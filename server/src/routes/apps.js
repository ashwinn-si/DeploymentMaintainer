import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import App from '../models/App.js';
import Deployment from '../models/Deployment.js';
import { HttpError } from '../lib/httpError.js';
import {
  validateAppName,
  validatePort,
  validateNodeVersion,
  validateEnvKey,
  validateEnvValue,
  validateRef,
} from '../lib/validate.js';
import { serializeAppSummary, serializeAppDetail, serializeDeploymentSummary } from '../lib/serializers.js';
import { defaultSteps, normalizeSteps } from '../steps/index.js';
import { allocatePort, assertPortAvailable } from '../services/ports.js';
import { encryptJSON, decryptAppEnv } from '../services/crypto.js';
import { safeRemoveAppDir } from '../services/git.js';
import { removePublishedApp } from '../steps/publish.js';
import { assertRoutePathFree } from '../services/routePaths.js';
import { removeAppRoute } from '../services/nginx.js';
import * as pm2Service from '../services/pm2.js';
import * as system from '../services/system.js';
import { getCommitsBehind, getCommitWindow, getLatestCommits } from '../services/github.js';
import { startDeployment, getActiveDeploymentId } from '../services/deployer.js';

const envEntrySchema = z.object({ key: z.string(), value: z.string() });
const stepInputSchema = z.object({
  type: z.string(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const createAppSchema = z.object({
  name: z.string(),
  kind: z.enum(['node', 'static']).optional(),
  repoFullName: z.string().min(1),
  branch: z.string().min(1),
  port: z.number().int().optional(),
  nodeVersion: z.string().min(1),
  env: z.array(envEntrySchema).default([]),
  steps: z.array(stepInputSchema).optional(),
  deploy: z.boolean().optional(),
});

const patchAppSchema = z.object({
  branch: z.string().min(1).optional(),
  port: z.number().int().optional(),
  nodeVersion: z.string().min(1).optional(),
  env: z.array(envEntrySchema).optional(),
  steps: z.array(stepInputSchema).optional(),
});

const deleteAppSchema = z.object({ confirmName: z.string() });

const duplicateAppSchema = z.object({
  name: z.string(),
  branch: z.string().min(1),
  port: z.number().int().optional(),
  nodeVersion: z.string().min(1).optional(),
  copyEnv: z.boolean(),
  deploy: z.boolean().optional(),
});

const deploySchema = z.object({
  branch: z.string().min(1).optional(),
  mode: z.enum(['update', 'fresh']),
  force: z.boolean().optional(),
});

function envArrayToObject(envArray) {
  const obj = {};
  for (const { key, value } of envArray) {
    validateEnvKey(key);
    validateEnvValue(value);
    obj[key] = value;
  }
  return obj;
}

// A PORT set in the env editor is the app's port: adopted when no explicit port is given,
// and rejected when it contradicts one (nginx and health checks use app.port, not the env).
function reconcilePort(requested, envObj) {
  const raw = envObj.PORT;
  if (raw === undefined || raw === '') return requested;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) {
    throw new HttpError(400, `PORT in environment variables must be an integer between 1024 and 65535, got "${raw}"`);
  }
  if (requested !== undefined && requested !== n) {
    throw new HttpError(400, `PORT in environment variables (${n}) does not match the port field (${requested}); make them match or remove PORT`);
  }
  return n;
}

function envObjectToArray(obj) {
  return Object.entries(obj || {}).map(([key, value]) => ({ key, value }));
}

async function getPm2Info(appName) {
  try {
    const list = await pm2Service.jlist();
    const proc = list[pm2Service.pm2Name(appName)];
    if (!proc) return { status: null, cpu: null, memory: null, restarts: null, uptimeMs: null };
    return {
      status: proc.pm2_env?.status ?? null,
      cpu: proc.monit?.cpu ?? null,
      memory: proc.monit?.memory ?? null,
      restarts: proc.pm2_env?.restart_time ?? null,
      uptimeMs: proc.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : null,
    };
  } catch {
    // pm2 missing/erroring shouldn't 500 the whole apps list.
    return { status: null, cpu: null, memory: null, restarts: null, uptimeMs: null };
  }
}

async function buildAppDetail(appDoc, config) {
  const app = appDoc.toObject ? appDoc.toObject() : appDoc;
  const pm2 = await getPm2Info(app.name);

  const env = envObjectToArray(decryptAppEnv(config, app.envEncrypted));
  // Kicks off a background du if the cache is stale/empty; never awaited here.
  system.refreshFolderSize(config, app.name);

  return serializeAppDetail(app, {
    pm2,
    activeDeploymentId: getActiveDeploymentId(app._id),
    env,
    diskBytes: system.getCachedFolderSize(app.name),
  });
}

// Static apps have no process, so they get no port; node apps get the requested or next free one.
async function resolvePort(config, kind, requested) {
  if (kind === 'static') {
    if (requested !== undefined && requested !== null) {
      throw new HttpError(400, 'Static apps do not use a port');
    }
    return null;
  }
  if (requested !== undefined) {
    validatePort(requested);
    await assertPortAvailable(requested);
    return requested;
  }
  return allocatePort(config);
}

function assertNodeApp(app, action) {
  if (app.kind === 'static') {
    throw new HttpError(409, `Static apps have no process to ${action}; redeploy to republish`);
  }
}

async function findAppOr404(id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'App not found');
  const app = await App.findById(id);
  if (!app) throw new HttpError(404, 'App not found');
  return app;
}

// Most recent deployment per commit sha for this app: Map<sha, { id, number, status }>.
async function latestDeploymentsBySha(app, shas) {
  const map = new Map();
  if (shas.length === 0) return map;
  const deployments = await Deployment.find({ appId: app._id, commitSha: { $in: shas } })
    .sort({ createdAt: -1 })
    .select('number status commitSha')
    .lean();
  for (const d of deployments) {
    if (!map.has(d.commitSha)) map.set(d.commitSha, { id: String(d._id), number: d.number, status: d.status });
  }
  return map;
}

async function annotateWithDeployments(app, commits) {
  const byCommit = await latestDeploymentsBySha(app, commits.map((c) => c.sha));
  return commits.map((c) => ({ ...c, deployment: byCommit.get(c.sha) ?? null }));
}

export function createAppsRouter(config) {
  const router = Router();
  router.use(requireAuth(config));

  router.get('/', async (req, res) => {
    const apps = await App.find().sort({ createdAt: 1 }).lean();
    const summaries = await Promise.all(apps.map(async (app) => serializeAppSummary(app, {
      pm2: await getPm2Info(app.name),
      activeDeploymentId: getActiveDeploymentId(app._id),
    })));
    res.json({ apps: summaries });
  });

  router.get('/defaults', async (req, res) => {
    const name = typeof req.query.name === 'string' && req.query.name.length > 0 ? req.query.name : 'my-app';
    const kind = req.query.kind === 'static' ? 'static' : 'node';
    const port = kind === 'static' ? null : await allocatePort(config);
    const preset = req.query.preset === 'frontend' ? 'frontend' : 'html';
    res.json({ kind, steps: defaultSteps(name, kind, preset), port, nodeVersion: config.DEFAULT_NODE_VERSION });
  });

  router.post('/', async (req, res) => {
    const body = createAppSchema.parse(req.body);
    validateAppName(body.name);

    const existing = await App.findOne({ name: body.name });
    if (existing) throw new HttpError(409, `An app named "${body.name}" already exists`);

    const kind = body.kind ?? 'node';
    const envObj = envArrayToObject(body.env ?? []);
    const port = await resolvePort(config, kind, kind === 'static' ? body.port : reconcilePort(body.port, envObj));

    validateNodeVersion(body.nodeVersion);
    const steps = normalizeSteps(body.steps?.length ? body.steps : defaultSteps(body.name, kind), { kind });
    await assertRoutePathFree(body.name, steps);

    const app = await App.create({
      name: body.name,
      repoFullName: body.repoFullName,
      branch: body.branch,
      kind,
      port,
      nodeVersion: body.nodeVersion,
      envEncrypted: encryptJSON(config, envObj),
      steps,
    });

    let deployment = null;
    if (body.deploy) {
      const dep = await startDeployment(String(app._id), config, { mode: 'update' });
      deployment = serializeDeploymentSummary(dep, { appName: app.name });
    }

    res.status(201).json({ app: await buildAppDetail(app, config), deployment });
  });

  router.get('/:id', async (req, res) => {
    const app = await findAppOr404(req.params.id);
    res.json({ app: await buildAppDetail(app, config) });
  });

  router.patch('/:id', async (req, res) => {
    const body = patchAppSchema.parse(req.body);
    const app = await findAppOr404(req.params.id);

    if (body.branch !== undefined) {
      validateRef(body.branch);
      app.branch = body.branch;
    }
    const envObj = body.env !== undefined ? envArrayToObject(body.env) : undefined;
    const newPort = envObj && app.kind !== 'static' ? reconcilePort(body.port, envObj) : body.port;
    if (newPort !== undefined) {
      if (app.kind === 'static') throw new HttpError(400, 'Static apps do not use a port');
      validatePort(newPort);
      if (newPort !== app.port) await assertPortAvailable(newPort, app._id);
      app.port = newPort;
    }
    if (body.nodeVersion !== undefined) {
      validateNodeVersion(body.nodeVersion);
      app.nodeVersion = body.nodeVersion;
    }
    if (envObj) {
      app.envEncrypted = encryptJSON(config, envObj);
    }
    if (body.steps !== undefined) {
      const steps = normalizeSteps(body.steps, { kind: app.kind });
      await assertRoutePathFree(app.name, steps, { excludeId: app._id });
      app.steps = steps;
    }

    await app.save();
    res.json({ app: await buildAppDetail(app, config) });
  });

  router.delete('/:id', async (req, res) => {
    const body = deleteAppSchema.parse(req.body);
    const app = await findAppOr404(req.params.id);
    if (body.confirmName !== app.name) {
      throw new HttpError(400, 'confirmName does not match the app name');
    }
    if (getActiveDeploymentId(app._id)) {
      throw new HttpError(409, 'Cannot delete while a deployment is running');
    }

    if (app.kind !== 'static') {
      try {
        await pm2Service.remove(pm2Service.pm2Name(app.name));
      } catch (err) {
        if (!/not (found|exist)/i.test(err.message)) {
          console.error(`apps: pm2 delete failed for ${app.name}: ${err.message}`);
        }
      }
    }
    try {
      await removeAppRoute(app, { config });
    } catch (err) {
      console.error(`apps: removeAppRoute failed for ${app.name}: ${err.message}`);
    }
    try {
      await safeRemoveAppDir(config, app.name);
      await removePublishedApp(config, app.name);
    } catch (err) {
      console.error(`apps: safeRemoveAppDir failed for ${app.name}: ${err.message}`);
    }

    await Deployment.deleteMany({ appId: app._id });
    await App.deleteOne({ _id: app._id });

    res.json({ ok: true });
  });

  router.post('/:id/duplicate', async (req, res) => {
    const body = duplicateAppSchema.parse(req.body);
    const source = await findAppOr404(req.params.id);

    validateAppName(body.name);
    const existing = await App.findOne({ name: body.name });
    if (existing) throw new HttpError(409, `An app named "${body.name}" already exists`);

    const kind = source.kind ?? 'node';
    const port = await resolvePort(config, kind, body.port);

    const nodeVersion = body.nodeVersion ?? source.nodeVersion;
    validateNodeVersion(nodeVersion);

    let envEncrypted = body.copyEnv ? source.envEncrypted : encryptJSON(config, {});
    if (body.copyEnv && kind !== 'static') {
      // The copy gets its own port, so a PORT carried over from the original must follow it.
      const copied = decryptAppEnv(config, source.envEncrypted);
      if ('PORT' in copied) envEncrypted = encryptJSON(config, { ...copied, PORT: String(port) });
    }
    const steps = normalizeSteps(JSON.parse(JSON.stringify(source.steps)), { kind });
    // A copy must not inherit the original's URL path, or Nginx would serve only one of them.
    for (const step of steps) {
      if (step.type === 'nginx') step.config = { ...step.config, path: `/${body.name}` };
    }
    await assertRoutePathFree(body.name, steps);

    const app = await App.create({
      name: body.name,
      repoFullName: source.repoFullName,
      branch: body.branch,
      kind,
      port,
      nodeVersion,
      envEncrypted,
      steps,
    });

    let deployment = null;
    if (body.deploy) {
      const dep = await startDeployment(String(app._id), config, { mode: 'update' });
      deployment = serializeDeploymentSummary(dep, { appName: app.name });
    }

    res.status(201).json({ app: await buildAppDetail(app, config), deployment });
  });

  router.post('/:id/deploy', async (req, res) => {
    const body = deploySchema.parse(req.body);
    const app = await findAppOr404(req.params.id);
    const deployment = await startDeployment(String(app._id), config, { branch: body.branch, mode: body.mode, force: body.force });
    res.json({ deployment: serializeDeploymentSummary(deployment, { appName: app.name }) });
  });

  router.post('/:id/restart', async (req, res) => {
    const app = await findAppOr404(req.params.id);
    assertNodeApp(app, 'restart');
    await pm2Service.restart(pm2Service.pm2Name(app.name));
    app.status = 'online';
    await app.save();
    res.json({ app: serializeAppSummary(app, {
      pm2: await getPm2Info(app.name),
      activeDeploymentId: getActiveDeploymentId(app._id),
    }) });
  });

  router.post('/:id/stop', async (req, res) => {
    const app = await findAppOr404(req.params.id);
    assertNodeApp(app, 'stop');
    await pm2Service.stop(pm2Service.pm2Name(app.name));
    app.status = 'stopped';
    await app.save();
    res.json({ app: serializeAppSummary(app, {
      pm2: await getPm2Info(app.name),
      activeDeploymentId: getActiveDeploymentId(app._id),
    }) });
  });

  router.get('/:id/updates', async (req, res) => {
    const app = await findAppOr404(req.params.id);
    if (!app.currentCommitSha || !app.repoFullName) return res.json({ behindBy: 0, commits: [] });
    const [owner, repo] = app.repoFullName.split('/');
    res.json(await getCommitsBehind(config, owner, repo, app.currentCommitSha, app.branch));
  });

  // Commit timeline around the deployed commit, each commit annotated with its latest deployment (if any).
  router.get('/:id/commits', async (req, res) => {
    const app = await findAppOr404(req.params.id);
    const [owner, repo] = app.repoFullName.split('/');

    if (!app.currentCommitSha) {
      const older = await getLatestCommits(config, owner, repo, app.branch, 10);
      const annotated = await annotateWithDeployments(app, older);
      return res.json({ deployed: null, missing: false, neverDeployed: true, newer: [], newerTotal: 0, older: annotated });
    }

    const window = await getCommitWindow(config, owner, repo, app.currentCommitSha, app.branch);
    const allShas = [window.deployed, ...window.newer, ...window.older].filter(Boolean).map((c) => c.sha);
    const byCommit = await latestDeploymentsBySha(app, allShas);
    const annotate = (c) => ({ ...c, deployment: byCommit.get(c.sha) ?? null });
    res.json({
      deployed: window.deployed ? annotate(window.deployed) : null,
      missing: Boolean(window.missing),
      neverDeployed: false,
      newer: window.newer.map(annotate),
      newerTotal: window.newerTotal,
      older: window.older.map(annotate),
    });
  });

  router.get('/:id/logs', async (req, res) => {
    const app = await findAppOr404(req.params.id);
    const lines = Number(req.query.lines) > 0 ? Number(req.query.lines) : 200;
    if (app.kind === 'static') {
      const text = '(static site: no runtime process, so no runtime logs)';
      return res.json({ text, out: text, err: '' });
    }
    try {
      const raw = await pm2Service.logs(pm2Service.pm2Name(app.name), lines);
      const { out, err } = pm2Service.splitLogs(raw);
      res.json({ text: raw, out, err });
    } catch (err) {
      const text = `(unable to read logs: ${err.message})`;
      res.json({ text, out: text, err: '' });
    }
  });

  router.get('/:id/deployments', async (req, res) => {
    const app = await findAppOr404(req.params.id);
    const limit = Math.min(Number(req.query.limit) > 0 ? Number(req.query.limit) : 50, 200);
    const query = { appId: app._id };
    if (req.query.before) query.createdAt = { $lt: new Date(String(req.query.before)) };
    const deployments = await Deployment.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ deployments: deployments.map((d) => serializeDeploymentSummary(d, { appName: app.name })) });
  });

  return router;
}

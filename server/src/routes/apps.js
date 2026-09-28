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
import { removeAppRoute } from '../services/nginx.js';
import * as pm2Service from '../services/pm2.js';
import { startDeployment, getActiveDeploymentId } from '../services/deployer.js';

const envEntrySchema = z.object({ key: z.string(), value: z.string() });
const stepInputSchema = z.object({
  type: z.string(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const createAppSchema = z.object({
  name: z.string(),
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

  return serializeAppDetail(app, {
    pm2,
    activeDeploymentId: getActiveDeploymentId(app._id),
    env,
    diskBytes: null,
  });
}

async function findAppOr404(id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'App not found');
  const app = await App.findById(id);
  if (!app) throw new HttpError(404, 'App not found');
  return app;
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
    const port = await allocatePort(config);
    res.json({ steps: defaultSteps(name), port, nodeVersion: config.DEFAULT_NODE_VERSION });
  });

  router.post('/', async (req, res) => {
    const body = createAppSchema.parse(req.body);
    validateAppName(body.name);

    const existing = await App.findOne({ name: body.name });
    if (existing) throw new HttpError(409, `An app named "${body.name}" already exists`);

    let port = body.port;
    if (port !== undefined) {
      validatePort(port);
      await assertPortAvailable(port);
    } else {
      port = await allocatePort(config);
    }

    validateNodeVersion(body.nodeVersion);
    const envObj = envArrayToObject(body.env ?? []);
    const steps = normalizeSteps(body.steps?.length ? body.steps : defaultSteps(body.name));

    const app = await App.create({
      name: body.name,
      repoFullName: body.repoFullName,
      branch: body.branch,
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
    if (body.port !== undefined) {
      validatePort(body.port);
      if (body.port !== app.port) await assertPortAvailable(body.port, app._id);
      app.port = body.port;
    }
    if (body.nodeVersion !== undefined) {
      validateNodeVersion(body.nodeVersion);
      app.nodeVersion = body.nodeVersion;
    }
    if (body.env !== undefined) {
      app.envEncrypted = encryptJSON(config, envArrayToObject(body.env));
    }
    if (body.steps !== undefined) {
      app.steps = normalizeSteps(body.steps);
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

    try {
      await pm2Service.remove(pm2Service.pm2Name(app.name));
    } catch (err) {
      if (!/not (found|exist)/i.test(err.message)) {
        console.error(`apps: pm2 delete failed for ${app.name}: ${err.message}`);
      }
    }
    try {
      await removeAppRoute(app, { config });
    } catch (err) {
      console.error(`apps: removeAppRoute failed for ${app.name}: ${err.message}`);
    }
    try {
      await safeRemoveAppDir(config, app.name);
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

    let port = body.port;
    if (port !== undefined) {
      validatePort(port);
      await assertPortAvailable(port);
    } else {
      port = await allocatePort(config);
    }

    const nodeVersion = body.nodeVersion ?? source.nodeVersion;
    validateNodeVersion(nodeVersion);

    const envEncrypted = body.copyEnv ? source.envEncrypted : encryptJSON(config, {});
    const steps = normalizeSteps(JSON.parse(JSON.stringify(source.steps)));

    const app = await App.create({
      name: body.name,
      repoFullName: source.repoFullName,
      branch: body.branch,
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
    const deployment = await startDeployment(String(app._id), config, { branch: body.branch, mode: body.mode });
    res.json({ deployment: serializeDeploymentSummary(deployment, { appName: app.name }) });
  });

  router.post('/:id/restart', async (req, res) => {
    const app = await findAppOr404(req.params.id);
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
    await pm2Service.stop(pm2Service.pm2Name(app.name));
    app.status = 'stopped';
    await app.save();
    res.json({ app: serializeAppSummary(app, {
      pm2: await getPm2Info(app.name),
      activeDeploymentId: getActiveDeploymentId(app._id),
    }) });
  });

  router.get('/:id/logs', async (req, res) => {
    const app = await findAppOr404(req.params.id);
    const lines = Number(req.query.lines) > 0 ? Number(req.query.lines) : 200;
    let text = '';
    try {
      text = await pm2Service.logs(pm2Service.pm2Name(app.name), lines);
    } catch (err) {
      text = `(unable to read logs: ${err.message})`;
    }
    res.json({ text });
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

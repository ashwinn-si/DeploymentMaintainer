import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import App from '../models/App.js';
import { HttpError } from '../lib/httpError.js';
import {
  validateAppName,
  validatePort,
  validateNodeVersion,
  validateEnvKey,
  validateEnvValue,
  validateRef,
  validateOwner,
  validateRepo,
} from '../lib/validate.js';
import { serializeAppSummary, serializeDeploymentSummary } from '../lib/serializers.js';
import { normalizeSteps } from '../steps/index.js';
import { isPortFree } from '../services/ports.js';
import { encryptJSON, decryptAppEnv, encryptWithPassphrase, decryptWithPassphrase } from '../services/crypto.js';
import { startDeployment, getActiveDeploymentId } from '../services/deployer.js';

const FORMAT = 'deployment-maintainer';
const VERSION = 1;

// --- Shared file shape -------------------------------------------------------

const encryptedBlobSchema = z.object({
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
  salt: z.string(),
});

const exportedStepSchema = z.object({
  type: z.string(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const exportedAppSchema = z.object({
  name: z.string().min(1),
  repoFullName: z.string().min(1),
  branch: z.string().min(1),
  port: z.number().int(),
  nodeVersion: z.string().min(1),
  steps: z.array(exportedStepSchema),
  env: encryptedBlobSchema,
});

const fileSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(VERSION),
  exportedAt: z.string(),
  apps: z.array(exportedAppSchema),
});

// --- Export ------------------------------------------------------------------

const exportSchema = z.object({
  appIds: z.array(z.string()).optional(),
  passphrase: z.string().min(8),
});

async function loadAppsForExport(appIds) {
  if (!appIds || appIds.length === 0) return App.find().lean();
  for (const id of appIds) {
    if (!mongoose.isValidObjectId(id)) throw new HttpError(400, `Invalid app id: ${id}`);
  }
  return App.find({ _id: { $in: appIds } }).lean();
}

// --- Import preview: conflict detection ---------------------------------------

function nextAvailableName(base, taken) {
  let candidate = `${base}-imported`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-imported-${n}`;
    n += 1;
  }
  return candidate;
}

async function computeConflictRows(exportedApps) {
  const existingApps = await App.find().lean();
  const existingNames = new Set(existingApps.map((a) => a.name));
  const existingPorts = new Set(existingApps.map((a) => a.port));

  const portCounts = new Map();
  for (const a of exportedApps) portCounts.set(a.port, (portCounts.get(a.port) ?? 0) + 1);

  const takenNames = new Set([...existingNames, ...exportedApps.map((a) => a.name)]);

  return exportedApps.map((a) => {
    let conflict = null;
    if (existingNames.has(a.name)) conflict = 'name';
    else if (existingPorts.has(a.port) || portCounts.get(a.port) > 1) conflict = 'port';

    const suggestedName = nextAvailableName(a.name, takenNames);
    takenNames.add(suggestedName);

    return {
      name: a.name,
      repoFullName: a.repoFullName,
      branch: a.branch,
      port: a.port,
      conflict,
      suggestedName,
    };
  });
}

// --- Import apply --------------------------------------------------------------

const importRowSchema = z.object({
  name: z.string().min(1),
  action: z.enum(['create', 'skip']),
  newName: z.string().optional(),
});

const importApplySchema = z.object({
  file: fileSchema,
  passphrase: z.string().min(1),
  rows: z.array(importRowSchema),
  deploy: z.boolean().optional(),
});

const importPreviewSchema = z.object({
  file: fileSchema,
  passphrase: z.string().min(1),
});

// Finds a free port not already claimed by an existing App or by an earlier
// row in this same import batch (those rows aren't persisted yet).
async function allocatePortExcluding(config, taken) {
  for (let port = config.APP_PORT_START; port <= 65535; port += 1) {
    if (!taken.has(port) && (await isPortFree(port))) return port;
  }
  throw new HttpError(500, 'No free ports available');
}

function validateEnvObject(env) {
  for (const [key, value] of Object.entries(env)) {
    validateEnvKey(key);
    validateEnvValue(value);
  }
  return env;
}

// Validates every "create" row against the file + existing DB state and
// returns fully-resolved specs ready to be written. Throws on the first
// invalid row — nothing is created until every row has passed.
async function validateImportRows(file, rows, decryptedEnvByName, config) {
  const fileAppsByName = new Map(file.apps.map((a) => [a.name, a]));
  const existingApps = await App.find().lean();
  const existingNames = new Set(existingApps.map((a) => a.name));
  const existingPorts = new Set(existingApps.map((a) => a.port));

  const namesInBatch = new Set();
  const portsInBatch = new Set();
  const specs = [];

  for (const row of rows) {
    if (row.action !== 'create') continue;

    const fileApp = fileAppsByName.get(row.name);
    if (!fileApp) throw new HttpError(400, `Row references an app not present in the file: "${row.name}"`);

    const finalName = row.newName?.trim() || row.name;
    validateAppName(finalName);
    if (existingNames.has(finalName) || namesInBatch.has(finalName)) {
      throw new HttpError(400, `An app named "${finalName}" already exists`);
    }
    namesInBatch.add(finalName);

    const [owner, repo, extra] = String(fileApp.repoFullName).split('/');
    if (extra !== undefined) throw new HttpError(400, `Invalid repository: "${fileApp.repoFullName}"`);
    validateOwner(owner);
    validateRepo(repo);
    validateRef(fileApp.branch);
    validateNodeVersion(fileApp.nodeVersion);
    const steps = normalizeSteps(fileApp.steps);

    const env = decryptedEnvByName.get(row.name);
    validateEnvObject(env);

    let port = fileApp.port;
    validatePort(port);
    const portTaken = existingPorts.has(port) || portsInBatch.has(port) || !(await isPortFree(port));
    if (portTaken) {
      port = await allocatePortExcluding(config, new Set([...existingPorts, ...portsInBatch]));
    }
    portsInBatch.add(port);

    // Only rewrite the nginx path if it was still the app's default (explicit
    // or implicit); a custom path is left alone even though the app was renamed.
    if (finalName !== row.name) {
      const nginxStep = steps.find((s) => s.type === 'nginx');
      if (nginxStep) {
        const currentPath = nginxStep.config?.path;
        const wasDefault = !currentPath || currentPath === `/${row.name}`;
        if (wasDefault) {
          nginxStep.config = { ...nginxStep.config, path: `/${finalName}` };
        }
      }
    }

    specs.push({
      finalName,
      repoFullName: fileApp.repoFullName,
      branch: fileApp.branch,
      port,
      nodeVersion: fileApp.nodeVersion,
      steps,
      env,
    });
  }

  return specs;
}

export function createConfigIoRouter(config) {
  const router = Router();
  router.use(requireAuth(config));

  router.post('/export', async (req, res) => {
    const body = exportSchema.parse(req.body);
    const apps = await loadAppsForExport(body.appIds);

    const exportedApps = apps.map((app) => ({
      name: app.name,
      repoFullName: app.repoFullName,
      branch: app.branch,
      port: app.port,
      nodeVersion: app.nodeVersion,
      steps: (app.steps || []).map((s) => ({ type: s.type, enabled: s.enabled, config: s.config })),
      env: encryptWithPassphrase(decryptAppEnv(config, app.envEncrypted), body.passphrase),
    }));

    const exportedAt = new Date().toISOString();
    const payload = { format: FORMAT, version: VERSION, exportedAt, apps: exportedApps };
    const filename = `deployer-config-${exportedAt.slice(0, 10)}.json`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.type('application/json').send(JSON.stringify(payload, null, 2));
  });

  router.post('/import/preview', async (req, res) => {
    const body = importPreviewSchema.parse(req.body);
    // Decrypt every app's env up front so a wrong passphrase fails the whole
    // request clearly, rather than surfacing later per-row.
    for (const app of body.file.apps) {
      decryptWithPassphrase(app.env, body.passphrase);
    }
    const rows = await computeConflictRows(body.file.apps);
    res.json({ rows });
  });

  router.post('/import', async (req, res) => {
    const body = importApplySchema.parse(req.body);

    const decryptedEnvByName = new Map();
    for (const app of body.file.apps) {
      decryptedEnvByName.set(app.name, decryptWithPassphrase(app.env, body.passphrase));
    }

    const specs = await validateImportRows(body.file, body.rows, decryptedEnvByName, config);

    const created = [];
    for (const spec of specs) {
      const app = await App.create({
        name: spec.finalName,
        repoFullName: spec.repoFullName,
        branch: spec.branch,
        port: spec.port,
        nodeVersion: spec.nodeVersion,
        envEncrypted: encryptJSON(config, spec.env),
        steps: spec.steps,
        status: 'not_deployed',
      });
      created.push(app);
    }

    const deployments = [];
    if (body.deploy) {
      for (const app of created) {
        try {
          const dep = await startDeployment(String(app._id), config, { mode: 'update' });
          deployments.push(serializeDeploymentSummary(dep, { appName: app.name }));
        } catch (err) {
          console.error(`config-io: failed to start deployment for ${app.name}: ${err.message}`);
        }
      }
    }

    res.json({
      created: created.map((app) => serializeAppSummary(app, { activeDeploymentId: getActiveDeploymentId(app._id) })),
      deployments,
    });
  });

  return router;
}

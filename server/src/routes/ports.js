import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import App from '../models/App.js';
import * as pm2Service from '../services/pm2.js';
import { isPortFree } from '../services/ports.js';

function toIso(d) {
  return d ? new Date(d).toISOString() : null;
}

export function createPortsRouter(config) {
  const router = Router();
  router.use(requireAuth(config));

  router.get('/', async (req, res) => {
    const apps = await App.find().sort({ port: 1 }).lean();

    let pm2ByName = {};
    try {
      pm2ByName = await pm2Service.jlist();
    } catch {
      pm2ByName = {};
    }

    const rows = await Promise.all(apps.map(async (app) => {
      const proc = pm2ByName[pm2Service.pm2Name(app.name)];
      const pm2Status = proc?.pm2_env?.status ?? null;
      const nginxStep = app.steps.find((s) => s.type === 'nginx');
      const nginxOn = Boolean(nginxStep?.enabled);
      const path = nginxOn ? (nginxStep.config?.path || `/${app.name}`) : null;

      let conflict = null;
      const sameApp = apps.find((other) => String(other._id) !== String(app._id) && other.port === app.port);
      if (sameApp) {
        conflict = 'port used by another app';
      } else if (app.status !== 'online' && !(await isPortFree(app.port))) {
        conflict = 'port in use by an unmanaged process';
      }

      return {
        port: app.port,
        appId: String(app._id),
        appName: app.name,
        repoFullName: app.repoFullName,
        branch: app.branch,
        path,
        nodeVersion: app.nodeVersion,
        pm2Status,
        health: {
          ok: app.health?.ok ?? false,
          statusCode: app.health?.statusCode ?? null,
          latencyMs: app.health?.latencyMs ?? null,
          checkedAt: toIso(app.health?.checkedAt),
        },
        nginx: nginxOn,
        lastDeployedAt: toIso(app.lastDeployedAt),
        conflict,
      };
    }));

    res.json({ dashboard: { port: config.PORT }, rows });
  });

  return router;
}

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import App from '../models/App.js';
import * as pm2Service from '../services/pm2.js';
import { isPortFree } from '../services/ports.js';
import { isHealthMonitorRunning } from '../services/monitor.js';

function toIso(d) {
  return d ? new Date(d).toISOString() : null;
}

export function createPortsRouter(config) {
  const router = Router();
  router.use(requireAuth(config));

  router.get('/', async (req, res) => {
    const all = await App.find().sort({ port: 1, name: 1 }).lean();
    // Static apps hold no port; they are listed after the process apps so every route is visible in one place.
    const apps = all.filter((a) => a.kind !== 'static');
    const staticApps = all.filter((a) => a.kind === 'static');

    let pm2ByName = {};
    try {
      pm2ByName = await pm2Service.jlist();
    } catch {
      pm2ByName = {};
    }

    const routeOf = (app) => {
      const nginxStep = app.steps.find((s) => s.type === 'nginx');
      const nginxOn = Boolean(nginxStep?.enabled);
      return { nginx: nginxOn, path: nginxOn ? (nginxStep.config?.path || `/${app.name}`) : null };
    };

    const healthOf = (app) => ({
      ok: app.health?.ok ?? false,
      statusCode: app.health?.statusCode ?? null,
      latencyMs: app.health?.latencyMs ?? null,
      checkedAt: toIso(app.health?.checkedAt),
    });

    const monitoring = isHealthMonitorRunning();
    const healthMonitoring = (app) => monitoring && app.steps.some((s) => s.type === 'healthCheck' && s.enabled);

    const rows = await Promise.all(apps.map(async (app) => {
      const proc = pm2ByName[pm2Service.pm2Name(app.name)];
      const pm2Status = proc?.pm2_env?.status ?? null;
      // A free port means nothing is listening on it, i.e. the app is not actually reachable there.
      const listening = !(await isPortFree(app.port));

      let conflict = null;
      const sameApp = apps.find((other) => String(other._id) !== String(app._id) && other.port === app.port);
      if (sameApp) {
        conflict = 'port used by another app';
      } else if (listening && pm2Status !== 'online') {
        conflict = 'port in use by an unmanaged process';
      }

      return {
        kind: 'node',
        port: app.port,
        appId: String(app._id),
        appName: app.name,
        repoFullName: app.repoFullName,
        branch: app.branch,
        ...routeOf(app),
        nodeVersion: app.nodeVersion,
        pm2Status,
        listening,
        healthMonitoring: healthMonitoring(app),
        health: healthOf(app),
        lastDeployedAt: toIso(app.lastDeployedAt),
        conflict,
      };
    }));

    const staticRows = staticApps.map((app) => ({
      kind: 'static',
      port: null,
      appId: String(app._id),
      appName: app.name,
      repoFullName: app.repoFullName,
      branch: app.branch,
      ...routeOf(app),
      nodeVersion: app.nodeVersion,
      pm2Status: null,
      listening: null,
      healthMonitoring: healthMonitoring(app),
      health: healthOf(app),
      lastDeployedAt: toIso(app.lastDeployedAt),
      conflict: null,
    }));

    res.json({ dashboard: { port: config.PORT }, rows: [...rows, ...staticRows] });
  });

  return router;
}

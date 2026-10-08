import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import App from '../models/App.js';
import * as pm2Service from '../services/pm2.js';
import * as system from '../services/system.js';
import * as monitor from '../services/monitor.js';

function toIso(d) {
  return d ? new Date(d).toISOString() : null;
}

async function buildApps(config) {
  const apps = await App.find().lean();

  let pm2ByName = {};
  try {
    pm2ByName = await pm2Service.jlist();
  } catch {
    // pm2 missing/erroring shouldn't 500 the whole /system response
    pm2ByName = {};
  }

  return apps.map((app) => {
    const proc = pm2ByName[pm2Service.pm2Name(app.name)];
    // Kicks off a background du if the cache is stale/empty; never awaited here.
    system.refreshFolderSize(config, app.name);

    return {
      appId: String(app._id),
      appName: app.name,
      pm2Status: proc?.pm2_env?.status ?? null,
      cpu: proc?.monit?.cpu ?? null,
      memory: proc?.monit?.memory ?? null,
      restarts: proc?.pm2_env?.restart_time ?? null,
      uptimeMs: proc?.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : null,
      diskBytes: system.getCachedFolderSize(app.name),
      healthMonitoring: monitor.isHealthMonitorRunning() && app.steps.some((s) => s.type === 'healthCheck' && s.enabled),
      health: {
        ok: app.health?.ok ?? false,
        statusCode: app.health?.statusCode ?? null,
        latencyMs: app.health?.latencyMs ?? null,
        checkedAt: toIso(app.health?.checkedAt),
      },
    };
  });
}

export function createSystemRouter(config) {
  const router = Router();
  router.use(requireAuth(config));

  router.get('/', async (req, res) => {
    const disks = await system.getDisks(config);
    const [current, info, apps] = await Promise.all([
      system.getCurrentSample(config, { disks }),
      system.getInfo(config),
      buildApps(config),
    ]);

    res.json({ current, history: monitor.getHistory(), info, disks, apps });
  });

  return router;
}

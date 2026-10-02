import os from 'node:os';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getTokenInfo } from '../services/github.js';

export function createSettingsRouter(config) {
  const router = Router();
  router.use(requireAuth(config));

  router.get('/info', async (req, res) => {
    let github;
    try {
      github = await getTokenInfo(config);
    } catch (err) {
      github = { error: err.message };
    }
    res.json({
      github,
      appsDir: config.APPS_DIR,
      nginxEnabled: config.NGINX_ENABLED,
      domainHint: null,
      serverId: config.SERVER_ID,
      hostname: os.hostname(),
    });
  });

  return router;
}

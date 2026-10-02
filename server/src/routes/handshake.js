import fs from 'node:fs';
import os from 'node:os';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';

const { version } = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

// Mounted at the app root: /deployment-manager is public, /api/auth/check is not.
export function createHandshakeRouter(config) {
  const router = Router();

  const handshakeLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
  });

  router.get('/deployment-manager', handshakeLimiter, (req, res) => {
    res.json({ service: 'deployment-maintainer', serverId: config.SERVER_ID, version });
  });

  router.get('/api/auth/check', requireAuth(config), (req, res) => {
    res.json({ ok: true, serverId: config.SERVER_ID, hostname: os.hostname() });
  });

  return router;
}

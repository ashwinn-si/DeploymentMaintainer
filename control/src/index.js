import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { ZodError } from 'zod';
import { createAuthRouter } from './routes/auth.js';
import { createAccountRouter } from './routes/account.js';
import { createServersRouter } from './routes/servers.js';
import { createProxyHandler } from './routes/proxy.js';
import { requireAuth } from './middleware/auth.js';
import { createStatusCache } from './services/statusCache.js';
import { loadConfig } from './config.js';
import { connectDB, disconnectDB } from './db.js';
import { HttpError } from './lib/httpError.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(config) {
  const app = express();
  const statusCache = createStatusCache();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());

  // Mounted before express.json() so request bodies stream through untouched.
  app.all('/api/servers/:id/api/*rest', requireAuth(config), createProxyHandler(config, statusCache));

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', createAuthRouter(config));
  app.use('/api/settings', createAccountRouter(config));
  app.use('/api/servers', createServersRouter(config, statusCache));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.use((req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', issues: err.issues });
    }
    const status = err.status ?? err.statusCode;
    const exposed = err instanceof HttpError ? err.expose !== false : err.expose === true;
    if (status && exposed) {
      return res.status(status).json({ error: err.message });
    }
    console.error(err.stack || err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  await connectDB(config.MONGO_URI);

  const app = createApp(config);
  const server = app.listen(config.PORT, () => {
    console.log(`Control plane listening on port ${config.PORT}`);
  });

  // pm2 reload sends SIGINT, so this must actually drain rather than just exit.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down...`);
    await new Promise((resolve) => {
      server.close(resolve);
      // Idle keep-alive sockets would otherwise hold close() open indefinitely.
      server.closeIdleConnections?.();
      // Open SSE proxies never go idle; give them a moment, then cut them.
      setTimeout(() => server.closeAllConnections?.(), 2000).unref();
    });
    await disconnectDB();
    process.exit(0);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}

import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { createHandshakeRouter } from './routes/handshake.js';
import { createReposRouter } from './routes/repos.js';
import { createAppsRouter } from './routes/apps.js';
import { createDeploymentsRouter } from './routes/deployments.js';
import { createPortsRouter } from './routes/ports.js';
import { createNodeRouter } from './routes/node.js';
import { createSystemRouter } from './routes/system.js';
import { createSettingsRouter } from './routes/settings.js';
import { createConfigIoRouter } from './routes/config-io.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import { loadConfig } from './config.js';
import { connectDB, disconnectDB } from './db.js';
import { HttpError } from './lib/httpError.js';
import { recoverInterruptedDeployments } from './services/deployer.js';
import { startMonitor, stopMonitor } from './services/monitor.js';
import { startAnalytics, stopAnalytics } from './services/analytics.js';

export function createApp(config) {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use(createHandshakeRouter(config));
  app.use('/api/repos', createReposRouter(config));
  app.use('/api/apps', createAppsRouter(config));
  app.use('/api/deployments', createDeploymentsRouter(config));
  app.use('/api/ports', createPortsRouter(config));
  app.use('/api/node', createNodeRouter(config));
  app.use('/api/system', createSystemRouter(config));
  app.use('/api/settings', createSettingsRouter(config));
  app.use('/api/config', createConfigIoRouter(config));
  app.use('/api/analytics', createAnalyticsRouter(config));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

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

export async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  await connectDB(config.MONGO_URI);
  const recovered = await recoverInterruptedDeployments(config);
  if (recovered > 0) {
    console.log(`Recovered ${recovered} deployment(s) interrupted by a restart.`);
  }
  startMonitor(config);
  startAnalytics(config);

  const app = createApp(config);
  const server = app.listen(config.PORT, () => {
    console.log(`Server listening on port ${config.PORT}`);
  });

  // pm2 reload sends SIGINT, so this must actually drain rather than just exit.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down...`);
    stopMonitor();
    stopAnalytics();
    await new Promise((resolve) => {
      server.close(resolve);
      // Idle keep-alive sockets would otherwise hold close() open indefinitely.
      server.closeIdleConnections?.();
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

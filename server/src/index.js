import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { ZodError } from 'zod';
import { createAuthRouter } from './routes/auth.js';
import { createReposRouter } from './routes/repos.js';
import { createAppsRouter } from './routes/apps.js';
import { createDeploymentsRouter } from './routes/deployments.js';
import { createPortsRouter } from './routes/ports.js';
import { createNodeRouter } from './routes/node.js';
import { loadConfig } from './config.js';
import { connectDB } from './db.js';
import { HttpError } from './lib/httpError.js';
import { recoverInterruptedDeployments } from './services/deployer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(config) {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', createAuthRouter(config));
  app.use('/api/repos', createReposRouter(config));
  app.use('/api/apps', createAppsRouter(config));
  app.use('/api/deployments', createDeploymentsRouter(config));
  app.use('/api/ports', createPortsRouter(config));
  app.use('/api/node', createNodeRouter(config));

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
  const recovered = await recoverInterruptedDeployments();
  if (recovered > 0) {
    console.log(`Recovered ${recovered} deployment(s) interrupted by a restart.`);
  }
  const app = createApp(config);
  app.listen(config.PORT, () => {
    console.log(`Server listening on port ${config.PORT}`);
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}

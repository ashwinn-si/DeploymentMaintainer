import bcrypt from 'bcryptjs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../src/index.js';
import User from '../../src/models/User.js';
import { createShims, patchProcessEnv } from './shims.js';
import { createGitFixture } from './gitFixture.js';
import { connectTestDB } from './db.js';

// A distinct port range per test file (its own OS process under node --test),
// so parallel files never fight over the same bind-test / pm2-launched ports.
// 7000-8999 avoids every port the Fetch spec forbids (e.g. 6000, 6665-6669),
// which fetch() in tests would otherwise refuse with "bad port".
const PORT_BASE = 7000 + (process.pid % 2000);

export async function setupTestServer({ nginxEnabled = false } = {}) {
  await connectTestDB();
  const shims = await createShims();
  const restoreEnv = patchProcessEnv(shims);

  const fixture = await createGitFixture();
  const appsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-apps-'));
  const nginxAppsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-nginx-'));

  const config = {
    PORT: 3099,
    MONGO_URI: 'unused-in-tests',
    JWT_SECRET: 'x'.repeat(32),
    ENCRYPTION_KEY: 'a'.repeat(64),
    GITHUB_TOKEN: undefined,
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'test-admin-password',
    APPS_DIR: appsDir,
    NGINX_APPS_DIR: nginxAppsDir,
    APP_PORT_START: PORT_BASE,
    DEFAULT_NODE_VERSION: '20',
    NGINX_ENABLED: nginxEnabled,
    NODE_ENV: 'test',
    GIT_REMOTE_BASE: fixture.remoteBase,
  };

  const passwordHash = await bcrypt.hash(config.ADMIN_PASSWORD, 4);
  await User.create({ email: config.ADMIN_EMAIL, passwordHash });

  const app = createApp(config);
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD }).expect(200);

  return {
    agent,
    app,
    config,
    shims,
    fixture,
    appsDir,
    nginxAppsDir,
    async cleanup() {
      restoreEnv();
      await shims.cleanup();
      await fixture.cleanup();
      await fsp.rm(appsDir, { recursive: true, force: true });
      await fsp.rm(nginxAppsDir, { recursive: true, force: true });
    },
  };
}

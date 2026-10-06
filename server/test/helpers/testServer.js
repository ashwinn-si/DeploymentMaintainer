import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../src/index.js';
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
  const publishedDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-published-'));

  const config = {
    PORT: 3099,
    MONGO_URI: 'unused-in-tests',
    SERVER_ID: 'test-server-01',
    SERVER_SECRET: 'x'.repeat(40),
    ENCRYPTION_KEY: 'a'.repeat(64),
    GITHUB_TOKEN: undefined,
    APPS_DIR: appsDir,
    NGINX_APPS_DIR: nginxAppsDir,
    PUBLISHED_DIR: publishedDir,
    APP_PORT_START: PORT_BASE,
    DEFAULT_NODE_VERSION: '20',
    NGINX_ENABLED: nginxEnabled,
    NODE_ENV: 'test',
    GIT_REMOTE_BASE: fixture.remoteBase,
  };

  const app = createApp(config);
  const bearer = `Bearer ${config.SERVER_SECRET}`;
  // Same surface as a supertest agent, with the bearer header pre-set on every request.
  const agent = Object.fromEntries(
    ['get', 'post', 'put', 'patch', 'delete'].map((method) => [
      method,
      (url) => request(app)[method](url).set('Authorization', bearer),
    ]),
  );

  return {
    agent,
    bearer,
    app,
    config,
    shims,
    fixture,
    appsDir,
    nginxAppsDir,
    publishedDir,
    async cleanup() {
      restoreEnv();
      await shims.cleanup();
      await fixture.cleanup();
      await fsp.rm(appsDir, { recursive: true, force: true });
      await fsp.rm(nginxAppsDir, { recursive: true, force: true });
      await fsp.rm(publishedDir, { recursive: true, force: true });
    },
  };
}

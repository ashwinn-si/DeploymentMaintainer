import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSmokeTest, smokeName } from '../src/services/smoke.js';
import { createShims, patchProcessEnv } from './helpers/shims.js';
import { connectTestDB, clearTestDB, disconnectTestDB } from './helpers/db.js';

test.before(connectTestDB);
test.after(disconnectTestDB);
test.afterEach(clearTestDB);

function makeLog() {
  const lines = [];
  const push = (level) => (text) => lines.push(`${level}: ${text}`);
  return {
    lines,
    info: push('info'),
    error: push('error'),
    cmd: push('cmd'),
    onLine: () => () => {},
  };
}

async function withSmokeEnv(serverSource, fn) {
  const shims = await createShims();
  const restore = patchProcessEnv(shims);
  const appsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-smoke-'));
  const stagingPath = path.join(appsDir, 'smoke-app.staging');
  await fs.mkdir(stagingPath, { recursive: true });
  await fs.writeFile(path.join(stagingPath, 'server.js'), serverSource);
  // distinct range from other test files (ports test files use their own bases)
  const config = { APPS_DIR: appsDir, APP_PORT_START: 9200 + (process.pid % 500) };
  const app = {
    name: 'smoke-app',
    port: config.APP_PORT_START,
    steps: [{ type: 'pm2', config: { command: 'node server.js' } }],
  };
  try {
    await fn({ shims, config, app, stagingPath });
  } finally {
    restore();
    await shims.cleanup();
    await fs.rm(appsDir, { recursive: true, force: true });
  }
}

const HEALTHY_SERVER = `
require('http').createServer((req, res) => {
  res.statusCode = req.url === '/health' ? 200 : 404;
  res.end('ok');
}).listen(process.env.PORT, '127.0.0.1');
`;

test('smokeName suffixes the pm2 name', () => {
  assert.equal(smokeName('my-app'), 'app-my-app-smoke');
});

test('runSmokeTest passes for a healthy staged build and cleans up afterwards', async () => {
  await withSmokeEnv(HEALTHY_SERVER, async ({ shims, config, app, stagingPath }) => {
    const log = makeLog();
    const result = await runSmokeTest(app, {
      config,
      env: {},
      stagingPath,
      healthConfig: { path: '/health', timeoutSec: 10, intervalSec: 1 },
      log,
      stepId: 's1',
    });
    assert.deepEqual(result, { ok: true });

    // the smoke process was started on a spare port (not the live app's port) ...
    assert.ok(shims.readCalls().some((c) => c.startsWith('pm2 startOrReload') && c.includes('ecosystem.smoke.config.cjs')));
    assert.ok(log.lines.some((l) => l.includes('spare port') && !l.includes(`port ${app.port}`)));
    // ... and torn down: pm2 delete issued, state entry gone, ecosystem file removed
    assert.ok(shims.readCalls().includes(`pm2 delete ${smokeName(app.name)}`));
    assert.equal(shims.readPm2State()[smokeName(app.name)], undefined);
    await assert.rejects(fs.access(path.join(stagingPath, 'ecosystem.smoke.config.cjs')), { code: 'ENOENT' });
  });
});

test('runSmokeTest fails for a staged build that exits immediately and still cleans up', async () => {
  await withSmokeEnv('process.exit(1);', async ({ shims, config, app, stagingPath }) => {
    const log = makeLog();
    const result = await runSmokeTest(app, {
      config,
      env: {},
      stagingPath,
      healthConfig: { path: '/health', timeoutSec: 3, intervalSec: 1 },
      log,
      stepId: 's1',
    });
    assert.equal(result.ok, false);
    assert.ok(result.reason);
    assert.equal(shims.readPm2State()[smokeName(app.name)], undefined);
    await assert.rejects(fs.access(path.join(stagingPath, 'ecosystem.smoke.config.cjs')), { code: 'ENOENT' });
  });
});

test('runSmokeTest returns ok:false (not a throw) when the abort signal is already set', async () => {
  await withSmokeEnv(HEALTHY_SERVER, async ({ shims, config, app, stagingPath }) => {
    const controller = new AbortController();
    controller.abort();
    const result = await runSmokeTest(app, {
      config,
      env: {},
      stagingPath,
      healthConfig: { path: '/health', timeoutSec: 5, intervalSec: 1 },
      log: makeLog(),
      signal: controller.signal,
      stepId: 's1',
    });
    assert.equal(result.ok, false);
    assert.equal(shims.readPm2State()[smokeName(app.name)], undefined);
  });
});

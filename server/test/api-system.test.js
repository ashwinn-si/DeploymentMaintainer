import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestServer } from './helpers/testServer.js';
import { disconnectTestDB, clearTestDB } from './helpers/db.js';
import { defaultSteps } from '../src/steps/index.js';
import * as monitor from '../src/services/monitor.js';

function createAppBody(fixture, config, overrides = {}) {
  return {
    name: overrides.name,
    repoFullName: fixture.repoFullName,
    branch: 'main',
    nodeVersion: '20',
    env: [{ key: 'GREETING', value: 'hello' }],
    steps: defaultSteps(overrides.name),
    port: config.APP_PORT_START + (overrides.portOffset ?? 0),
    ...overrides,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.after(disconnectTestDB);

test('GET /system returns the documented shape and fills diskBytes from a real du in the background', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config, appsDir } = server;
    const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'sys-app', portOffset: 200 }));
    assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
    const app = createRes.body.app;

    // Real files in the app's real directory *before* the first /system call, so the
    // background du cache isn't negative-cached against a not-yet-existing directory.
    fs.mkdirSync(path.join(appsDir, 'sys-app'), { recursive: true });
    fs.writeFileSync(path.join(appsDir, 'sys-app', 'file.bin'), Buffer.alloc(64 * 1024));

    const res = await agent.get('/api/system');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const body = res.body;

    assert.equal(typeof body.current.cpuPct, 'number');
    assert.equal(typeof body.current.memUsed, 'number');
    assert.equal(typeof body.current.memTotal, 'number');
    assert.equal(typeof body.current.swapUsed, 'number');
    assert.equal(typeof body.current.swapTotal, 'number');
    assert.equal(typeof body.current.load1, 'number');
    assert.equal(typeof body.current.diskUsedPct, 'number');
    assert.ok(typeof body.current.t === 'string');

    assert.ok(Array.isArray(body.history));

    assert.ok(body.info.hostname);
    assert.ok(body.info.platform);
    assert.equal(typeof body.info.uptimeSec, 'number');
    assert.ok(body.info.nodeVersion);
    assert.equal(typeof body.info.cpuCount, 'number');
    // pm2/nginx binaries are on PATH via the test shims/system, so these resolve to strings
    // (nginx isn't shimmed, so it may legitimately be null on a machine without it installed).
    assert.ok(body.info.pm2Version === null || typeof body.info.pm2Version === 'string');

    assert.ok(Array.isArray(body.disks));
    assert.ok(body.disks.length >= 1);
    for (const d of body.disks) {
      assert.ok(d.mount);
      assert.equal(typeof d.total, 'number');
      assert.equal(typeof d.used, 'number');
      assert.equal(typeof d.free, 'number');
    }

    const appRow = body.apps.find((a) => a.appId === app.id);
    assert.ok(appRow, 'expected the created app to appear in apps');
    assert.equal(appRow.appName, 'sys-app');
    assert.equal(appRow.pm2Status, null);
    assert.deepEqual(appRow.health, { ok: false, statusCode: null, latencyMs: null, checkedAt: null });
    // Never blocks on du: the very first response may still show the pre-du null.

    let diskBytes = appRow.diskBytes;
    const deadline = Date.now() + 40000;
    while (diskBytes === null && Date.now() < deadline) {
      const poll = await agent.get('/api/system');
      diskBytes = poll.body.apps.find((a) => a.appId === app.id)?.diskBytes;
      if (diskBytes === null) await sleep(200);
    }
    assert.ok(diskBytes > 0, `expected a positive diskBytes, got ${diskBytes}`);

    // AppDetail.diskBytes is filled from the same cache.
    const detail = await agent.get(`/api/apps/${app.id}`);
    assert.equal(detail.status, 200);
    assert.ok(detail.body.app.diskBytes > 0);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('GET /system history reflects the monitor ring buffer', async () => {
  const server = await setupTestServer();
  try {
    monitor.__resetMonitorState();
    await monitor.__runSampleTick(server.config);
    await monitor.__runSampleTick(server.config);

    const res = await server.agent.get('/api/system');
    assert.equal(res.status, 200);
    assert.ok(res.body.history.length >= 2);
  } finally {
    monitor.__resetMonitorState();
    await server.cleanup();
    await clearTestDB();
  }
});

test('GET /system is rejected without a bearer token', async () => {
  const server = await setupTestServer();
  try {
    const request = (await import('supertest')).default;
    const res = await request(server.app).get('/api/system');
    assert.equal(res.status, 401);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

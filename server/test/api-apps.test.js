import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestServer } from './helpers/testServer.js';
import { disconnectTestDB, clearTestDB } from './helpers/db.js';
import { defaultSteps } from '../src/steps/index.js';

function stepsFor(name, { pm2Command = 'node server.js', buildEnabled = false } = {}) {
  return defaultSteps(name).map((s) => {
    if (s.type === 'pm2') return { ...s, config: { command: pm2Command } };
    if (s.type === 'healthCheck') return { ...s, config: { ...s.config, timeoutSec: 20, intervalSec: 1 } };
    if (s.type === 'build') return { ...s, enabled: buildEnabled };
    return s;
  });
}

function createAppBody(fixture, overrides = {}) {
  return {
    name: 'test-main',
    repoFullName: fixture.repoFullName,
    branch: 'main',
    nodeVersion: '20',
    env: [{ key: 'GREETING', value: 'hello-main' }],
    steps: stepsFor('test-main'),
    ...overrides,
  };
}

test.after(disconnectTestDB);

test('POST /apps validation: reserved name, duplicate name, taken port, bad env key, shell operator in command', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;

    const reserved = await agent.post('/api/apps').send(createAppBody(fixture, { name: 'deployment-manager' }));
    assert.equal(reserved.status, 400);

    const created = await agent.post('/api/apps').send(createAppBody(fixture, { name: 'dup-app', port: config.APP_PORT_START + 50 }));
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const dupName = await agent.post('/api/apps').send(createAppBody(fixture, { name: 'dup-app', port: config.APP_PORT_START + 51 }));
    assert.equal(dupName.status, 409);

    const takenPort = await agent.post('/api/apps').send(createAppBody(fixture, { name: 'other-app', port: config.APP_PORT_START + 50 }));
    assert.equal(takenPort.status, 400);
    assert.match(takenPort.body.error, /already used/);

    const badEnvKey = await agent.post('/api/apps').send(createAppBody(fixture, {
      name: 'bad-env-app',
      port: config.APP_PORT_START + 52,
      env: [{ key: 'BAD=KEY', value: 'x' }],
    }));
    assert.equal(badEnvKey.status, 400);

    const badCommand = await agent.post('/api/apps').send(createAppBody(fixture, {
      name: 'bad-cmd-app',
      port: config.APP_PORT_START + 53,
      steps: stepsFor('bad-cmd-app').map((s) => (s.type === 'install' ? { ...s, config: { command: 'npm ci && rm -rf /' } } : s)),
    }));
    assert.equal(badCommand.status, 400);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('create, get, patch, list an app', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;

    const createRes = await agent.post('/api/apps').send(createAppBody(fixture, { port: config.APP_PORT_START + 60 }));
    assert.equal(createRes.status, 201);
    const app = createRes.body.app;
    assert.equal(app.name, 'test-main');
    assert.equal(app.status, 'not_deployed');
    assert.deepEqual(app.env, [{ key: 'GREETING', value: 'hello-main' }]);
    assert.equal(app.path, '/test-main');
    assert.equal(createRes.body.deployment, null);

    const getRes = await agent.get(`/api/apps/${app.id}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.app.id, app.id);

    const listRes = await agent.get('/api/apps');
    assert.equal(listRes.status, 200);
    assert.ok(listRes.body.apps.some((a) => a.id === app.id));
    assert.ok('pm2' in listRes.body.apps[0]);

    const patchRes = await agent.patch(`/api/apps/${app.id}`).send({ env: [{ key: 'GREETING', value: 'updated' }] });
    assert.equal(patchRes.status, 200);
    assert.deepEqual(patchRes.body.app.env, [{ key: 'GREETING', value: 'updated' }]);

    const patchPortConflict = await agent.post('/api/apps').send(createAppBody(fixture, { name: 'second-app', port: config.APP_PORT_START + 61, steps: stepsFor('second-app') }));
    assert.equal(patchPortConflict.status, 201);
    const conflictPatch = await agent.patch(`/api/apps/${app.id}`).send({ port: config.APP_PORT_START + 61 });
    assert.equal(conflictPatch.status, 400);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('PORT in env sets the app port, conflicts are rejected, duplicate rewrites it', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const envPort = config.APP_PORT_START + 120;

    const adopted = await agent.post('/api/apps').send(createAppBody(fixture, { env: [{ key: 'PORT', value: String(envPort) }] }));
    assert.equal(adopted.status, 201);
    assert.equal(adopted.body.app.port, envPort);

    const mismatch = await agent.post('/api/apps').send(createAppBody(fixture, {
      name: 'mismatch-app',
      port: envPort + 1,
      steps: stepsFor('mismatch-app'),
      env: [{ key: 'PORT', value: String(envPort + 2) }],
    }));
    assert.equal(mismatch.status, 400);
    assert.match(mismatch.body.error, /does not match the port field/);

    const bad = await agent.post('/api/apps').send(createAppBody(fixture, {
      name: 'bad-port-app',
      steps: stepsFor('bad-port-app'),
      env: [{ key: 'PORT', value: 'abc' }],
    }));
    assert.equal(bad.status, 400);

    const patched = await agent.patch(`/api/apps/${adopted.body.app.id}`).send({ env: [{ key: 'PORT', value: String(envPort + 3) }] });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.app.port, envPort + 3);

    const dup = await agent.post(`/api/apps/${adopted.body.app.id}/duplicate`).send({ name: 'dup-port', branch: 'main', copyEnv: true });
    assert.equal(dup.status, 201);
    const dupEnv = dup.body.app.env.find((e) => e.key === 'PORT');
    assert.equal(dupEnv.value, String(dup.body.app.port));
    assert.notEqual(dup.body.app.port, patched.body.app.port);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('GET /apps/defaults returns steps, a free port and the server default node version', async () => {
  const server = await setupTestServer();
  try {
    const { agent, config } = server;
    const res = await agent.get('/api/apps/defaults?name=my-app');
    assert.equal(res.status, 200);
    assert.equal(res.body.nodeVersion, config.DEFAULT_NODE_VERSION);
    assert.equal(res.body.port, config.APP_PORT_START);
    assert.ok(Array.isArray(res.body.steps));
    assert.equal(res.body.steps[0].type, 'gitSync');
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('POST /apps/:id/duplicate copies repo/steps and optionally env', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const createRes = await agent.post('/api/apps').send(createAppBody(fixture, { port: config.APP_PORT_START + 70 }));
    const app = createRes.body.app;

    const dupRes = await agent.post(`/api/apps/${app.id}/duplicate`).send({
      name: 'test-main-copy',
      branch: 'main',
      copyEnv: true,
    });
    assert.equal(dupRes.status, 201, JSON.stringify(dupRes.body));
    assert.equal(dupRes.body.app.repoFullName, fixture.repoFullName);
    assert.deepEqual(dupRes.body.app.env, [{ key: 'GREETING', value: 'hello-main' }]);
    assert.notEqual(dupRes.body.app.port, app.port);

    const dupNoEnv = await agent.post(`/api/apps/${app.id}/duplicate`).send({
      name: 'test-main-copy-2',
      branch: 'main',
      copyEnv: false,
    });
    assert.equal(dupNoEnv.status, 201);
    assert.deepEqual(dupNoEnv.body.app.env, []);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('DELETE /apps/:id requires a matching confirmName, calls pm2 delete, removes the app dir', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config, shims, appsDir } = server;
    const createRes = await agent.post('/api/apps').send(createAppBody(fixture, { port: config.APP_PORT_START + 80 }));
    const app = createRes.body.app;

    fs.mkdirSync(path.join(appsDir, app.name), { recursive: true });
    fs.writeFileSync(path.join(appsDir, app.name, 'marker.txt'), 'x');

    const badConfirm = await agent.delete(`/api/apps/${app.id}`).send({ confirmName: 'wrong-name' });
    assert.equal(badConfirm.status, 400);

    const delRes = await agent.delete(`/api/apps/${app.id}`).send({ confirmName: app.name });
    assert.equal(delRes.status, 200);
    assert.deepEqual(delRes.body, { ok: true });

    assert.ok(shims.readCalls().some((c) => c.startsWith('pm2 delete')));
    assert.ok(!fs.existsSync(path.join(appsDir, app.name)));

    const getAfter = await agent.get(`/api/apps/${app.id}`);
    assert.equal(getAfter.status, 404);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('POST /apps/:id/restart and /stop update App.status', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const createRes = await agent.post('/api/apps').send(createAppBody(fixture, { port: config.APP_PORT_START + 90 }));
    const app = createRes.body.app;

    const stopRes = await agent.post(`/api/apps/${app.id}/stop`);
    assert.equal(stopRes.status, 200);
    assert.equal(stopRes.body.app.status, 'stopped');

    const restartRes = await agent.post(`/api/apps/${app.id}/restart`);
    assert.equal(restartRes.status, 200);
    assert.equal(restartRes.body.app.status, 'online');
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('GET /apps/:id/logs tolerates whatever pm2 returns', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const createRes = await agent.post('/api/apps').send(createAppBody(fixture, { port: config.APP_PORT_START + 91 }));
    const app = createRes.body.app;
    const res = await agent.get(`/api/apps/${app.id}/logs?lines=50`);
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.text, 'string');
    assert.equal(typeof res.body.out, 'string');
    assert.equal(typeof res.body.err, 'string');
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('GET /node/versions tolerates an empty fnm install list', async () => {
  const server = await setupTestServer();
  try {
    const res = await server.agent.get('/api/node/versions');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.installed, []);
    assert.equal(res.body.default, server.config.DEFAULT_NODE_VERSION);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('GET /ports lists rows and flags an unmanaged-process conflict', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const createRes = await agent.post('/api/apps').send(createAppBody(fixture, { port: config.APP_PORT_START + 100 }));
    const app = createRes.body.app;

    const before = await agent.get('/api/ports');
    assert.equal(before.status, 200);
    assert.equal(before.body.dashboard.port, config.PORT);
    const row = before.body.rows.find((r) => r.appId === app.id);
    assert.ok(row);
    assert.equal(row.conflict, null);
    assert.equal(row.path, '/test-main');

    const net = await import('node:net');
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(app.port, '127.0.0.1', resolve));
    try {
      const after = await agent.get('/api/ports');
      const conflictRow = after.body.rows.find((r) => r.appId === app.id);
      assert.equal(conflictRow.conflict, 'port in use by an unmanaged process');
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('unauthenticated requests are rejected with 401', async () => {
  const server = await setupTestServer();
  try {
    const request = (await import('supertest')).default;
    const res = await request(server.app).get('/api/apps');
    assert.equal(res.status, 401);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

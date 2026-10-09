import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestServer } from './helpers/testServer.js';
import { disconnectTestDB, clearTestDB } from './helpers/db.js';
import { defaultSteps } from '../src/steps/index.js';
import App from '../src/models/App.js';
import Deployment from '../src/models/Deployment.js';
import { setFetchImpl, __resetCache } from '../src/services/github.js';

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

test('stagedDeploys defaults to true and can be turned off via PATCH', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;

    const createRes = await agent.post('/api/apps').send(createAppBody(fixture, { name: 'staged-app', port: config.APP_PORT_START + 70, steps: stepsFor('staged-app') }));
    assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
    assert.equal(createRes.body.app.stagedDeploys, true);

    const patchRes = await agent.patch(`/api/apps/${createRes.body.app.id}`).send({ stagedDeploys: false });
    assert.equal(patchRes.status, 200, JSON.stringify(patchRes.body));
    assert.equal(patchRes.body.app.stagedDeploys, false);

    const getRes = await agent.get(`/api/apps/${createRes.body.app.id}`);
    assert.equal(getRes.body.app.stagedDeploys, false);

    const bad = await agent.patch(`/api/apps/${createRes.body.app.id}`).send({ stagedDeploys: 'nope' });
    assert.equal(bad.status, 400);
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

function fakeGhCommit(n) {
  return {
    sha: String(n).padStart(40, '0'),
    commit: { message: `commit ${n}\n\nmore`, author: { name: 'dev', date: '2024-02-01T00:00:00Z' } },
  };
}

function ghResponse(json, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

test('GET /apps/:id/commits: never-deployed app lists the latest commits on the branch', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    config.GITHUB_TOKEN = 'test-token-commits-never';
    const created = await agent.post('/api/apps').send(createAppBody(fixture, { port: config.APP_PORT_START + 70 }));
    assert.equal(created.status, 201);

    const urls = [];
    setFetchImpl(async (url) => {
      urls.push(url);
      return ghResponse([fakeGhCommit(3), fakeGhCommit(2), fakeGhCommit(1)]);
    });
    const res = await agent.get(`/api/apps/${created.body.app.id}/commits`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.neverDeployed, true);
    assert.equal(res.body.missing, false);
    assert.equal(res.body.deployed, null);
    assert.deepEqual(res.body.newer, []);
    assert.equal(res.body.newerTotal, 0);
    assert.equal(res.body.older.length, 3);
    assert.equal(res.body.older[0].message, 'commit 3');
    assert.equal(res.body.older[0].deployment, null);
    assert.match(urls[0], /repos\/fixture\/repo\/commits\?sha=main&per_page=10/);

    assert.equal((await agent.get('/api/apps/not-an-id/commits')).status, 404);
  } finally {
    setFetchImpl();
    __resetCache();
    await server.cleanup();
    await clearTestDB();
  }
});

test('rootDir defaults to the repo root, is normalised on create/patch and rejects unsafe values', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;

    const plain = await agent.post('/api/apps').send(createAppBody(fixture, { name: 'root-plain', port: config.APP_PORT_START + 80, steps: stepsFor('root-plain') }));
    assert.equal(plain.status, 201, JSON.stringify(plain.body));
    assert.equal(plain.body.app.rootDir, '');

    const sub = await agent.post('/api/apps').send(createAppBody(fixture, {
      name: 'root-sub', port: config.APP_PORT_START + 81, steps: stepsFor('root-sub'), rootDir: './apps/web/',
    }));
    assert.equal(sub.status, 201, JSON.stringify(sub.body));
    assert.equal(sub.body.app.rootDir, 'apps/web');
    assert.equal((await agent.get(`/api/apps/${sub.body.app.id}`)).body.app.rootDir, 'apps/web');
    const list = await agent.get('/api/apps');
    assert.equal(list.body.apps.find((a) => a.name === 'root-sub').rootDir, 'apps/web');

    for (const bad of ['../x', '/etc', 'a b', 'a;b']) {
      const res = await agent.post('/api/apps').send(createAppBody(fixture, {
        name: 'root-bad', port: config.APP_PORT_START + 82, steps: stepsFor('root-bad'), rootDir: bad,
      }));
      assert.equal(res.status, 400, `rootDir ${bad}`);
    }

    const patched = await agent.patch(`/api/apps/${plain.body.app.id}`).send({ rootDir: 'packages/api' });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.equal(patched.body.app.rootDir, 'packages/api');
    const backToRoot = await agent.patch(`/api/apps/${plain.body.app.id}`).send({ rootDir: '/' });
    assert.equal(backToRoot.body.app.rootDir, '');
    const badPatch = await agent.patch(`/api/apps/${plain.body.app.id}`).send({ rootDir: '../escape' });
    assert.equal(badPatch.status, 400);
    assert.equal((await agent.get(`/api/apps/${plain.body.app.id}`)).body.app.rootDir, '');
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('GET /apps/:id/commits: deployed app returns the window with deployment badges', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    config.GITHUB_TOKEN = 'test-token-commits-deployed';
    const created = await agent.post('/api/apps').send(createAppBody(fixture, { port: config.APP_PORT_START + 71 }));
    assert.equal(created.status, 201);
    const appId = created.body.app.id;
    const sha = (n) => String(n).padStart(40, '0');
    await App.updateOne({ _id: appId }, { currentCommitSha: sha(5) });

    // An older failed deployment and a later success of sha(5); one failure for sha(6).
    const base = { appId, branch: 'main', mode: 'update', nodeVersion: '20', steps: [] };
    await Deployment.create({ ...base, number: 1, commitSha: sha(5), status: 'failed', createdAt: new Date(Date.now() - 3000) });
    await Deployment.create({ ...base, number: 2, commitSha: sha(5), status: 'success', createdAt: new Date(Date.now() - 2000) });
    await Deployment.create({ ...base, number: 3, commitSha: sha(6), status: 'failed', createdAt: new Date(Date.now() - 1000) });

    setFetchImpl(async (url) => {
      if (url.includes('/compare/')) {
        return ghResponse({ ahead_by: 7, commits: [6, 7, 8, 9, 10, 11, 12].map(fakeGhCommit) });
      }
      return ghResponse([5, 4, 3, 2, 1].map(fakeGhCommit));
    });
    const res = await agent.get(`/api/apps/${appId}/commits`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.neverDeployed, false);
    assert.equal(res.body.missing, false);
    assert.equal(res.body.deployed.sha, sha(5));
    assert.equal(res.body.deployed.deployment.number, 2);
    assert.equal(res.body.deployed.deployment.status, 'success');
    assert.deepEqual(res.body.newer.map((c) => c.sha), [10, 9, 8, 7, 6].map(sha));
    assert.equal(res.body.newerTotal, 7);
    assert.deepEqual(res.body.older.map((c) => c.sha), [4, 3, 2, 1].map(sha));
    const failedBadge = res.body.newer.find((c) => c.sha === sha(6)).deployment;
    assert.equal(failedBadge.number, 3);
    assert.equal(failedBadge.status, 'failed');
    assert.ok(failedBadge.id);
    assert.equal(res.body.newer.find((c) => c.sha === sha(7)).deployment, null);
  } finally {
    setFetchImpl();
    __resetCache();
    await server.cleanup();
    await clearTestDB();
  }
});

test('an app saved before rootDir existed reads back as the repo root', async () => {
  const server = await setupTestServer();
  try {
    const { agent, config } = server;
    const { insertedId } = await App.collection.insertOne({
      name: 'legacy-app', repoFullName: 'fixture/repo', branch: 'main', kind: 'node', port: config.APP_PORT_START + 83,
      nodeVersion: '20', envEncrypted: null, steps: [], status: 'not_deployed', deploySeq: 0,
    });
    const res = await agent.get(`/api/apps/${insertedId}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.app.rootDir, '');
    assert.equal(res.body.app.stagedDeploys, true);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('POST /apps/:id/duplicate copies rootDir unless one is given', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const createRes = await agent.post('/api/apps').send(createAppBody(fixture, {
      name: 'dup-root', port: config.APP_PORT_START + 84, steps: stepsFor('dup-root'), rootDir: 'apps/web',
    }));
    assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
    const app = createRes.body.app;

    const copy = await agent.post(`/api/apps/${app.id}/duplicate`).send({ name: 'dup-root-copy', branch: 'main', copyEnv: false });
    assert.equal(copy.status, 201, JSON.stringify(copy.body));
    assert.equal(copy.body.app.rootDir, 'apps/web');

    const other = await agent.post(`/api/apps/${app.id}/duplicate`).send({ name: 'dup-root-other', branch: 'main', copyEnv: false, rootDir: 'apps/api' });
    assert.equal(other.body.app.rootDir, 'apps/api');

    const toRoot = await agent.post(`/api/apps/${app.id}/duplicate`).send({ name: 'dup-root-top', branch: 'main', copyEnv: false, rootDir: '/' });
    assert.equal(toRoot.body.app.rootDir, '');

    const bad = await agent.post(`/api/apps/${app.id}/duplicate`).send({ name: 'dup-root-bad', branch: 'main', copyEnv: false, rootDir: '../x' });
    assert.equal(bad.status, 400);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

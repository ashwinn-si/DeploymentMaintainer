import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestServer } from './helpers/testServer.js';
import { disconnectTestDB, clearTestDB } from './helpers/db.js';
import { defaultSteps } from '../src/steps/index.js';
import { getPublishedAppCurrentDir } from '../src/steps/publish.js';
import { readEcosystem } from '../src/services/pm2.js';

const SUB_DIR = 'apps/web';

let server;

test.before(async () => {
  server = await setupTestServer({ fixtureOptions: { subDir: SUB_DIR } });
});

test.after(async () => {
  await server.cleanup();
  await clearTestDB();
  await disconnectTestDB();
});

function nodeSteps(name) {
  return defaultSteps(name).map((s) => {
    if (s.type === 'pm2') return { ...s, config: { command: 'node server.js' } };
    if (s.type === 'healthCheck') return { ...s, enabled: true, config: { ...s.config, path: '/', timeoutSec: 20, intervalSec: 1 } };
    return s;
  });
}

// Port offsets sit well above those other test files use, so parallel files never fight over a port.
function createBody(name, portOffset, overrides = {}) {
  return {
    name,
    repoFullName: server.fixture.repoFullName,
    branch: 'main',
    nodeVersion: '20',
    env: [{ key: 'GREETING', value: 'hello' }],
    steps: nodeSteps(name),
    port: server.config.APP_PORT_START + portOffset,
    ...overrides,
  };
}

async function waitForDeployment(id, { timeoutMs = 25000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await server.agent.get(`/api/deployments/${id}`);
    if (['success', 'failed', 'cancelled'].includes(res.body.deployment.status)) return res.body.deployment;
    if (Date.now() > deadline) throw new Error('deployment did not finish in time');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function deploy(appId, body = { mode: 'update' }) {
  const res = await server.agent.post(`/api/apps/${appId}/deploy`).send(body);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return waitForDeployment(res.body.deployment.id);
}

test('a node app with a root directory installs, writes env and runs pm2 inside the sub-folder', async () => {
  const { agent } = server;
  const createRes = await agent.post('/api/apps').send(createBody('mono-node', 801, { rootDir: SUB_DIR }));
  assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
  const app = createRes.body.app;
  assert.equal(app.rootDir, SUB_DIR);

  const deployment = await deploy(app.id);
  assert.equal(deployment.status, 'success', JSON.stringify(deployment));
  assert.ok(deployment.commitSha);
  assert.equal(deployment.steps.find((s) => s.type === 'healthCheck').status, 'success');

  // The sub-folder app answered (the repo root has no server at all).
  const res = await fetch(`http://127.0.0.1:${app.port}/`);
  assert.equal(await res.text(), 'sub-app:hello');

  const repoDir = path.join(server.appsDir, 'mono-node');
  const workDir = path.join(repoDir, SUB_DIR);
  assert.ok(fs.existsSync(path.join(repoDir, '.git')), 'the whole repo is cloned into the app folder');
  assert.ok(fs.existsSync(path.join(workDir, '.env')), 'env is written into the root directory');
  assert.ok(!fs.existsSync(path.join(repoDir, '.env')), 'nothing is written at the repo root');
  assert.ok(fs.existsSync(path.join(workDir, 'package-lock.json')), 'npm install ran inside the root directory');
  assert.ok(!fs.existsSync(path.join(repoDir, 'package-lock.json')));

  const eco = await readEcosystem(path.join(workDir, 'ecosystem.config.cjs'));
  assert.ok(eco, 'ecosystem file lives in the root directory');
  assert.ok(eco.cwd.endsWith(path.join('mono-node', 'apps', 'web')), eco.cwd);
  assert.ok(!fs.existsSync(path.join(repoDir, 'ecosystem.config.cjs')));

  // A second (update) deploy keeps working: pm2 reads the previous definition from the same place.
  const again = await deploy(app.id);
  assert.equal(again.status, 'success', JSON.stringify(again));
  assert.equal((await (await fetch(`http://127.0.0.1:${app.port}/`)).text()), 'sub-app:hello');
});

test('a deploy whose root directory is missing fails with a clear error and marks the app failed', async () => {
  const { agent } = server;
  const createRes = await agent.post('/api/apps').send(createBody('mono-missing', 802, { rootDir: 'apps/nope' }));
  assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
  const app = createRes.body.app;

  const deployment = await deploy(app.id);
  assert.equal(deployment.status, 'failed');
  assert.match(deployment.error, /Root directory 'apps\/nope' not found in fixture\/repo@[0-9a-f]{7}/);
  const failedStep = deployment.steps.find((s) => s.status === 'failed');
  assert.equal(failedStep.type, 'gitSync');
  assert.ok(deployment.steps.filter((s) => s.type !== 'gitSync').every((s) => s.status !== 'success'));

  // gitSync failed before pm2 was reached, so the app did not go live.
  assert.equal((await agent.get(`/api/apps/${app.id}`)).body.app.status, 'not_deployed');
});

test('patching rootDir applies from the next deploy', async () => {
  const { agent } = server;
  // The repo root has no server.js, so deploying with the default root fails ...
  const createRes = await agent.post('/api/apps').send(createBody('mono-patch', 803));
  const app = createRes.body.app;
  assert.equal(app.rootDir, '');
  assert.equal((await deploy(app.id)).status, 'failed');

  // ... and succeeds after pointing the app at the sub-folder.
  const patched = await agent.patch(`/api/apps/${app.id}`).send({ rootDir: `${SUB_DIR}/` });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(patched.body.app.rootDir, SUB_DIR);
  assert.equal((await agent.patch(`/api/apps/${app.id}`).send({ rootDir: `/${SUB_DIR}` })).status, 400, 'absolute paths are rejected');

  const deployment = await deploy(app.id);
  assert.equal(deployment.status, 'success', JSON.stringify(deployment));
  assert.equal(await (await fetch(`http://127.0.0.1:${app.port}/`)).text(), 'sub-app:hello');
});

test('a duplicate inherits the root directory and deploys from it', async () => {
  const { agent } = server;
  const createRes = await agent.post('/api/apps').send(createBody('mono-src', 804, { rootDir: SUB_DIR }));
  const src = createRes.body.app;

  const dupRes = await agent.post(`/api/apps/${src.id}/duplicate`).send({ name: 'mono-copy', branch: 'main', copyEnv: true, port: server.config.APP_PORT_START + 805 });
  assert.equal(dupRes.status, 201, JSON.stringify(dupRes.body));
  const copy = dupRes.body.app;
  assert.equal(copy.rootDir, SUB_DIR);

  const deployment = await deploy(copy.id);
  assert.equal(deployment.status, 'success', JSON.stringify(deployment));
  assert.equal(await (await fetch(`http://127.0.0.1:${copy.port}/`)).text(), 'sub-app:hello');
});

test('a static app publishes from inside its root directory', async () => {
  const { agent, fixture } = server;
  fixture.createBranchFrom('mono-static', 'main', { filename: `${SUB_DIR}/index.html`, content: '<h1>sub site</h1>' });
  const defaults = await agent.get('/api/apps/defaults?name=mono-site&kind=static');
  const createRes = await agent.post('/api/apps').send({
    name: 'mono-site', kind: 'static', repoFullName: fixture.repoFullName, branch: 'mono-static',
    rootDir: SUB_DIR, nodeVersion: '20', env: [], steps: defaults.body.steps,
  });
  assert.equal(createRes.status, 201, JSON.stringify(createRes.body));

  const deployment = await deploy(createRes.body.app.id);
  assert.equal(deployment.status, 'success', JSON.stringify(deployment));

  const current = getPublishedAppCurrentDir(server.config, 'mono-site');
  assert.equal(fs.readFileSync(path.join(current, 'index.html'), 'utf8'), '<h1>sub site</h1>');
  assert.ok(!fs.existsSync(path.join(current, 'README.md')), 'files outside the root directory are not published');
});

test('a staged deploy of a root-directory app swaps the whole repo and restores it (with its sub-folder app) on a post-swap failure', async () => {
  const { agent } = server;
  const name = 'mono-staged';
  const port = server.config.APP_PORT_START + 820;
  const createRes = await agent.post('/api/apps').send(createBody(name, 820, {
    rootDir: SUB_DIR,
    steps: nodeSteps(name).map((s) => (s.type === 'healthCheck' ? { ...s, config: { ...s.config, timeoutSec: 4 } } : s)),
  }));
  assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
  const app = createRes.body.app;

  const first = await deploy(app.id);
  assert.equal(first.status, 'success', JSON.stringify(first));
  const second = await deploy(app.id);
  assert.equal(second.status, 'success', JSON.stringify(second));

  const live = path.join(server.appsDir, name);
  const previous = `${live}.previous`;
  assert.ok(fs.existsSync(path.join(live, SUB_DIR, 'server.js')));
  assert.ok(!fs.existsSync(previous), 'the old copy is deleted once the deploy passed');
  assert.ok(fs.existsSync(path.join(live, SUB_DIR, 'ecosystem.config.cjs')));
  assert.ok(!fs.existsSync(`${live}.staging`));
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'sub-app:hello');

  // A build that answers 500 on the real port only: the smoke test (spare port) passes, the live health check fails.
  const goodSha = (await agent.get(`/api/apps/${app.id}`)).body.app.currentCommitSha;
  server.fixture.createBranchFrom('mono-staged-bad', 'main', {
    filename: path.join(SUB_DIR, 'server.js'),
    content: `require('http').createServer((req, res) => { res.statusCode = String(process.env.PORT) === '${port}' ? 500 : 200; res.end('bad'); }).listen(process.env.PORT);\n`,
  });
  const failed = await deploy(app.id, { mode: 'update', branch: 'mono-staged-bad' });
  assert.equal(failed.status, 'failed', JSON.stringify(failed));
  assert.equal(failed.restoredPrevious, true);

  assert.ok(!fs.existsSync(previous));
  assert.ok(fs.readFileSync(path.join(live, SUB_DIR, 'server.js'), 'utf8').includes('GREETING'), 'the old sub-folder app is live again');
  const deadline = Date.now() + 8000;
  let text = '';
  while (Date.now() < deadline && text !== 'sub-app:hello') {
    text = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text()).catch(() => '');
    if (text !== 'sub-app:hello') await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.equal(text, 'sub-app:hello', 'the restored process runs the old code from the sub-folder');
  const after = (await agent.get(`/api/apps/${app.id}`)).body.app;
  assert.equal(after.currentCommitSha, goodSha);
  assert.equal(after.status, 'online');
});

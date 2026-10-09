import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestServer } from './helpers/testServer.js';
import { disconnectTestDB, clearTestDB } from './helpers/db.js';
import { defaultSteps } from '../src/steps/index.js';
import { getPublishedAppCurrentDir } from '../src/steps/publish.js';
import { recoverInterruptedDeployments, __resetDeployerState } from '../src/services/deployer.js';
import { __setFreeBytesOverride } from '../src/services/staging.js';
import App from '../src/models/App.js';
import Deployment from '../src/models/Deployment.js';

let server;

test.before(async () => {
  server = await setupTestServer();
});

test.after(async () => {
  __setFreeBytesOverride(undefined);
  await server.cleanup();
  await clearTestDB();
  await disconnectTestDB();
});

// --- helpers ---------------------------------------------------------------------------------

// A custom step that fails when the checked-out commit contains the given marker file.
function failIfFile(file, label = `Fail on ${file}`) {
  return { type: 'custom', enabled: true, config: { label, command: `node -e "process.exit(require('fs').existsSync('${file}')?1:0)"` } };
}

// Node steps with the health check on, optional extra custom steps before install (`before`) or at the very end (`after`).
function nodeSteps(name, { before = [], after = [], healthTimeoutSec = 8 } = {}) {
  const steps = defaultSteps(name).map((s) => {
    if (s.type === 'pm2') return { ...s, config: { command: 'node server.js' } };
    if (s.type === 'healthCheck') return { ...s, enabled: true, config: { ...s.config, path: '/', timeoutSec: healthTimeoutSec, intervalSec: 1 } };
    return s;
  });
  const at = steps.findIndex((s) => s.type === 'writeEnv') + 1;
  steps.splice(at, 0, ...before);
  return [...steps, ...after];
}

let nextOffset = 40;
async function createApp(name, { steps, ...overrides } = {}) {
  const portOffset = nextOffset;
  nextOffset += 1;
  const res = await server.agent.post('/api/apps').send({
    name,
    repoFullName: server.fixture.repoFullName,
    branch: 'main',
    nodeVersion: '20',
    env: [{ key: 'GREETING', value: 'hello' }],
    steps: steps ?? nodeSteps(name),
    port: server.config.APP_PORT_START + portOffset,
    ...overrides,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.app;
}

async function waitForDeployment(id, { timeoutMs = 30000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await server.agent.get(`/api/deployments/${id}`);
    if (['success', 'failed', 'cancelled'].includes(res.body.deployment.status)) return res.body.deployment;
    if (Date.now() > deadline) throw new Error(`deployment ${id} did not finish in ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function deploy(appId, body = { mode: 'update' }) {
  const res = await server.agent.post(`/api/apps/${appId}/deploy`).send(body);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return waitForDeployment(res.body.deployment.id);
}

async function getApp(appId) {
  return (await server.agent.get(`/api/apps/${appId}`)).body.app;
}

async function logText(deploymentId) {
  const res = await server.agent.get(`/api/deployments/${deploymentId}/entries?after=-1&limit=5000`);
  return res.body.entries.map((e) => e.text).join('\n');
}

async function fetchText(port, urlPath = '/') {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  return { status: res.status, text: await res.text() };
}

// The shim spawns the app in the background, so give a freshly (re)started process a moment to bind.
async function fetchEventually(port, expected, { timeoutMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      last = await fetchText(port);
      if (last.text === expected) return last;
    } catch (err) {
      last = { error: err.message };
    }
    if (Date.now() > deadline) assert.fail(`expected "${expected}" on port ${port}, last response: ${JSON.stringify(last)}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

const live = (name) => path.join(server.appsDir, name);
const staging = (name) => `${live(name)}.staging`;
const previous = (name) => `${live(name)}.previous`;
const pm2Entry = (name) => server.shims.readPm2State()[`app-${name}`];

// server.js variants committed on throwaway branches so no test poisons `main` for the others.
const plainServer = (text) => `require('http').createServer((req, res) => { res.end(${JSON.stringify(text)}); }).listen(process.env.PORT);\n`;
// Healthy on the smoke test's spare port, 500 on the app's real port: only the live health check can catch it.
const failsOnRealPort = (text, realPort) => `require('http').createServer((req, res) => {
  res.statusCode = String(process.env.PORT) === '${realPort}' ? 500 : 200;
  res.end(${JSON.stringify(text)});
}).listen(process.env.PORT);\n`;

function branchWith(name, files) {
  let sha;
  let first = true;
  for (const [filename, content] of Object.entries(files)) {
    if (first) {
      sha = server.fixture.createBranchFrom(name, 'main', { filename, content, message: `${name}: ${filename}` });
      first = false;
    } else {
      sha = server.fixture.addCommit(name, { filename, content, message: `${name}: ${filename}` });
    }
  }
  return sha;
}

// --- happy path -------------------------------------------------------------------------------

test('staged deploy swaps the new build in, serves the new code and deletes the old copy once it passed', async () => {
  const app = await createApp('stg-happy');
  const first = await deploy(app.id);
  assert.equal(first.status, 'success', JSON.stringify(first));
  assert.ok(!fs.existsSync(previous('stg-happy')), 'a first deploy has nothing to keep');
  assert.ok(!fs.existsSync(staging('stg-happy')));
  assert.equal((await fetchText(app.port)).text, 'hello');

  const newSha = branchWith('stg-happy-v2', { 'server.js': plainServer('v2'), 'v2-marker.txt': 'v2' });
  const second = await deploy(app.id, { mode: 'update', branch: 'stg-happy-v2' });
  assert.equal(second.status, 'success', JSON.stringify(second));
  assert.equal(second.commitSha, newSha);
  assert.equal(second.restoredPrevious, false);

  assert.ok(fs.existsSync(path.join(live('stg-happy'), 'v2-marker.txt')), 'live folder holds the new code');
  assert.ok(!fs.existsSync(previous('stg-happy')), 'the old copy is deleted after the deploy fully passed: one copy at rest');
  assert.ok(!fs.existsSync(staging('stg-happy')), 'staging was promoted, not left behind');
  assert.ok(fs.existsSync(path.join(live('stg-happy'), '.git')));

  await fetchEventually(app.port, 'v2');
  const after = await getApp(app.id);
  assert.equal(after.status, 'online');
  assert.equal(after.currentCommitSha, newSha);

  const log = await logText(second.id);
  assert.match(log, /staged deploy: building in stg-happy\.staging/);
  assert.match(log, /smoke test: GET \/ -> 200/);
  assert.match(log, /promoted staged build \(previous version kept at stg-happy\.previous until the deploy passes\)/);
  assert.match(log, /deleted the previous version \(freed .*\)/);
  // the real pm2 process was restarted from the live folder; the smoke process is gone
  assert.ok(pm2Entry('stg-happy'));
  assert.equal(server.shims.readPm2State()['app-stg-happy-smoke'], undefined);

  // A later deploy again ends with a single copy.
  const third = await deploy(app.id);
  assert.equal(third.status, 'success', JSON.stringify(third));
  assert.ok(!fs.existsSync(previous('stg-happy')));
});

// --- failure before the swap -------------------------------------------------------------------

test('a failing build step leaves the live folder, process and commit untouched and removes staging', async () => {
  const app = await createApp('stg-badbuild', { steps: nodeSteps('stg-badbuild', { before: [failIfFile('FAIL_BUILD', 'Build gate')] }) });
  const first = await deploy(app.id);
  assert.equal(first.status, 'success', JSON.stringify(first));
  const pidBefore = pm2Entry('stg-badbuild').pid;
  const callsBefore = server.shims.readCalls().length;
  const liveSha = (await getApp(app.id)).currentCommitSha;
  const liveEntries = fs.readdirSync(live('stg-badbuild')).sort();
  const serverJs = fs.readFileSync(path.join(live('stg-badbuild'), 'server.js'), 'utf8');

  branchWith('stg-badbuild-bad', { 'FAIL_BUILD': 'x' });
  const failed = await deploy(app.id, { mode: 'update', branch: 'stg-badbuild-bad' });
  assert.equal(failed.status, 'failed', JSON.stringify(failed));
  assert.match(failed.error, /Build gate failed/);
  assert.equal(failed.restoredPrevious, false);

  assert.deepEqual(fs.readdirSync(live('stg-badbuild')).sort(), liveEntries, 'live folder content untouched');
  assert.equal(fs.readFileSync(path.join(live('stg-badbuild'), 'server.js'), 'utf8'), serverJs);
  assert.ok(!fs.existsSync(path.join(live('stg-badbuild'), 'FAIL_BUILD')));
  assert.ok(!fs.existsSync(staging('stg-badbuild')), 'staging removed');
  assert.ok(!fs.existsSync(previous('stg-badbuild')) || !fs.existsSync(path.join(previous('stg-badbuild'), 'FAIL_BUILD')));

  assert.equal(pm2Entry('stg-badbuild').pid, pidBefore, 'the running process was not restarted');
  assert.equal((await fetchText(app.port)).text, 'hello');
  const after = await getApp(app.id);
  assert.equal(after.currentCommitSha, liveSha);
  assert.equal(after.status, 'online', 'app status unchanged: the live version never stopped serving');

  // pm2 was never touched by the failed deploy, and its remaining steps are skipped.
  const newCalls = server.shims.readCalls().slice(callsBefore).filter((c) => c.includes('app-stg-badbuild'));
  assert.deepEqual(newCalls.filter((c) => !c.includes('-smoke')), []);
  const byType = Object.fromEntries(failed.steps.map((s) => [s.type, s.status]));
  assert.equal(byType.custom, 'failed');
  assert.equal(byType.install, 'skipped');
  assert.equal(byType.pm2, 'skipped');
  assert.equal(byType.healthCheck, 'skipped');

  // No rebuild-based auto-rollback was started.
  await new Promise((resolve) => setTimeout(resolve, 700));
  const list = await server.agent.get(`/api/apps/${app.id}/deployments`);
  assert.equal(list.body.deployments.length, 2);
  assert.ok(list.body.deployments.every((d) => d.autoRollbackOf === null));
});

test('a staged build that crashes on start fails the smoke test and the live app is untouched', async () => {
  const app = await createApp('stg-smoke', { steps: nodeSteps('stg-smoke', { healthTimeoutSec: 4 }) });
  const first = await deploy(app.id);
  assert.equal(first.status, 'success', JSON.stringify(first));
  const pidBefore = pm2Entry('stg-smoke').pid;
  const liveSha = (await getApp(app.id)).currentCommitSha;

  branchWith('stg-smoke-crash', { 'server.js': 'process.exit(1);\n' });
  const failed = await deploy(app.id, { mode: 'update', branch: 'stg-smoke-crash' });
  assert.equal(failed.status, 'failed', JSON.stringify(failed));
  assert.match(failed.error, /^Smoke test failed: /);

  assert.ok(!fs.existsSync(staging('stg-smoke')));
  assert.equal(fs.readFileSync(path.join(live('stg-smoke'), 'server.js'), 'utf8').includes('process.exit(1)'), false);
  assert.equal(pm2Entry('stg-smoke').pid, pidBefore);
  assert.equal(server.shims.readPm2State()['app-stg-smoke-smoke'], undefined, 'the throwaway smoke process is gone');
  assert.equal((await fetchText(app.port)).text, 'hello');
  const after = await getApp(app.id);
  assert.equal(after.currentCommitSha, liveSha);
  assert.equal(after.status, 'online');

  const byType = Object.fromEntries(failed.steps.map((s) => [s.type, s.status]));
  assert.equal(byType.install, 'success');
  assert.equal(byType.pm2, 'skipped');
  assert.equal(byType.healthCheck, 'skipped');
  assert.equal(byType.nginx, 'skipped');
  assert.match(await logText(failed.id), /smoke test: starting staged build on spare port/);

  await new Promise((resolve) => setTimeout(resolve, 500));
  const list = await server.agent.get(`/api/apps/${app.id}/deployments`);
  assert.ok(list.body.deployments.every((d) => d.autoRollbackOf === null));
});

test('a force deploy promotes even when the smoke test fails', async () => {
  const app = await createApp('stg-forcesmoke', { steps: nodeSteps('stg-forcesmoke', { healthTimeoutSec: 3 }) });
  assert.equal((await deploy(app.id)).status, 'success');

  branchWith('stg-forcesmoke-crash', { 'server.js': 'process.exit(1);\n' });
  const forced = await deploy(app.id, { mode: 'update', branch: 'stg-forcesmoke-crash', force: true });
  assert.match(await logText(forced.id), /force deploy: ignoring the failed smoke test/);
  assert.ok(fs.readFileSync(path.join(live('stg-forcesmoke'), 'server.js'), 'utf8').includes('process.exit(1)'), 'the staged build was promoted');
});

test('not enough free disk fails before anything is touched', async () => {
  const app = await createApp('stg-disk');
  assert.equal((await deploy(app.id)).status, 'success');
  const pidBefore = pm2Entry('stg-disk').pid;
  const liveEntries = fs.readdirSync(live('stg-disk')).sort();

  __setFreeBytesOverride(1024);
  let failed;
  try {
    failed = await deploy(app.id);
  } finally {
    __setFreeBytesOverride(undefined);
  }
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /^Not enough disk space for a staged deploy: need ~.* have 1\.0 KB free/);
  assert.ok(failed.steps.every((s) => s.status === 'skipped'), JSON.stringify(failed.steps));
  assert.match(await logText(failed.id), /Not enough disk space/);

  assert.ok(!fs.existsSync(staging('stg-disk')));
  assert.deepEqual(fs.readdirSync(live('stg-disk')).sort(), liveEntries);
  assert.equal(pm2Entry('stg-disk').pid, pidBefore);
  assert.equal((await getApp(app.id)).status, 'online', 'app status restored to what it was');
});

test('cancelling during the staging phase removes the staging folder and leaves the live app alone', async () => {
  const slow = { type: 'custom', enabled: true, config: { label: 'Maybe slow', command: `node -e "if(require('fs').existsSync('SLOW'))setTimeout(()=>{},30000)"` } };
  const app = await createApp('stg-cancel', { steps: nodeSteps('stg-cancel', { before: [slow] }) });
  assert.equal((await deploy(app.id)).status, 'success');
  const pidBefore = pm2Entry('stg-cancel').pid;
  const liveEntries = fs.readdirSync(live('stg-cancel')).sort();

  branchWith('stg-cancel-slow', { SLOW: 'x' });
  const res = await server.agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update', branch: 'stg-cancel-slow' });
  assert.equal(res.status, 200);
  const id = res.body.deployment.id;

  // Wait until the slow step is running inside the staging folder.
  const deadline = Date.now() + 20000;
  for (;;) {
    const d = (await server.agent.get(`/api/deployments/${id}`)).body.deployment;
    if (d.steps.find((s) => s.label === 'Maybe slow')?.status === 'running') break;
    assert.ok(Date.now() < deadline, 'slow step never started');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(fs.existsSync(staging('stg-cancel')), 'the build is happening in the staging folder');

  assert.equal((await server.agent.post(`/api/deployments/${id}/cancel`)).status, 200);
  const cancelled = await waitForDeployment(id, { timeoutMs: 10000 });
  assert.equal(cancelled.status, 'cancelled');

  assert.ok(!fs.existsSync(staging('stg-cancel')), 'staging removed on cancel');
  assert.deepEqual(fs.readdirSync(live('stg-cancel')).sort(), liveEntries);
  assert.equal(pm2Entry('stg-cancel').pid, pidBefore);
  assert.equal((await getApp(app.id)).status, 'online');
});

// --- failure after the swap ----------------------------------------------------------------------

test('a failed live health check restores the previous version, whose process serves the OLD code again', async () => {
  const app = await createApp('stg-restore', { steps: nodeSteps('stg-restore', { healthTimeoutSec: 4 }) });
  const first = await deploy(app.id);
  assert.equal(first.status, 'success', JSON.stringify(first));
  const goodSha = (await getApp(app.id)).currentCommitSha;
  assert.equal((await fetchText(app.port)).text, 'hello');

  branchWith('stg-restore-bad', { 'server.js': failsOnRealPort('new-but-broken', app.port) });
  const failed = await deploy(app.id, { mode: 'update', branch: 'stg-restore-bad' });
  assert.equal(failed.status, 'failed', JSON.stringify(failed));
  assert.match(failed.error, /Health check .* failed/);
  assert.equal(failed.restoredPrevious, true);
  assert.equal(failed.steps.find((s) => s.type === 'healthCheck').status, 'failed');

  // Folder: the old code is live again, nothing left over.
  assert.ok(fs.readFileSync(path.join(live('stg-restore'), 'server.js'), 'utf8').includes("GREETING"), 'old server.js is live');
  assert.ok(!fs.existsSync(previous('stg-restore')));
  assert.ok(!fs.existsSync(`${live('stg-restore')}.failed`));
  assert.ok(!fs.existsSync(staging('stg-restore')));

  // Process: running the OLD code, checked over HTTP.
  await fetchEventually(app.port, 'hello');
  const proc = pm2Entry('stg-restore');
  assert.ok(proc);
  assert.doesNotThrow(() => process.kill(proc.pid, 0), 'the restored process is alive');

  const after = await getApp(app.id);
  assert.equal(after.status, 'online');
  assert.equal(after.currentCommitSha, goodSha, 'currentCommitSha only moves on success');
  const log = await logText(failed.id);
  assert.match(log, new RegExp(`restored the previous version \\(${goodSha}\\) in \\d+ms`));

  // The rebuild-based auto-rollback is not started.
  await new Promise((resolve) => setTimeout(resolve, 800));
  const list = await server.agent.get(`/api/apps/${app.id}/deployments`);
  assert.equal(list.body.deployments.length, 2);
  assert.ok(list.body.deployments.every((d) => d.autoRollbackOf === null));

  // The deployment list/detail serializers expose the flag.
  const listed = list.body.deployments.find((d) => d.id === failed.id);
  assert.equal(listed.restoredPrevious, true);
  assert.equal(list.body.deployments.find((d) => d.id === first.id).restoredPrevious, false);
});

test('any step failing after the swap (here a custom step after pm2) restores the previous version', async () => {
  const app = await createApp('stg-poststep', { steps: nodeSteps('stg-poststep', { after: [failIfFile('FAIL_POST', 'Post deploy gate')] }) });
  assert.equal((await deploy(app.id)).status, 'success');
  const goodSha = (await getApp(app.id)).currentCommitSha;

  branchWith('stg-poststep-bad', { 'server.js': plainServer('v2-post'), FAIL_POST: 'x' });
  const failed = await deploy(app.id, { mode: 'update', branch: 'stg-poststep-bad' });
  assert.equal(failed.status, 'failed', JSON.stringify(failed));
  assert.match(failed.error, /Post deploy gate failed/);
  assert.equal(failed.restoredPrevious, true);
  assert.equal(failed.steps.find((s) => s.type === 'pm2').status, 'success', 'the new version did start before the gate failed');

  await fetchEventually(app.port, 'hello');
  assert.ok(!fs.existsSync(path.join(live('stg-poststep'), 'FAIL_POST')));
  const after = await getApp(app.id);
  assert.equal(after.status, 'online');
  assert.equal(after.currentCommitSha, goodSha);
});

test('the very first deploy failing after the swap has nothing to restore and falls back to the legacy failure handling', async () => {
  const app = await createApp('stg-firstfail', { steps: nodeSteps('stg-firstfail', { healthTimeoutSec: 3 }) });
  branchWith('stg-firstfail-bad', { 'server.js': failsOnRealPort('v1', app.port) });
  await server.agent.patch(`/api/apps/${app.id}`).send({ branch: 'stg-firstfail-bad' });

  const failed = await deploy(app.id);
  assert.equal(failed.status, 'failed', JSON.stringify(failed));
  assert.match(failed.error, /Health check .* failed/);
  assert.equal(failed.restoredPrevious, false);
  assert.ok(!fs.existsSync(previous('stg-firstfail')));
  assert.ok(fs.existsSync(live('stg-firstfail')), 'the new build stays live, as in-place deploys always did');

  const after = await getApp(app.id);
  assert.equal(after.status, 'failed', 'pm2 had already been reached');
  assert.equal(after.currentCommitSha, null);
  assert.ok(!(await logText(failed.id)).includes('restored the previous version'));
  // No earlier success exists, so there is also nothing to auto-roll back to.
  const list = await server.agent.get(`/api/apps/${app.id}/deployments`);
  assert.equal(list.body.deployments.length, 1);
});

// --- fresh mode, opt-out, static -------------------------------------------------------------------

test('fresh mode builds in an empty staging folder and keeps the live app until the swap', async () => {
  const app = await createApp('stg-fresh', { steps: nodeSteps('stg-fresh', { before: [failIfFile('FAIL_BUILD', 'Build gate')] }) });
  assert.equal((await deploy(app.id)).status, 'success');
  fs.writeFileSync(path.join(live('stg-fresh'), 'junk.txt'), 'junk');
  const pidBefore = pm2Entry('stg-fresh').pid;

  // A fresh deploy that fails keeps everything, junk included.
  branchWith('stg-fresh-bad', { FAIL_BUILD: 'x' });
  const failed = await deploy(app.id, { mode: 'fresh', branch: 'stg-fresh-bad' });
  assert.equal(failed.status, 'failed');
  assert.ok(fs.existsSync(path.join(live('stg-fresh'), 'junk.txt')), 'the live folder was not wiped');
  assert.equal(pm2Entry('stg-fresh').pid, pidBefore);
  assert.equal((await fetchText(app.port)).text, 'hello');
  assert.ok(!fs.existsSync(staging('stg-fresh')));

  // A fresh deploy that passes replaces the folder wholesale.
  const ok = await deploy(app.id, { mode: 'fresh', branch: 'main' });
  assert.equal(ok.status, 'success', JSON.stringify(ok));
  assert.ok(!fs.existsSync(path.join(live('stg-fresh'), 'junk.txt')), 'a fresh clone has no leftovers');
  assert.ok(!fs.existsSync(previous('stg-fresh')), 'the old folder is deleted once the deploy passed');
  await fetchEventually(app.port, 'hello');
});

test('a staged update deploy replaces untracked files; stagedDeploys:false keeps the legacy in-place behaviour', async () => {
  const app = await createApp('stg-optout');
  assert.equal((await deploy(app.id)).status, 'success');
  fs.writeFileSync(path.join(live('stg-optout'), 'junk.txt'), 'junk');

  // staged (default): the new folder came from a fresh checkout, so untracked files do not survive the swap
  assert.equal((await deploy(app.id)).status, 'success');
  assert.ok(!fs.existsSync(path.join(live('stg-optout'), 'junk.txt')));

  // opt out: deploy in place
  assert.equal((await server.agent.patch(`/api/apps/${app.id}`).send({ stagedDeploys: false })).status, 200);
  fs.writeFileSync(path.join(live('stg-optout'), 'junk.txt'), 'junk');
  rmIfExists(previous('stg-optout'));
  const callsBefore = server.shims.readCalls().length;
  const inPlace = await deploy(app.id);
  assert.equal(inPlace.status, 'success', JSON.stringify(inPlace));
  assert.ok(fs.existsSync(path.join(live('stg-optout'), 'junk.txt')), 'in place: untracked files stay');
  assert.ok(!fs.existsSync(staging('stg-optout')));
  assert.ok(!fs.existsSync(previous('stg-optout')), 'no .previous copy is made');
  assert.ok(!server.shims.readCalls().slice(callsBefore).some((c) => c.includes('-smoke')), 'no smoke test');
  const log = await logText(inPlace.id);
  assert.ok(!/staged deploy|promoted staged build|smoke test/.test(log));

  // and a broken build then modifies the live folder, as before
  branchWith('stg-optout-bad', { FAIL_BUILD: 'x' });
  const steps = nodeSteps('stg-optout', { before: [failIfFile('FAIL_BUILD', 'Build gate')] });
  assert.equal((await server.agent.patch(`/api/apps/${app.id}`).send({ steps })).status, 200);
  const failed = await deploy(app.id, { mode: 'update', branch: 'stg-optout-bad' });
  assert.equal(failed.status, 'failed');
  assert.ok(fs.existsSync(path.join(live('stg-optout'), 'FAIL_BUILD')), 'in place: the broken commit is checked out in the live folder');
  assert.equal(failed.steps.find((s) => s.type === 'install').status, 'pending', 'in place: remaining steps are left pending as before');
});

function rmIfExists(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function createStaticApp(name, branch, extraSteps = []) {
  const steps = defaultSteps(name, 'static');
  const res = await server.agent.post('/api/apps').send({
    name, kind: 'static', repoFullName: server.fixture.repoFullName, branch, nodeVersion: '20', env: [], steps: [...steps, ...extraSteps],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.app;
}

test('a static app still publishes through a staged deploy', async () => {
  branchWith('stg-static-site', { 'index.html': '<h1>v1</h1>' });
  const app = await createStaticApp('stg-site', 'stg-static-site');
  const first = await deploy(app.id);
  assert.equal(first.status, 'success', first.error);
  const current = getPublishedAppCurrentDir(server.config, 'stg-site');
  assert.equal(fs.readFileSync(path.join(current, 'index.html'), 'utf8'), '<h1>v1</h1>');
  assert.equal(server.shims.readCalls().some((c) => c.includes('app-stg-site')), false, 'no pm2 and no smoke test for a static app');

  server.fixture.addCommit('stg-static-site', { filename: 'index.html', content: '<h1>v2</h1>' });
  const second = await deploy(app.id);
  assert.equal(second.status, 'success', second.error);
  assert.equal(fs.readFileSync(path.join(current, 'index.html'), 'utf8'), '<h1>v2</h1>');
  assert.ok(!fs.existsSync(previous('stg-site')), 'the old source is deleted once the deploy passed');
  assert.equal((await getApp(app.id)).status, 'online');
});

test('a static deploy failing after publish puts the previous release back', async () => {
  branchWith('stg-static-fail', { 'index.html': '<h1>good</h1>' });
  const app = await createStaticApp('stg-sitefail', 'stg-static-fail', [failIfFile('FAIL_POST', 'Post publish gate')]);
  assert.equal((await deploy(app.id)).status, 'success');
  const current = getPublishedAppCurrentDir(server.config, 'stg-sitefail');
  const goodRelease = fs.realpathSync(current);

  server.fixture.addCommit('stg-static-fail', { filename: 'index.html', content: '<h1>bad</h1>' });
  server.fixture.addCommit('stg-static-fail', { filename: 'FAIL_POST', content: 'x' });
  const failed = await deploy(app.id);
  assert.equal(failed.status, 'failed', JSON.stringify(failed));
  assert.equal(failed.restoredPrevious, true);
  assert.equal(fs.realpathSync(current), goodRelease, 'the site serves the previous release again');
  assert.equal(fs.readFileSync(path.join(current, 'index.html'), 'utf8'), '<h1>good</h1>');
  assert.equal(fs.readFileSync(path.join(live('stg-sitefail'), 'index.html'), 'utf8'), '<h1>good</h1>');
  assert.equal((await getApp(app.id)).status, 'online');
});

// --- startup recovery -----------------------------------------------------------------------------------

async function makeStuckDeployment(name, appFields = {}) {
  const app = await App.create({
    name,
    repoFullName: 'fixture/repo',
    branch: 'main',
    port: 59000 + nextOffset,
    nodeVersion: '20',
    status: 'deploying',
    steps: defaultSteps(name),
    ...appFields,
  });
  nextOffset += 1;
  await Deployment.create({ appId: app._id, number: 1, branch: 'main', mode: 'update', nodeVersion: '20', status: 'running', steps: [] });
  return app;
}

function writeFolder(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content);
}

test('startup recovery removes stale staging folders of interrupted deploys and leaves the live folder alone', async () => {
  __resetDeployerState();
  await makeStuckDeployment('stg-rec-clean');
  writeFolder(live('stg-rec-clean'), { 'v.txt': 'live' });
  writeFolder(staging('stg-rec-clean'), { 'v.txt': 'half-built' });
  writeFolder(previous('stg-rec-clean'), { 'v.txt': 'older' });

  const count = await recoverInterruptedDeployments(server.config);
  assert.ok(count >= 1);
  assert.ok(!fs.existsSync(staging('stg-rec-clean')));
  assert.equal(fs.readFileSync(path.join(live('stg-rec-clean'), 'v.txt'), 'utf8'), 'live');
  assert.ok(fs.existsSync(previous('stg-rec-clean')), '.previous is kept while the live folder is intact');
});

test('startup recovery repairs a swap interrupted between its two renames', async () => {
  __resetDeployerState();
  await makeStuckDeployment('stg-rec-swap');
  // live was already renamed to .previous; the process died before staging became live
  writeFolder(previous('stg-rec-swap'), { 'v.txt': 'last good' });
  writeFolder(staging('stg-rec-swap'), { 'v.txt': 'new build' });

  await recoverInterruptedDeployments(server.config);
  assert.equal(fs.readFileSync(path.join(live('stg-rec-swap'), 'v.txt'), 'utf8'), 'last good');
  assert.ok(!fs.existsSync(previous('stg-rec-swap')));
  assert.ok(!fs.existsSync(staging('stg-rec-swap')));
});

test('startup recovery does not touch .previous for apps that deploy in place', async () => {
  __resetDeployerState();
  await makeStuckDeployment('stg-rec-inplace', { stagedDeploys: false });
  writeFolder(previous('stg-rec-inplace'), { 'v.txt': 'stale' });

  await recoverInterruptedDeployments(server.config);
  assert.ok(!fs.existsSync(live('stg-rec-inplace')));
  assert.ok(fs.existsSync(previous('stg-rec-inplace')));
});

test('deleting an app removes its staging and previous folders too', async () => {
  const app = await createApp('stg-delete');
  assert.equal((await deploy(app.id)).status, 'success');
  assert.equal((await deploy(app.id)).status, 'success');
  writeFolder(staging('stg-delete'), { 'v.txt': 'x' });
  writeFolder(previous('stg-delete'), { 'v.txt': 'old' }); // leftovers (e.g. from an interrupted deploy) are removed too
  assert.ok(fs.existsSync(previous('stg-delete')));

  const del = await server.agent.delete(`/api/apps/${app.id}`).send({ confirmName: 'stg-delete' });
  assert.equal(del.status, 200);
  assert.ok(!fs.existsSync(live('stg-delete')));
  assert.ok(!fs.existsSync(staging('stg-delete')));
  assert.ok(!fs.existsSync(previous('stg-delete')));
});

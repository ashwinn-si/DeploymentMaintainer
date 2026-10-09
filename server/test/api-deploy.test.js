import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { setupTestServer } from './helpers/testServer.js';
import { disconnectTestDB, clearTestDB } from './helpers/db.js';
import { defaultSteps } from '../src/steps/index.js';
import { recoverInterruptedDeployments, __resetDeployerState, startDeployment } from '../src/services/deployer.js';
import App from '../src/models/App.js';
import Deployment from '../src/models/Deployment.js';

let server;

test.before(async () => {
  server = await setupTestServer();
});

test.after(async () => {
  await server.cleanup();
  await disconnectTestDB();
});

function stepsFor(name, { pm2Command = 'node server.js', buildEnabled = false, extra = [] } = {}) {
  const steps = defaultSteps(name).map((s) => {
    if (s.type === 'pm2') return { ...s, config: { command: pm2Command } };
    if (s.type === 'healthCheck') return { ...s, enabled: true, config: { ...s.config, path: '/', timeoutSec: 20, intervalSec: 1 } };
    if (s.type === 'build') return { ...s, enabled: buildEnabled };
    return s;
  });
  // Insert custom steps right after writeEnv so they run before install/pm2.
  const writeEnvIndex = steps.findIndex((s) => s.type === 'writeEnv');
  steps.splice(writeEnvIndex + 1, 0, ...extra);
  return steps;
}

function createAppBody(fixture, config, overrides = {}) {
  return {
    name: overrides.name,
    repoFullName: fixture.repoFullName,
    branch: 'main',
    nodeVersion: '20',
    env: [{ key: 'GREETING', value: 'hello' }],
    steps: stepsFor(overrides.name),
    port: config.APP_PORT_START + (overrides.portOffset ?? 0),
    ...overrides,
  };
}

async function waitForDeployment(agent, id, { timeoutMs = 25000, intervalMs = 150 } = {}) {
  const start = Date.now();
  for (;;) {
    const res = await agent.get(`/api/deployments/${id}`);
    const status = res.body.deployment.status;
    if (['success', 'failed', 'cancelled'].includes(status)) return res.body.deployment;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`deployment ${id} still ${status} after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function fetchText(port, urlPath = '/') {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  return { status: res.status, text: await res.text() };
}

test('full deploy succeeds: install, pm2 start, health check passes against the real fixture server', async () => {
  const { agent, fixture, config } = server;
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'dep-main', portOffset: 1 }));
  assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
  const app = createRes.body.app;

  const deployRes = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  assert.equal(deployRes.status, 200);
  const deployment = await waitForDeployment(agent, deployRes.body.deployment.id);

  assert.equal(deployment.status, 'success');
  assert.equal(deployment.number, 1);
  assert.ok(deployment.commitSha);
  assert.equal(deployment.previousSha, null);
  assert.equal(deployment.steps.find((s) => s.type === 'healthCheck').status, 'success');

  const { status, text } = await fetchText(app.port, '/');
  assert.equal(status, 200);
  assert.equal(text, 'hello');

  const appAfter = await agent.get(`/api/apps/${app.id}`);
  assert.equal(appAfter.body.app.status, 'online');
  assert.equal(appAfter.body.app.currentCommitSha, deployment.commitSha);
});

test('a second app from the same repo on a different branch with different env serves its own env value', async () => {
  const { agent, fixture, config } = server;
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, {
    name: 'dep-dev',
    portOffset: 2,
    branch: 'dev',
    env: [{ key: 'GREETING', value: 'hello-from-dev' }],
  }));
  assert.equal(createRes.status, 201);
  const app = createRes.body.app;

  const deployRes = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  const deployment = await waitForDeployment(agent, deployRes.body.deployment.id);
  assert.equal(deployment.status, 'success', JSON.stringify(deployment));

  const { text } = await fetchText(app.port, '/');
  assert.equal(text, 'hello-from-dev');

  assert.ok(fs.existsSync(path.join(server.appsDir, 'dep-dev', 'DEV_MARKER.txt')));
});

test('branch switch via the deploy body updates App.branch and the checked-out branch', async () => {
  const { agent, fixture, config } = server;
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'dep-switch', portOffset: 3 }));
  const app = createRes.body.app;

  const first = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  await waitForDeployment(agent, first.body.deployment.id);
  assert.ok(!fs.existsSync(path.join(server.appsDir, 'dep-switch', 'DEV_MARKER.txt')));

  const second = await agent.post(`/api/apps/${app.id}/deploy`).send({ branch: 'dev', mode: 'update' });
  const deployment2 = await waitForDeployment(agent, second.body.deployment.id);
  assert.equal(deployment2.status, 'success', JSON.stringify(deployment2));
  assert.equal(deployment2.branch, 'dev');
  assert.ok(fs.existsSync(path.join(server.appsDir, 'dep-switch', 'DEV_MARKER.txt')));

  const appAfter = await agent.get(`/api/apps/${app.id}`);
  assert.equal(appAfter.body.app.branch, 'dev');
});

test('fresh mode deletes and re-clones the app directory', async () => {
  const { agent, fixture, config } = server;
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'dep-fresh', portOffset: 4 }));
  const app = createRes.body.app;

  const first = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  await waitForDeployment(agent, first.body.deployment.id);

  const junkPath = path.join(server.appsDir, 'dep-fresh', 'untracked-junk.txt');
  fs.writeFileSync(junkPath, 'junk');
  assert.ok(fs.existsSync(junkPath));

  const second = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'fresh' });
  const deployment2 = await waitForDeployment(agent, second.body.deployment.id);
  assert.equal(deployment2.status, 'success', JSON.stringify(deployment2));
  assert.ok(!fs.existsSync(junkPath));
});

test('a disabled build step is skipped', async () => {
  const { agent, fixture, config } = server;
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'dep-buildoff', portOffset: 5 }));
  const app = createRes.body.app;

  const deployRes = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  const deployment = await waitForDeployment(agent, deployRes.body.deployment.id);
  assert.equal(deployment.status, 'success', JSON.stringify(deployment));

  const buildStep = deployment.steps.find((s) => s.type === 'build');
  assert.equal(buildStep.status, 'skipped');
});

test('a custom step runs and its output is observable', async () => {
  const { agent, fixture, config } = server;
  const custom = { type: 'custom', enabled: true, config: { label: 'Write marker', command: 'node -e "require(\'fs\').writeFileSync(\'custom-marker.txt\',\'ran\')"' } };
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, {
    name: 'dep-custom',
    portOffset: 6,
    steps: stepsFor('dep-custom', { extra: [custom] }),
  }));
  const app = createRes.body.app;

  const deployRes = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  const deployment = await waitForDeployment(agent, deployRes.body.deployment.id);
  assert.equal(deployment.status, 'success', JSON.stringify(deployment));
  assert.ok(fs.existsSync(path.join(server.appsDir, 'dep-custom', 'custom-marker.txt')));
});

test('a concurrent deploy on the same app is rejected with 409', async () => {
  const { agent, fixture, config } = server;
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'dep-concurrent', portOffset: 7 }));
  const app = createRes.body.app;

  const first = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  assert.equal(first.status, 200);
  const second = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  assert.equal(second.status, 409);

  await waitForDeployment(agent, first.body.deployment.id);
});

test('two truly concurrent deploy requests (Promise.all) never both start — exactly one 409', async () => {
  const { agent, fixture, config } = server;
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'dep-race', portOffset: 12 }));
  const app = createRes.body.app;

  const [r1, r2] = await Promise.all([
    agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' }),
    agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' }),
  ]);

  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [200, 409], `expected one 200 and one 409, got ${r1.status} and ${r2.status}`);

  const winner = r1.status === 200 ? r1 : r2;
  await waitForDeployment(agent, winner.body.deployment.id);
});

function countSleepProcesses() {
  try {
    const out = execSync("ps -eo command | grep -c '[s]leep 30'").toString().trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

test('cancelling during a custom "sleep 30" step reaches cancelled within 7s and leaves no orphan process', async () => {
  const { agent, fixture, config } = server;
  const minimalSteps = [
    { type: 'gitSync', enabled: true, config: {} },
    { type: 'nodeSetup', enabled: true, config: {} },
    { type: 'writeEnv', enabled: true, config: { filename: '.env' } },
    { type: 'custom', enabled: true, config: { label: 'Sleep', command: 'sleep 30' } },
  ];
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, {
    name: 'dep-cancel',
    portOffset: 8,
    steps: minimalSteps,
  }));
  const app = createRes.body.app;

  const deployRes = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  const deploymentId = deployRes.body.deployment.id;

  // Give gitSync + nodeSetup time to finish so the custom sleep step is the one running.
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const cancelStart = Date.now();
  const cancelRes = await agent.post(`/api/deployments/${deploymentId}/cancel`);
  assert.equal(cancelRes.status, 200);

  const deployment = await waitForDeployment(agent, deploymentId, { timeoutMs: 8000 });
  const elapsed = Date.now() - cancelStart;
  assert.equal(deployment.status, 'cancelled');
  assert.ok(elapsed < 7000, `cancellation took ${elapsed}ms`);

  const sleepDeadline = Date.now() + 5000;
  let remaining = countSleepProcesses();
  while (remaining > 0 && Date.now() < sleepDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    remaining = countSleepProcesses();
  }
  assert.equal(remaining, 0, 'no orphan sleep process should remain');

  const cancelAgain = await agent.post(`/api/deployments/${deploymentId}/cancel`);
  assert.equal(cancelAgain.status, 409);
});

test('a health check failure with autoRollback triggers a rollback deployment to the previous sha', async () => {
  const { agent, fixture, config } = server;
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, {
    name: 'dep-autorollback',
    portOffset: 9,
    steps: stepsFor('dep-autorollback', {}).map((s) => (s.type === 'healthCheck' ? { ...s, config: { ...s.config, timeoutSec: 4, intervalSec: 1 } } : s)),
  }));
  const app = createRes.body.app;

  const first = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  const deployment1 = await waitForDeployment(agent, first.body.deployment.id);
  assert.equal(deployment1.status, 'success', JSON.stringify(deployment1));
  const goodSha = deployment1.commitSha;

  // A dedicated branch, not main, so this crashing server.js doesn't poison
  // the shared fixture's main branch for other tests in this file.
  fixture.createBranchFrom('break-main-autorollback', 'main', {
    filename: 'server.js',
    content: 'process.exit(1);\n',
    message: 'breaks the server',
  });

  const second = await agent.post(`/api/apps/${app.id}/deploy`).send({ branch: 'break-main-autorollback', mode: 'update' });
  const deployment2 = await waitForDeployment(agent, second.body.deployment.id, { timeoutMs: 15000 });
  assert.equal(deployment2.status, 'failed', JSON.stringify(deployment2));
  assert.match(deployment2.error, /health check/i);

  // The deployer starts the rollback after releasing the lock; poll for it to show up.
  let rollbackDeployment = null;
  const start = Date.now();
  while (!rollbackDeployment && Date.now() - start < 15000) {
    const listRes = await agent.get(`/api/apps/${app.id}/deployments`);
    rollbackDeployment = listRes.body.deployments.find((d) => d.autoRollbackOf === deployment2.id);
    if (!rollbackDeployment) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  assert.ok(rollbackDeployment, 'expected an auto-rollback deployment to appear');

  const finishedRollback = await waitForDeployment(agent, rollbackDeployment.id, { timeoutMs: 20000 });
  assert.equal(finishedRollback.status, 'success', JSON.stringify(finishedRollback));
  assert.equal(finishedRollback.commitSha, goodSha);
  assert.equal(finishedRollback.mode, 'rollback');

  const { status, text } = await fetchText(app.port, '/');
  assert.equal(status, 200);
  assert.equal(text, 'hello');
});

test('a failed rollback deployment never triggers another auto-rollback', async () => {
  const { agent, fixture, config } = server;
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, {
    name: 'dep-norollbackchain',
    portOffset: 15,
    steps: stepsFor('dep-norollbackchain', {}).map((s) => (s.type === 'healthCheck' ? { ...s, config: { ...s.config, timeoutSec: 4, intervalSec: 1 } } : s)),
  }));
  const app = createRes.body.app;

  const first = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  const deployment1 = await waitForDeployment(agent, first.body.deployment.id);
  assert.equal(deployment1.status, 'success', JSON.stringify(deployment1));

  fixture.createBranchFrom('break-main-norollbackchain', 'main', {
    filename: 'server.js',
    content: 'process.exit(1);\n',
    message: 'breaks the server',
  });
  const brokenSha = fixture.shaOf('break-main-norollbackchain');

  // Call the deployer directly with mode:'rollback' targeting a broken sha —
  // rollbackTo() itself refuses this, but here we're simulating the deployer's
  // own auto-rollback path hitting a bad target, to prove it doesn't chain further.
  const rollbackDeployment = await startDeployment(app.id, config, {
    branch: 'break-main-norollbackchain',
    mode: 'rollback',
    sha: brokenSha,
    rollbackOf: deployment1.id,
  });

  const finishedRollback = await waitForDeployment(agent, rollbackDeployment._id.toString(), { timeoutMs: 15000 });
  assert.equal(finishedRollback.status, 'failed', JSON.stringify(finishedRollback));
  assert.match(finishedRollback.error, /health check/i);

  // Give a wrongly-chained auto-rollback a chance to appear if the guard were missing.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const listRes = await agent.get(`/api/apps/${app.id}/deployments`);
  const chained = listRes.body.deployments.find((d) => d.autoRollbackOf === finishedRollback.id);
  assert.equal(chained, undefined, 'a failed rollback must not trigger another auto-rollback');
});

test('manual rollback redeploys a previous successful deployment sha', async () => {
  const { agent, fixture, config } = server;
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'dep-manualrollback', portOffset: 10 }));
  const app = createRes.body.app;

  const first = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  const deployment1 = await waitForDeployment(agent, first.body.deployment.id);
  assert.equal(deployment1.status, 'success');

  fixture.addCommit('main', { filename: 'second-commit.txt', content: 'x', message: 'second commit' });
  const second = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  const deployment2 = await waitForDeployment(agent, second.body.deployment.id);
  assert.equal(deployment2.status, 'success');
  assert.notEqual(deployment2.commitSha, deployment1.commitSha);

  const rollbackRes = await agent.post(`/api/deployments/${deployment1.id}/rollback`);
  assert.equal(rollbackRes.status, 200, JSON.stringify(rollbackRes.body));
  const rollbackDeployment = await waitForDeployment(agent, rollbackRes.body.deployment.id);
  assert.equal(rollbackDeployment.status, 'success');
  assert.equal(rollbackDeployment.commitSha, deployment1.commitSha);
  assert.equal(rollbackDeployment.mode, 'rollback');
  assert.equal(rollbackDeployment.rollbackOf, deployment1.id);
});

test('rollback is rejected for a deployment that never succeeded', async () => {
  const { agent } = server;
  const fakeAppId = (await App.findOne().sort({ createdAt: 1 }))._id;
  const failed = await Deployment.create({
    appId: fakeAppId,
    number: 999,
    branch: 'main',
    mode: 'update',
    nodeVersion: '20',
    status: 'failed',
    steps: [],
  });
  const res = await agent.post(`/api/deployments/${failed._id}/rollback`);
  assert.equal(res.status, 400);
});

test('an undecryptable env fails deploy clearly, without bumping deploySeq/creating a deployment, and GET /apps/:id also fails clearly', async () => {
  const { agent, fixture, config } = server;
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'dep-badenv', portOffset: 16 }));
  const app = createRes.body.app;

  // Corrupt the stored blob (simulates ENCRYPTION_KEY having changed since this app was saved).
  await App.updateOne({ _id: app.id }, {
    envEncrypted: {
      iv: Buffer.alloc(12, 1).toString('base64'),
      tag: Buffer.alloc(16, 2).toString('base64'),
      data: Buffer.alloc(16, 3).toString('base64'),
    },
  });

  const deployRes = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  assert.equal(deployRes.status, 500, JSON.stringify(deployRes.body));
  assert.match(deployRes.body.error, /Could not decrypt/);

  const appAfter = await App.findById(app.id).lean();
  assert.equal(appAfter.deploySeq, 0, 'deploySeq must not be bumped when the env can\'t be decrypted');
  assert.equal(appAfter.status, 'not_deployed', 'App.status must not flip to deploying');

  const depCount = await Deployment.countDocuments({ appId: app.id });
  assert.equal(depCount, 0, 'no Deployment doc should have been created');

  const getRes = await agent.get(`/api/apps/${app.id}`);
  assert.equal(getRes.status, 500, JSON.stringify(getRes.body));
  assert.match(getRes.body.error, /Could not decrypt/);
});

test('a secret env value printed by a custom step is redacted from entries and the download', async () => {
  const { agent, fixture, config } = server;
  const secretValue = 'sk-supersecretvalue-123456';
  const printSecret = {
    type: 'custom',
    enabled: true,
    config: { label: 'Print secret', command: 'node -e "console.log(process.env.SECRET)"' },
  };
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, {
    name: 'dep-redact',
    portOffset: 11,
    env: [{ key: 'GREETING', value: 'hello' }, { key: 'SECRET', value: secretValue }],
    steps: stepsFor('dep-redact', { extra: [printSecret] }),
  }));
  const app = createRes.body.app;

  const deployRes = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
  const deployment = await waitForDeployment(agent, deployRes.body.deployment.id);
  assert.equal(deployment.status, 'success', JSON.stringify(deployment));

  const entriesRes = await agent.get(`/api/deployments/${deployment.id}/entries?after=-1&limit=5000`);
  const allText = entriesRes.body.entries.map((e) => e.text).join('\n');
  assert.ok(!allText.includes(secretValue), 'secret must not appear in stored entries');
  assert.ok(allText.includes('••••'), 'expected a redaction marker somewhere in the log');

  const downloadRes = await agent.get(`/api/deployments/${deployment.id}/download`);
  assert.equal(downloadRes.status, 200);
  assert.ok(!downloadRes.text.includes(secretValue), 'secret must not appear in the downloaded log');
});

test('recoverInterruptedDeployments fails stuck deployments and resets the app status', async () => {
  __resetDeployerState();
  const app = await App.create({
    name: 'dep-recovery',
    repoFullName: 'fixture/repo',
    branch: 'main',
    port: 59999,
    nodeVersion: '20',
    status: 'deploying',
    steps: defaultSteps('dep-recovery'),
  });
  const deployment = await Deployment.create({
    appId: app._id,
    number: 1,
    branch: 'main',
    mode: 'update',
    nodeVersion: '20',
    status: 'running',
    steps: [],
  });

  const count = await recoverInterruptedDeployments();
  assert.ok(count >= 1);

  const reloadedDeployment = await Deployment.findById(deployment._id).lean();
  assert.equal(reloadedDeployment.status, 'failed');
  assert.equal(reloadedDeployment.error, 'Dashboard restarted during deploy');

  const reloadedApp = await App.findById(app._id).lean();
  assert.equal(reloadedApp.status, 'failed');
});

// --- pm2 start vs restart ---------------------------------------------------

// pm2 shim calls that concern one app, in order (the log is shared by every test in this file).
function pm2CallsFor(name) {
  return server.shims.readCalls().filter((line) => (
    line.startsWith('pm2 ') && (line.includes(`app-${name} `) || line.endsWith(`app-${name}`) || line.includes(`/${name}/ecosystem`))
  ));
}

async function deployOnce(agent, appId, body = { mode: 'update' }) {
  const res = await agent.post(`/api/apps/${appId}/deploy`).send(body);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const deployment = await waitForDeployment(agent, res.body.deployment.id);
  assert.equal(deployment.status, 'success', JSON.stringify(deployment));
  return deployment;
}

test('first deploy of a new app starts the pm2 process; the next update deploy restarts it with --update-env', async () => {
  const { agent, fixture, config, shims } = server;
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'dep-restart', portOffset: 20 }));
  const app = createRes.body.app;
  const pm2Name = 'app-dep-restart';

  await deployOnce(agent, app.id);
  let calls = pm2CallsFor('dep-restart');
  assert.ok(calls.some((c) => c.startsWith('pm2 start ') && c.endsWith('--update-env')), calls.join('\n'));
  assert.ok(!calls.some((c) => c.startsWith('pm2 restart')), 'a new app must not be restarted');
  assert.ok(!calls.some((c) => c.startsWith('pm2 startOrReload')));
  const restartsAfterFirst = shims.readPm2State()[pm2Name].pm2_env.restart_time;
  const pidAfterFirst = shims.readPm2State()[pm2Name].pid;

  const before = shims.readCalls().length;
  await deployOnce(agent, app.id);
  calls = shims.readCalls().slice(before).filter((c) => c.includes(pm2Name) || c.includes('/dep-restart/ecosystem'));
  assert.ok(calls.some((c) => c.startsWith('pm2 restart ') && c.includes('/dep-restart/ecosystem') && c.endsWith('--update-env')), calls.join('\n'));
  assert.ok(!calls.some((c) => c.startsWith('pm2 start ')), 'an unchanged definition must not be recreated');
  assert.ok(!calls.some((c) => c.startsWith('pm2 delete')));

  const proc = shims.readPm2State()[pm2Name];
  assert.ok(proc.pm2_env.restart_time > restartsAfterFirst);
  assert.notEqual(proc.pid, pidAfterFirst);
  assert.equal((await fetchText(app.port, '/')).text, 'hello');
});

test('an update deploy after changing the pm2 start command deletes and recreates the process', async () => {
  const { agent, fixture, config, shims } = server;
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'dep-newcmd', portOffset: 21 }));
  const app = createRes.body.app;
  const pm2Name = 'app-dep-newcmd';

  await deployOnce(agent, app.id);

  const patchRes = await agent.patch(`/api/apps/${app.id}`).send({ steps: stepsFor('dep-newcmd', { pm2Command: 'node ./server.js' }) });
  assert.equal(patchRes.status, 200, JSON.stringify(patchRes.body));

  const before = shims.readCalls().length;
  await deployOnce(agent, app.id);
  const calls = shims.readCalls().slice(before).filter((c) => c.includes(pm2Name) || c.includes('/dep-newcmd/ecosystem'));
  const deleteIdx = calls.indexOf(`pm2 delete ${pm2Name}`);
  const startIdx = calls.findIndex((c) => c.startsWith('pm2 start '));
  assert.ok(deleteIdx >= 0 && startIdx > deleteIdx, calls.join('\n'));
  assert.ok(!calls.some((c) => c.startsWith('pm2 restart')));

  assert.equal((await fetchText(app.port, '/')).text, 'hello');
});

test('a fresh deploy deletes any leftover pm2 process and starts a new one', async () => {
  const { agent, fixture, config, shims } = server;
  const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'dep-freshpm2', portOffset: 22 }));
  const app = createRes.body.app;
  const pm2Name = 'app-dep-freshpm2';

  await deployOnce(agent, app.id);

  const before = shims.readCalls().length;
  await deployOnce(agent, app.id, { mode: 'fresh' });
  const calls = shims.readCalls().slice(before).filter((c) => c.includes(pm2Name) || c.includes('/dep-freshpm2/ecosystem'));
  const deleteIdx = calls.indexOf(`pm2 delete ${pm2Name}`);
  const startIdx = calls.findIndex((c) => c.startsWith('pm2 start '));
  assert.ok(deleteIdx >= 0 && startIdx > deleteIdx, calls.join('\n'));
  assert.ok(!calls.some((c) => c.startsWith('pm2 restart')));
  assert.equal((await fetchText(app.port, '/')).text, 'hello');
});

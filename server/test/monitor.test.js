import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestServer } from './helpers/testServer.js';
import { disconnectTestDB, clearTestDB } from './helpers/db.js';
import { defaultSteps } from '../src/steps/index.js';
import * as monitor from '../src/services/monitor.js';
import App from '../src/models/App.js';

function stepsFor(name) {
  return defaultSteps(name).map((s) => {
    if (s.type === 'pm2') return { ...s, config: { command: 'node server.js' } };
    if (s.type === 'healthCheck') return { ...s, config: { ...s.config, timeoutSec: 20, intervalSec: 1 } };
    return s;
  });
}

function createAppBody(fixture, config, overrides = {}) {
  return {
    name: overrides.name,
    repoFullName: fixture.repoFullName,
    branch: 'main',
    nodeVersion: '20',
    env: [{ key: 'GREETING', value: 'hello-monitor' }],
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
    if (Date.now() - start > timeoutMs) throw new Error(`deployment ${id} still ${status} after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

test.after(disconnectTestDB);

test('a health tick updates App.health against the real fixture server', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'mon-app', portOffset: 400 }));
    assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
    const app = createRes.body.app;

    const deployRes = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
    const deployment = await waitForDeployment(agent, deployRes.body.deployment.id);
    assert.equal(deployment.status, 'success', JSON.stringify(deployment));

    const before = await App.findById(app.id).lean();
    assert.equal(before.health.ok, false);
    assert.equal(before.health.checkedAt, null);

    await monitor.__runHealthTick();

    const after = await App.findById(app.id).lean();
    assert.equal(after.health.ok, true);
    assert.equal(after.health.statusCode, 200);
    assert.equal(typeof after.health.latencyMs, 'number');
    assert.ok(after.health.checkedAt);
    assert.ok(Date.now() - new Date(after.health.checkedAt).getTime() < 10000);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('a health tick skips apps that are not online or have no enabled healthCheck step', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;

    // Never deployed: status stays 'not_deployed'.
    const notDeployedRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'mon-notdeployed', portOffset: 401 }));
    const notDeployedApp = notDeployedRes.body.app;

    // Deployed but with healthCheck disabled.
    const noHcSteps = stepsFor('mon-nohc').map((s) => (s.type === 'healthCheck' ? { ...s, enabled: false } : s));
    const noHcRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'mon-nohc', portOffset: 402, steps: noHcSteps }));
    const noHcApp = noHcRes.body.app;
    const deployRes = await agent.post(`/api/apps/${noHcApp.id}/deploy`).send({ mode: 'update' });
    await waitForDeployment(agent, deployRes.body.deployment.id);

    await monitor.__runHealthTick();

    const notDeployedAfter = await App.findById(notDeployedApp.id).lean();
    assert.equal(notDeployedAfter.health.checkedAt, null);

    const noHcAfter = await App.findById(noHcApp.id).lean();
    assert.equal(noHcAfter.health.checkedAt, null, 'a disabled healthCheck step must not be probed');
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

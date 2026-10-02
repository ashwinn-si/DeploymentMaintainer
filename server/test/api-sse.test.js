import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { setupTestServer } from './helpers/testServer.js';
import { disconnectTestDB } from './helpers/db.js';
import { defaultSteps } from '../src/steps/index.js';
import { createDeployLog } from '../src/services/deployLog.js';
import Deployment from '../src/models/Deployment.js';

let server;
let httpServer;
let baseUrl;

test.before(async () => {
  server = await setupTestServer();
  httpServer = server.app.listen(0);
  await new Promise((resolve) => httpServer.once('listening', resolve));
  const { port } = httpServer.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
  await server.cleanup();
  await disconnectTestDB();
});

function stepsFor(name) {
  return defaultSteps(name).map((s) => {
    if (s.type === 'pm2') return { ...s, config: { command: 'node server.js' } };
    if (s.type === 'healthCheck') return { ...s, config: { ...s.config, timeoutSec: 20, intervalSec: 1 } };
    return s;
  });
}

async function createTestApp(name, portOffset) {
  const res = await fetch(`${baseUrl}/api/apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: server.bearer },
    body: JSON.stringify({
      name,
      repoFullName: server.fixture.repoFullName,
      branch: 'main',
      port: server.config.APP_PORT_START + portOffset,
      nodeVersion: '20',
      env: [{ key: 'GREETING', value: 'hi' }],
      steps: stepsFor(name),
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  return body.app;
}

async function deploy(appId, payload = { mode: 'update' }) {
  const res = await fetch(`${baseUrl}/api/apps/${appId}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: server.bearer },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.deployment;
}

async function waitForFinish(id, timeoutMs = 25000) {
  const start = Date.now();
  for (;;) {
    const res = await fetch(`${baseUrl}/api/deployments/${id}`, { headers: { Authorization: server.bearer } });
    const { deployment } = await res.json();
    if (['success', 'failed', 'cancelled'].includes(deployment.status)) return deployment;
    if (Date.now() - start > timeoutMs) throw new Error('deployment did not finish in time');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function openSSE(deploymentId, after) {
  return new Promise((resolve, reject) => {
    const suffix = after !== undefined ? `?after=${after}` : '';
    const url = new URL(`${baseUrl}/api/deployments/${deploymentId}/stream${suffix}`);
    const req = http.get(url, { headers: { Authorization: server.bearer } }, (res) => {
      const events = [];
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let idx = buffer.indexOf('\n\n');
        while (idx !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (raw.trim().length > 0 && !raw.startsWith(':')) {
            const lines = raw.split('\n');
            const eventLine = lines.find((l) => l.startsWith('event: '));
            const dataLine = lines.find((l) => l.startsWith('data: '));
            if (eventLine && dataLine) {
              events.push({ event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) });
            }
          }
          idx = buffer.indexOf('\n\n');
        }
      });
      resolve({ req, res, events });
    });
    req.on('error', reject);
  });
}

test('SSE stream: monotonic non-duplicate line indices, then status and done', async () => {
  const app = await createTestApp('sse-app', 50);
  const deployment = await deploy(app.id);

  const { res, events } = await openSSE(deployment.id, -1);
  await new Promise((resolve) => {
    res.on('end', resolve);
    setTimeout(resolve, 25000);
  });

  await waitForFinish(deployment.id);

  const lineEvents = events.filter((e) => e.event === 'line');
  assert.ok(lineEvents.length > 0, 'expected at least one line event');
  const indices = lineEvents.map((e) => e.data.i);
  assert.equal(new Set(indices).size, indices.length, 'no duplicate indices in the SSE stream');
  const sorted = [...indices].sort((a, b) => a - b);
  assert.deepEqual(indices, sorted, 'indices should arrive in increasing order');

  const doneEvents = events.filter((e) => e.event === 'done');
  assert.equal(doneEvents.length, 1);
  assert.equal(doneEvents[0].data.status, 'success');

  const statusEvents = events.filter((e) => e.event === 'status');
  assert.ok(statusEvents.length >= 1);
  assert.equal(statusEvents[statusEvents.length - 1].data.status, 'success');
});

test('SSE on an already-finished deployment replays and immediately sends status+done', async () => {
  const app = await createTestApp('sse-app2', 51);
  const deployment = await deploy(app.id);
  const finished = await waitForFinish(deployment.id);
  assert.equal(finished.status, 'success');

  const { res, events } = await openSSE(finished.id, -1);
  await new Promise((resolve) => {
    res.on('end', resolve);
    setTimeout(resolve, 5000);
  });

  const doneEvents = events.filter((e) => e.event === 'done');
  assert.equal(doneEvents.length, 1);
  assert.equal(doneEvents[0].data.status, 'success');

  const entriesRes = await fetch(`${baseUrl}/api/deployments/${finished.id}/entries?after=-1&limit=5000`, { headers: { Authorization: server.bearer } });
  const { entries } = await entriesRes.json();
  const lineEvents = events.filter((e) => e.event === 'line');
  assert.equal(lineEvents.length, entries.length, 'replay via SSE should match the entries endpoint');
});

test('a SSE reconnect with ?after= only receives entries past that index', async () => {
  const app = await createTestApp('sse-app3', 52);
  const deployment = await deploy(app.id);
  const finished = await waitForFinish(deployment.id);

  const entriesRes = await fetch(`${baseUrl}/api/deployments/${finished.id}/entries?after=-1&limit=5000`, { headers: { Authorization: server.bearer } });
  const { entries } = await entriesRes.json();
  assert.ok(entries.length > 3);
  const cutoff = entries[2].i;

  const { res, events } = await openSSE(finished.id, cutoff);
  await new Promise((resolve) => {
    res.on('end', resolve);
    setTimeout(resolve, 5000);
  });

  const lineEvents = events.filter((e) => e.event === 'line');
  assert.ok(lineEvents.every((e) => e.data.i > cutoff));
  assert.equal(lineEvents.length, entries.filter((e) => e.i > cutoff).length);
});

test('SSE delivers a line that was pushed but not yet flushed to Mongo', async () => {
  const deployment = await Deployment.create({
    appId: new mongoose.Types.ObjectId(),
    number: 1,
    branch: 'main',
    mode: 'update',
    nodeVersion: '20',
    status: 'running',
    steps: [],
  });

  // A long flush interval so the line below sits in the in-memory buffer,
  // unflushed, for the whole test — exactly the gap getUnflushedEntries covers.
  const log = createDeployLog(deployment, { flushIntervalMs: 60000 });
  log.info('hello-before-flush');

  try {
    const { res, events } = await openSSE(deployment._id.toString(), -1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    res.destroy();

    const dbDoc = await Deployment.findById(deployment._id).lean();
    assert.equal(dbDoc.entries.length, 0, 'the entry should not have reached Mongo yet');

    const lineEvents = events.filter((e) => e.event === 'line');
    assert.ok(
      lineEvents.some((e) => e.data.text === 'hello-before-flush'),
      'expected the unflushed line via SSE even though it is not in the DB yet',
    );
  } finally {
    await log.close();
  }
});

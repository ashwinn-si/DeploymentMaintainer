import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { setupTestServer } from './helpers/testServer.js';
import { disconnectTestDB, clearTestDB } from './helpers/db.js';
import App from '../src/models/App.js';
import RequestStat from '../src/models/RequestStat.js';
import { defaultSteps } from '../src/steps/index.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let server;
let logDir;

test.before(async () => {
  server = await setupTestServer({ nginxEnabled: true });
  logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-api-logs-'));
  server.config.ANALYTICS_ENABLED = true;
  server.config.ACCESS_LOG_DIR = logDir;
});

test.after(async () => {
  await fs.rm(logDir, { recursive: true, force: true });
  await server.cleanup();
  await clearTestDB();
  await disconnectTestDB();
});

test.afterEach(async () => {
  server.config.ANALYTICS_ENABLED = true;
  server.config.ACCESS_LOG_DIR = logDir;
  server.config.NGINX_ENABLED = true;
  delete process.env.SUDO_FAIL_ON;
  await clearTestDB();
  for (const name of await fs.readdir(server.nginxAppsDir)) {
    await fs.rm(path.join(server.nginxAppsDir, name), { force: true });
  }
});

let nextPort = 0;
function makeApp(name, { steps, kind = 'node' } = {}) {
  nextPort += 1;
  return App.create({
    name,
    kind,
    repoFullName: `me/${name}`,
    branch: 'main',
    port: kind === 'static' ? null : 5000 + nextPort,
    nodeVersion: '20',
    steps: steps ?? defaultSteps(name, kind),
  });
}

function stat(app, hourMs, counters = {}) {
  return RequestStat.create({
    appId: app._id,
    appName: app.name,
    hour: new Date(hourMs),
    total: 0,
    ...counters,
    expireAt: new Date(hourMs + 90 * DAY),
  });
}

const hourStart = () => Math.floor(Date.now() / HOUR) * HOUR;
const dayStart = () => Math.floor(Date.now() / DAY) * DAY;

// --- GET /analytics ---------------------------------------------------------------------

test('requires the server secret', async () => {
  const res = await request(server.app).get('/api/analytics');
  assert.equal(res.status, 401);
  assert.equal((await request(server.app).post('/api/analytics/setup')).status, 401);
});

test('GET /analytics (24h default) returns the documented shape, zero-filled and sorted', async () => {
  const alpha = await makeApp('alpha');
  const beta = await makeApp('beta');
  const idle = await makeApp('idle');
  const h0 = hourStart();
  await stat(alpha, h0, { total: 5, s2xx: 3, s3xx: 1, s4xx: 1, bytes: 1000 });
  await stat(alpha, h0 - 2 * HOUR, { total: 2, s2xx: 2, bytes: 20 });
  await stat(beta, h0 - HOUR, { total: 9, s2xx: 4, s4xx: 3, s5xx: 2, bytes: 90 });
  await stat(beta, h0 - 30 * HOUR, { total: 100, s2xx: 100 }); // outside 24h

  const res = await server.agent.get('/api/analytics');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const body = res.body;
  assert.equal(body.enabled, true);
  assert.equal(body.logDirReady, true);
  assert.equal(body.range, '24h');
  assert.equal(body.bucket, 'hour');
  assert.equal(body.from, new Date(h0 - 23 * HOUR).toISOString());
  assert.ok(Math.abs(Date.parse(body.to) - Date.now()) < 5000);
  assert.deepEqual(body.warnings, []);

  assert.deepEqual(body.apps.map((a) => a.name), ['beta', 'alpha', 'idle'], 'sorted by total desc, zeros included');
  const byName = Object.fromEntries(body.apps.map((a) => [a.name, a]));
  assert.deepEqual(byName.beta, { id: String(beta._id), name: 'beta', total: 9, s2xx: 4, s3xx: 0, s4xx: 3, s5xx: 2, bytes: 90 });
  assert.deepEqual(byName.alpha, { id: String(alpha._id), name: 'alpha', total: 7, s2xx: 5, s3xx: 1, s4xx: 1, s5xx: 0, bytes: 1020 });
  assert.equal(byName.idle.total, 0);

  assert.deepEqual(body.status, { s2xx: 9, s3xx: 1, s4xx: 4, s5xx: 2 });

  assert.equal(body.series.length, 24);
  assert.equal(body.series[0].t, new Date(h0 - 23 * HOUR).toISOString());
  assert.equal(body.series[23].t, new Date(h0).toISOString());
  const at = (ms) => body.series.find((p) => p.t === new Date(ms).toISOString());
  assert.equal(at(h0).total, 5);
  assert.deepEqual(at(h0).perApp, { [alpha._id]: 5, [beta._id]: 0, [idle._id]: 0 });
  assert.equal(at(h0 - HOUR).perApp[beta._id], 9);
  assert.equal(at(h0 - 5 * HOUR).total, 0, 'empty buckets are zero filled');
  assert.equal(body.series.reduce((sum, p) => sum + p.total, 0), 16);

  assert.equal(body.busiestHours.length, 24);
  assert.deepEqual(body.busiestHours.map((b) => b.hour), Array.from({ length: 24 }, (_, i) => i));
  const hourOf = (ms) => new Date(ms).getUTCHours();
  const busiest = Object.fromEntries(body.busiestHours.map((b) => [b.hour, b.total]));
  assert.equal(busiest[hourOf(h0 - HOUR)] >= 9, true);
  assert.equal(body.busiestHours.reduce((sum, b) => sum + b.total, 0), 16);
});

test('range=1h covers the previous and the current hour bucket', async () => {
  const alpha = await makeApp('alpha');
  const h0 = hourStart();
  await stat(alpha, h0, { total: 4, s2xx: 4 });
  await stat(alpha, h0 - HOUR, { total: 3, s2xx: 3 });
  await stat(alpha, h0 - 2 * HOUR, { total: 50, s2xx: 50 });

  const res = await server.agent.get('/api/analytics?range=1h');
  assert.equal(res.status, 200);
  assert.equal(res.body.range, '1h');
  assert.equal(res.body.bucket, 'hour');
  assert.equal(res.body.series.length, 2);
  assert.equal(res.body.apps[0].total, 7);
  assert.equal(res.body.from, new Date(h0 - HOUR).toISOString());
});

test('range=7d and 30d sum hourly rows into UTC days', async () => {
  const alpha = await makeApp('alpha');
  const d0 = dayStart();
  const threeAgo = d0 - 3 * DAY;
  await stat(alpha, threeAgo + 2 * HOUR, { total: 10, s2xx: 10 });
  await stat(alpha, threeAgo + 15 * HOUR, { total: 5, s5xx: 5 });
  await stat(alpha, d0 - 20 * DAY + 3 * HOUR, { total: 7, s4xx: 7 });
  await stat(alpha, d0 - 40 * DAY + 3 * HOUR, { total: 1000, s2xx: 1000 }); // outside every range

  const week = (await server.agent.get('/api/analytics?range=7d')).body;
  assert.equal(week.bucket, 'day');
  assert.equal(week.series.length, 7);
  assert.equal(week.series[0].t, new Date(d0 - 6 * DAY).toISOString());
  assert.equal(week.series[6].t, new Date(d0).toISOString());
  const day = week.series.find((p) => p.t === new Date(threeAgo).toISOString());
  assert.equal(day.total, 15);
  assert.equal(day.perApp[alpha._id], 15);
  assert.equal(week.apps[0].total, 15);
  assert.deepEqual(week.status, { s2xx: 10, s3xx: 0, s4xx: 0, s5xx: 5 });
  const busiest = Object.fromEntries(week.busiestHours.map((b) => [b.hour, b.total]));
  assert.equal(busiest[2], 10);
  assert.equal(busiest[15], 5);

  const month = (await server.agent.get('/api/analytics?range=30d')).body;
  assert.equal(month.series.length, 30);
  assert.equal(month.series[0].t, new Date(d0 - 29 * DAY).toISOString());
  assert.equal(month.apps[0].total, 22);
  assert.equal(month.status.s4xx, 7);
});

test('apps= filters to the chosen apps in every part of the response', async () => {
  const alpha = await makeApp('alpha');
  const beta = await makeApp('beta');
  const h0 = hourStart();
  await stat(alpha, h0, { total: 5, s2xx: 5 });
  await stat(beta, h0, { total: 8, s5xx: 8 });

  const res = await server.agent.get(`/api/analytics?range=24h&apps=${beta._id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.apps.map((a) => a.name), ['beta']);
  assert.deepEqual(res.body.status, { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 8 });
  assert.deepEqual(Object.keys(res.body.series[23].perApp), [String(beta._id)]);
  assert.equal(res.body.series[23].total, 8);

  const both = await server.agent.get(`/api/analytics?apps=${alpha._id},${beta._id}`);
  assert.deepEqual(both.body.apps.map((a) => a.name), ['beta', 'alpha']);
});

test('GET /analytics validates range and apps', async () => {
  assert.equal((await server.agent.get('/api/analytics?range=5m')).status, 400);
  assert.equal((await server.agent.get('/api/analytics?apps=not-an-id')).status, 400);
  const app = await makeApp('alpha');
  assert.equal((await server.agent.get(`/api/analytics?apps=${app._id},zzz`)).status, 400);
  // A well-formed id of an app that no longer exists is ignored rather than rejected.
  const gone = await server.agent.get('/api/analytics?apps=000000000000000000000000');
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.body.apps, []);
});

test('reports enabled=false and logDirReady=false honestly, and still serves stored data', async () => {
  const alpha = await makeApp('alpha');
  await stat(alpha, hourStart(), { total: 2, s2xx: 2 });
  server.config.ANALYTICS_ENABLED = false;
  server.config.ACCESS_LOG_DIR = path.join(logDir, 'nope');
  const res = await server.agent.get('/api/analytics');
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, false);
  assert.equal(res.body.logDirReady, false);
  assert.equal(res.body.apps[0].total, 2);
});

// --- POST /analytics/setup ---------------------------------------------------------------

test('POST /setup is a 400 when analytics is disabled', async () => {
  server.config.ANALYTICS_ENABLED = false;
  const res = await server.agent.post('/api/analytics/setup');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /disabled/i);
});

test('POST /setup is a 409 explaining the directory when it does not exist', async () => {
  await makeApp('alpha');
  server.config.ACCESS_LOG_DIR = path.join(logDir, 'missing');
  const res = await server.agent.post('/api/analytics/setup');
  assert.equal(res.status, 409);
  assert.match(res.body.error, /missing/);
  assert.match(res.body.error, /DEPLOYMENT\.md/);
  await assert.rejects(fs.access(path.join(server.nginxAppsDir, 'alpha.conf')), 'nothing was written');
});

test('POST /setup rewrites routes with access_log, skips apps without nginx and is a no-op the second time', async () => {
  await makeApp('alpha');
  await makeApp('site', { kind: 'static' });
  const noNginx = defaultSteps('quiet').map((s) => (s.type === 'nginx' ? { ...s, enabled: false } : s));
  await makeApp('quiet', { steps: noNginx });
  const bare = defaultSteps('bare').filter((s) => s.type !== 'nginx');
  await makeApp('bare', { steps: bare });

  // A route written before analytics existed (no access_log).
  await fs.writeFile(path.join(server.nginxAppsDir, 'alpha.conf'), 'location /alpha/ { proxy_pass http://127.0.0.1:1/; }\n');
  const callsBefore = server.shims.readCalls().length;

  const res = await server.agent.post('/api/analytics/setup');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.updated, 2);
  assert.deepEqual(res.body.errors, []);
  assert.deepEqual(res.body.skipped.map((s) => s.app).sort(), ['bare', 'quiet']);
  assert.ok(res.body.skipped.every((s) => typeof s.reason === 'string' && s.reason.length > 0));

  const alphaConf = await fs.readFile(path.join(server.nginxAppsDir, 'alpha.conf'), 'utf8');
  assert.ok(alphaConf.includes(`access_log ${path.join(logDir, 'alpha.log')} combined;`));
  const siteConf = await fs.readFile(path.join(server.nginxAppsDir, 'site.conf'), 'utf8');
  assert.ok(siteConf.includes(`access_log ${path.join(logDir, 'site.log')} combined;`));
  await assert.rejects(fs.access(path.join(server.nginxAppsDir, 'quiet.conf')));

  const calls = server.shims.readCalls().slice(callsBefore);
  assert.equal(calls.filter((c) => c === 'sudo systemctl reload nginx').length, 2, 'one reload per changed route');

  const again = await server.agent.post('/api/analytics/setup');
  assert.equal(again.status, 200);
  assert.equal(again.body.updated, 0);
});

test('POST /setup collects one app failing without stopping the others', async () => {
  await makeApp('alpha');
  await makeApp('beta');
  process.env.SUDO_FAIL_ON = 'nginx -t';
  const res = await server.agent.post('/api/analytics/setup');
  delete process.env.SUDO_FAIL_ON;
  assert.equal(res.status, 200);
  assert.equal(res.body.updated, 0);
  assert.deepEqual(res.body.errors.map((e) => e.app), ['alpha', 'beta']);
  assert.ok(res.body.errors.every((e) => typeof e.message === 'string' && e.message.length > 0));
  await assert.rejects(fs.access(path.join(server.nginxAppsDir, 'alpha.conf')), 'failed routes are rolled back');

  const retry = await server.agent.post('/api/analytics/setup');
  assert.equal(retry.body.updated, 2);
});

test('POST /setup skips every app when Nginx is disabled on the server', async () => {
  await makeApp('alpha');
  server.config.NGINX_ENABLED = false;
  const res = await server.agent.post('/api/analytics/setup');
  assert.equal(res.status, 200);
  assert.equal(res.body.updated, 0);
  assert.equal(res.body.skipped.length, 1);
  assert.match(res.body.skipped[0].reason, /NGINX_ENABLED/);
});

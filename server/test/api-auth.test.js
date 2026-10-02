import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import request from 'supertest';
import { setupTestServer } from './helpers/testServer.js';
import { disconnectTestDB, clearTestDB } from './helpers/db.js';
import { RESERVED_APP_NAMES } from '../src/lib/validate.js';

test.after(disconnectTestDB);

async function withServer(fn) {
  const server = await setupTestServer();
  try {
    await fn(server);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
}

test('a valid bearer secret is accepted', () =>
  withServer(async ({ app, config }) => {
    const res = await request(app).get('/api/apps').set('Authorization', `Bearer ${config.SERVER_SECRET}`);
    assert.equal(res.status, 200);
  }));

test('a missing Authorization header is rejected with 401', () =>
  withServer(async ({ app }) => {
    const res = await request(app).get('/api/apps');
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Invalid server secret' });
  }));

test('a wrong or malformed secret is rejected with 401', () =>
  withServer(async ({ app, config }) => {
    for (const header of ['Bearer wrong-secret', `Basic ${config.SERVER_SECRET}`, `Bearer ${config.SERVER_SECRET}x`, 'Bearer ']) {
      const res = await request(app).get('/api/apps').set('Authorization', header);
      assert.equal(res.status, 401, header);
      assert.equal(res.body.error, 'Invalid server secret');
    }
  }));

test('repeated wrong secrets are rate limited (429), but the valid secret still works', () =>
  withServer(async ({ app, config }) => {
    for (let i = 0; i < 20; i += 1) {
      const res = await request(app).get('/api/apps').set('Authorization', 'Bearer wrong-secret');
      assert.equal(res.status, 401);
    }
    const limited = await request(app).get('/api/apps').set('Authorization', 'Bearer wrong-secret');
    assert.equal(limited.status, 429);
    assert.ok(limited.body.error);

    const ok = await request(app).get('/api/apps').set('Authorization', `Bearer ${config.SERVER_SECRET}`);
    assert.equal(ok.status, 200);
  }));

test('successful requests (and their 4xx responses) never count toward the failed-attempt limit', () =>
  withServer(async ({ agent }) => {
    for (let i = 0; i < 25; i += 1) {
      const res = await agent.get('/api/apps/000000000000000000000000');
      assert.notEqual(res.status, 401);
      assert.notEqual(res.status, 429);
    }
  }));

test('GET /deployment-manager needs no auth and reports the server identity', () =>
  withServer(async ({ app, config }) => {
    const res = await request(app).get('/deployment-manager');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      service: 'deployment-maintainer',
      serverId: config.SERVER_ID,
      version: res.body.version,
    });
    assert.match(res.body.version, /^\d+\.\d+\.\d+/);
    assert.equal(JSON.stringify(res.body).includes(config.SERVER_SECRET), false);
  }));

test('GET /api/auth/check requires auth and returns serverId + hostname', () =>
  withServer(async ({ app, agent, config }) => {
    const denied = await request(app).get('/api/auth/check');
    assert.equal(denied.status, 401);

    const res = await agent.get('/api/auth/check');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, serverId: config.SERVER_ID, hostname: os.hostname() });
  }));

test('the removed auth and password endpoints are gone', () =>
  withServer(async ({ app, agent }) => {
    assert.equal((await request(app).post('/api/auth/login').send({})).status, 404);
    assert.equal((await agent.post('/api/settings/password').send({})).status, 404);
  }));

test('GET / and other non-API paths return a JSON 404', () =>
  withServer(async ({ app }) => {
    for (const path of ['/', '/login', '/api/nope']) {
      const res = await request(app).get(path);
      assert.equal(res.status, 404, path);
      assert.match(res.headers['content-type'], /json/);
      assert.deepEqual(res.body, { error: 'Not found' });
    }
  }));

test('RESERVED_APP_NAMES covers the routes this server owns', () => {
  assert.deepEqual([...RESERVED_APP_NAMES].sort(), ['api', 'deployment-manager']);
});

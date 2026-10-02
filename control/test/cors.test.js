import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setupControl } from './helpers/testControl.js';
import { loadConfig, ConfigError } from '../src/config.js';
import { connectTestDB, clearTestDB, disconnectTestDB } from './helpers/db.js';

test.before(connectTestDB);
test.after(disconnectTestDB);
test.afterEach(clearTestDB);

const UI = 'https://deploy.example.com';
const EVIL = 'https://evil.example.com';
const PROXIED = '/api/servers/64b7f0f0f0f0f0f0f0f0f0f0/api/apps';

async function setup(corsOrigins) {
  return setupControl({ login: false, config: { CORS_ORIGINS: corsOrigins } });
}

test('allowed origin gets credentialed CORS headers on a normal request', async () => {
  const { app } = await setup([UI]);
  const res = await request(app).get('/api/health').set('Origin', UI);
  assert.equal(res.status, 200);
  assert.equal(res.headers['access-control-allow-origin'], UI);
  assert.equal(res.headers['access-control-allow-credentials'], 'true');
  assert.match(res.headers['access-control-expose-headers'], /Content-Disposition/);
});

test('preflight to a proxied path succeeds for an allowed origin', async () => {
  const { app } = await setup([UI]);
  const res = await request(app)
    .options(PROXIED)
    .set('Origin', UI)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type');
  assert.equal(res.status, 204);
  assert.equal(res.headers['access-control-allow-origin'], UI);
  assert.equal(res.headers['access-control-allow-credentials'], 'true');
  assert.match(res.headers['access-control-allow-methods'], /PATCH/);
  assert.match(res.headers['access-control-allow-headers'], /Content-Type/i);
  assert.equal(res.headers['access-control-max-age'], '600');
});

test('disallowed origin gets no CORS headers', async () => {
  const { app } = await setup([UI]);
  const res = await request(app).get('/api/health').set('Origin', EVIL);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  const pre = await request(app)
    .options(PROXIED)
    .set('Origin', EVIL)
    .set('Access-Control-Request-Method', 'POST');
  assert.equal(pre.headers['access-control-allow-origin'], undefined);
});

test('POST with a disallowed Origin is rejected with 403', async () => {
  const { app } = await setup([UI]);
  const res = await request(app).post('/api/auth/login').set('Origin', EVIL).send({});
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: 'Origin not allowed' });
  const proxied = await request(app).post(PROXIED).set('Origin', EVIL).send({});
  assert.equal(proxied.status, 403);
});

test('POST with an allowed Origin passes the origin check', async () => {
  const { app } = await setup([UI]);
  const res = await request(app).post('/api/auth/login').set('Origin', UI).send({});
  assert.notEqual(res.status, 403);
});

test('POST with no Origin header passes the origin check', async () => {
  const { app } = await setup([UI]);
  const res = await request(app).post('/api/auth/login').send({});
  assert.notEqual(res.status, 403);
});

test("POST from the control plane's own origin passes the origin check", async () => {
  const { app } = await setup([UI]);
  const res = await request(app)
    .post('/api/auth/login')
    .set('Host', 'control.example.com')
    .set('Origin', 'http://control.example.com')
    .send({});
  assert.notEqual(res.status, 403);
});

test('empty CORS_ORIGINS: no CORS headers, only same-origin or no-Origin writes allowed', async () => {
  const { app } = await setup([]);
  const get = await request(app).get('/api/health').set('Origin', UI);
  assert.equal(get.headers['access-control-allow-origin'], undefined);
  assert.equal(get.headers['access-control-allow-credentials'], undefined);

  const cross = await request(app).post('/api/auth/login').set('Origin', UI).send({});
  assert.equal(cross.status, 403);

  const same = await request(app)
    .post('/api/auth/login')
    .set('Host', 'control.example.com')
    .set('Origin', 'http://control.example.com')
    .send({});
  assert.notEqual(same.status, 403);

  const none = await request(app).post('/api/auth/login').send({});
  assert.notEqual(none.status, 403);
});

test('CORS_ORIGINS config parsing', () => {
  const base = {
    MONGO_URI: 'mongodb://127.0.0.1:27017/x',
    JWT_SECRET: 'j'.repeat(32),
    ENCRYPTION_KEY: 'a'.repeat(64),
  };
  const keys = [...Object.keys(base), 'CORS_ORIGINS'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, base);
  try {
    delete process.env.CORS_ORIGINS;
    assert.deepEqual(loadConfig().CORS_ORIGINS, []);
    process.env.CORS_ORIGINS = '';
    assert.deepEqual(loadConfig().CORS_ORIGINS, []);
    process.env.CORS_ORIGINS = ' https://a.example.com , http://localhost:5173 ';
    assert.deepEqual(loadConfig().CORS_ORIGINS, ['https://a.example.com', 'http://localhost:5173']);
    for (const bad of ['https://a.example.com/', 'https://a.example.com/path', 'a.example.com', '*']) {
      process.env.CORS_ORIGINS = bad;
      assert.throws(() => loadConfig(), ConfigError, bad);
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

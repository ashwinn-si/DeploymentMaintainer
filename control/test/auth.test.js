import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import User from '../src/models/User.js';
import { setupControl, ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers/testControl.js';
import { connectTestDB, clearTestDB, disconnectTestDB } from './helpers/db.js';

test.before(connectTestDB);
test.after(disconnectTestDB);
test.afterEach(clearTestDB);

test('login succeeds with the right credentials and sets an httpOnly dm_session cookie', async () => {
  const { app } = await setupControl({ login: false });
  const res = await request(app).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, ADMIN_EMAIL);
  assert.ok(res.body.user.id);
  const cookie = res.headers['set-cookie'].join(';');
  assert.match(cookie, /dm_session=/);
  assert.match(cookie, /HttpOnly/i);
});

test('login fails with 401 for a wrong password and for an unknown email', async () => {
  const { app } = await setupControl({ login: false });
  const wrongPw = await request(app).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: 'nope-nope-nope' });
  assert.equal(wrongPw.status, 401);
  const unknown = await request(app).post('/api/auth/login').send({ email: 'who@example.com', password: ADMIN_PASSWORD });
  assert.equal(unknown.status, 401);
  assert.equal(wrongPw.body.error, unknown.body.error);
});

test('login rejects a malformed body with 400', async () => {
  const { app } = await setupControl({ login: false });
  const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
  assert.equal(res.status, 400);
});

test('login is rate limited after 10 attempts', async () => {
  const { app } = await setupControl({ login: false });
  let last;
  for (let i = 0; i < 11; i += 1) {
    last = await request(app).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: 'wrong-wrong-wrong' });
  }
  assert.equal(last.status, 429);
});

test('/me returns the user when logged in and 401 otherwise', async () => {
  const { app, agent } = await setupControl();
  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, ADMIN_EMAIL);
  const anon = await request(app).get('/api/auth/me');
  assert.equal(anon.status, 401);
});

test('logout clears the cookie', async () => {
  const { agent } = await setupControl();
  const out = await agent.post('/api/auth/logout');
  assert.equal(out.status, 200);
  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 401);
});

test('re-seeding (tokenVersion bump) invalidates an existing session cookie', async () => {
  const { app } = await setupControl({ login: false });
  const login = await request(app).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const cookie = login.headers['set-cookie'];
  await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);

  await User.updateOne({ email: ADMIN_EMAIL }, { $inc: { tokenVersion: 1 } });
  await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
});

test('unauthenticated access to /api/servers and the proxy is 401', async () => {
  const { app } = await setupControl({ login: false });
  assert.equal((await request(app).get('/api/servers')).status, 401);
  assert.equal((await request(app).get('/api/servers/507f1f77bcf86cd799439011/api/apps')).status, 401);
});

test('/api/health is public and unknown /api paths are JSON 404', async () => {
  const { app } = await setupControl({ login: false });
  assert.deepEqual((await request(app).get('/api/health')).body, { ok: true });
  const missing = await request(app).get('/api/nope');
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: 'Not found' });
});

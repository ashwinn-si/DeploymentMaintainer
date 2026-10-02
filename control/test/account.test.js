import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setupControl, ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers/testControl.js';
import { connectTestDB, clearTestDB, disconnectTestDB } from './helpers/db.js';

test.before(connectTestDB);
test.after(disconnectTestDB);
test.afterEach(clearTestDB);

test('POST /settings/password: wrong current is 400, validation is 400, success invalidates the old cookie', async () => {
  const { app, agent } = await setupControl();

  const fresh = await request(app).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const oldCookie = fresh.headers['set-cookie'];

  const wrong = await agent.post('/api/settings/password').send({ currentPassword: 'totally-wrong-password', newPassword: 'brand-new-password-1' });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /incorrect/i);

  const tooShort = await agent.post('/api/settings/password').send({ currentPassword: ADMIN_PASSWORD, newPassword: 'short' });
  assert.equal(tooShort.status, 400);

  const same = await agent.post('/api/settings/password').send({ currentPassword: ADMIN_PASSWORD, newPassword: ADMIN_PASSWORD });
  assert.equal(same.status, 400);
  assert.match(same.body.error, /different/i);

  const ok = await agent.post('/api/settings/password').send({ currentPassword: ADMIN_PASSWORD, newPassword: 'brand-new-password-1' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });

  await request(app).get('/api/auth/me').set('Cookie', oldCookie).expect(401);
  await agent.get('/api/auth/me').expect(200);

  await request(app).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: 'brand-new-password-1' }).expect(200);
});

test('POST /settings/password requires a session', async () => {
  const { app } = await setupControl({ login: false });
  const res = await request(app).post('/api/settings/password').send({ currentPassword: 'a', newPassword: 'b'.repeat(12) });
  assert.equal(res.status, 401);
});

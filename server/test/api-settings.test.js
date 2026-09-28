import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestServer } from './helpers/testServer.js';
import { disconnectTestDB, clearTestDB } from './helpers/db.js';
import { setFetchImpl, __resetCache } from '../src/services/github.js';

function mockResponse({ status = 200, json, headers = {} } = {}) {
  const lowerHeaders = {};
  for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lowerHeaders[name.toLowerCase()] ?? null },
    json: async () => json,
    text: async () => (json ? JSON.stringify(json) : ''),
  };
}

test.after(disconnectTestDB);

test('GET /settings/info reports a github error (never throws) when GITHUB_TOKEN is unset', async () => {
  const server = await setupTestServer();
  try {
    const res = await server.agent.get('/api/settings/info');
    assert.equal(res.status, 200);
    assert.ok(res.body.github.error, 'expected a { error } shape, not a thrown 503');
    assert.equal(res.body.appsDir, server.config.APPS_DIR);
    assert.equal(res.body.nginxEnabled, server.config.NGINX_ENABLED);
    assert.equal(res.body.domainHint, null);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('GET /settings/info returns github token info when GITHUB_TOKEN is set', async () => {
  const server = await setupTestServer();
  try {
    server.config.GITHUB_TOKEN = 'test-token-settings';
    setFetchImpl(async () => mockResponse({
      json: { login: 'octocat' },
      headers: { 'x-oauth-scopes': 'repo, read:org', 'x-ratelimit-remaining': '4999' },
    }));

    const res = await server.agent.get('/api/settings/info');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.github, { login: 'octocat', scopes: ['repo', 'read:org'], rateLimitRemaining: 4999 });
  } finally {
    setFetchImpl();
    __resetCache();
    await server.cleanup();
    await clearTestDB();
  }
});

test('POST /settings/password: wrong current password is 400; success rotates the session, invalidating the old cookie', async () => {
  const server = await setupTestServer();
  try {
    const { agent, config, app } = server;
    const request = (await import('supertest')).default;

    const freshLogin = await request(app).post('/api/auth/login').send({ email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD });
    assert.equal(freshLogin.status, 200);
    const oldCookie = freshLogin.headers['set-cookie'];
    assert.ok(oldCookie);

    const wrong = await agent.post('/api/settings/password').send({ currentPassword: 'totally-wrong-password', newPassword: 'brand-new-password-1' });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error, /incorrect/i);

    const tooShort = await agent.post('/api/settings/password').send({ currentPassword: config.ADMIN_PASSWORD, newPassword: 'short' });
    assert.equal(tooShort.status, 400);

    const same = await agent.post('/api/settings/password').send({ currentPassword: config.ADMIN_PASSWORD, newPassword: config.ADMIN_PASSWORD });
    assert.equal(same.status, 400);
    assert.match(same.body.error, /different/i);

    const ok = await agent.post('/api/settings/password').send({ currentPassword: config.ADMIN_PASSWORD, newPassword: 'brand-new-password-1' });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { ok: true });

    const oldCookieRes = await request(app).get('/api/auth/me').set('Cookie', oldCookie);
    assert.equal(oldCookieRes.status, 401, 'the pre-change cookie must be invalidated by the tokenVersion bump');

    const newCookieRes = await agent.get('/api/auth/me');
    assert.equal(newCookieRes.status, 200, "the agent's jar was updated with the reissued cookie");
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

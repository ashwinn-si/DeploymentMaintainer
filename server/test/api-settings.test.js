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
    assert.equal(res.body.serverId, server.config.SERVER_ID);
    assert.ok(res.body.hostname);
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

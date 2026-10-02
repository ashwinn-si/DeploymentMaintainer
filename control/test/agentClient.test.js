import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServerUrl, handshake, checkAuth, verifyServer, probeServer } from '../src/services/agentClient.js';
import { startFakeAgent } from './helpers/fakeAgent.js';

const strict = { ALLOW_INSECURE_SERVER_URLS: false };

test('normalizeServerUrl keeps only the origin', () => {
  assert.equal(normalizeServerUrl('https://api.example.com/some/path/?q=1#h', strict), 'https://api.example.com');
  assert.equal(normalizeServerUrl(' https://api.example.com:8443/ ', strict), 'https://api.example.com:8443');
});

test('normalizeServerUrl allows http only for localhost or when ALLOW_INSECURE_SERVER_URLS', () => {
  assert.equal(normalizeServerUrl('http://localhost:3000/x', strict), 'http://localhost:3000');
  assert.equal(normalizeServerUrl('http://127.0.0.1:3000', strict), 'http://127.0.0.1:3000');
  assert.equal(normalizeServerUrl('http://[::1]:3000', strict), 'http://[::1]:3000');
  assert.throws(() => normalizeServerUrl('http://example.com', strict), { status: 400, message: 'Invalid server URL' });
  assert.equal(normalizeServerUrl('http://example.com', { ALLOW_INSECURE_SERVER_URLS: true }), 'http://example.com');
});

test('normalizeServerUrl rejects garbage and non-http protocols', () => {
  for (const bad of ['', 'not a url', 'ftp://example.com', 'javascript:alert(1)']) {
    assert.throws(() => normalizeServerUrl(bad, strict), { status: 400 }, bad);
  }
});

test('handshake / checkAuth / verifyServer against a fake agent', async () => {
  const agent = await startFakeAgent();
  try {
    assert.deepEqual(await handshake(agent.url), { serverId: agent.serverId, version: '1.2.3' });
    assert.deepEqual(await checkAuth(agent.url, agent.secret), { serverId: agent.serverId, hostname: 'fake-host' });
    await assert.rejects(() => checkAuth(agent.url, 'z'.repeat(40)), { status: 400, message: /rejected the secret/ });
    assert.deepEqual(await verifyServer({ url: agent.url, serverId: agent.serverId, secret: agent.secret }), { version: '1.2.3', hostname: 'fake-host' });
    await assert.rejects(
      () => verifyServer({ url: agent.url, serverId: 'someone-else-1', secret: agent.secret }),
      { status: 400, message: `Server ID mismatch: the server reports "${agent.serverId}" — check SERVER_ID in its .env` },
    );
  } finally {
    await agent.close();
  }
});

test('probeServer maps outcomes to online / unauthorized / offline', async () => {
  const agent = await startFakeAgent();
  const target = { url: agent.url, serverId: agent.serverId, secret: agent.secret };
  try {
    assert.deepEqual(await probeServer(target), { status: 'online', version: '1.2.3', hostname: 'fake-host' });
    assert.deepEqual(await probeServer({ ...target, secret: 'z'.repeat(40) }), { status: 'unauthorized' });
  } finally {
    await agent.close();
  }
  assert.deepEqual(await probeServer(target), { status: 'offline' });
});

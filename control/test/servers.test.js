import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import Server from '../src/models/Server.js';
import { encryptJSON, decryptJSON } from '../src/lib/crypto.js';
import { setupControl } from './helpers/testControl.js';
import { startFakeAgent } from './helpers/fakeAgent.js';
import { connectTestDB, clearTestDB, disconnectTestDB } from './helpers/db.js';

test.before(connectTestDB);
test.after(disconnectTestDB);
test.afterEach(clearTestDB);

async function withAgent(opts, fn) {
  const agent = await startFakeAgent(opts);
  try {
    return await fn(agent);
  } finally {
    await agent.close();
  }
}

const payload = (agent, extra = {}) => ({ name: 'Box 1', url: agent.url, serverId: agent.serverId, secret: agent.secret, ...extra });

async function closedPort() {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

test('POST /servers verifies the agent, stores the secret encrypted, and returns a summary without it', async () => {
  const { agent: browser, config } = await setupControl();
  await withAgent({}, async (agent) => {
    const res = await browser.post('/api/servers').send(payload(agent, { url: `${agent.url}/ignored/path/` }));
    assert.equal(res.status, 200);
    const { server } = res.body;
    assert.equal(server.name, 'Box 1');
    assert.equal(server.url, agent.url);
    assert.equal(server.serverId, agent.serverId);
    assert.equal(server.status, 'online');
    assert.equal(server.version, '1.2.3');
    assert.equal(server.hostname, 'fake-host');
    assert.ok(server.id && server.createdAt);
    assert.ok(!('_id' in server));
    assert.ok(!JSON.stringify(res.body).includes(agent.secret));
    assert.ok(!JSON.stringify(res.body).includes('secretEncrypted'));

    const stored = await Server.findById(server.id);
    assert.ok(!JSON.stringify(stored.secretEncrypted).includes(agent.secret));
    assert.deepEqual(decryptJSON(config, stored.secretEncrypted), { secret: agent.secret });
  });
});

test('POST /servers: wrong id is a 400 mismatch message', async () => {
  const { agent: browser } = await setupControl();
  await withAgent({}, async (agent) => {
    const res = await browser.post('/api/servers').send(payload(agent, { serverId: 'not-the-real-id' }));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Server ID mismatch: the server reports "fake-server-01"/);
  });
});

test('POST /servers: wrong secret is 400, never 401', async () => {
  const { agent: browser } = await setupControl();
  await withAgent({}, async (agent) => {
    const res = await browser.post('/api/servers').send(payload(agent, { secret: 'w'.repeat(40) }));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /rejected the secret/);
  });
});

test('POST /servers: unreachable is 502', async () => {
  const { agent: browser } = await setupControl();
  const port = await closedPort();
  const res = await browser.post('/api/servers').send({
    name: 'Ghost', url: `http://127.0.0.1:${port}`, serverId: 'ghost-server-1', secret: 'g'.repeat(40),
  });
  assert.equal(res.status, 502);
  assert.match(res.body.error, /Could not reach the server at http:\/\/127\.0\.0\.1:/);
});

test('POST /servers: a URL that is not a Deployment Maintainer is 502', async () => {
  const { agent: browser } = await setupControl();
  const other = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>hi</html>');
  });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  try {
    const res = await browser.post('/api/servers').send({
      name: 'Web', url: `http://127.0.0.1:${other.address().port}`, serverId: 'web-server-01', secret: 'w'.repeat(40),
    });
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'That URL is not a Deployment Maintainer server');
  } finally {
    other.closeAllConnections();
    await new Promise((r) => other.close(r));
  }
});

test('POST /servers: duplicate serverId or url is 409', async () => {
  const { agent: browser } = await setupControl();
  await withAgent({}, async (agent) => {
    await browser.post('/api/servers').send(payload(agent)).expect(200);
    const dup = await browser.post('/api/servers').send(payload(agent, { name: 'Again' }));
    assert.equal(dup.status, 409);
  });
  await withAgent({ serverId: 'fake-server-01' }, async (second) => {
    const dupId = await browser.post('/api/servers').send(payload(second));
    assert.equal(dupId.status, 409);
  });
});

test('POST /servers: http non-localhost URL and bad input are 400', async () => {
  const { agent: browser } = await setupControl();
  const insecure = await browser.post('/api/servers').send({
    name: 'Remote', url: 'http://example.com', serverId: 'remote-server-1', secret: 'r'.repeat(40),
  });
  assert.equal(insecure.status, 400);
  assert.equal(insecure.body.error, 'Invalid server URL');

  const badId = await browser.post('/api/servers').send({ name: 'x', url: 'https://example.com', serverId: 'short', secret: 'r'.repeat(40) });
  assert.equal(badId.status, 400);
  assert.ok(badId.body.issues.length > 0);

  const shortSecret = await browser.post('/api/servers').send({ name: 'x', url: 'https://example.com', serverId: 'remote-server-1', secret: 'short' });
  assert.equal(shortSecret.status, 400);
});

test('GET /servers lists online servers and never contains the secret', async () => {
  const { agent: browser } = await setupControl();
  const empty = await browser.get('/api/servers');
  assert.deepEqual(empty.body, { servers: [] });

  await withAgent({}, async (agent) => {
    await browser.post('/api/servers').send(payload(agent)).expect(200);
    const res = await browser.get('/api/servers');
    assert.equal(res.status, 200);
    assert.equal(res.body.servers.length, 1);
    assert.equal(res.body.servers[0].status, 'online');
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('secret'));
    assert.ok(!text.includes(agent.secret));
  });
});

test('GET /servers reports offline, unauthorized and online per server, and caches for 15s', async () => {
  const { agent: browser, config } = await setupControl();
  const agent = await startFakeAgent();
  const port = await closedPort();
  const make = (name, url, serverId, secret) =>
    Server.create({ name, url, serverId, secretEncrypted: encryptJSON(config, { secret }) });
  try {
    await make('A online', agent.url, agent.serverId, agent.secret);
    await make('B wrong id', `http://localhost:${agent.port}`, 'other-server-01', agent.secret);
    await make('C down', `http://127.0.0.1:${port}`, 'down-server-01', 'd'.repeat(40));

    const res = await browser.get('/api/servers');
    const byName = Object.fromEntries(res.body.servers.map((s) => [s.name, s]));
    assert.equal(byName['A online'].status, 'online');
    assert.equal(byName['A online'].hostname, 'fake-host');
    assert.ok(byName['A online'].lastSeenAt);
    assert.equal(byName['C down'].status, 'offline');
    assert.equal(byName['B wrong id'].status, 'offline', 'an id mismatch is not a rejected secret');
    assert.ok(!JSON.stringify(res.body).includes(agent.secret));

    const probesBefore = agent.requests.length;
    await browser.get('/api/servers').expect(200);
    assert.equal(agent.requests.length, probesBefore, 'second call within 15s is served from cache');

    const stored = await Server.findOne({ name: 'C down' });
    assert.equal(stored.lastStatus, 'offline');
  } finally {
    await agent.close();
  }
});

test('GET /servers marks a rejected secret as unauthorized', async () => {
  const { agent: browser, config } = await setupControl();
  await withAgent({}, async (agent) => {
    await Server.create({
      name: 'Rotated', url: agent.url, serverId: agent.serverId,
      secretEncrypted: encryptJSON(config, { secret: 'o'.repeat(40) }),
    });
    const res = await browser.get('/api/servers');
    assert.equal(res.body.servers[0].status, 'unauthorized');
    assert.equal((await Server.findOne()).lastStatus, 'unauthorized');
  });
});

test('GET /servers/:id returns the server; bad or unknown ids are 404', async () => {
  const { agent: browser } = await setupControl();
  await withAgent({}, async (agent) => {
    const created = await browser.post('/api/servers').send(payload(agent));
    const got = await browser.get(`/api/servers/${created.body.server.id}`);
    assert.equal(got.status, 200);
    assert.equal(got.body.server.name, 'Box 1');
  });
  assert.equal((await browser.get('/api/servers/not-an-id')).status, 404);
  assert.equal((await browser.get('/api/servers/507f1f77bcf86cd799439011')).status, 404);
});

test('PATCH /servers/:id renames, and re-verifies when the url changes', async () => {
  const { agent: browser } = await setupControl();
  await withAgent({}, async (agent) => {
    const created = await browser.post('/api/servers').send(payload(agent));
    const id = created.body.server.id;

    const renamed = await browser.patch(`/api/servers/${id}`).send({ name: '  Renamed ' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.server.name, 'Renamed');

    const port = await closedPort();
    const bad = await browser.patch(`/api/servers/${id}`).send({ url: `http://localhost:${port}` });
    assert.equal(bad.status, 502);
    assert.equal((await Server.findById(id)).url, agent.url, 'a failed verify must not change the stored url');

    const good = await browser.patch(`/api/servers/${id}`).send({ url: `http://localhost:${agent.port}/` });
    assert.equal(good.status, 200);
    assert.equal(good.body.server.url, `http://localhost:${agent.port}`);

    assert.equal((await browser.patch(`/api/servers/${id}`).send({})).status, 400);
  });
});

test('POST /servers/:id/secret rotates the stored secret after verifying the new one', async () => {
  const { agent: browser, config } = await setupControl();
  await withAgent({}, async (agent) => {
    const created = await browser.post('/api/servers').send(payload(agent));
    const id = created.body.server.id;
    const newSecret = 'n'.repeat(40);

    const early = await browser.post(`/api/servers/${id}/secret`).send({ secret: newSecret });
    assert.equal(early.status, 400, 'agent still has the old secret');
    assert.deepEqual(decryptJSON(config, (await Server.findById(id)).secretEncrypted), { secret: agent.secret });

    agent.secret = newSecret;
    const ok = await browser.post(`/api/servers/${id}/secret`).send({ secret: newSecret });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.server.status, 'online');
    assert.ok(!JSON.stringify(ok.body).includes(newSecret));
    assert.deepEqual(decryptJSON(config, (await Server.findById(id)).secretEncrypted), { secret: newSecret });

    const proxied = await browser.get(`/api/servers/${id}/api/echo`);
    assert.equal(proxied.status, 200);
    assert.equal(proxied.body.headers.authorization, `Bearer ${newSecret}`);
  });
});

test('DELETE /servers/:id removes only the registration', async () => {
  const { agent: browser } = await setupControl();
  await withAgent({}, async (agent) => {
    const created = await browser.post('/api/servers').send(payload(agent));
    const id = created.body.server.id;
    const before = agent.requests.length;
    const res = await browser.delete(`/api/servers/${id}`);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(agent.requests.length, before, 'nothing is sent to the agent');
    assert.equal(await Server.countDocuments(), 0);
    assert.equal((await browser.get(`/api/servers/${id}`)).status, 404);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { setupControl, ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers/testControl.js';
import { startFakeAgent } from './helpers/fakeAgent.js';
import { connectTestDB, clearTestDB, disconnectTestDB } from './helpers/db.js';

test.before(connectTestDB);
test.after(disconnectTestDB);
test.afterEach(clearTestDB);

async function setup() {
  const ctx = await setupControl();
  const agent = await startFakeAgent();
  const created = await ctx.agent
    .post('/api/servers')
    .send({ name: 'Box', url: agent.url, serverId: agent.serverId, secret: agent.secret })
    .expect(200);
  return { ...ctx, fake: agent, id: created.body.server.id };
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}

async function loginCookie(app) {
  const res = await request(app).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}

test('proxy adds the bearer, drops browser cookie/authorization, and forwards method, body and query', async () => {
  const { app, agent, fake, id } = await setup();
  try {
    const cookie = await loginCookie(app);
    const res = await agent
      .post(`/api/servers/${id}/api/echo?x=1&y=two%20words`)
      .set('Cookie', cookie)
      .set('Authorization', 'Bearer browser-token')
      .set('X-Forwarded-Secret', 'nope')
      .send({ hello: 'world' });
    assert.equal(res.status, 200);
    assert.equal(res.body.method, 'POST');
    assert.deepEqual(res.body.query, { x: '1', y: 'two words' });
    assert.deepEqual(JSON.parse(res.body.body), { hello: 'world' });
    assert.equal(res.body.path, '/api/echo');
    assert.equal(res.body.headers.authorization, `Bearer ${fake.secret}`);
    assert.equal(res.body.headers['content-type'], 'application/json');
    assert.equal(res.body.headers.cookie, undefined);
    assert.equal(res.body.headers['x-forwarded-secret'], undefined);
    assert.ok(!JSON.stringify(res.body.headers).includes('browser-token'));
    assert.ok(!JSON.stringify(res.body.headers).includes('dm_session'));
  } finally {
    await fake.close();
  }
});

test('proxy forwards PATCH/DELETE and nested paths, re-encoding segments', async () => {
  const { agent, fake, id } = await setup();
  try {
    const patch = await agent.patch(`/api/servers/${id}/api/echo`).send({ a: 1 });
    assert.equal(patch.body.method, 'PATCH');
    const del = await agent.delete(`/api/servers/${id}/api/echo`);
    assert.equal(del.body.method, 'DELETE');
    const nested = await agent.get(`/api/servers/${id}/api/missing/a%20b/c`);
    assert.equal(nested.status, 404);
    assert.equal(fake.requests.at(-1).url, '/api/missing/a%20b/c');
  } finally {
    await fake.close();
  }
});

test('proxy refuses dot segments that would escape /api/', async () => {
  const { agent, fake, id } = await setup();
  try {
    const before = fake.requests.length;
    const res = await agent.get(`/api/servers/${id}/api/%2E%2E/deployment-manager`);
    assert.equal(res.status, 400);
    assert.equal(fake.requests.length, before);
  } finally {
    await fake.close();
  }
});

test('an upstream 401 becomes a 502 with the rotate message and marks the server unauthorized', async () => {
  const { agent, fake, id } = await setup();
  try {
    fake.secret = 'changed-'.padEnd(40, 'z');
    const res = await agent.get(`/api/servers/${id}/api/echo`);
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'The server rejected the stored secret — rotate it in Servers');

    const list = await agent.get('/api/servers');
    assert.equal(list.body.servers[0].status, 'unauthorized');
  } finally {
    await fake.close();
  }
});

test('other upstream statuses pass through (404) and only whitelisted headers are copied back', async () => {
  const { agent, fake, id } = await setup();
  try {
    const missing = await agent.get(`/api/servers/${id}/api/nothing-here`);
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'Not found' });

    const file = await agent.get(`/api/servers/${id}/api/file`).buffer(true).parse((res, cb) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => cb(null, data));
    });
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-disposition'], 'attachment; filename="deploy-1.log"');
    assert.match(file.headers['content-type'], /text\/plain/);
    assert.equal(file.headers['x-secret-leak'], undefined);
    assert.equal(file.body, 'log line 1\nlog line 2\n');
  } finally {
    await fake.close();
  }
});

test('unknown or malformed server id is 404; unreachable agent is 502', async () => {
  const { agent, fake, id } = await setup();
  try {
    assert.equal((await agent.get('/api/servers/507f1f77bcf86cd799439011/api/echo')).status, 404);
    assert.equal((await agent.get('/api/servers/not-an-id/api/echo')).status, 404);
  } finally {
    await fake.close();
  }
  const down = await agent.get(`/api/servers/${id}/api/echo`);
  assert.equal(down.status, 502);
  assert.deepEqual(down.body, { error: 'Server unreachable' });
});

test('unauthenticated proxy request is 401 and never reaches the agent', async () => {
  const { app, fake, id } = await setup();
  try {
    const before = fake.requests.length;
    const res = await request(app).get(`/api/servers/${id}/api/echo`);
    assert.equal(res.status, 401);
    assert.equal(fake.requests.length, before);
  } finally {
    await fake.close();
  }
});

test('SSE events stream incrementally and the upstream is closed when the client disconnects', async () => {
  const { app, fake, id } = await setup();
  const listener = await listen(app);
  try {
    const cookie = await loginCookie(app);
    const events = [];
    const t0 = Date.now();
    let ended = null;

    const firstEvent = await new Promise((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port: listener.port, path: `/api/servers/${id}/api/stream`, headers: { cookie, accept: 'text/event-stream' } },
        (res) => {
          assert.equal(res.statusCode, 200);
          assert.match(res.headers['content-type'], /text\/event-stream/);
          assert.equal(res.headers['x-accel-buffering'], 'no');
          let buf = '';
          res.on('data', (chunk) => {
            buf += chunk;
            for (const m of buf.matchAll(/data: (.*)\n\n/g)) {
              if (!events.includes(m[1])) {
                events.push(m[1]);
                if (events.length === 1) resolve(Date.now() - t0);
              }
            }
          });
          res.on('end', () => { ended = Date.now() - t0; });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
    });

    // The agent takes ~300ms to emit three events, so the first must arrive well before the stream ends.
    await new Promise((r) => setTimeout(r, 450));
    assert.equal(events.length, 3);
    assert.ok(ended !== null);
    assert.ok(firstEvent < ended - 100, `first event at ${firstEvent}ms should precede stream end at ${ended}ms`);

    // Client disconnect mid-stream tears down the upstream request.
    await new Promise((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port: listener.port, path: `/api/servers/${id}/api/stream`, headers: { cookie } },
        (res) => {
          res.once('data', () => { req.destroy(); resolve(); });
        },
      );
      req.on('error', (err) => { if (err.code !== 'ECONNRESET') reject(err); });
    });
    for (let i = 0; i < 40 && fake.streamsClosedEarly === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(fake.streamsClosedEarly, 1, 'agent should see the stream closed');
  } finally {
    await listener.close();
    await fake.close();
  }
});

import http from 'node:http';

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

// A stand-in for a server/ agent: same handshake + bearer rules, plus a few probe endpoints.
export async function startFakeAgent({
  serverId = 'fake-server-01',
  secret = 's'.repeat(40),
  version = '1.2.3',
} = {}) {
  const agent = {
    serverId,
    secret,
    version,
    requests: [],
    streamsOpened: 0,
    streamsClosedEarly: 0,
  };

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake');
    agent.requests.push({ method: req.method, url: req.url, headers: req.headers });

    if (url.pathname === '/deployment-manager') {
      return json(res, 200, { service: 'deployment-maintainer', serverId: agent.serverId, version: agent.version });
    }

    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
    if (req.headers.authorization !== `Bearer ${agent.secret}`) {
      return json(res, 401, { error: 'Invalid server secret' });
    }

    if (url.pathname === '/api/auth/check') {
      return json(res, 200, { ok: true, serverId: agent.serverId, hostname: 'fake-host' });
    }

    if (url.pathname === '/api/echo') {
      const body = await readBody(req);
      return json(res, 200, {
        method: req.method,
        headers: req.headers,
        body,
        query: Object.fromEntries(url.searchParams),
        path: url.pathname,
        rawUrl: req.url,
      });
    }

    if (url.pathname === '/api/stream') {
      agent.streamsOpened += 1;
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
      });
      let sent = 0;
      let finished = false;
      const timer = setInterval(() => {
        sent += 1;
        res.write(`data: ${JSON.stringify({ n: sent })}\n\n`);
        if (sent === 3) {
          finished = true;
          clearInterval(timer);
          res.end();
        }
      }, 100);
      res.write(': open\n\n');
      res.on('close', () => {
        clearInterval(timer);
        if (!finished) agent.streamsClosedEarly += 1;
      });
      return undefined;
    }

    if (url.pathname === '/api/file') {
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': 'attachment; filename="deploy-1.log"',
        'x-secret-leak': 'should-not-pass',
      });
      return res.end('log line 1\nlog line 2\n');
    }

    return json(res, 404, { error: 'Not found' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  agent.port = server.address().port;
  agent.url = `http://127.0.0.1:${agent.port}`;
  agent.close = () =>
    new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  return agent;
}

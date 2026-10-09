import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/index.js';
import { setupTestServer } from './helpers/testServer.js';
import { disconnectTestDB } from './helpers/db.js';
import { setFetchImpl, __resetCache } from '../src/services/github.js';

test.after(disconnectTestDB);
test.afterEach(() => {
  setFetchImpl();
  __resetCache();
});

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

async function withRepoApi(fn) {
  const server = await setupTestServer();
  try {
    const config = { ...server.config, GITHUB_TOKEN: 'route-test-token' };
    const app = createApp(config);
    const get = (url) => request(app).get(url).set('Authorization', `Bearer ${config.SERVER_SECRET}`);
    await fn(get);
  } finally {
    await server.cleanup();
  }
}

test('GET /repos/:owner/:repo/tree lists sub-folders of the repo root and of a nested path', async () => {
  const urls = [];
  setFetchImpl(async (url) => {
    urls.push(url);
    if (/\/contents\?ref=main$/.test(url)) {
      return json([{ type: 'dir', name: 'web', path: 'web' }, { type: 'file', name: 'README.md', path: 'README.md' }]);
    }
    if (/\/contents\/web\?ref=main$/.test(url)) {
      return json([{ type: 'file', name: 'package.json', path: 'web/package.json' }, { type: 'dir', name: 'src', path: 'web/src' }]);
    }
    if (/\/contents\/web\/src\?ref=main$/.test(url)) return json([]);
    return json('', 404);
  });

  await withRepoApi(async (get) => {
    const root = await get('/api/repos/octo/mono/tree?branch=main');
    assert.equal(root.status, 200, JSON.stringify(root.body));
    assert.deepEqual(root.body, { path: '', directories: [{ name: 'web', path: 'web', hasPackageJson: true, hasIndexHtml: false }] });

    const nested = await get('/api/repos/octo/mono/tree?branch=main&path=web/');
    assert.equal(nested.status, 200, JSON.stringify(nested.body));
    assert.equal(nested.body.path, 'web');
    assert.deepEqual(nested.body.directories, [{ name: 'src', path: 'web/src', hasPackageJson: false, hasIndexHtml: false }]);

    const slash = await get('/api/repos/octo/mono/tree?branch=main&path=/');
    assert.equal(slash.body.path, '');
  });
});

test('GET /repos/:owner/:repo/tree validates branch and path and reports a missing folder as 404', async () => {
  setFetchImpl(async () => json('', 404));
  await withRepoApi(async (get) => {
    assert.equal((await get('/api/repos/octo/mono/tree')).status, 400, 'branch is required');
    assert.equal((await get('/api/repos/octo/mono/tree?branch=main&path=../etc')).status, 400);
    assert.equal((await get('/api/repos/octo/mono/tree?branch=main&path=/etc')).status, 400);
    assert.equal((await get('/api/repos/octo/mono/tree?branch=--evil')).status, 400);
    assert.equal((await get('/api/repos/octo/mono/tree?branch=main&path=gone')).status, 404);
  });
});

test('detect-project and node-version accept an optional root and validate it', async () => {
  const urls = [];
  setFetchImpl(async (url) => {
    urls.push(url);
    if (url.includes('/contents/apps/web/package.json')) return json(JSON.stringify({ engines: { node: '20' } }));
    return json('', 404);
  });

  await withRepoApi(async (get) => {
    const node = await get('/api/repos/octo/mono/node-version?ref=main&root=apps/web');
    assert.equal(node.status, 200, JSON.stringify(node.body));
    assert.deepEqual(node.body, { version: '20', source: 'engines' });
    assert.ok(urls.some((u) => u.includes('/contents/apps/web/package.json')));

    const detect = await get('/api/repos/octo/mono/detect-project?ref=main&root=apps/web');
    assert.equal(detect.status, 200, JSON.stringify(detect.body));
    assert.ok(urls.some((u) => u.includes('/contents/apps/web/index.html')));

    assert.equal((await get('/api/repos/octo/mono/node-version?ref=main&root=../x')).status, 400);
    assert.equal((await get('/api/repos/octo/mono/detect-project?ref=main&root=%2Fabs')).status, 400);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listRepos,
  listBranches,
  detectNodeVersion,
  detectProjectType,
  getTokenInfo,
  GitHubError,
  setFetchImpl,
  __resetCache,
} from '../src/services/github.js';

function mockResponse({ status = 200, json, text, headers = {} } = {}) {
  const lowerHeaders = {};
  for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lowerHeaders[name.toLowerCase()] ?? null },
    json: async () => json,
    text: async () => (text !== undefined ? text : json ? JSON.stringify(json) : ''),
  };
}

let tokenCounter = 0;
function freshConfig(overrides = {}) {
  tokenCounter += 1;
  return { GITHUB_TOKEN: `test-token-${tokenCounter}`, ...overrides };
}

test.afterEach(() => {
  setFetchImpl();
  __resetCache();
});

test('listRepos throws a clear 503 when GITHUB_TOKEN is not configured', async () => {
  await assert.rejects(
    () => listRepos({ GITHUB_TOKEN: undefined }),
    (err) => {
      assert.ok(err instanceof GitHubError);
      assert.equal(err.status, 503);
      assert.match(err.message, /GITHUB_TOKEN is not configured/);
      return true;
    },
  );
});

test('listRepos follows Link header pagination and maps fields', async () => {
  const config = freshConfig();
  const calls = [];
  setFetchImpl(async (url) => {
    calls.push(url);
    if (calls.length === 1) {
      assert.match(url, /\/user\/repos\?per_page=100/);
      return mockResponse({
        json: [
          { full_name: 'me/repo-a', name: 'repo-a', owner: { login: 'me' }, private: false, default_branch: 'main', pushed_at: '2024-01-01T00:00:00Z', description: 'a', html_url: 'https://github.com/me/repo-a' },
        ],
        headers: { link: '<https://api.github.com/user/repos?per_page=100&page=2>; rel="next"' },
      });
    }
    return mockResponse({
      json: [
        { full_name: 'me/repo-b', name: 'repo-b', owner: { login: 'me' }, private: true, default_branch: 'master', pushed_at: '2024-02-01T00:00:00Z', description: null, html_url: 'https://github.com/me/repo-b' },
      ],
      headers: {},
    });
  });

  const repos = await listRepos(config);
  assert.equal(calls.length, 2);
  assert.deepEqual(repos.map((r) => r.fullName), ['me/repo-a', 'me/repo-b']);
  assert.deepEqual(repos[0], {
    fullName: 'me/repo-a',
    name: 'repo-a',
    owner: 'me',
    private: false,
    defaultBranch: 'main',
    pushedAt: '2024-01-01T00:00:00Z',
    description: 'a',
    htmlUrl: 'https://github.com/me/repo-a',
  });
});

test('listRepos caches for 60s and refresh=true bypasses the cache', async () => {
  const config = freshConfig();
  let fetchCount = 0;
  setFetchImpl(async () => {
    fetchCount += 1;
    return mockResponse({ json: [{ full_name: 'me/r', name: 'r', owner: { login: 'me' } }] });
  });

  await listRepos(config);
  await listRepos(config);
  assert.equal(fetchCount, 1, 'second call should be served from cache');

  await listRepos(config, { refresh: true });
  assert.equal(fetchCount, 2, 'refresh should bypass the cache');
});

test('listRepos filters by q against the repo name', async () => {
  const config = freshConfig();
  setFetchImpl(async () => mockResponse({
    json: [
      { full_name: 'me/api-server', name: 'api-server', owner: { login: 'me' } },
      { full_name: 'me/frontend', name: 'frontend', owner: { login: 'me' } },
    ],
  }));

  const repos = await listRepos(config, { q: 'api' });
  assert.deepEqual(repos.map((r) => r.name), ['api-server']);
});

test('listBranches paginates and puts the default branch first', async () => {
  const config = freshConfig();
  setFetchImpl(async (url) => {
    if (url.includes('/branches')) {
      if (url.includes('page=2')) {
        return mockResponse({ json: [{ name: 'main' }] });
      }
      return mockResponse({
        json: [{ name: 'dev' }, { name: 'feature-x' }],
        headers: { link: '<https://api.github.com/repos/me/repo/branches?per_page=100&page=2>; rel="next"' },
      });
    }
    // repo metadata
    return mockResponse({ json: { default_branch: 'main' } });
  });

  const branches = await listBranches(config, 'me', 'repo');
  assert.deepEqual(branches, ['main', 'dev', 'feature-x']);
});

test('detectNodeVersion reads .nvmrc "v20.11.0"', async () => {
  const config = freshConfig();
  setFetchImpl(async (url) => {
    if (url.includes('.nvmrc')) return mockResponse({ text: 'v20.11.0\n' });
    return mockResponse({ status: 404, text: '' });
  });
  const result = await detectNodeVersion(config, 'me', 'repo', 'main');
  assert.deepEqual(result, { version: '20.11.0', source: '.nvmrc' });
});

test('detectNodeVersion treats .nvmrc "lts/*" as unparseable and falls back to package.json', async () => {
  const config = freshConfig();
  setFetchImpl(async (url) => {
    if (url.includes('.nvmrc')) return mockResponse({ text: 'lts/*\n' });
    if (url.includes('package.json')) return mockResponse({ json: { engines: { node: '>=18' } } });
    return mockResponse({ status: 404, text: '' });
  });
  const result = await detectNodeVersion(config, 'me', 'repo', 'main');
  assert.deepEqual(result, { version: '18', source: 'engines' });
});

test('detectNodeVersion extracts the leading major from engines ranges', async () => {
  const cases = [
    ['>=18', '18'],
    ['^20.0.0', '20'],
    ['20.x', '20'],
  ];
  for (const [range, expectedMajor] of cases) {
    const config = freshConfig();
    setFetchImpl(async (url) => {
      if (url.includes('.nvmrc')) return mockResponse({ status: 404, text: '' });
      if (url.includes('package.json')) return mockResponse({ json: { engines: { node: range } } });
      return mockResponse({ status: 404, text: '' });
    });
    const result = await detectNodeVersion(config, 'me', 'repo', 'main');
    assert.deepEqual(result, { version: expectedMajor, source: 'engines' });
  }
});

test('detectNodeVersion returns nulls when neither file gives a version', async () => {
  const config = freshConfig();
  setFetchImpl(async () => mockResponse({ status: 404, text: '' }));
  const result = await detectNodeVersion(config, 'me', 'repo', 'main');
  assert.deepEqual(result, { version: null, source: null });
});

test('detectNodeVersion rejects an invalid ref before making a request', async () => {
  const config = freshConfig();
  let called = false;
  setFetchImpl(async () => {
    called = true;
    return mockResponse({ status: 404 });
  });
  await assert.rejects(() => detectNodeVersion(config, 'me', 'repo', '../evil'));
  assert.equal(called, false);
});

test('maps 401 to a clear invalid-token message', async () => {
  const config = freshConfig();
  setFetchImpl(async () => mockResponse({ status: 401, json: { message: 'Bad credentials' } }));
  await assert.rejects(
    () => listRepos(config),
    (err) => {
      assert.ok(err instanceof GitHubError);
      assert.equal(err.status, 502);
      assert.match(err.message, /invalid or expired/);
      return true;
    },
  );
});

test('maps a 403 with zero remaining rate limit to a message with the reset time', async () => {
  const config = freshConfig();
  const resetEpoch = 1700000000;
  setFetchImpl(async () => mockResponse({
    status: 403,
    json: { message: 'rate limit exceeded' },
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetEpoch) },
  }));
  await assert.rejects(
    () => listRepos(config),
    (err) => {
      assert.ok(err instanceof GitHubError);
      assert.equal(err.status, 503);
      assert.match(err.message, /rate limit/i);
      assert.ok(err.message.includes(new Date(resetEpoch * 1000).toISOString()));
      return true;
    },
  );
});

test('maps 404 to "Repository or branch not found"', async () => {
  const config = freshConfig();
  setFetchImpl(async () => mockResponse({ status: 404, json: { message: 'Not Found' } }));
  await assert.rejects(
    () => listBranches(config, 'me', 'missing-repo'),
    (err) => {
      assert.ok(err instanceof GitHubError);
      assert.equal(err.status, 404);
      assert.match(err.message, /Repository or branch not found/);
      return true;
    },
  );
});

test('getTokenInfo reads login, scopes and rate limit from headers', async () => {
  const config = freshConfig();
  setFetchImpl(async () => mockResponse({
    json: { login: 'octocat' },
    headers: { 'x-oauth-scopes': 'repo, read:org', 'x-ratelimit-remaining': '4999' },
  }));
  const info = await getTokenInfo(config);
  assert.deepEqual(info, { login: 'octocat', scopes: ['repo', 'read:org'], rateLimitRemaining: 4999 });
});

test('getTokenInfo handles an empty scopes header (fine-grained tokens)', async () => {
  const config = freshConfig();
  setFetchImpl(async () => mockResponse({
    json: { login: 'octocat' },
    headers: { 'x-oauth-scopes': '', 'x-ratelimit-remaining': '100' },
  }));
  const info = await getTokenInfo(config);
  assert.deepEqual(info.scopes, []);
});

test('detectProjectType classifies from package.json and index.html fetched at the ref', async () => {
  const config = freshConfig();
  const files = { 'package.json': JSON.stringify({ devDependencies: { vite: '5' }, scripts: { build: 'vite build' } }) };
  const urls = [];
  setFetchImpl(async (url) => {
    urls.push(url);
    const name = decodeURIComponent(url.split('/contents/')[1].split('?')[0]);
    return name in files ? mockResponse({ text: files[name] }) : mockResponse({ status: 404, json: { message: 'Not Found' } });
  });
  const result = await detectProjectType(config, 'octo', 'site', 'main');
  assert.equal(result.type, 'frontend');
  assert.equal(result.framework.id, 'vite');
  assert.ok(urls.every((u) => u.includes('ref=main')));

  setFetchImpl(async (url) => (url.includes('/index.html')
    ? mockResponse({ text: '<h1>hi</h1>' })
    : mockResponse({ status: 404, json: { message: 'Not Found' } })));
  assert.equal((await detectProjectType(freshConfig(), 'octo', 'plain', 'main')).type, 'static-html');
});

test('detectProjectType treats a malformed package.json as absent', async () => {
  setFetchImpl(async (url) => (url.includes('/package.json')
    ? mockResponse({ text: '{ not json' })
    : mockResponse({ status: 404, json: { message: 'Not Found' } })));
  assert.equal((await detectProjectType(freshConfig(), 'octo', 'bad', 'main')).type, 'unknown');
});

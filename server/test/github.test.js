import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listRepos,
  listBranches,
  detectNodeVersion,
  detectProjectType,
  listDirectories,
  getTokenInfo,
  getCommitWindow,
  getLatestCommits,
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

function fakeCommit(n) {
  const sha = String(n).padStart(40, '0');
  return {
    sha,
    commit: { message: `commit ${n}\n\nbody line`, author: { name: `author-${n}`, date: `2024-01-${String(n % 28 + 1).padStart(2, '0')}T00:00:00Z` } },
  };
}
const sha = (n) => String(n).padStart(40, '0');

// Mocks a linear history 1..total (higher = newer). Deployed commit is `deployedN`.
function historyFetch({ total, deployedN, calls = [] }) {
  return async (url) => {
    calls.push(url);
    if (url.includes('/compare/')) {
      const commits = [];
      for (let n = deployedN + 1; n <= total; n += 1) commits.push(fakeCommit(n));
      return mockResponse({ json: { ahead_by: commits.length, commits } });
    }
    const u = new URL(url);
    const perPage = Number(u.searchParams.get('per_page'));
    const start = u.searchParams.get('sha') === sha(deployedN) ? deployedN : total;
    const commits = [];
    for (let n = start; n >= 1 && commits.length < perPage; n -= 1) commits.push(fakeCommit(n));
    return mockResponse({ json: commits });
  };
}

test('getCommitWindow splits newer/deployed/older, newest first, with "more" total', async () => {
  const config = freshConfig();
  setFetchImpl(historyFetch({ total: 20, deployedN: 10 }));
  const win = await getCommitWindow(config, 'octo', 'repo', sha(10), 'main');
  assert.equal(win.deployed.sha, sha(10));
  assert.equal(win.deployed.message, 'commit 10');
  assert.equal(win.deployed.author, 'author-10');
  assert.deepEqual(win.newer.map((c) => c.sha), [15, 14, 13, 12, 11].map(sha));
  assert.equal(win.newerTotal, 10);
  assert.deepEqual(win.older.map((c) => c.sha), [9, 8, 7, 6, 5].map(sha));
  assert.equal(win.missing, undefined);
});

test('getCommitWindow with the deployed commit at the branch head has no newer commits and few older ones', async () => {
  setFetchImpl(historyFetch({ total: 3, deployedN: 3 }));
  const win = await getCommitWindow(freshConfig(), 'octo', 'repo', sha(3), 'main');
  assert.deepEqual(win.newer, []);
  assert.equal(win.newerTotal, 0);
  assert.deepEqual(win.older.map((c) => c.sha), [2, 1].map(sha));
});

test('getCommitWindow returns missing:true with latest commits when the deployed sha is unknown to GitHub', async () => {
  const calls = [];
  setFetchImpl(async (url) => {
    calls.push(url);
    if (url.includes('/compare/')) return mockResponse({ status: 404, json: { message: 'Not Found' } });
    if (url.includes(`sha=${sha(99)}`)) return mockResponse({ status: 422, json: { message: 'No commit found for SHA' } });
    assert.match(url, /commits\?sha=main&per_page=10/);
    return mockResponse({ json: [fakeCommit(5), fakeCommit(4)] });
  });
  const win = await getCommitWindow(freshConfig(), 'octo', 'repo', sha(99), 'main');
  assert.equal(win.missing, true);
  assert.equal(win.deployed, null);
  assert.deepEqual(win.newer, []);
  assert.equal(win.newerTotal, 0);
  assert.deepEqual(win.older.map((c) => c.sha), [5, 4].map(sha));
});

test('getCommitWindow still propagates real GitHub errors', async () => {
  setFetchImpl(async () => mockResponse({ status: 403, headers: { 'x-ratelimit-remaining': '0' }, json: {} }));
  await assert.rejects(() => getCommitWindow(freshConfig(), 'octo', 'repo', sha(1), 'main'), (err) => {
    assert.ok(err instanceof GitHubError);
    assert.equal(err.status, 503);
    return true;
  });
  // A 404 on the commits list (repo gone) is a real 404, not "missing".
  setFetchImpl(async () => mockResponse({ status: 404, json: { message: 'Not Found' } }));
  await assert.rejects(() => getCommitWindow(freshConfig(), 'octo', 'gone', sha(1), 'main'), (err) => err instanceof GitHubError && err.status === 404);
});

test('getCommitWindow caches results briefly and __resetCache clears them', async () => {
  const config = freshConfig();
  const calls = [];
  setFetchImpl(historyFetch({ total: 8, deployedN: 4, calls }));
  const first = await getCommitWindow(config, 'octo', 'repo', sha(4), 'main');
  const callsAfterFirst = calls.length;
  assert.equal(callsAfterFirst, 2);
  first.newer.pop(); // mutating a result must not poison the cache
  const second = await getCommitWindow(config, 'octo', 'repo', sha(4), 'main');
  assert.equal(calls.length, callsAfterFirst);
  assert.equal(second.newer.length, 4);

  await getCommitWindow(config, 'octo', 'repo', sha(4), 'other-branch');
  assert.ok(calls.length > callsAfterFirst, 'different branch is a different cache key');

  __resetCache();
  const before = calls.length;
  await getCommitWindow(config, 'octo', 'repo', sha(4), 'main');
  assert.ok(calls.length > before);
});

test('getLatestCommits maps the first line of each message', async () => {
  setFetchImpl(async (url) => {
    assert.match(url, /commits\?sha=main&per_page=10/);
    return mockResponse({ json: [fakeCommit(2), fakeCommit(1)] });
  });
  const commits = await getLatestCommits(freshConfig(), 'octo', 'repo', 'main');
  assert.deepEqual(commits.map((c) => c.message), ['commit 2', 'commit 1']);
});

// A fake contents API: `tree` maps a folder path ('' = root) to its entries; missing folders 404.
function contentsFetch(tree, { fail = new Set() } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const match = /\/contents\/?([^?]*)\?ref=(.+)$/.exec(url);
    const folder = decodeURIComponent(match[1]);
    if (fail.has(folder)) return mockResponse({ status: 500, text: 'boom' });
    if (!(folder in tree)) return mockResponse({ status: 404, text: '' });
    return mockResponse({ json: tree[folder] });
  };
  return { impl, calls };
}

const dir = (name, parent = '') => ({ type: 'dir', name, path: parent ? `${parent}/${name}` : name });
const file = (name, parent = '') => ({ type: 'file', name, path: parent ? `${parent}/${name}` : name });

test('listDirectories returns only directories, sorted, flagged by what each contains', async () => {
  const { impl, calls } = contentsFetch({
    '': [file('README.md'), dir('web'), dir('api'), dir('docs'), file('package.json')],
    api: [file('package.json', 'api'), file('server.js', 'api')],
    web: [file('index.html', 'web'), file('package.json', 'web')],
    docs: [file('intro.md', 'docs')],
  });
  setFetchImpl(impl);

  const result = await listDirectories(freshConfig(), 'me', 'repo', 'main');
  assert.deepEqual(result, [
    { name: 'api', path: 'api', hasPackageJson: true, hasIndexHtml: false },
    { name: 'docs', path: 'docs', hasPackageJson: false, hasIndexHtml: false },
    { name: 'web', path: 'web', hasPackageJson: true, hasIndexHtml: true },
  ]);
  assert.match(calls[0], /\/repos\/me\/repo\/contents\?ref=main$/);
  assert.equal(calls.length, 4, 'one listing for the folder plus one per returned directory');
});

test('listDirectories lists a nested folder, encodes each path segment and caches for 60s', async () => {
  const { impl, calls } = contentsFetch({
    'apps/web': [dir('src', 'apps/web'), dir('public', 'apps/web')],
    'apps/web/src': [file('index.html', 'apps/web/src')],
    'apps/web/public': [],
  });
  setFetchImpl(impl);
  const config = freshConfig();

  const first = await listDirectories(config, 'me', 'repo', 'feat/x', 'apps/web/');
  assert.deepEqual(first.map((d) => d.path), ['apps/web/public', 'apps/web/src']);
  assert.equal(first[1].hasIndexHtml, true);
  assert.match(calls[0], /\/contents\/apps\/web\?ref=feat%2Fx$/);

  const before = calls.length;
  await listDirectories(config, 'me', 'repo', 'feat/x', 'apps/web');
  assert.equal(calls.length, before, 'second call is served from the cache');

  __resetCache();
  await listDirectories(config, 'me', 'repo', 'feat/x', 'apps/web');
  assert.ok(calls.length > before, '__resetCache clears the folder cache');
});

test('listDirectories skips failed flag lookups silently and caps the lookups at 30 folders', async () => {
  const names = Array.from({ length: 35 }, (_, i) => `pkg${String(i).padStart(2, '0')}`);
  const tree = { '': names.map((n) => dir(n)) };
  for (const n of names) tree[n] = [file('package.json', n)];
  const { impl, calls } = contentsFetch(tree, { fail: new Set(['pkg01']) });
  setFetchImpl(impl);

  const result = await listDirectories(freshConfig(), 'me', 'repo', 'main');
  assert.equal(result.length, 35, 'every directory is returned');
  assert.equal(result[0].hasPackageJson, true);
  assert.equal(result[1].hasPackageJson, false, 'a failed lookup leaves the flags false');
  assert.equal(result[29].hasPackageJson, true);
  assert.equal(result[30].hasPackageJson, false, 'folders beyond the cap are not looked into');
  assert.equal(calls.length, 1 + 30);
});

test('listDirectories maps a missing folder to 404, rejects bad input and needs a token', async () => {
  setFetchImpl(contentsFetch({ '': [] }).impl);
  await assert.rejects(() => listDirectories(freshConfig(), 'me', 'repo', 'main', 'nope'), (err) => err.status === 404);
  await assert.rejects(() => listDirectories(freshConfig(), 'me', 'repo', 'main', '../etc'), (err) => err.status === 400);
  await assert.rejects(() => listDirectories(freshConfig(), 'me', 'repo', '--bad'), (err) => err.status === 400);
  await assert.rejects(() => listDirectories({ GITHUB_TOKEN: undefined }, 'me', 'repo', 'main'), (err) => err.status === 503);
  // A path that is a file (the API answers with an object) is not a folder.
  setFetchImpl(async () => mockResponse({ json: { type: 'file', name: 'x' } }));
  await assert.rejects(() => listDirectories(freshConfig(), 'me', 'repo', 'main', 'x'), (err) => err.status === 404);
});

test('detectNodeVersion and detectProjectType read files inside the root directory', async () => {
  const requested = [];
  setFetchImpl(async (url) => {
    requested.push(url);
    if (url.includes('/contents/apps/web/package.json')) {
      return mockResponse({ text: JSON.stringify({ engines: { node: '>=22' }, scripts: { build: 'vite build' }, devDependencies: { vite: '^5' } }) });
    }
    return mockResponse({ status: 404, text: '' });
  });
  const config = freshConfig();

  const version = await detectNodeVersion(config, 'me', 'repo', 'main', 'apps/web');
  assert.deepEqual(version, { version: '22', source: 'engines' });
  assert.ok(requested.some((u) => u.includes('/contents/apps/web/.nvmrc?')));
  assert.ok(!requested.some((u) => /\/contents\/(\.nvmrc|package\.json)\?/.test(u)), 'the repo root files are not read');

  requested.length = 0;
  const project = await detectProjectType(config, 'me', 'repo', 'main', 'apps/web');
  assert.ok(project, 'classified from the sub-folder package.json');
  assert.ok(requested.some((u) => u.includes('/contents/apps/web/index.html?')));

  await assert.rejects(() => detectNodeVersion(config, 'me', 'repo', 'main', '../x'), (err) => err.status === 400);
  // Default stays the repo root.
  requested.length = 0;
  await detectNodeVersion(config, 'me', 'repo', 'main');
  assert.ok(requested.every((u) => /\/contents\/(\.nvmrc|package\.json)\?/.test(u)));
});

import { HttpError } from '../lib/httpError.js';
import { validateOwner, validateRepo, validateRef, validateCommitSha, validateRootDir } from '../lib/validate.js';
import { classifyProject } from '../lib/frontend.js';

const GITHUB_API = 'https://api.github.com';
const CACHE_TTL_MS = 60 * 1000;

export class GitHubError extends HttpError {
  constructor(status, message, options) {
    super(status, message, options);
    this.name = 'GitHubError';
  }
}

// Module-level fetch injection point for tests; defaults to the global fetch.
let fetchImpl = globalThis.fetch?.bind(globalThis);

export function setFetchImpl(fn) {
  fetchImpl = fn ?? globalThis.fetch?.bind(globalThis);
}

// Keyed by token so a config change (unlikely, but cheap to support) doesn't
// serve stale data from a different token.
let repoListCache = new Map();
// Folder listings, keyed by token + repo + ref + path.
let treeCache = new Map();

// Commit-window results are cached briefly so flipping between tabs or hammering Refresh doesn't burn rate limit.
const COMMIT_CACHE_TTL_MS = 30 * 1000;
let commitCache = new Map();

export function __resetCache() {
  repoListCache = new Map();
  commitCache = new Map();
  treeCache = new Map();
}

function requireToken(config) {
  if (!config?.GITHUB_TOKEN) {
    throw new GitHubError(503, 'GITHUB_TOKEN is not configured in server/.env');
  }
  return config.GITHUB_TOKEN;
}

function authHeaders(token, accept) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept ?? 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'deployment-maintainer',
  };
}

// Upstream auth failures map to 502/503, never 401: the frontend treats 401 as "dashboard session expired".
async function throwForStatus(res, { notFoundMessage } = {}) {
  const status = res.status;
  if (status === 401) {
    throw new GitHubError(502, 'GitHub token is invalid or expired');
  }
  if (status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      const resetHeader = res.headers.get('x-ratelimit-reset');
      const resetAt = resetHeader ? new Date(Number(resetHeader) * 1000).toISOString() : 'unknown';
      throw new GitHubError(503, `GitHub API rate limit exceeded; resets at ${resetAt}`);
    }
    throw new GitHubError(502, 'GitHub token lacks access to this resource');
  }
  if (status === 404) {
    throw new GitHubError(404, notFoundMessage ?? 'Repository or branch not found');
  }
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    // ignore — body isn't essential to the error message
  }
  throw new GitHubError(502, `GitHub API request failed (${status})${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`);
}

async function githubFetch(token, url, { accept, notFoundMessage } = {}) {
  const res = await fetchImpl(url, { headers: authHeaders(token, accept) });
  if (!res.ok) {
    await throwForStatus(res, { notFoundMessage });
  }
  return res;
}

function parseLinkHeader(header) {
  const links = {};
  if (!header) return links;
  for (const part of header.split(',')) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/);
    if (match) links[match[2]] = match[1];
  }
  return links;
}

async function paginate(token, initialUrl) {
  const results = [];
  let url = initialUrl;
  while (url) {
    const res = await githubFetch(token, url);
    const page = await res.json();
    results.push(...page);
    url = parseLinkHeader(res.headers.get('link')).next ?? null;
  }
  return results;
}

function filterRepos(repos, q) {
  if (!q) return repos;
  const needle = q.toLowerCase();
  return repos.filter((r) => r.name.toLowerCase().includes(needle));
}

export async function listRepos(config, { q, refresh = false } = {}) {
  const token = requireToken(config);
  const now = Date.now();

  if (!refresh) {
    const cached = repoListCache.get(token);
    if (cached && cached.expiresAt > now) {
      return filterRepos(cached.data, q);
    }
  }

  const url = `${GITHUB_API}/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=pushed`;
  const raw = await paginate(token, url);
  const mapped = raw.map((r) => ({
    fullName: r.full_name,
    name: r.name,
    owner: r.owner?.login,
    private: r.private,
    defaultBranch: r.default_branch,
    pushedAt: r.pushed_at,
    description: r.description,
    htmlUrl: r.html_url,
  }));

  repoListCache.set(token, { data: mapped, expiresAt: now + CACHE_TTL_MS });
  return filterRepos(mapped, q);
}

async function getRepoMeta(token, owner, repo) {
  const res = await githubFetch(token, `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  return res.json();
}

export async function listBranches(config, owner, repo) {
  const token = requireToken(config);
  const validOwner = validateOwner(owner);
  const validRepo = validateRepo(repo);

  const branchesUrl = `${GITHUB_API}/repos/${encodeURIComponent(validOwner)}/${encodeURIComponent(validRepo)}/branches?per_page=100`;
  const [branches, meta] = await Promise.all([
    paginate(token, branchesUrl),
    getRepoMeta(token, validOwner, validRepo),
  ]);

  const names = branches.map((b) => b.name);
  const defaultBranch = meta.default_branch;
  if (defaultBranch && names.includes(defaultBranch)) {
    return [defaultBranch, ...names.filter((n) => n !== defaultBranch)];
  }
  return names;
}

// Encodes each path segment separately so the slashes between them survive.
function encodePath(p) {
  return p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function contentsUrl(owner, repo, dirOrFilePath, ref) {
  const suffix = dirOrFilePath ? `/${encodePath(dirOrFilePath)}` : '';
  return `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${suffix}?ref=${encodeURIComponent(ref)}`;
}

async function fetchRawFile(token, owner, repo, filePath, ref) {
  const url = contentsUrl(owner, repo, filePath, ref);
  const res = await fetchImpl(url, { headers: authHeaders(token, 'application/vnd.github.raw+json') });
  if (res.status === 404) return null;
  if (!res.ok) {
    await throwForStatus(res, { notFoundMessage: 'Repository or branch not found' });
  }
  return res.text();
}

function normalizeNvmrc(content) {
  const firstLine = content.trim().split('\n')[0]?.trim();
  if (!firstLine) return null;
  if (firstLine.toLowerCase().startsWith('lts/')) return null;
  const stripped = firstLine.replace(/^v/i, '');
  const match = stripped.match(/^\d+(?:\.\d+){0,2}/);
  return match ? match[0] : null;
}

function extractEngineMajor(range) {
  const match = String(range).match(/(\d+)/);
  return match ? match[1] : null;
}

// `rootDir` is the app's sub-folder in the repo ('' = repo root); files are read relative to it.
function inRoot(rootDir, file) {
  return rootDir ? `${rootDir}/${file}` : file;
}

export async function detectNodeVersion(config, owner, repo, ref, rootDir = '') {
  const token = requireToken(config);
  const validOwner = validateOwner(owner);
  const validRepo = validateRepo(repo);
  const validRef = validateRef(ref);
  const validRoot = validateRootDir(rootDir);

  const nvmrc = await fetchRawFile(token, validOwner, validRepo, inRoot(validRoot, '.nvmrc'), validRef);
  if (nvmrc !== null) {
    const version = normalizeNvmrc(nvmrc);
    if (version) return { version, source: '.nvmrc' };
  }

  const pkgJsonText = await fetchRawFile(token, validOwner, validRepo, inRoot(validRoot, 'package.json'), validRef);
  if (pkgJsonText !== null) {
    try {
      const pkg = JSON.parse(pkgJsonText);
      const engineRange = pkg.engines?.node;
      if (engineRange) {
        const version = extractEngineMajor(engineRange);
        if (version) return { version, source: 'engines' };
      }
    } catch {
      // malformed package.json — fall through to "not detected"
    }
  }

  return { version: null, source: null };
}

export async function detectProjectType(config, owner, repo, ref, rootDir = '') {
  const token = requireToken(config);
  const validOwner = validateOwner(owner);
  const validRepo = validateRepo(repo);
  const validRef = validateRef(ref);
  const validRoot = validateRootDir(rootDir);

  const [pkgText, indexHtml] = await Promise.all([
    fetchRawFile(token, validOwner, validRepo, inRoot(validRoot, 'package.json'), validRef),
    fetchRawFile(token, validOwner, validRepo, inRoot(validRoot, 'index.html'), validRef),
  ]);

  let pkg = null;
  if (pkgText !== null) {
    try {
      pkg = JSON.parse(pkgText);
    } catch {
      pkg = null; // malformed package.json: classify from what else we know
    }
  }
  return classifyProject({ pkg, hasIndexHtml: indexHtml !== null });
}

const MAX_FLAG_LOOKUPS = 30;

// One folder listing (JSON); null on any failure so callers can treat "unknown" as "no".
async function listFolderEntries(token, owner, repo, ref, dirPath) {
  const res = await githubFetch(token, contentsUrl(owner, repo, dirPath, ref), {
    notFoundMessage: 'Folder not found on this branch',
  });
  const body = await res.json();
  return Array.isArray(body) ? body : null;
}

// Sub-folders of `dirPath` ('' = repo root) on `ref`, for the root-directory picker. Each carries hints about
// what is inside it; only the first 30 folders get the extra lookup (the rest report false) to bound API calls.
export async function listDirectories(config, owner, repo, ref, dirPath = '') {
  const token = requireToken(config);
  const validOwner = validateOwner(owner);
  const validRepo = validateRepo(repo);
  const validRef = validateRef(ref);
  const validPath = validateRootDir(dirPath);

  const cacheKey = `${token}\u0000${validOwner}/${validRepo}@${validRef}:${validPath}`;
  const cached = treeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const entries = await listFolderEntries(token, validOwner, validRepo, validRef, validPath);
  if (!entries) throw new GitHubError(404, 'Path is not a folder');

  const dirs = entries
    .filter((e) => e.type === 'dir')
    .sort((a, b) => a.name.localeCompare(b.name));

  const data = await Promise.all(dirs.map(async (dir, index) => {
    const result = { name: dir.name, path: dir.path, hasPackageJson: false, hasIndexHtml: false };
    if (index >= MAX_FLAG_LOOKUPS) return result;
    try {
      const inner = await listFolderEntries(token, validOwner, validRepo, validRef, dir.path);
      for (const entry of inner ?? []) {
        if (entry.type !== 'file') continue;
        if (entry.name === 'package.json') result.hasPackageJson = true;
        if (entry.name === 'index.html') result.hasIndexHtml = true;
      }
    } catch {
      // flags are a nicety; a failed lookup just leaves them false
    }
    return result;
  }));

  treeCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function getTokenInfo(config) {
  const token = requireToken(config);
  const res = await githubFetch(token, `${GITHUB_API}/user`);
  const data = await res.json();
  const scopesHeader = res.headers.get('x-oauth-scopes');
  const scopes = scopesHeader
    ? scopesHeader.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const rateLimitRemaining = res.headers.get('x-ratelimit-remaining');

  return {
    login: data.login,
    scopes,
    rateLimitRemaining: rateLimitRemaining !== null ? Number(rateLimitRemaining) : null,
  };
}

// Commits on `branch` that the deployed `sha` doesn't have yet (GitHub compare, base...head).
export async function getCommitsBehind(config, owner, repo, sha, branch) {
  const token = requireToken(config);
  const validOwner = validateOwner(owner);
  const validRepo = validateRepo(repo);
  const validBranch = validateRef(branch);
  const validSha = validateCommitSha(sha);

  const url = `${GITHUB_API}/repos/${encodeURIComponent(validOwner)}/${encodeURIComponent(validRepo)}/compare/${validSha}...${encodeURIComponent(validBranch)}?per_page=100`;
  const res = await githubFetch(token, url, { notFoundMessage: 'Deployed commit or branch not found on GitHub' });
  const data = await res.json();
  const behindBy = data.ahead_by ?? 0;
  // Compare lists oldest first; show the newest few.
  const commits = (data.commits ?? []).slice(-5).reverse().map((c) => ({
    sha: c.sha,
    message: String(c.commit?.message ?? '').split('\n')[0],
    author: c.commit?.author?.name ?? c.author?.login ?? null,
    date: c.commit?.author?.date ?? null,
  }));
  return { behindBy, commits };
}

function mapCommit(c) {
  return {
    sha: c.sha,
    message: String(c.commit?.message ?? '').split('\n')[0],
    author: c.commit?.author?.name ?? c.author?.login ?? null,
    date: c.commit?.author?.date ?? null,
  };
}

// Returns null when the response status is one of `missingStatuses` (meaning "the deployed sha is unknown to
// GitHub", e.g. force-pushed away); anything else that isn't ok is a real error.
async function githubFetchOrMissing(token, url, missingStatuses) {
  const res = await fetchImpl(url, { headers: authHeaders(token) });
  if (missingStatuses.includes(res.status)) return null;
  if (!res.ok) await throwForStatus(res);
  return res;
}

async function cachedCommits(key, load) {
  const hit = commitCache.get(key);
  if (hit && hit.expires > Date.now()) return structuredClone(hit.value);
  const value = await load();
  commitCache.set(key, { expires: Date.now() + COMMIT_CACHE_TTL_MS, value });
  return structuredClone(value);
}

// Latest `count` commits on `branch`, newest first.
export async function getLatestCommits(config, owner, repo, branch, count = 10) {
  const token = requireToken(config);
  const validOwner = validateOwner(owner);
  const validRepo = validateRepo(repo);
  const validBranch = validateRef(branch);

  return cachedCommits(`latest:${validOwner}/${validRepo}/${validBranch}/${count}`, async () => {
    const url = `${GITHUB_API}/repos/${encodeURIComponent(validOwner)}/${encodeURIComponent(validRepo)}/commits?sha=${encodeURIComponent(validBranch)}&per_page=${count}`;
    const res = await githubFetch(token, url, { notFoundMessage: 'Repository or branch not found' });
    return ((await res.json()) ?? []).map(mapCommit);
  });
}

// A window of history around the deployed commit: up to `count` newer commits on `branch` (newest first),
// the deployed commit itself, and up to `count` older ones (newest first).
// If the deployed sha no longer exists on GitHub, returns `{ deployed: null, missing: true, ... }` with the latest commits.
export async function getCommitWindow(config, owner, repo, sha, branch, count = 5) {
  const token = requireToken(config);
  const validOwner = validateOwner(owner);
  const validRepo = validateRepo(repo);
  const validBranch = validateRef(branch);
  const validSha = validateCommitSha(sha);

  return cachedCommits(`window:${validOwner}/${validRepo}/${validSha}/${validBranch}/${count}`, async () => {
    const base = `${GITHUB_API}/repos/${encodeURIComponent(validOwner)}/${encodeURIComponent(validRepo)}`;
    const [olderRes, compareRes] = await Promise.all([
      // An unknown sha on the commits list is a 422; a 404 there means the repo itself is gone (real error).
      githubFetchOrMissing(token, `${base}/commits?sha=${validSha}&per_page=${count + 1}`, [422]),
      githubFetchOrMissing(token, `${base}/compare/${validSha}...${encodeURIComponent(validBranch)}?per_page=100`, [404, 422]),
    ]);

    if (!olderRes || !compareRes) {
      const res = await githubFetch(token, `${base}/commits?sha=${encodeURIComponent(validBranch)}&per_page=${count * 2}`, {
        notFoundMessage: 'Repository or branch not found',
      });
      const older = ((await res.json()) ?? []).map(mapCommit);
      return { deployed: null, missing: true, newer: [], newerTotal: 0, older };
    }

    const [deployed, ...older] = ((await olderRes.json()) ?? []).map(mapCommit);
    const compare = await compareRes.json();
    // Compare lists oldest first; the ones right after the deployed commit are the first `count`.
    const newer = (compare.commits ?? []).slice(0, count).reverse().map(mapCommit);
    return { deployed: deployed ?? null, newer, newerTotal: compare.ahead_by ?? newer.length, older };
  });
}

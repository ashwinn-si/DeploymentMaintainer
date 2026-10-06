import { HttpError } from '../lib/httpError.js';
import { validateOwner, validateRepo, validateRef } from '../lib/validate.js';
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

export function __resetCache() {
  repoListCache = new Map();
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

async function fetchRawFile(token, owner, repo, filePath, ref) {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(ref)}`;
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

export async function detectNodeVersion(config, owner, repo, ref) {
  const token = requireToken(config);
  const validOwner = validateOwner(owner);
  const validRepo = validateRepo(repo);
  const validRef = validateRef(ref);

  const nvmrc = await fetchRawFile(token, validOwner, validRepo, '.nvmrc', validRef);
  if (nvmrc !== null) {
    const version = normalizeNvmrc(nvmrc);
    if (version) return { version, source: '.nvmrc' };
  }

  const pkgJsonText = await fetchRawFile(token, validOwner, validRepo, 'package.json', validRef);
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

export async function detectProjectType(config, owner, repo, ref) {
  const token = requireToken(config);
  const validOwner = validateOwner(owner);
  const validRepo = validateRepo(repo);
  const validRef = validateRef(ref);

  const [pkgText, indexHtml] = await Promise.all([
    fetchRawFile(token, validOwner, validRepo, 'package.json', validRef),
    fetchRawFile(token, validOwner, validRepo, 'index.html', validRef),
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

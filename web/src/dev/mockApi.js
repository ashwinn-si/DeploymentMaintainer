// DEV-only fixture backend. Only ever loaded via a dynamic `import()` gated by
// `import.meta.env.DEV`, so bundlers drop it entirely from production builds.
// Intercepts every `/api/*` call except `/api/auth/*` and `/api/settings/password`
// (real auth already works, so those stay pointed at the real backend).
// Implements the control plane's `/api/servers` registry, plus the per-server agent API
// under `/api/servers/:serverId/api/*`. Each server has its own apps and deployments.

const RESERVED_NAMES = ['api', 'assets', 'login', 'ports', 'apps', 'new', 'deployments', 'server', 'settings'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function sha() {
  return Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
}

class MockHttpError extends Error {
  constructor(status, message, issues) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

// Not real crypto — just enough of a reversible cipher that "wrong passphrase"
// is rejectable in the mock the same way it would be against the real backend.
function fakeEncrypt(text, passphrase) {
  const bytes = new TextEncoder().encode(text);
  const key = new TextEncoder().encode(passphrase);
  const out = bytes.map((b, i) => b ^ key[i % key.length]);
  return btoa(String.fromCharCode(...out));
}

function fakeDecrypt(b64, passphrase) {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const key = new TextEncoder().encode(passphrase);
    const out = bytes.map((b, i) => b ^ key[i % key.length]);
    return new TextDecoder().decode(out);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ system stats

const CPU_COUNT = 2;
const MEM_TOTAL = 8 * 1024 ** 3;
const SWAP_TOTAL = 1 * 1024 ** 3;
const DISK_TOTAL = 40 * 1024 ** 3;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// A slow sine wave plus a little noise, so history reads as a real trend
// (not point-to-point noise) and keeps drifting the same way on every poll —
// it's a pure function of wall-clock time, not stored state.
function wave(tMs, periodMs, base, amplitude, noiseAmp = 0) {
  const phase = (tMs / periodMs) * Math.PI * 2;
  return base + Math.sin(phase) * amplitude + (Math.random() - 0.5) * noiseAmp;
}

function systemSampleAt(tMs) {
  const cpuPct = clamp(wave(tMs, 6 * 60_000, 32, 16, 6), 2, 97);
  const memUsedFrac = clamp(wave(tMs, 11 * 60_000, 0.42, 0.08, 0.02), 0.15, 0.92);
  const diskUsedPct = clamp(wave(tMs, 90 * 60_000, 47, 4, 1), 5, 99);
  return {
    t: new Date(tMs).toISOString(),
    cpuPct,
    memUsed: memUsedFrac * MEM_TOTAL,
    memTotal: MEM_TOTAL,
    swapUsed: clamp(wave(tMs, 20 * 60_000, 0.08, 0.06, 0.02), 0, 1) * SWAP_TOTAL,
    swapTotal: SWAP_TOTAL,
    load1: (cpuPct / 100) * CPU_COUNT * 0.9,
    load5: (cpuPct / 100) * CPU_COUNT * 0.8,
    load15: (cpuPct / 100) * CPU_COUNT * 0.7,
    diskUsedPct,
  };
}

function diskListAt(tMs) {
  const pct = systemSampleAt(tMs).diskUsedPct / 100;
  const used = pct * DISK_TOTAL;
  return [{ mount: '/', total: DISK_TOTAL, used, free: DISK_TOTAL - used }];
}

// ------------------------------------------------------------------ fixtures

function defaultSteps(nginxPath) {
  return [
    { type: 'gitSync', enabled: true, config: {} },
    { type: 'nodeSetup', enabled: true, config: {} },
    { type: 'writeEnv', enabled: true, config: { filename: '.env' } },
    { type: 'install', enabled: true, config: { command: 'npm ci' } },
    { type: 'build', enabled: false, config: { command: 'npm run build' } },
    { type: 'pm2', enabled: true, config: { command: 'npm start' } },
    {
      type: 'healthCheck',
      enabled: true,
      config: { path: '/health', timeoutMs: 60000, intervalMs: 2000, autoRollback: true },
    },
    { type: 'nginx', enabled: Boolean(nginxPath), config: { path: nginxPath ?? '/app', stripPrefix: true } },
  ];
}

const REPOS = [
  {
    fullName: 'acme/api',
    name: 'api',
    owner: 'acme',
    private: true,
    defaultBranch: 'main',
    pushedAt: '2026-09-25T10:00:00.000Z',
    description: 'Core API service',
    htmlUrl: 'https://github.com/acme/api',
  },
  {
    fullName: 'acme/worker',
    name: 'worker',
    owner: 'acme',
    private: true,
    defaultBranch: 'main',
    pushedAt: '2026-09-20T10:00:00.000Z',
    description: 'Background job worker',
    htmlUrl: 'https://github.com/acme/worker',
  },
  {
    fullName: 'acme/broken-svc',
    name: 'broken-svc',
    owner: 'acme',
    private: false,
    defaultBranch: 'main',
    pushedAt: '2026-09-18T10:00:00.000Z',
    description: 'Known to crash on boot (for testing)',
    htmlUrl: 'https://github.com/acme/broken-svc',
  },
  {
    fullName: 'acme/marketing-site',
    name: 'marketing-site',
    owner: 'acme',
    private: false,
    defaultBranch: 'main',
    pushedAt: '2026-09-10T10:00:00.000Z',
    description: 'Public marketing site',
    htmlUrl: 'https://github.com/acme/marketing-site',
  },
];

const BRANCHES = {
  'acme/api': ['main', 'dev', 'feature/rate-limiting'],
  'acme/worker': ['main', 'staging'],
  'acme/broken-svc': ['main'],
  'acme/marketing-site': ['main', 'redesign'],
};

const NODE_VERSION_HINTS = {
  'acme/api': { version: '20.11.1', source: '.nvmrc' },
  'acme/worker': { version: '22', source: 'package.json engines.node' },
};

// `apps` / `deployments` / `deploySeqByApp` / `hostname` always belong to the server
// activated by the request being handled (see activateWorld). Deployment ids are globally
// unique, so entries and live runners can stay shared across servers.
let apps = [];
let deployments = [];
let hostname = 'mock-ec2';
let deploySeqByApp = new Map();
const entriesByDeployment = new Map();
const runners = new Map();

function nextDeployNumber(appId) {
  const n = (deploySeqByApp.get(appId) ?? 0) + 1;
  deploySeqByApp.set(appId, n);
  return n;
}

function makeApp({ id, name, repoFullName, branch, port, nodeVersion, nginxPath, status, healthy, envExtra = [] }) {
  return {
    id,
    name,
    repoFullName,
    branch,
    port,
    nodeVersion,
    path: nginxPath ?? null,
    status,
    pm2:
      status === 'not_deployed'
        ? { status: null, cpu: null, memory: null, restarts: null, uptimeMs: null }
        : {
            status: status === 'online' ? 'online' : status === 'deploying' ? 'online' : 'stopped',
            cpu: status === 'stopped' ? 0 : Math.round(Math.random() * 12 * 10) / 10,
            memory: status === 'stopped' ? 0 : Math.round((60 + Math.random() * 120) * 1024 * 1024),
            restarts: status === 'failed' ? 4 : 0,
            uptimeMs: status === 'stopped' || status === 'not_deployed' ? null : 3 * 3600 * 1000 + 12 * 60 * 1000,
          },
    health:
      status === 'not_deployed'
        ? { ok: false, statusCode: null, latencyMs: null, checkedAt: null }
        : {
            ok: healthy,
            statusCode: healthy ? 200 : 502,
            latencyMs: healthy ? 30 + Math.round(Math.random() * 60) : null,
            checkedAt: new Date(Date.now() - 20_000).toISOString(),
          },
    currentCommitSha: status === 'not_deployed' ? null : sha(),
    lastDeployedAt: status === 'not_deployed' ? null : new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    activeDeploymentId: null,
    env: [{ key: 'NODE_ENV', value: 'production' }, ...envExtra],
    steps: defaultSteps(nginxPath),
    diskBytes: status === 'not_deployed' ? null : Math.round((80 + Math.random() * 400) * 1024 * 1024),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  };
}

function makeDeployment({ app, mode = 'update', status, branch, ageMinutes, rollbackOf = null, autoRollbackOf = null, error = null }) {
  const id = uid('dep');
  const startedAt = new Date(Date.now() - ageMinutes * 60_000);
  const durationMs = status === 'queued' || status === 'running' ? null : 8000 + Math.round(Math.random() * 40000);
  const finishedAt =
    status === 'queued' || status === 'running' ? null : new Date(startedAt.getTime() + (durationMs ?? 0)).toISOString();
  const steps = defaultSteps(app.path).map((s, idx) => ({
    id: `${idx}-${s.type}`,
    type: s.type,
    label: s.type,
    status: !s.enabled ? 'skipped' : status === 'failed' && idx > 4 ? 'failed' : 'success',
    startedAt: s.enabled ? startedAt.toISOString() : null,
    endedAt: s.enabled ? finishedAt : null,
  }));
  const dep = {
    id,
    number: nextDeployNumber(app.id),
    appId: app.id,
    appName: app.name,
    repoFullName: app.repoFullName,
    branch: branch ?? app.branch,
    commitSha: sha(),
    previousSha: sha(),
    mode,
    rollbackOf,
    autoRollbackOf,
    status,
    nodeVersion: app.nodeVersion,
    error: status === 'failed' ? error ?? 'Health check failed: GET /health timed out after 60s' : null,
    createdAt: startedAt.toISOString(),
    finishedAt,
    durationMs,
    steps,
  };
  deployments.push(dep);
  return dep;
}

function seedEntriesFor(dep) {
  if (entriesByDeployment.has(dep.id)) return entriesByDeployment.get(dep.id);
  const lines = [];
  let i = 0;
  const push = (step, stream, text) => lines.push({ i: i++, t: new Date().toISOString(), step, stream, text });
  push(null, 'info', `Deploying ${dep.appName} · ${dep.branch}@${dep.commitSha.slice(0, 7)} · mode ${dep.mode}`);
  for (const step of dep.steps) {
    if (step.status === 'skipped') {
      push(step.id, 'info', `– ${step.type} · disabled`);
      continue;
    }
    push(step.id, 'info', `▶ ${step.label}`);
    if (step.type === 'gitSync') push(step.id, 'cmd', '$ git fetch origin ' + dep.branch);
    if (step.type === 'install') push(step.id, 'cmd', '$ npm ci');
    if (step.type === 'pm2') push(step.id, 'cmd', '$ pm2 startOrReload ecosystem.config.cjs');
    if (step.type === 'healthCheck') push(step.id, 'stdout', `GET /health → 200 (attempt 1)`);
    push(step.id, step.status === 'failed' ? 'stderr' : 'stdout', step.status === 'failed' ? 'Error: connect ECONNREFUSED' : 'ok');
    push(
      step.id,
      'info',
      step.status === 'failed' ? `✖ ${step.label} · exit code 1` : `✔ ${step.label} · ${(1 + Math.random() * 4).toFixed(1)}s`
    );
    if (step.status === 'failed') break;
  }
  push(null, dep.status === 'success' ? 'info' : 'error', `Deployment ${dep.status}`);
  entriesByDeployment.set(dep.id, lines);
  return lines;
}

function seedFullFixtures() {
  const apiMain = makeApp({
    id: 'app_api_main',
    name: 'api-main',
    repoFullName: 'acme/api',
    branch: 'main',
    port: 4001,
    nodeVersion: '20.11.1',
    nginxPath: '/api-main',
    status: 'online',
    healthy: true,
  });
  const apiDev = makeApp({
    id: 'app_api_dev',
    name: 'api-dev',
    repoFullName: 'acme/api',
    branch: 'dev',
    port: 4002,
    nodeVersion: '22.11.0',
    nginxPath: '/api-dev',
    status: 'deploying',
    healthy: true,
    envExtra: [{ key: 'FEATURE_FLAG_RATE_LIMIT', value: 'true' }],
  });
  const worker = makeApp({
    id: 'app_worker',
    name: 'worker',
    repoFullName: 'acme/worker',
    branch: 'main',
    port: 4003,
    nodeVersion: '22',
    nginxPath: null,
    status: 'stopped',
    healthy: false,
  });
  const broken = makeApp({
    id: 'app_broken_svc',
    name: 'broken-svc',
    repoFullName: 'acme/broken-svc',
    branch: 'main',
    port: 4004,
    nodeVersion: '20',
    nginxPath: '/broken-svc',
    status: 'failed',
    healthy: false,
  });
  const fresh = makeApp({
    id: 'app_marketing_site',
    name: 'marketing-site',
    repoFullName: 'acme/marketing-site',
    branch: 'main',
    port: 4005,
    nodeVersion: '20',
    nginxPath: '/marketing-site',
    status: 'not_deployed',
    healthy: false,
  });
  apps = [apiMain, apiDev, worker, broken, fresh];

  makeDeployment({ app: apiMain, status: 'success', mode: 'update', ageMinutes: 300 });
  makeDeployment({ app: apiMain, status: 'success', mode: 'update', ageMinutes: 42 });
  const failedOne = makeDeployment({ app: broken, status: 'failed', mode: 'update', ageMinutes: 15 });
  makeDeployment({
    app: broken,
    status: 'failed',
    mode: 'rollback',
    branch: broken.branch,
    ageMinutes: 14,
    autoRollbackOf: failedOne.id,
    error: 'Auto-rollback also failed health check',
  });
  makeDeployment({ app: worker, status: 'cancelled', mode: 'fresh', ageMinutes: 120 });
  const workerSuccess = makeDeployment({ app: worker, status: 'success', mode: 'update', ageMinutes: 200 });
  makeDeployment({ app: worker, status: 'rollback' === 'rollback' ? 'success' : 'success', mode: 'rollback', rollbackOf: workerSuccess.id, ageMinutes: 90 });

  for (const dep of deployments) seedEntriesFor(dep);

  // The one live, in-progress deployment (drives the sidebar dot + activity panel).
  const running = makeDeployment({ app: apiDev, status: 'running', mode: 'update', ageMinutes: 0 });
  running.steps = running.steps.map((s, idx) => ({ ...s, status: idx === 0 ? 'running' : 'pending', startedAt: idx === 0 ? new Date().toISOString() : null, endedAt: null }));
  running.durationMs = null;
  running.finishedAt = null;
  entriesByDeployment.set(running.id, []);
  apiDev.activeDeploymentId = running.id;
  ensureRunnerStarted(running.id);
}

function seedLiteFixtures() {
  const web = makeApp({
    id: 'app_web_frontend',
    name: 'web-frontend',
    repoFullName: 'acme/web',
    branch: 'main',
    port: 5001,
    nodeVersion: '22.11.0',
    nginxPath: '/web-frontend',
    status: 'online',
    healthy: true,
  });
  const cron = makeApp({
    id: 'app_cron_jobs',
    name: 'cron-jobs',
    repoFullName: 'acme/worker',
    branch: 'main',
    port: 5002,
    nodeVersion: '20.11.1',
    nginxPath: null,
    status: 'stopped',
    healthy: false,
  });
  apps = [web, cron];
  makeDeployment({ app: web, status: 'success', mode: 'update', ageMinutes: 180 });
  makeDeployment({ app: web, status: 'success', mode: 'update', ageMinutes: 25 });
  makeDeployment({ app: cron, status: 'failed', mode: 'update', ageMinutes: 600 });
  for (const dep of deployments) seedEntriesFor(dep);
}

// ------------------------------------------------------------------ per-server worlds

const worlds = new Map();

function saveWorld(serverId) {
  const world = worlds.get(serverId);
  if (world) Object.assign(world, { apps, deployments, deploySeqByApp, hostname });
}

function activateWorld(serverId) {
  let world = worlds.get(serverId);
  if (!world) {
    apps = [];
    deployments = [];
    deploySeqByApp = new Map();
    const full = serverId === 'srv_demo_prod';
    hostname = full ? 'prod-ec2' : `host-${serverId.slice(-6)}`;
    if (full) seedFullFixtures();
    else seedLiteFixtures();
    world = {};
    worlds.set(serverId, world);
    saveWorld(serverId);
    return;
  }
  ({ apps, deployments, deploySeqByApp, hostname } = world);
}

// ------------------------------------------------------------------ live-deploy simulation

function pushEntry(depId, step, stream, text) {
  const list = entriesByDeployment.get(depId) ?? [];
  const entry = { i: list.length, t: new Date().toISOString(), step, stream, text };
  list.push(entry);
  entriesByDeployment.set(depId, list);
  return entry;
}

function notify(id, type, payload) {
  const state = runners.get(id);
  if (!state) return;
  for (const sub of state.subscribers) sub[type]?.(payload);
}

function ensureRunnerStarted(id) {
  if (runners.has(id)) return;
  const dep = deployments.find((d) => d.id === id);
  if (!dep) return;
  const state = { subscribers: new Set(), cancelled: false };
  runners.set(id, state);
  runSimulation(dep, state);
}

function subscribeRunner(id, handlers) {
  ensureRunnerStarted(id);
  const state = runners.get(id);
  if (!state) return () => {};
  state.subscribers.add(handlers);
  return () => state.subscribers.delete(handlers);
}

async function runSimulation(dep, state) {
  const app = apps.find((a) => a.id === dep.appId);
  const shouldFail = app?.name === 'broken-svc';
  dep.status = 'running';

  for (let idx = 0; idx < dep.steps.length; idx++) {
    if (state.cancelled) break;
    const step = dep.steps[idx];
    if (step.status === 'skipped') continue;

    step.status = 'running';
    step.startedAt = new Date().toISOString();
    notify(dep.id, 'onStep', { id: step.id, status: step.status, startedAt: step.startedAt, endedAt: null });
    notify(dep.id, 'onLine', pushEntry(dep.id, step.id, 'info', `▶ ${step.label}`));
    await sleep(350);
    if (state.cancelled) break;
    notify(dep.id, 'onLine', pushEntry(dep.id, step.id, 'cmd', `$ run ${step.type}`));
    await sleep(450 + Math.random() * 500);
    if (state.cancelled) break;

    const failThisStep = shouldFail && step.type === 'healthCheck';
    notify(
      dep.id,
      'onLine',
      pushEntry(dep.id, step.id, failThisStep ? 'stderr' : 'stdout', failThisStep ? 'GET /health → 502 (attempt 5)' : 'ok')
    );

    step.status = failThisStep ? 'failed' : 'success';
    step.endedAt = new Date().toISOString();
    notify(dep.id, 'onStep', { id: step.id, status: step.status, startedAt: step.startedAt, endedAt: step.endedAt });
    notify(
      dep.id,
      'onLine',
      pushEntry(
        dep.id,
        step.id,
        'info',
        failThisStep ? `✖ ${step.label} · exit code 1` : `✔ ${step.label} · ${(1 + Math.random() * 3).toFixed(1)}s`
      )
    );

    if (failThisStep) {
      dep.status = 'failed';
      dep.error = 'Health check failed: GET /health → 502 (attempt 5)';
      break;
    }
  }

  if (state.cancelled) {
    dep.status = 'cancelled';
    for (const step of dep.steps) if (step.status === 'running' || step.status === 'pending') step.status = 'skipped';
  } else if (dep.status !== 'failed') {
    dep.status = 'success';
  }

  dep.finishedAt = new Date().toISOString();
  dep.durationMs = new Date(dep.finishedAt).getTime() - new Date(dep.createdAt).getTime();

  if (app) {
    app.activeDeploymentId = null;
    app.status = dep.status === 'success' ? 'online' : dep.status === 'cancelled' ? 'stopped' : 'failed';
    app.health = dep.status === 'success' ? { ok: true, statusCode: 200, latencyMs: 42, checkedAt: dep.finishedAt } : app.health;
    if (dep.status === 'success') {
      app.currentCommitSha = dep.commitSha;
      app.lastDeployedAt = dep.finishedAt;
    }
  }

  notify(dep.id, 'onLine', pushEntry(dep.id, null, dep.status === 'success' ? 'info' : 'error', `Deployment ${dep.status}`));
  notify(dep.id, 'onStatus', { status: dep.status, commitSha: dep.commitSha, error: dep.error, finishedAt: dep.finishedAt });
  notify(dep.id, 'onDone', { status: dep.status });
  await sleep(50);
  runners.delete(dep.id);
}

export function createMockStream(serverId, depId, after = -1) {
  const listeners = { line: new Set(), step: new Set(), status: new Set(), done: new Set() };
  let closed = false;
  let unsubscribe = () => {};

  function emit(type, data) {
    if (closed) return;
    for (const fn of listeners[type]) fn({ data: JSON.stringify(data) });
  }

  const handle = {
    addEventListener(type, fn) {
      listeners[type]?.add(fn);
    },
    removeEventListener(type, fn) {
      listeners[type]?.delete(fn);
    },
    close() {
      closed = true;
      unsubscribe();
    },
  };

  (async () => {
    const backlog = (entriesByDeployment.get(depId) ?? []).filter((e) => e.i > after);
    for (const entry of backlog) {
      if (closed) return;
      emit('line', entry);
      await sleep(10);
    }
    if (closed) return;

    activateWorld(serverId);
    const dep = deployments.find((d) => d.id === depId);
    if (!dep) {
      emit('done', { status: 'failed' });
      closed = true;
      return;
    }
    if (dep.status === 'running' || dep.status === 'queued') {
      unsubscribe = subscribeRunner(depId, {
        onLine: (e) => emit('line', e),
        onStep: (s) => emit('step', s),
        onStatus: (s) => emit('status', s),
        onDone: (s) => {
          emit('done', s);
          closed = true;
        },
      });
    } else {
      emit('done', { status: dep.status });
      closed = true;
    }
  })();

  return handle;
}

// ------------------------------------------------------------------ HTTP-ish route handling

function matchRepoBranches(pathname) {
  const m = pathname.match(/^\/api\/repos\/([^/]+)\/([^/]+)\/branches$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function matchRepoNodeVersion(pathname) {
  const m = pathname.match(/^\/api\/repos\/([^/]+)\/([^/]+)\/node-version$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function toAppSummary(app) {
  const { env, steps, diskBytes, ...summary } = app;
  void env;
  void steps;
  void diskBytes;
  return summary;
}

function findApp(id) {
  const app = apps.find((a) => a.id === id);
  if (!app) throw new MockHttpError(404, 'App not found');
  return app;
}

function findDeployment(id) {
  const dep = deployments.find((d) => d.id === id);
  if (!dep) throw new MockHttpError(404, 'Deployment not found');
  return dep;
}

function validateAppInput(body, { isCreate }) {
  const issues = [];
  if (isCreate) {
    if (!body.name || !/^[a-z0-9-]{1,40}$/.test(body.name)) {
      issues.push({ path: ['name'], message: 'Lowercase letters, numbers and hyphens only, max 40 chars' });
    } else if (RESERVED_NAMES.includes(body.name)) {
      issues.push({ path: ['name'], message: 'That name is reserved' });
    } else if (apps.some((a) => a.name === body.name)) {
      issues.push({ path: ['name'], message: 'An app with this name already exists' });
    }
    if (!body.repoFullName) issues.push({ path: ['repoFullName'], message: 'Repo is required' });
    if (!body.branch) issues.push({ path: ['branch'], message: 'Branch is required' });
  }
  if (body.port !== undefined && body.port !== null) {
    const conflict = apps.find((a) => a.port === body.port && a.id !== body.id);
    if (conflict) issues.push({ path: ['port'], message: `Port already used by ${conflict.name}` });
  }
  if (issues.length) throw new MockHttpError(400, 'Validation failed', issues);
}

// ------------------------------------------------------------------ config export/import

function buildExportFile(body) {
  const { appIds, passphrase } = body ?? {};
  if (!passphrase || passphrase.length < 8) {
    throw new MockHttpError(400, 'Passphrase must be at least 8 characters');
  }
  const selected = appIds?.length ? apps.filter((a) => appIds.includes(a.id)) : apps;
  return {
    exportedAt: new Date().toISOString(),
    apps: selected.map((app) => ({
      name: app.name,
      repoFullName: app.repoFullName,
      branch: app.branch,
      port: app.port,
      nodeVersion: app.nodeVersion,
      steps: app.steps,
      envEncrypted: fakeEncrypt(JSON.stringify(app.env), passphrase),
    })),
  };
}

function previewImportRows(body) {
  const { file, passphrase } = body ?? {};
  const fileApps = file?.apps;
  if (!Array.isArray(fileApps)) throw new MockHttpError(400, 'That file has no apps to import');
  if (fileApps[0] && fakeDecrypt(fileApps[0].envEncrypted, passphrase) === null) {
    throw new MockHttpError(400, 'Incorrect passphrase for this export file');
  }
  return fileApps.map((entry) => {
    const nameTaken = apps.some((a) => a.name === entry.name);
    const portTaken = apps.some((a) => a.port === entry.port);
    const conflict = nameTaken ? 'name' : portTaken ? 'port' : null;
    return {
      name: entry.name,
      repoFullName: entry.repoFullName,
      branch: entry.branch,
      port: entry.port,
      conflict,
      suggestedName: nameTaken ? `${entry.name}-import` : entry.name,
    };
  });
}

function applyImport(body) {
  const { file, passphrase, rows = [], deploy } = body ?? {};
  const fileApps = file?.apps ?? [];
  const created = [];
  const deployments = [];

  for (const row of rows) {
    if (row.action !== 'create') continue;
    const entry = fileApps.find((a) => a.name === row.name);
    if (!entry) continue;

    const decrypted = fakeDecrypt(entry.envEncrypted, passphrase);
    const env = decrypted ? JSON.parse(decrypted) : [];
    const finalName = row.newName || entry.name;
    if (apps.some((a) => a.name === finalName)) continue;

    const usedPorts = new Set(apps.map((a) => a.port));
    let port = entry.port;
    while (usedPorts.has(port)) port++;

    const app = makeApp({
      id: uid('app'),
      name: finalName,
      repoFullName: entry.repoFullName,
      branch: entry.branch,
      port,
      nodeVersion: entry.nodeVersion,
      nginxPath: `/${finalName}`,
      status: 'not_deployed',
      healthy: false,
    });
    app.env = env;
    app.steps = entry.steps ?? app.steps;
    apps.push(app);
    created.push(toAppSummary(app));

    if (deploy) {
      const dep = makeDeployment({ app, status: 'queued', mode: 'update', ageMinutes: 0 });
      app.status = 'deploying';
      app.activeDeploymentId = dep.id;
      entriesByDeployment.set(dep.id, []);
      ensureRunnerStarted(dep.id);
      deployments.push(dep);
    }
  }

  return { created, deployments };
}

async function route(serverId, pathname, method, body, query) {
  await sleep(120 + Math.random() * 180);
  activateWorld(serverId);
  try {
    return await agentRoute(pathname, method, body, query);
  } finally {
    saveWorld(serverId);
  }
}

function agentRoute(pathname, method, body, query) {
  if (pathname === '/api/repos' && method === 'GET') {
    const q = (query.get('q') || '').toLowerCase();
    const repos = q ? REPOS.filter((r) => r.fullName.toLowerCase().includes(q)) : REPOS;
    return { repos };
  }

  const branchMatch = matchRepoBranches(pathname);
  if (branchMatch && method === 'GET') {
    const full = `${branchMatch.owner}/${branchMatch.repo}`;
    return { branches: BRANCHES[full] ?? ['main'] };
  }

  const nodeVerMatch = matchRepoNodeVersion(pathname);
  if (nodeVerMatch && method === 'GET') {
    const full = `${nodeVerMatch.owner}/${nodeVerMatch.repo}`;
    return NODE_VERSION_HINTS[full] ?? { version: null, source: null };
  }

  if (pathname === '/api/apps' && method === 'GET') {
    return { apps: apps.map(toAppSummary) };
  }

  if (pathname === '/api/apps/defaults' && method === 'GET') {
    const name = query.get('name') || '';
    const usedPorts = new Set(apps.map((a) => a.port));
    let port = 4001;
    while (usedPorts.has(port)) port++;
    return { steps: defaultSteps(name ? `/${name}` : null), port, nodeVersion: '20.11.1' };
  }

  if (pathname === '/api/apps' && method === 'POST') {
    validateAppInput(body, { isCreate: true });
    const usedPorts = new Set(apps.map((a) => a.port));
    let port = body.port ?? 4001;
    while (usedPorts.has(port)) port++;
    const app = makeApp({
      id: uid('app'),
      name: body.name,
      repoFullName: body.repoFullName,
      branch: body.branch,
      port,
      nodeVersion: body.nodeVersion || '20',
      nginxPath: `/${body.name}`,
      status: 'not_deployed',
      healthy: false,
    });
    app.env = body.env?.length ? body.env : app.env;
    app.steps = body.steps?.length ? body.steps : app.steps;
    apps.push(app);
    let deployment = null;
    if (body.deploy) {
      deployment = makeDeployment({ app, status: 'queued', mode: 'update', ageMinutes: 0 });
      app.status = 'deploying';
      app.activeDeploymentId = deployment.id;
      entriesByDeployment.set(deployment.id, []);
      ensureRunnerStarted(deployment.id);
    }
    return { app, deployment };
  }

  const appIdMatch = pathname.match(/^\/api\/apps\/([^/]+)$/);
  if (appIdMatch && method === 'GET') {
    return { app: findApp(appIdMatch[1]) };
  }
  if (appIdMatch && method === 'PATCH') {
    const app = findApp(appIdMatch[1]);
    validateAppInput({ ...body, id: app.id }, { isCreate: false });
    Object.assign(app, body, { updatedAt: new Date().toISOString() });
    return { app };
  }
  if (appIdMatch && method === 'DELETE') {
    const app = findApp(appIdMatch[1]);
    if (body?.confirmName !== app.name) {
      throw new MockHttpError(400, 'Type the app name to confirm deletion');
    }
    apps = apps.filter((a) => a.id !== app.id);
    return { ok: true };
  }

  const dupMatch = pathname.match(/^\/api\/apps\/([^/]+)\/duplicate$/);
  if (dupMatch && method === 'POST') {
    const source = findApp(dupMatch[1]);
    validateAppInput({ name: body.name, repoFullName: source.repoFullName, branch: body.branch }, { isCreate: true });
    const usedPorts = new Set(apps.map((a) => a.port));
    let port = body.port ?? source.port + 1;
    while (usedPorts.has(port)) port++;
    const app = makeApp({
      id: uid('app'),
      name: body.name,
      repoFullName: source.repoFullName,
      branch: body.branch ?? source.branch,
      port,
      nodeVersion: body.nodeVersion || source.nodeVersion,
      nginxPath: `/${body.name}`,
      status: 'not_deployed',
      healthy: false,
    });
    app.env = body.copyEnv ? source.env : [{ key: 'NODE_ENV', value: 'production' }];
    app.steps = source.steps;
    apps.push(app);
    let deployment = null;
    if (body.deploy) {
      deployment = makeDeployment({ app, status: 'queued', mode: 'update', ageMinutes: 0 });
      app.status = 'deploying';
      app.activeDeploymentId = deployment.id;
      entriesByDeployment.set(deployment.id, []);
      ensureRunnerStarted(deployment.id);
    }
    return { app, deployment };
  }

  const deployMatch = pathname.match(/^\/api\/apps\/([^/]+)\/deploy$/);
  if (deployMatch && method === 'POST') {
    const app = findApp(deployMatch[1]);
    if (app.activeDeploymentId) throw new MockHttpError(409, 'A deployment is already running for this app');
    if (body.branch) app.branch = body.branch;
    const deployment = makeDeployment({ app, status: 'queued', mode: body.mode ?? 'update', ageMinutes: 0 });
    app.status = 'deploying';
    app.activeDeploymentId = deployment.id;
    entriesByDeployment.set(deployment.id, []);
    ensureRunnerStarted(deployment.id);
    return { deployment };
  }

  const restartMatch = pathname.match(/^\/api\/apps\/([^/]+)\/restart$/);
  if (restartMatch && method === 'POST') {
    const app = findApp(restartMatch[1]);
    app.pm2.status = 'online';
    app.status = 'online';
    return { app: toAppSummary(app) };
  }
  const stopMatch = pathname.match(/^\/api\/apps\/([^/]+)\/stop$/);
  if (stopMatch && method === 'POST') {
    const app = findApp(stopMatch[1]);
    app.pm2.status = 'stopped';
    app.status = 'stopped';
    return { app: toAppSummary(app) };
  }

  const logsMatch = pathname.match(/^\/api\/apps\/([^/]+)\/logs$/);
  if (logsMatch && method === 'GET') {
    const app = findApp(logsMatch[1]);
    return {
      text: [
        `0|app-${app.name}  | [mock] pm2 runtime logs`,
        `0|app-${app.name}  | Server listening on port ${app.port}`,
        `0|app-${app.name}  | GET /health 200 3ms`,
      ].join('\n'),
    };
  }

  const appDeploysMatch = pathname.match(/^\/api\/apps\/([^/]+)\/deployments$/);
  if (appDeploysMatch && method === 'GET') {
    const app = findApp(appDeploysMatch[1]);
    const limit = Number(query.get('limit')) || 50;
    return { deployments: deployments.filter((d) => d.appId === app.id).sort(byCreatedAtDesc).slice(0, limit) };
  }

  if (pathname === '/api/deployments/active' && method === 'GET') {
    return { deployments: deployments.filter((d) => d.status === 'queued' || d.status === 'running') };
  }

  if (pathname === '/api/deployments' && method === 'GET') {
    let list = [...deployments];
    if (query.get('app')) list = list.filter((d) => d.appId === query.get('app'));
    if (query.get('status')) list = list.filter((d) => d.status === query.get('status'));
    if (query.get('branch')) list = list.filter((d) => d.branch === query.get('branch'));
    if (query.get('mode')) list = list.filter((d) => d.mode === query.get('mode'));
    list = list.sort(byCreatedAtDesc);
    const limit = Number(query.get('limit')) || 50;
    return { deployments: list.slice(0, limit), nextBefore: list.length > limit ? list[limit - 1].createdAt : null };
  }

  const depIdMatch = pathname.match(/^\/api\/deployments\/([^/]+)$/);
  if (depIdMatch && method === 'GET') {
    const dep = findDeployment(depIdMatch[1]);
    return { deployment: { ...dep, entryCount: (entriesByDeployment.get(dep.id) ?? []).length, repoFullName: dep.repoFullName } };
  }

  const entriesMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/entries$/);
  if (entriesMatch && method === 'GET') {
    const dep = findDeployment(entriesMatch[1]);
    const after = Number(query.get('after') ?? -1);
    const limit = Number(query.get('limit')) || 2000;
    const all = entriesByDeployment.get(dep.id) ?? [];
    return { entries: all.filter((e) => e.i > after).slice(0, limit) };
  }

  const cancelMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/cancel$/);
  if (cancelMatch && method === 'POST') {
    const dep = findDeployment(cancelMatch[1]);
    const state = runners.get(dep.id);
    if (state) state.cancelled = true;
    else if (dep.status === 'running' || dep.status === 'queued') dep.status = 'cancelled';
    return { deployment: dep };
  }

  const rollbackMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/rollback$/);
  if (rollbackMatch && method === 'POST') {
    const source = findDeployment(rollbackMatch[1]);
    if (source.status !== 'success') throw new MockHttpError(400, 'Can only roll back to a successful deployment');
    const app = findApp(source.appId);
    if (app.activeDeploymentId) throw new MockHttpError(409, 'A deployment is already running for this app');
    const dep = makeDeployment({ app, status: 'queued', mode: 'rollback', branch: source.branch, rollbackOf: source.id, ageMinutes: 0 });
    dep.commitSha = source.commitSha;
    app.status = 'deploying';
    app.activeDeploymentId = dep.id;
    entriesByDeployment.set(dep.id, []);
    ensureRunnerStarted(dep.id);
    return { deployment: dep };
  }

  if (pathname === '/api/ports' && method === 'GET') {
    return {
      dashboard: { port: 3000 },
      rows: apps
        .map((app) => ({
          port: app.port,
          appId: app.id,
          appName: app.name,
          repoFullName: app.repoFullName,
          branch: app.branch,
          path: app.path,
          nodeVersion: app.nodeVersion,
          pm2Status: app.pm2.status,
          health: app.health,
          nginx: Boolean(app.path),
          lastDeployedAt: app.lastDeployedAt,
          // One demo conflict so the UI's conflict pill is exercisable in dev.
          conflict: app.name === 'worker' ? 'Also bound by an unmanaged process (pid 8821)' : null,
        }))
        .sort((a, b) => a.port - b.port),
    };
  }

  if (pathname === '/api/node/versions' && method === 'GET') {
    return { installed: ['18.20.4', '20.11.1', '22.11.0'], default: '20.11.1' };
  }

  if (pathname === '/api/system' && method === 'GET') {
    const now = Date.now();
    const history = Array.from({ length: 40 }, (_, idx) => systemSampleAt(now - (40 - idx) * 30_000));
    return {
      current: systemSampleAt(now),
      history,
      info: { hostname, platform: 'linux', uptimeSec: 86400 * 3, nodeVersion: '20.11.1', pm2Version: '5.4.2', nginxVersion: '1.24.0', cpuCount: CPU_COUNT },
      disks: diskListAt(now),
      apps: apps.map((app) => ({
        appId: app.id,
        appName: app.name,
        pm2Status: app.pm2.status,
        cpu: app.pm2.cpu,
        memory: app.pm2.memory,
        restarts: app.pm2.restarts,
        uptimeMs: app.pm2.uptimeMs,
        diskBytes: app.diskBytes,
        health: app.health,
      })),
    };
  }

  if (pathname === '/api/settings/info' && method === 'GET') {
    // Empty scopes mirrors a real fine-grained PAT, which reports none via the API.
    return { github: { login: 'acme-bot', scopes: [], rateLimitRemaining: 4931 }, appsDir: '/home/ubuntu/apps', nginxEnabled: false, domainHint: null };
  }

  if (pathname === '/api/config/import/preview' && method === 'POST') {
    return { rows: previewImportRows(body) };
  }

  if (pathname === '/api/config/import' && method === 'POST') {
    return applyImport(body);
  }

  throw new MockHttpError(404, 'Not found (mock)');
}

function byCreatedAtDesc(a, b) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body ?? null), { status, headers: { 'Content-Type': 'application/json' } });
}

// ------------------------------------------------------------------ control plane: server registry

const SERVER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ROTATE_MESSAGE = 'The server rejected the stored secret — rotate it in Servers';

function seedServers() {
  const now = Date.now();
  return [
    {
      id: 'srv_demo_prod',
      name: 'Production',
      url: 'https://api.example.com',
      serverId: 'demo-prod-0001',
      secret: 'x'.repeat(43),
      version: '0.1.0',
      hostname: 'prod-ec2',
      status: 'online',
      lastSeenAt: new Date(now - 4_000).toISOString(),
      createdAt: new Date(now - 86_400_000 * 20).toISOString(),
    },
    {
      id: 'srv_demo_staging',
      name: 'Staging',
      url: 'https://api2.example.com',
      serverId: 'demo-staging-02',
      secret: 'y'.repeat(43),
      version: '0.1.0',
      hostname: 'staging-ec2',
      status: 'offline',
      lastSeenAt: new Date(now - 3_600_000 * 5).toISOString(),
      createdAt: new Date(now - 86_400_000 * 6).toISOString(),
    },
  ];
}

let servers = null;

function serverList() {
  if (!servers) servers = seedServers();
  return servers;
}

function serializeServer(server) {
  const { secret, ...rest } = server;
  void secret;
  return rest;
}

function findServer(id) {
  const server = serverList().find((s) => s.id === id);
  if (!server) throw new MockHttpError(404, 'Server not found');
  return server;
}

function normalizeUrl(input) {
  let parsed;
  try {
    parsed = new URL(String(input).trim());
  } catch {
    throw new MockHttpError(400, 'Invalid server URL');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) throw new MockHttpError(400, 'Invalid server URL');
  return parsed.origin;
}

// Fake handshake: a URL containing "unreachable" fails to connect, a serverId starting with
// "mismatch" reports a different id, and a secret starting with "bad" is rejected.
function mockVerify({ url, serverId, secret }) {
  if (url.includes('unreachable')) throw new MockHttpError(502, `Could not reach the server at ${url}`);
  if (serverId.startsWith('mismatch')) {
    throw new MockHttpError(400, 'Server ID mismatch: the server reports "other-server-id" — check SERVER_ID in its .env');
  }
  if (secret.startsWith('bad')) {
    throw new MockHttpError(400, 'The server rejected the secret — check SERVER_SECRET in its .env and reload it');
  }
  return { version: '0.1.0', hostname: `host-${serverId.slice(-6)}` };
}

function markOnline(server, info) {
  Object.assign(server, { ...info, status: 'online', lastSeenAt: new Date().toISOString() });
}

async function serversRoute(pathname, method, body) {
  await sleep(150 + Math.random() * 200);
  const list = serverList();

  if (pathname === '/api/servers' && method === 'GET') {
    return { servers: list.map(serializeServer) };
  }

  if (pathname === '/api/servers' && method === 'POST') {
    const name = String(body?.name ?? '').trim();
    if (!name || name.length > 60) throw new MockHttpError(400, 'Invalid request body', [{ path: ['name'], message: 'Name must be 1-60 characters' }]);
    if (!SERVER_ID_RE.test(body?.serverId ?? '')) throw new MockHttpError(400, 'serverId must be 8-64 characters: letters, digits, - or _');
    if (typeof body?.secret !== 'string' || body.secret.length < 32) throw new MockHttpError(400, 'secret must be at least 32 characters');
    const url = normalizeUrl(body.url);
    if (list.some((s) => s.serverId === body.serverId)) throw new MockHttpError(409, 'A server with that ID is already registered');
    if (list.some((s) => s.url === url)) throw new MockHttpError(409, 'A server with that URL is already registered');
    const info = mockVerify({ url, serverId: body.serverId, secret: body.secret });
    const server = { id: uid('srv'), name, url, serverId: body.serverId, secret: body.secret, createdAt: new Date().toISOString() };
    markOnline(server, info);
    list.push(server);
    return { server: serializeServer(server) };
  }

  const idMatch = pathname.match(/^\/api\/servers\/([^/]+)$/);
  if (idMatch) {
    const server = findServer(idMatch[1]);
    if (method === 'GET') return { server: serializeServer(server) };
    if (method === 'PATCH') {
      if (body?.name !== undefined) {
        const name = String(body.name).trim();
        if (!name || name.length > 60) throw new MockHttpError(400, 'Name must be 1-60 characters');
        server.name = name;
      }
      if (body?.url !== undefined) {
        const url = normalizeUrl(body.url);
        if (url !== server.url) {
          if (list.some((s) => s.id !== server.id && s.url === url)) throw new MockHttpError(409, 'A server with that URL is already registered');
          markOnline(server, mockVerify({ url, serverId: server.serverId, secret: server.secret }));
          server.url = url;
        }
      }
      return { server: serializeServer(server) };
    }
    if (method === 'DELETE') {
      servers = list.filter((s) => s.id !== server.id);
      worlds.delete(server.id);
      return { ok: true };
    }
  }

  const secretMatch = pathname.match(/^\/api\/servers\/([^/]+)\/secret$/);
  if (secretMatch && method === 'POST') {
    const server = findServer(secretMatch[1]);
    if (typeof body?.secret !== 'string' || body.secret.length < 32) throw new MockHttpError(400, 'secret must be at least 32 characters');
    markOnline(server, mockVerify({ url: server.url, serverId: server.serverId, secret: body.secret }));
    server.secret = body.secret;
    return { server: serializeServer(server) };
  }

  throw new MockHttpError(404, 'Not found (mock)');
}

function shouldMock(pathname) {
  if (!pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/api/auth/')) return false;
  if (pathname === '/api/settings/password') return false;
  return true;
}

export function installMockFetch() {
  if (window.__mockApiInstalled) return;
  window.__mockApiInstalled = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input.url;
    const url = new URL(rawUrl, window.location.origin);
    if (!shouldMock(url.pathname)) return originalFetch(input, init);

    const method = (init.method || 'GET').toUpperCase();
    let body;
    if (init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = undefined;
      }
    }

    try {
      const proxied = url.pathname.match(/^\/api\/servers\/([^/]+)(\/api\/.*)$/);
      if (!proxied) {
        return jsonResponse(200, await serversRoute(url.pathname, method, body));
      }

      const [, serverId, agentPath] = proxied;
      const server = findServer(serverId);
      if (server.status === 'offline') {
        await sleep(300);
        throw new MockHttpError(502, 'Server unreachable');
      }
      if (server.status === 'unauthorized') {
        await sleep(300);
        throw new MockHttpError(502, ROTATE_MESSAGE);
      }

      // Export returns a file attachment, not a JSON API envelope — handled
      // separately so it can set Content-Disposition and a blob body.
      if (agentPath === '/api/config/export' && method === 'POST') {
        await sleep(200);
        activateWorld(serverId);
        const file = buildExportFile(body);
        const filename = `deployer-config-${new Date().toISOString().slice(0, 10)}.json`;
        return new Response(JSON.stringify(file, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        });
      }

      const downloadMatch = agentPath.match(/^\/api\/deployments\/([^/]+)\/download$/);
      if (downloadMatch && method === 'GET') {
        const dep = findDeployment(downloadMatch[1]);
        const text = (entriesByDeployment.get(dep.id) ?? []).map((e) => e.text).join('\n');
        return new Response(text, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
            'Content-Disposition': `attachment; filename="deployment-${dep.id}.log"`,
          },
        });
      }

      const result = await route(serverId, agentPath, method, body, url.searchParams);
      return jsonResponse(200, result);
    } catch (err) {
      if (err instanceof MockHttpError) return jsonResponse(err.status, { error: err.message, issues: err.issues });
      // eslint-disable-next-line no-console
      console.error('[mockApi] unhandled error', err);
      return jsonResponse(500, { error: 'Mock server error' });
    }
  };

  // eslint-disable-next-line no-console
  console.info('[mockApi] enabled — intercepting /api/* except auth and settings/password. Set localStorage.mockApi to "0" and reload to disable.');
}

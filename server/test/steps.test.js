import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultSteps, normalizeSteps, ALWAYS_INVOKE } from '../src/steps/index.js';
import { run as gitSyncRun } from '../src/steps/gitSync.js';
import { run as writeEnvRun } from '../src/steps/writeEnv.js';
import { run as installRun } from '../src/steps/install.js';
import { run as pm2Run } from '../src/steps/pm2.js';
import { run as healthCheckRun } from '../src/steps/healthCheck.js';
import * as pm2Service from '../src/services/pm2.js';
import { HttpError } from '../src/lib/httpError.js';
import { createShims, patchProcessEnv } from './helpers/shims.js';
import { createGitFixture } from './helpers/gitFixture.js';

function createFakeLog() {
  const events = [];
  const log = {
    info: (text, step) => events.push({ method: 'info', text, step }),
    cmd: (text, step) => events.push({ method: 'cmd', text, step }),
    error: (text, step) => events.push({ method: 'error', text, step }),
    onLine: (step) => ({ stream, text }) => events.push({ method: stream, text, step }),
    stepStart: (step) => events.push({ method: 'stepStart', step }),
    stepEnd: (step, status) => events.push({ method: 'stepEnd', step, status }),
  };
  return { log, events };
}

async function withShims(fn) {
  const shims = await createShims();
  const restore = patchProcessEnv(shims);
  try {
    await fn(shims);
  } finally {
    restore();
    await shims.cleanup();
  }
}

// --- steps/index.js -------------------------------------------------------

test('defaultSteps starts with gitSync/nodeSetup enabled and build/healthCheck configured per plan', () => {
  const steps = defaultSteps('my-app');
  assert.equal(steps[0].type, 'gitSync');
  assert.equal(steps[1].type, 'nodeSetup');
  assert.equal(steps.find((s) => s.type === 'build').enabled, false);
  assert.equal(steps.find((s) => s.type === 'nginx').config.path, '/my-app');
});

test('normalizeSteps accepts defaultSteps output unchanged', () => {
  const steps = defaultSteps('my-app');
  const normalized = normalizeSteps(steps);
  assert.deepEqual(normalized.map((s) => s.type), steps.map((s) => s.type));
});

test('normalizeSteps forces gitSync and nodeSetup enabled even if the caller disabled them', () => {
  const steps = defaultSteps('x').map((s) =>
    (s.type === 'gitSync' || s.type === 'nodeSetup' ? { ...s, enabled: false } : s));
  const normalized = normalizeSteps(steps);
  assert.equal(normalized.find((s) => s.type === 'gitSync').enabled, true);
  assert.equal(normalized.find((s) => s.type === 'nodeSetup').enabled, true);
});

test('normalizeSteps rejects a pipeline that does not start with gitSync', () => {
  const steps = defaultSteps('x').slice(1);
  assert.throws(() => normalizeSteps(steps), HttpError);
});

test('normalizeSteps rejects an unknown step type', () => {
  assert.throws(() => normalizeSteps([{ type: 'nope', enabled: true, config: {} }]), HttpError);
});

test('normalizeSteps rejects a custom step with no command', () => {
  const steps = [...defaultSteps('x'), { type: 'custom', enabled: true, config: {} }];
  assert.throws(() => normalizeSteps(steps), HttpError);
});

test('normalizeSteps rejects a command containing shell operators (surfaced at save time)', () => {
  const steps = defaultSteps('x').map((s) =>
    (s.type === 'install' ? { ...s, config: { command: 'npm ci && rm -rf /' } } : s));
  assert.throws(() => normalizeSteps(steps), (err) => {
    assert.ok(err instanceof HttpError);
    assert.match(err.message, /invalid command/);
    return true;
  });
});

test('ALWAYS_INVOKE contains nginx so a disabled route can still be removed', () => {
  assert.ok(ALWAYS_INVOKE.has('nginx'));
});

test('normalizeSteps rejects an nginx path that would inject into the config', () => {
  const steps = defaultSteps('x').map((s) =>
    (s.type === 'nginx' ? { ...s, config: { path: '/x;\n}\nlocation / { proxy_pass http://evil' } } : s));
  assert.throws(() => normalizeSteps(steps), HttpError);
});

test('normalizeSteps rejects a healthCheck path with a space or newline', () => {
  for (const badPath of ['/has space', '/has\nnewline', '/a'.repeat(101)]) {
    const steps = defaultSteps('x').map((s) =>
      (s.type === 'healthCheck' ? { ...s, config: { path: badPath } } : s));
    assert.throws(() => normalizeSteps(steps), HttpError);
  }
});

test('normalizeSteps rejects a writeEnv filename with path traversal', () => {
  for (const badFilename of ['../../etc/passwd', '..', '.', 'a/b']) {
    const steps = defaultSteps('x').map((s) =>
      (s.type === 'writeEnv' ? { ...s, config: { filename: badFilename } } : s));
    assert.throws(() => normalizeSteps(steps), HttpError);
  }
});

// --- writeEnv ---------------------------------------------------------------

test('writeEnv step writes decrypted env plus PORT at mode 600', async () => {
  const appsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-writeenv-'));
  const dir = path.join(appsDir, 'my-app');
  await fsp.mkdir(dir, { recursive: true });

  const app = { name: 'my-app', port: 4321 };
  const { log } = createFakeLog();
  await writeEnvRun({
    app,
    env: { GREETING: 'hi', API_KEY: 'secret' },
    config: { APPS_DIR: appsDir },
    log,
    state: { appDir: dir },
    step: { type: 'writeEnv', config: {} },
    stepId: 'writeEnv',
  });

  const filePath = path.join(dir, '.env');
  const stat = await fsp.stat(filePath);
  assert.equal(stat.mode & 0o777, 0o600);
  const content = await fsp.readFile(filePath, 'utf8');
  assert.match(content, /GREETING='hi'/);
  assert.match(content, /API_KEY='secret'/);
  assert.match(content, /PORT='4321'/);

  await fsp.rm(appsDir, { recursive: true, force: true });
});

test('writeEnv step chmods to 600 even when the file already exists with looser permissions', async () => {
  const appsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-writeenv-'));
  const dir = path.join(appsDir, 'my-app');
  await fsp.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, '.env');
  await fsp.writeFile(filePath, 'STALE=1\n', { mode: 0o644 });

  const { log } = createFakeLog();
  await writeEnvRun({
    app: { name: 'my-app', port: 4321 },
    env: { FRESH: 'yes' },
    config: { APPS_DIR: appsDir },
    log,
    state: { appDir: dir },
    step: { type: 'writeEnv', config: {} },
    stepId: 'writeEnv',
  });

  const stat = await fsp.stat(filePath);
  assert.equal(stat.mode & 0o777, 0o600);
  await fsp.rm(appsDir, { recursive: true, force: true });
});

test('writeEnv step quotes values so dotenv.parse round-trips them exactly', async () => {
  const dotenv = await import('dotenv');
  const appsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-writeenv-'));
  const dir = path.join(appsDir, 'my-app');
  await fsp.mkdir(dir, { recursive: true });

  const env = {
    HASH: 'value#with#hash and spaces',
    EQUALS: 'a=b=c',
    DQUOTE: 'has "double" quotes',
    SQUOTE: "it's got a single quote",
    DOLLAR: 'price:$5 and ${NOT_EXPANDED}',
    BACKSLASH: 'C:\\Users\\test',
  };

  const { log } = createFakeLog();
  await writeEnvRun({
    app: { name: 'my-app', port: 4321 },
    env,
    config: { APPS_DIR: appsDir },
    log,
    state: { appDir: dir },
    step: { type: 'writeEnv', config: {} },
    stepId: 'writeEnv',
  });

  const content = await fsp.readFile(path.join(dir, '.env'), 'utf8');
  const parsed = dotenv.parse(content);
  for (const [key, value] of Object.entries(env)) {
    assert.equal(parsed[key], value, `round-trip mismatch for ${key}`);
  }
  assert.equal(parsed.PORT, '4321');

  await fsp.rm(appsDir, { recursive: true, force: true });
});

test('writeEnv step rejects a path-traversal filename', async () => {
  const { log } = createFakeLog();
  await assert.rejects(() => writeEnvRun({
    app: { name: 'my-app', port: 4321 },
    env: {},
    config: { APPS_DIR: '/tmp' },
    log,
    state: { appDir: '/tmp' },
    step: { type: 'writeEnv', config: { filename: '../../etc/passwd' } },
    stepId: 'writeEnv',
  }), HttpError);
});

test('writeEnv step honors a custom filename', async () => {
  const appsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-writeenv-'));
  const dir = path.join(appsDir, 'my-app');
  await fsp.mkdir(dir, { recursive: true });

  const { log } = createFakeLog();
  await writeEnvRun({
    app: { name: 'my-app', port: 4321 },
    env: {},
    config: { APPS_DIR: appsDir },
    log,
    state: { appDir: dir },
    step: { type: 'writeEnv', config: { filename: '.env.production' } },
    stepId: 'writeEnv',
  });

  assert.ok(fs.existsSync(path.join(dir, '.env.production')));
  await fsp.rm(appsDir, { recursive: true, force: true });
});

// --- install (with shims for the fnm passthrough) ---------------------------

test('install step falls back to "npm install" when there is no lockfile', async () => {
  await withShims(async () => {
    const fixture = await createGitFixture();
    const appsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-install-'));
    try {
      const appDir = path.join(appsDir, 'fixture-app');
      await fsp.cp(fixture.seedDir, appDir, {
        recursive: true,
        filter: (src) => !src.includes(`${path.sep}.git`),
      });
      assert.ok(!fs.existsSync(path.join(appDir, 'package-lock.json')));

      const { log, events } = createFakeLog();
      await installRun({
        app: { name: 'fixture-app', nodeVersion: '20' },
        config: { APPS_DIR: appsDir },
        log,
        state: { appDir },
        step: { type: 'install', config: {} },
        stepId: 'install',
      });

      const cmdEvent = events.find((e) => e.method === 'cmd');
      assert.equal(cmdEvent.text, 'npm install');
    } finally {
      await fixture.cleanup();
      await fsp.rm(appsDir, { recursive: true, force: true });
    }
  });
});

test('install step uses "npm ci" when a lockfile is present', async () => {
  await withShims(async () => {
    const appsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-install-'));
    const appDir = path.join(appsDir, 'lockfile-app');
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
    await fsp.writeFile(
      path.join(appDir, 'package-lock.json'),
      JSON.stringify({ name: 'x', version: '1.0.0', lockfileVersion: 3, packages: { '': {} } }),
    );

    try {
      const { log, events } = createFakeLog();
      await installRun({
        app: { name: 'lockfile-app', nodeVersion: '20' },
        config: { APPS_DIR: appsDir },
        log,
        state: { appDir },
        step: { type: 'install', config: {} },
        stepId: 'install',
      });
      const cmdEvent = events.find((e) => e.method === 'cmd');
      assert.equal(cmdEvent.text, 'npm ci');
    } finally {
      await fsp.rm(appsDir, { recursive: true, force: true });
    }
  });
});

test('install step respects an explicit configured command', async () => {
  await withShims(async () => {
    const appsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-install-'));
    const appDir = path.join(appsDir, 'custom-install');
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
    try {
      const { log, events } = createFakeLog();
      await installRun({
        app: { name: 'custom-install', nodeVersion: '20' },
        config: { APPS_DIR: appsDir },
        log,
        state: { appDir },
        step: { type: 'install', config: { command: 'npm install --omit=dev' } },
        stepId: 'install',
      });
      const cmdEvent = events.find((e) => e.method === 'cmd');
      assert.equal(cmdEvent.text, 'npm install --omit=dev');
    } finally {
      await fsp.rm(appsDir, { recursive: true, force: true });
    }
  });
});

// --- pm2 + healthCheck end-to-end against the shim-launched fixture --------

test('gitSync -> writeEnv -> pm2 -> healthCheck brings the fixture app up healthy', async () => {
  await withShims(async () => {
    const fixture = await createGitFixture();
    const appsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-pipeline-'));
    const app = {
      name: 'fixture-app',
      port: 4601,
      nodeVersion: '20',
      repoFullName: fixture.repoFullName,
      branch: 'main',
    };
    const config = { APPS_DIR: appsDir, GIT_REMOTE_BASE: fixture.remoteBase, GITHUB_TOKEN: undefined };
    const state = {};
    const { log } = createFakeLog();

    try {
      await gitSyncRun({ app, config, log, state, stepId: 'gitSync' });
      assert.ok(fs.existsSync(path.join(state.appDir, 'server.js')));

      await writeEnvRun({
        app,
        env: { GREETING: 'hello-pipeline' },
        config,
        log,
        state,
        step: { type: 'writeEnv', config: {} },
        stepId: 'writeEnv',
      });

      await pm2Run({
        app,
        env: { GREETING: 'hello-pipeline' },
        config,
        log,
        state,
        step: { type: 'pm2', config: { command: 'node server.js' } },
        stepId: 'pm2',
      });

      const result = await healthCheckRun({
        app,
        config,
        log,
        state,
        step: { type: 'healthCheck', config: { path: '/health', timeoutSec: 10, intervalSec: 1 } },
        stepId: 'healthCheck',
      });

      assert.equal(result.ok, true);
      assert.equal(result.statusCode, 200);

      const res = await fetch(`http://127.0.0.1:${app.port}/`);
      assert.equal(await res.text(), 'hello-pipeline');
    } finally {
      await pm2Service.remove(pm2Service.pm2Name(app.name)).catch(() => {});
      await fixture.cleanup();
      await fsp.rm(appsDir, { recursive: true, force: true });
    }
  });
});

test('healthCheck returns ok:false (not a throw) when nothing is listening', async () => {
  await withShims(async () => {
    const { log } = createFakeLog();
    const result = await healthCheckRun({
      app: { name: 'nothing-here', port: 5999 },
      config: {},
      log,
      state: {},
      step: { type: 'healthCheck', config: { path: '/', timeoutSec: 2, intervalSec: 1 } },
      stepId: 'healthCheck',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'timed out');
  });
});

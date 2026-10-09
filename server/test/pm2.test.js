import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as pm2Service from '../src/services/pm2.js';
import { createShims, patchProcessEnv } from './helpers/shims.js';
import { createGitFixture } from './helpers/gitFixture.js';

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

test('pm2Name and ecosystemPath', () => {
  assert.equal(pm2Service.pm2Name('my-app'), 'app-my-app');
  assert.equal(pm2Service.ecosystemPath('/apps/my-app'), '/apps/my-app/ecosystem.config.cjs');
  assert.equal(pm2Service.ecosystemPath('/apps/my-app/apps/web'), '/apps/my-app/apps/web/ecosystem.config.cjs');
});

test('writeEcosystem tokenizes the start command and writes mode-600 JSON-ish cjs', async () => {
  const appsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-appsdir-'));
  const appDir = path.join(appsDir, 'my-app');
  await fs.mkdir(appDir, { recursive: true });

  const app = { name: 'my-app', port: 4001 };
  const filePath = await pm2Service.writeEcosystem(app, {
    env: { GREETING: 'hi' },
    binDir: '/opt/fnm/node-versions/v20/installation/bin',
    appsDir,
    startCommand: 'npm start',
  });

  const stat = await fs.stat(filePath);
  assert.equal(stat.mode & 0o777, 0o600);

  const text = await fs.readFile(filePath, 'utf8');
  assert.match(text, /module\.exports = /);
  assert.match(text, /"script": "npm"/);
  assert.match(text, /"start"/);
  assert.match(text, /"PORT": "4001"/);
  assert.match(text, /"GREETING": "hi"/);
  assert.match(text, /"interpreter": "none"/);
  assert.match(text, /node-versions\/v20\/installation\/bin/);

  await fs.rm(appsDir, { recursive: true, force: true });
});

test('writeEcosystem runs inside the app root directory and lands the file there', async () => {
  const appsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-appsdir-'));
  const workDir = path.join(appsDir, 'mono', 'apps', 'web');
  await fs.mkdir(workDir, { recursive: true });
  try {
    const app = { name: 'mono', port: 4002, rootDir: 'apps/web' };
    const filePath = await pm2Service.writeEcosystem(app, { appsDir, startCommand: 'node server.js' });
    assert.equal(filePath, path.join(workDir, 'ecosystem.config.cjs'));
    assert.equal((await pm2Service.readEcosystem(filePath)).cwd, workDir);
  } finally {
    await fs.rm(appsDir, { recursive: true, force: true });
  }
});

test('readEcosystem round-trips what writeEcosystem wrote and returns null for missing or garbage files', async () => {
  const appsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-appsdir-'));
  await fs.mkdir(path.join(appsDir, 'my-app'), { recursive: true });

  const app = { name: 'my-app', port: 4002 };
  const filePath = await pm2Service.writeEcosystem(app, {
    env: { GREETING: 'hi' },
    binDir: '/opt/node/bin',
    appsDir,
    startCommand: 'node dist/server.js --flag',
  });

  const eco = await pm2Service.readEcosystem(filePath);
  assert.equal(eco.name, 'app-my-app');
  assert.equal(eco.script, 'node');
  assert.deepEqual(eco.args, ['dist/server.js', '--flag']);
  assert.equal(eco.cwd, path.join(appsDir, 'my-app'));
  assert.equal(eco.env.GREETING, 'hi');
  assert.ok(eco.env.PATH.startsWith('/opt/node/bin'));

  assert.equal(await pm2Service.readEcosystem(path.join(appsDir, 'nope', 'ecosystem.config.cjs')), null);
  const garbage = path.join(appsDir, 'garbage.cjs');
  await fs.writeFile(garbage, 'module.exports = {not json');
  assert.equal(await pm2Service.readEcosystem(garbage), null);

  await fs.rm(appsDir, { recursive: true, force: true });
});

test('describeDefinitionChange reports start command, cwd and node version changes', () => {
  const base = { script: 'npm', args: ['start'], cwd: '/apps/x', env: { PATH: '/v20/bin:/usr/bin', PORT: '4000' } };
  assert.equal(pm2Service.describeDefinitionChange(base, { ...base, env: { PATH: '/v20/bin:/usr/bin', PORT: '4001', FOO: 'bar' } }), null);
  assert.equal(pm2Service.describeDefinitionChange(base, { ...base, script: 'node', args: ['server.js'] }), 'start command changed');
  assert.equal(pm2Service.describeDefinitionChange(base, { ...base, args: ['run', 'prod'] }), 'start command changed');
  assert.equal(pm2Service.describeDefinitionChange(base, { ...base, cwd: '/apps/y' }), 'working directory changed');
  assert.equal(
    pm2Service.describeDefinitionChange(base, { ...base, env: { PATH: '/v22/bin:/usr/bin' } }),
    'node version changed',
  );
  assert.ok(pm2Service.describeDefinitionChange(null, base));
});

test('startOrReload launches the fixture app and jlist reports it online', async () => {
  await withShims(async () => {
    const fixture = await createGitFixture();
    try {
      const appsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-appsdir-'));
      const appDir = path.join(appsDir, 'fixture-app');
      await fs.cp(fixture.seedDir, appDir, { recursive: true, filter: (src) => !src.includes('/.git') });

      const app = { name: 'fixture-app', port: 4501 };
      const ecoPath = await pm2Service.writeEcosystem(app, {
        env: { GREETING: 'hello-from-pm2-test' },
        binDir: undefined,
        appsDir,
        startCommand: 'node server.js',
      });

      await pm2Service.startOrReload(ecoPath);
      const list = await pm2Service.jlist();
      const proc = list[pm2Service.pm2Name('fixture-app')];
      assert.ok(proc, 'process should be tracked by jlist');
      assert.equal(proc.pm2_env.status, 'online');
      assert.equal(typeof proc.pid, 'number');

      // give the fixture http server a moment to bind
      await new Promise((resolve) => setTimeout(resolve, 300));
      const res = await fetch(`http://127.0.0.1:4501/`);
      const bodyText = await res.text();
      assert.equal(res.status, 200);
      assert.equal(bodyText, 'hello-from-pm2-test');

      await pm2Service.remove(pm2Service.pm2Name('fixture-app'));
      await fs.rm(appsDir, { recursive: true, force: true });
    } finally {
      await fixture.cleanup();
    }
  });
});

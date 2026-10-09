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
  assert.equal(pm2Service.ecosystemPath('/apps', 'my-app'), '/apps/my-app/ecosystem.config.cjs');
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

test('splitLogs separates stdout from stderr and strips ANSI colours and pm2 prefixes', () => {
  const raw = [
    '\x1b[90m[TAILING] Tailing last 200 lines for [app-x] process\x1b[39m',
    '/home/u/.pm2/logs/app-x-out.log last 200 lines:',
    '\x1b[32m3|app-x  | \x1b[39mServer is running on port 5001',
    '\x1b[32m3|app-x  | \x1b[39mconnected to database',
    '',
    '/home/u/.pm2/logs/app-x-error.log last 200 lines:',
    '\x1b[32m3|app-x  | \x1b[39mError: boom',
    '',
  ].join('\n');
  assert.deepEqual(pm2Service.splitLogs(raw), {
    out: 'Server is running on port 5001\nconnected to database',
    err: 'Error: boom',
  });
});

test('splitLogs treats output without log sections as stdout', () => {
  assert.deepEqual(pm2Service.splitLogs('just some text\n'), { out: 'just some text', err: '' });
  assert.deepEqual(pm2Service.splitLogs(''), { out: '', err: '' });
});

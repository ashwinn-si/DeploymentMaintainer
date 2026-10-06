import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyProject, planStaticBuild } from '../src/lib/frontend.js';
import { resolveStaticDir } from '../src/steps/publish.js';

const pkg = (extra) => ({ name: 'x', ...extra });

test('classifyProject: plain html repo', () => {
  assert.equal(classifyProject({ pkg: null, hasIndexHtml: true }).type, 'static-html');
  assert.equal(classifyProject({ pkg: null, hasIndexHtml: false }).type, 'unknown');
});

test('classifyProject: frontend frameworks and their output dirs', () => {
  const vite = classifyProject({ pkg: pkg({ devDependencies: { vite: '^5', react: '^18' }, scripts: { build: 'vite build' } }) });
  assert.equal(vite.type, 'frontend');
  assert.equal(vite.framework.id, 'vite');
  assert.equal(vite.outputDir, 'dist');
  assert.equal(vite.baseSupport, 'auto');

  const cra = classifyProject({ pkg: pkg({ dependencies: { 'react-scripts': '5' }, scripts: { start: 'react-scripts start', build: 'react-scripts build' } }) });
  assert.equal(cra.type, 'frontend');
  assert.equal(cra.outputDir, 'build');

  const astro = classifyProject({ pkg: pkg({ dependencies: { astro: '4' }, devDependencies: { vite: '5' } }) });
  assert.equal(astro.framework.id, 'astro', 'astro must win over the vite it bundles');

  const vue = classifyProject({ pkg: pkg({ devDependencies: { '@vue/cli-service': '5' } }) });
  assert.equal(vue.baseSupport, 'manual');
});

test('classifyProject: servers and SSR frameworks need a process', () => {
  assert.equal(classifyProject({ pkg: pkg({ dependencies: { express: '4' }, scripts: { start: 'node server.js' } }) }).type, 'node-server');
  const next = classifyProject({ pkg: pkg({ dependencies: { next: '14', react: '18' }, scripts: { build: 'next build' } }) });
  assert.equal(next.type, 'node-server');
  assert.match(next.reasons[0], /Next\.js/);
});

test('classifyProject: express plus a vite build is a node server, with a hint', () => {
  const r = classifyProject({ pkg: pkg({ dependencies: { express: '4' }, devDependencies: { vite: '5' }, scripts: { start: 'node s.js', build: 'vite build' } }) });
  assert.equal(r.type, 'node-server');
  assert.ok(r.reasons.some((x) => /Frontend app/.test(x)));
});

test('classifyProject: generic build-only and start-only packages', () => {
  assert.equal(classifyProject({ pkg: pkg({ scripts: { build: 'webpack' } }) }).type, 'frontend');
  assert.equal(classifyProject({ pkg: pkg({ scripts: { start: 'node index.js' } }) }).type, 'node-server');
  assert.equal(classifyProject({ pkg: pkg({}), hasIndexHtml: true }).type, 'static-html');
});

test('planStaticBuild adds --base for Vite and Astro, PUBLIC_URL for CRA', () => {
  const vite = planStaticBuild({ command: 'npm run build', pkg: { devDependencies: { vite: '5' } }, routePath: '/site' });
  assert.equal(vite.command, 'npm run build -- --base=/site/');
  assert.equal(vite.env.BASE_PATH, '/site/');
  assert.equal(vite.env.PUBLIC_URL, '/site');

  const astro = planStaticBuild({ command: 'npm run build', pkg: { dependencies: { astro: '4' } }, routePath: '/docs/' });
  assert.equal(astro.command, 'npm run build -- --base=/docs/');

  const cra = planStaticBuild({ command: 'npm run build', pkg: { dependencies: { 'react-scripts': '5' } }, routePath: '/site' });
  assert.equal(cra.command, 'npm run build');
  assert.ok(cra.notes.some((n) => /PUBLIC_URL=\/site/.test(n)));
});

test('planStaticBuild leaves custom commands alone and warns', () => {
  const custom = planStaticBuild({ command: 'npm run build:prod', pkg: { devDependencies: { vite: '5' } }, routePath: '/site' });
  assert.equal(custom.command, 'npm run build:prod');
  assert.ok(custom.notes.some((n) => /404/.test(n)));

  const own = planStaticBuild({ command: 'npx vite build --base=/custom/', pkg: { devDependencies: { vite: '5' } }, routePath: '/site' });
  assert.equal(own.command, 'npx vite build --base=/custom/');

  const unknown = planStaticBuild({ command: 'npm run build', pkg: null, routePath: '/site' });
  assert.ok(unknown.notes.some((n) => /unknown framework/.test(n)));
});

test('resolveStaticDir auto-detects the build output, and fails clearly when there is none', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-static-'));
  try {
    assert.equal(await resolveStaticDir(dir, 'dist', { buildEnabled: true }), 'dist', 'explicit dirs pass through');
    await assert.rejects(() => resolveStaticDir(dir, 'auto', { buildEnabled: true }), /no index\.html found in dist, build, out/);

    await fs.mkdir(path.join(dir, 'build'));
    await fs.writeFile(path.join(dir, 'build', 'index.html'), 'x');
    assert.equal(await resolveStaticDir(dir, 'auto', { buildEnabled: true }), 'build');

    await assert.rejects(() => resolveStaticDir(dir, 'auto', { buildEnabled: false }), /no index\.html found in \./);
    await fs.writeFile(path.join(dir, 'index.html'), 'x');
    assert.equal(await resolveStaticDir(dir, 'auto', { buildEnabled: false }), '.');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

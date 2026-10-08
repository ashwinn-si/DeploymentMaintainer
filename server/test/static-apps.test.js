import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestServer } from './helpers/testServer.js';
import { disconnectTestDB, clearTestDB } from './helpers/db.js';
import { defaultSteps, normalizeSteps } from '../src/steps/index.js';
import { renderLocation } from '../src/services/nginx.js';
import { checkPublished, getPublishedAppCurrentDir } from '../src/steps/publish.js';
import { HttpError } from '../src/lib/httpError.js';

test.after(disconnectTestDB);

// --- step validation ------------------------------------------------------------

test('defaultSteps(static) publishes then routes, with no pm2 step enabled', () => {
  const steps = defaultSteps('site', 'static');
  const types = steps.map((s) => s.type);
  assert.ok(types.indexOf('publish') < types.indexOf('nginx'));
  assert.ok(types.indexOf('nginx') < types.indexOf('healthCheck'), 'health check must run after the route exists');
  assert.equal(steps.find((s) => s.type === 'pm2'), undefined);
});

test('normalizeSteps lets a static app turn nodeSetup off, but a node app cannot', () => {
  const staticSteps = normalizeSteps(defaultSteps('site', 'static'), { kind: 'static' });
  assert.equal(staticSteps.find((s) => s.type === 'nodeSetup').enabled, false);

  const nodeSteps = defaultSteps('svc').map((s) => (s.type === 'nodeSetup' ? { ...s, enabled: false } : s));
  assert.equal(normalizeSteps(nodeSteps).find((s) => s.type === 'nodeSetup').enabled, true);
});

test('normalizeSteps rejects static pipelines that cannot serve the site', () => {
  const base = defaultSteps('site', 'static');
  const without = (type) => base.map((s) => (s.type === type ? { ...s, enabled: false } : s));
  assert.throws(() => normalizeSteps(without('publish'), { kind: 'static' }), HttpError);
  assert.throws(() => normalizeSteps(without('nginx'), { kind: 'static' }), HttpError);
  const withPm2 = [...base, { type: 'pm2', enabled: true, config: {} }];
  assert.throws(() => normalizeSteps(withPm2, { kind: 'static' }), HttpError);
});

test('static step configs reject a traversing staticDir', () => {
  const steps = defaultSteps('site', 'static').map((s) => (s.type === 'publish' ? { ...s, config: { staticDir: '../../etc' } } : s));
  assert.throws(() => normalizeSteps(steps, { kind: 'static' }), HttpError);
});

// --- nginx rendering ------------------------------------------------------------

test('renderLocation(serveStatic) emits alias + SPA fallback and no proxy_pass', () => {
  const out = renderLocation({ path: '/site', serveStatic: true, publishedDir: '/var/www/deployer/site/current' });
  assert.match(out, /location = \/site \{\s+return 301 \/site\/;/);
  assert.match(out, /location \/site\/ \{/);
  assert.match(out, /alias \/var\/www\/deployer\/site\/current\/;/);
  assert.match(out, /try_files \$uri \$uri\/ \/site\/index\.html;/);
  assert.doesNotMatch(out, /proxy_pass/);
});

// --- checkPublished -------------------------------------------------------------

test('checkPublished finds index.html, nested files and refuses to escape the site root', async () => {
  const server = await setupTestServer();
  try {
    const dir = getPublishedAppCurrentDir(server.config, 'site');
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>x</h1>');
    fs.writeFileSync(path.join(dir, 'docs', 'index.html'), '<h1>docs</h1>');
    fs.writeFileSync(path.join(server.publishedDir, 'secret.txt'), 'nope');

    assert.equal((await checkPublished(server.config, 'site', '/')).ok, true);
    assert.equal((await checkPublished(server.config, 'site', '/docs')).ok, true);
    assert.equal((await checkPublished(server.config, 'site', '/missing')).ok, false);
    assert.equal((await checkPublished(server.config, 'site', '/../../secret.txt')).ok, false);
  } finally {
    await server.cleanup();
  }
});

// --- end to end -----------------------------------------------------------------

async function waitForDeployment(agent, id, { timeoutMs = 25000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await agent.get(`/api/deployments/${id}`);
    if (['success', 'failed', 'cancelled'].includes(res.body.deployment.status)) return res.body.deployment;
    if (Date.now() > deadline) throw new Error('deployment did not finish in time');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

test('a static app deploys without a port or PM2, publishes a clean release and cleans up on delete', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    fixture.createBranchFrom('static-site', 'main', { filename: 'index.html', content: '<h1>hello</h1>' });
    fixture.addCommit('static-site', { filename: '.env', content: 'SECRET=1' });

    const defaults = await agent.get('/api/apps/defaults?name=site&kind=static');
    assert.equal(defaults.status, 200);
    assert.equal(defaults.body.kind, 'static');
    assert.equal(defaults.body.port, null);

    const withPort = await agent.post('/api/apps').send({
      name: 'site', kind: 'static', repoFullName: fixture.repoFullName, branch: 'static-site',
      nodeVersion: '20', port: config.APP_PORT_START + 5, steps: defaults.body.steps,
    });
    assert.equal(withPort.status, 400, 'static apps must not accept a port');

    const created = await agent.post('/api/apps').send({
      name: 'site', kind: 'static', repoFullName: fixture.repoFullName, branch: 'static-site',
      nodeVersion: '20', env: [], steps: defaults.body.steps,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const app = created.body.app;
    assert.equal(app.kind, 'static');
    assert.equal(app.port, null);

    const deploy = await agent.post(`/api/apps/${app.id}/deploy`).send({ mode: 'update' });
    assert.equal(deploy.status, 200, JSON.stringify(deploy.body));
    const finished = await waitForDeployment(agent, deploy.body.deployment.id);
    assert.equal(finished.status, 'success', finished.error);

    const current = getPublishedAppCurrentDir(config, 'site');
    assert.equal(fs.readFileSync(path.join(current, 'index.html'), 'utf8'), '<h1>hello</h1>');
    assert.equal(fs.existsSync(path.join(current, '.git')), false, '.git must never be published');
    assert.equal(fs.existsSync(path.join(current, '.env')), false, '.env must never be published');

    const detail = await agent.get(`/api/apps/${app.id}`);
    assert.equal(detail.body.app.status, 'online');

    assert.equal((await agent.post(`/api/apps/${app.id}/restart`)).status, 409);
    assert.equal((await agent.post(`/api/apps/${app.id}/stop`)).status, 409);
    const logs = await agent.get(`/api/apps/${app.id}/logs`);
    assert.equal(logs.status, 200);

    const ports = await agent.get('/api/ports');
    const siteRow = ports.body.rows.find((r) => r.appName === 'site');
    assert.equal(siteRow?.kind, 'static');
    assert.equal(siteRow?.port, null);

    const del = await agent.delete(`/api/apps/${app.id}`).send({ confirmName: 'site' });
    assert.equal(del.status, 200);
    assert.equal(fs.existsSync(path.join(server.publishedDir, 'site')), false);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('a static deploy fails clearly when the site has no index.html', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture } = server;
    const steps = defaultSteps('empty-site', 'static');
    const created = await agent.post('/api/apps').send({
      name: 'empty-site', kind: 'static', repoFullName: fixture.repoFullName, branch: 'main',
      nodeVersion: '20', env: [], steps,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const deploy = await agent.post(`/api/apps/${created.body.app.id}/deploy`).send({ mode: 'update' });
    const finished = await waitForDeployment(agent, deploy.body.deployment.id);
    assert.equal(finished.status, 'failed');
    assert.match(finished.error, /index\.html not found/);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('a frontend (build) app builds with its base path, then publishes the auto-detected output', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    fixture.createBranchFrom('frontend-site', 'main', {
      filename: 'package.json',
      content: JSON.stringify({ name: 'spa', private: true, scripts: { build: 'node build.js' } }),
    });
    fixture.addCommit('frontend-site', {
      filename: 'build.js',
      content: "const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html','<base href=\"'+process.env.BASE_PATH+'\">'+(process.env.VITE_GREETING||''));",
    });

    const defaults = await agent.get('/api/apps/defaults?name=spa&kind=static&preset=frontend');
    assert.equal(defaults.body.steps.find((s) => s.type === 'build').enabled, true);
    assert.equal(defaults.body.steps.find((s) => s.type === 'publish').config.staticDir, 'auto');

    const created = await agent.post('/api/apps').send({
      name: 'spa', kind: 'static', repoFullName: fixture.repoFullName, branch: 'frontend-site',
      nodeVersion: '20', env: [{ key: 'VITE_GREETING', value: 'built-with-env' }], steps: defaults.body.steps,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const deploy = await agent.post(`/api/apps/${created.body.app.id}/deploy`).send({ mode: 'update' });
    const finished = await waitForDeployment(agent, deploy.body.deployment.id, { timeoutMs: 40000 });
    assert.equal(finished.status, 'success', finished.error);

    const html = fs.readFileSync(path.join(getPublishedAppCurrentDir(config, 'spa'), 'index.html'), 'utf8');
    assert.match(html, /<base href="\/spa\/">/, 'the build must see BASE_PATH=/spa/');
    assert.match(html, /built-with-env/, 'app env must reach the build');

    const entries = await agent.get(`/api/deployments/${deploy.body.deployment.id}/entries`);
    const text = entries.body.entries.map((e) => e.text).join('\n');
    assert.match(text, /auto-detected output directory: dist/);
    assert.doesNotMatch(text, /PORT=null/);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('GET /repos/:owner/:repo/detect-project requires a ref and a token', async () => {
  const server = await setupTestServer();
  try {
    const noRef = await server.agent.get('/api/repos/octo/site/detect-project');
    assert.equal(noRef.status, 400);
    const noToken = await server.agent.get('/api/repos/octo/site/detect-project?ref=main');
    assert.equal(noToken.status, 503);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('publish never copies symlinks out of the repo', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    fixture.createBranchFrom('link-site', 'main', { filename: 'index.html', content: '<h1>x</h1>' });
    const linkTarget = path.join(server.publishedDir, 'outside-secret.txt');
    fs.writeFileSync(linkTarget, 'SECRET');
    // The fixture can't hold absolute links portably, so plant one in the cloned checkout after gitSync.
    const created = await agent.post('/api/apps').send({
      name: 'link-site', kind: 'static', repoFullName: fixture.repoFullName, branch: 'link-site',
      nodeVersion: '20', env: [], steps: defaultSteps('link-site', 'static'),
    });
    const appDir = path.join(config.APPS_DIR, 'link-site');
    // Deploy once to clone, then add the link and republish.
    const first = await agent.post(`/api/apps/${created.body.app.id}/deploy`).send({ mode: 'update' });
    assert.equal((await waitForDeployment(agent, first.body.deployment.id)).status, 'success');
    fs.symlinkSync(linkTarget, path.join(appDir, 'leak.txt'));
    fs.writeFileSync(path.join(appDir, 'untracked-note.txt'), 'kept');
    const { run } = await import('../src/steps/publish.js');
    const logs = [];
    await run({
      app: { name: 'link-site', steps: [] }, deployment: { _id: 'manual-release' }, config,
      log: { info: (t) => logs.push(t) }, step: { config: { staticDir: '.' } }, stepId: 'x',
    });
    const current = getPublishedAppCurrentDir(config, 'link-site');
    assert.equal(fs.existsSync(path.join(current, 'leak.txt')), false, 'symlink must not be published');
    assert.equal(fs.readFileSync(path.join(current, 'untracked-note.txt'), 'utf8'), 'kept');
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('findDirNginxCannotTraverse flags a directory that is not world-executable', async () => {
  const { findDirNginxCannotTraverse } = await import('../src/steps/publish.js');
  const os = await import('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-perm-'));
  const inner = path.join(root, 'private', 'site');
  fs.mkdirSync(inner, { recursive: true });
  try {
    fs.chmodSync(path.join(root, 'private'), 0o750);
    const blocked = await findDirNginxCannotTraverse(inner);
    assert.equal(blocked, fs.realpathSync(path.join(root, 'private')));
    fs.chmodSync(path.join(root, 'private'), 0o755);
    // mkdtemp roots are 0700 on most systems, so only assert the 750 dir stopped being the culprit.
    assert.notEqual(await findDirNginxCannotTraverse(inner), fs.realpathSync(path.join(root, 'private')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('two apps cannot share an Nginx path; duplicates get their own', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const body = (name, steps) => ({
      name, repoFullName: fixture.repoFullName, branch: 'main', nodeVersion: '20', env: [], steps,
      port: config.APP_PORT_START + 80 + Math.floor(Math.random() * 1000),
    });
    const withPath = (name, p) => defaultSteps(name).map((s) => (s.type === 'nginx' ? { ...s, config: { ...s.config, path: p } } : s));

    const first = await agent.post('/api/apps').send(body('route-a', withPath('route-a', '/shared')));
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const clash = await agent.post('/api/apps').send(body('route-b', withPath('route-b', '/shared')));
    assert.equal(clash.status, 409);
    assert.match(clash.body.error, /already used by app "route-a"/);

    const other = await agent.post('/api/apps').send(body('route-c', withPath('route-c', '/route-c')));
    assert.equal(other.status, 201);
    const patch = await agent.patch(`/api/apps/${other.body.app.id}`).send({ steps: withPath('route-c', '/shared') });
    assert.equal(patch.status, 409, 'editing steps onto a taken path must fail');
    const selfPatch = await agent.patch(`/api/apps/${first.body.app.id}`).send({ steps: withPath('route-a', '/shared') });
    assert.equal(selfPatch.status, 200, 'an app may keep its own path');

    const dup = await agent.post(`/api/apps/${first.body.app.id}/duplicate`).send({ name: 'route-a-copy', branch: 'main', copyEnv: false });
    assert.equal(dup.status, 201, JSON.stringify(dup.body));
    assert.equal(dup.body.app.path, '/route-a-copy', 'a duplicate must not inherit the original path');
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('duplicating a static app needs no port and gets its own path', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture } = server;
    const created = await agent.post('/api/apps').send({
      name: 'site-one', kind: 'static', repoFullName: fixture.repoFullName, branch: 'main',
      nodeVersion: '20', env: [], steps: defaultSteps('site-one', 'static'),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const dup = await agent.post(`/api/apps/${created.body.app.id}/duplicate`).send({ name: 'site-two', branch: 'main', copyEnv: false });
    assert.equal(dup.status, 201, JSON.stringify(dup.body));
    assert.equal(dup.body.app.kind, 'static');
    assert.equal(dup.body.app.port, null);
    assert.equal(dup.body.app.path, '/site-two');
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

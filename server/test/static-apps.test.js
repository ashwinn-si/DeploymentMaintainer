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
    assert.equal(ports.body.rows.some((r) => r.appName === 'site'), false);

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

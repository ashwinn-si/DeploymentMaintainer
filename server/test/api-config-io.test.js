import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestServer } from './helpers/testServer.js';
import { disconnectTestDB, clearTestDB } from './helpers/db.js';
import { defaultSteps } from '../src/steps/index.js';
import App from '../src/models/App.js';

function stepsFor(name) {
  return defaultSteps(name).map((s) => (s.type === 'pm2' ? { ...s, config: { command: 'node server.js' } } : s));
}

function createAppBody(fixture, config, overrides = {}) {
  return {
    name: overrides.name,
    repoFullName: fixture.repoFullName,
    branch: 'main',
    nodeVersion: '20',
    env: [{ key: 'GREETING', value: 'hello' }],
    steps: stepsFor(overrides.name),
    port: config.APP_PORT_START + (overrides.portOffset ?? 0),
    ...overrides,
  };
}

test.after(disconnectTestDB);

test('export -> delete -> import round trip preserves env; a wrong passphrase is rejected with 400', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, {
      name: 'cfg-app',
      portOffset: 300,
      env: [{ key: 'GREETING', value: 'exported-value' }],
    }));
    assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
    const app = createRes.body.app;

    const exportRes = await agent.post('/api/config/export').send({ appIds: [app.id], passphrase: 'export-passphrase' });
    assert.equal(exportRes.status, 200);
    assert.match(exportRes.headers['content-disposition'], /attachment; filename="deployer-config-\d{4}-\d{2}-\d{2}\.json"/);
    const file = exportRes.body;
    assert.equal(file.format, 'deployment-maintainer');
    assert.equal(file.version, 2);
    assert.equal(file.apps[0].rootDir, '');
    assert.equal(file.apps[0].stagedDeploys, true);
    assert.equal(file.apps.length, 1);
    assert.equal(file.apps[0].name, 'cfg-app');
    assert.equal(file.apps[0].port, app.port);
    assert.ok(file.apps[0].env.salt, 'env should be passphrase-encrypted, not plaintext');

    const wrongPass = await agent.post('/api/config/import/preview').send({ file, passphrase: 'not-the-passphrase' });
    assert.equal(wrongPass.status, 400);
    assert.match(wrongPass.body.error, /wrong passphrase/i);

    const wrongPassApply = await agent.post('/api/config/import').send({ file, passphrase: 'not-the-passphrase', rows: [{ name: 'cfg-app', action: 'create' }] });
    assert.equal(wrongPassApply.status, 400);

    const delRes = await agent.delete(`/api/apps/${app.id}`).send({ confirmName: 'cfg-app' });
    assert.equal(delRes.status, 200);

    const previewRes = await agent.post('/api/config/import/preview').send({ file, passphrase: 'export-passphrase' });
    assert.equal(previewRes.status, 200, JSON.stringify(previewRes.body));
    assert.equal(previewRes.body.rows.length, 1);
    assert.equal(previewRes.body.rows[0].conflict, null);
    assert.equal(previewRes.body.rows[0].name, 'cfg-app');

    const importRes = await agent.post('/api/config/import').send({
      file,
      passphrase: 'export-passphrase',
      rows: [{ name: 'cfg-app', action: 'create' }],
    });
    assert.equal(importRes.status, 200, JSON.stringify(importRes.body));
    assert.equal(importRes.body.created.length, 1);
    assert.equal(importRes.body.deployments.length, 0);
    const restored = importRes.body.created[0];
    assert.equal(restored.name, 'cfg-app');
    assert.equal(restored.status, 'not_deployed');
    assert.equal(restored.port, app.port);

    const detail = await agent.get(`/api/apps/${restored.id}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.app.env, [{ key: 'GREETING', value: 'exported-value' }]);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('a name conflict is flagged with a suggested name in preview and cleared by renaming on apply', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const existingRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'cfg-existing', portOffset: 310 }));
    const existingApp = existingRes.body.app;

    const exportRes = await agent.post('/api/config/export').send({ appIds: [existingApp.id], passphrase: 'pw12345678' });
    const file = exportRes.body;

    // The app still exists in the DB under its original name, so importing the
    // exact same export is a self-conflict.
    const previewRes = await agent.post('/api/config/import/preview').send({ file, passphrase: 'pw12345678' });
    assert.equal(previewRes.status, 200);
    const row = previewRes.body.rows[0];
    assert.equal(row.conflict, 'name');
    assert.equal(row.suggestedName, 'cfg-existing-imported');

    const importRes = await agent.post('/api/config/import').send({
      file,
      passphrase: 'pw12345678',
      rows: [{ name: 'cfg-existing', action: 'create', newName: row.suggestedName }],
    });
    assert.equal(importRes.status, 200, JSON.stringify(importRes.body));
    assert.equal(importRes.body.created[0].name, 'cfg-existing-imported');
    // The nginx step's default path (/cfg-existing) should follow the rename.
    const detail = await agent.get(`/api/apps/${importRes.body.created[0].id}`);
    const nginxStep = detail.body.app.steps.find((s) => s.type === 'nginx');
    assert.equal(nginxStep.config.path, '/cfg-existing-imported');
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('a port conflict is flagged in preview and a fresh port is allocated automatically on import', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const portOffset = 330;
    const takenPort = config.APP_PORT_START + portOffset;

    const appARes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'cfg-porta', portOffset }));
    const appA = appARes.body.app;
    const exportRes = await agent.post('/api/config/export').send({ appIds: [appA.id], passphrase: 'pw12345678' });
    const file = exportRes.body;

    await agent.delete(`/api/apps/${appA.id}`).send({ confirmName: 'cfg-porta' });
    const appBRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'cfg-portb', port: takenPort }));
    assert.equal(appBRes.status, 201, JSON.stringify(appBRes.body));

    const previewRes = await agent.post('/api/config/import/preview').send({ file, passphrase: 'pw12345678' });
    assert.equal(previewRes.status, 200);
    assert.equal(previewRes.body.rows[0].conflict, 'port');

    const importRes = await agent.post('/api/config/import').send({
      file,
      passphrase: 'pw12345678',
      rows: [{ name: 'cfg-porta', action: 'create' }],
    });
    assert.equal(importRes.status, 200, JSON.stringify(importRes.body));
    assert.equal(importRes.body.created[0].name, 'cfg-porta');
    assert.notEqual(importRes.body.created[0].port, takenPort);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('one invalid row aborts the whole import — nothing is created', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const app1Res = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'cfg-valid', portOffset: 340 }));
    const app2Res = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'cfg-badrow', portOffset: 341 }));
    const app1 = app1Res.body.app;
    const app2 = app2Res.body.app;

    const exportRes = await agent.post('/api/config/export').send({ appIds: [app1.id, app2.id], passphrase: 'pw12345678' });
    const file = exportRes.body;

    await agent.delete(`/api/apps/${app1.id}`).send({ confirmName: 'cfg-valid' });
    await agent.delete(`/api/apps/${app2.id}`).send({ confirmName: 'cfg-badrow' });

    const importRes = await agent.post('/api/config/import').send({
      file,
      passphrase: 'pw12345678',
      rows: [
        { name: 'cfg-valid', action: 'create' },
        { name: 'cfg-badrow', action: 'create', newName: 'Not A Valid Slug!' },
      ],
    });
    assert.equal(importRes.status, 400);

    const remaining = await App.find({ name: { $in: ['cfg-valid', 'cfg-badrow', 'Not A Valid Slug!'] } }).lean();
    assert.equal(remaining.length, 0, 'nothing should have been created when one row is invalid');
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('a skipped row is not created and does not block the rest of the import', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const app1Res = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'cfg-keep', portOffset: 350 }));
    const app2Res = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'cfg-skip', portOffset: 351 }));
    const app1 = app1Res.body.app;
    const app2 = app2Res.body.app;

    const exportRes = await agent.post('/api/config/export').send({ appIds: [app1.id, app2.id], passphrase: 'pw12345678' });
    const file = exportRes.body;

    await agent.delete(`/api/apps/${app1.id}`).send({ confirmName: 'cfg-keep' });
    await agent.delete(`/api/apps/${app2.id}`).send({ confirmName: 'cfg-skip' });

    const importRes = await agent.post('/api/config/import').send({
      file,
      passphrase: 'pw12345678',
      rows: [
        { name: 'cfg-keep', action: 'create' },
        { name: 'cfg-skip', action: 'skip' },
      ],
    });
    assert.equal(importRes.status, 200, JSON.stringify(importRes.body));
    assert.equal(importRes.body.created.length, 1);
    assert.equal(importRes.body.created[0].name, 'cfg-keep');

    const skippedExists = await App.findOne({ name: 'cfg-skip' }).lean();
    assert.equal(skippedExists, null);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('export -> delete -> import round trip preserves rootDir and stagedDeploys', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, {
      name: 'cfg-root', portOffset: 360, rootDir: 'apps/web',
    }));
    assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
    const app = createRes.body.app;
    assert.equal((await agent.patch(`/api/apps/${app.id}`).send({ stagedDeploys: false })).status, 200);

    const file = (await agent.post('/api/config/export').send({ appIds: [app.id], passphrase: 'pw12345678' })).body;
    assert.equal(file.version, 2);
    assert.equal(file.apps[0].rootDir, 'apps/web');
    assert.equal(file.apps[0].stagedDeploys, false);

    await agent.delete(`/api/apps/${app.id}`).send({ confirmName: 'cfg-root' });

    const preview = await agent.post('/api/config/import/preview').send({ file, passphrase: 'pw12345678' });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.rows[0].rootDir, 'apps/web');

    const importRes = await agent.post('/api/config/import').send({ file, passphrase: 'pw12345678', rows: [{ name: 'cfg-root', action: 'create' }] });
    assert.equal(importRes.status, 200, JSON.stringify(importRes.body));
    assert.equal(importRes.body.created[0].rootDir, 'apps/web');
    assert.equal(importRes.body.created[0].stagedDeploys, false);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

test('a version-1 export without rootDir/stagedDeploys still imports, defaulting to the repo root', async () => {
  const server = await setupTestServer();
  try {
    const { agent, fixture, config } = server;
    const createRes = await agent.post('/api/apps').send(createAppBody(fixture, config, { name: 'cfg-v1', portOffset: 370 }));
    const app = createRes.body.app;
    const file = (await agent.post('/api/config/export').send({ appIds: [app.id], passphrase: 'pw12345678' })).body;
    await agent.delete(`/api/apps/${app.id}`).send({ confirmName: 'cfg-v1' });

    // Rewrite it to look like a file from before these fields existed.
    const oldFile = { ...file, version: 1, apps: file.apps.map(({ rootDir, stagedDeploys, ...rest }) => rest) };
    assert.equal('rootDir' in oldFile.apps[0], false);

    const preview = await agent.post('/api/config/import/preview').send({ file: oldFile, passphrase: 'pw12345678' });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.rows[0].rootDir, '');

    const importRes = await agent.post('/api/config/import').send({ file: oldFile, passphrase: 'pw12345678', rows: [{ name: 'cfg-v1', action: 'create' }] });
    assert.equal(importRes.status, 200, JSON.stringify(importRes.body));
    assert.equal(importRes.body.created[0].rootDir, '');
    assert.equal(importRes.body.created[0].stagedDeploys, true);

    const unknownVersion = await agent.post('/api/config/import/preview').send({ file: { ...oldFile, version: 3 }, passphrase: 'pw12345678' });
    assert.equal(unknownVersion.status, 400);

    const badRoot = { ...file, apps: file.apps.map((a) => ({ ...a, rootDir: '../x' })) };
    const rejected = await agent.post('/api/config/import').send({ file: badRoot, passphrase: 'pw12345678', rows: [{ name: 'cfg-v1', action: 'create', newName: 'cfg-v1-bad' }] });
    assert.equal(rejected.status, 400);
  } finally {
    await server.cleanup();
    await clearTestDB();
  }
});

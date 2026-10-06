import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import App from '../src/models/App.js';
import Deployment from '../src/models/Deployment.js';
import { defaultSteps } from '../src/steps/index.js';
import { connectTestDB, clearTestDB, disconnectTestDB } from './helpers/db.js';

test.before(connectTestDB);
test.after(disconnectTestDB);
test.afterEach(clearTestDB);

function makeApp(overrides = {}) {
  return {
    name: 'my-app',
    repoFullName: 'me/my-app',
    branch: 'main',
    port: 4001,
    nodeVersion: '20',
    steps: defaultSteps('my-app'),
    ...overrides,
  };
}

test('App.port is optional for static apps but required for node apps', async () => {
  await assert.rejects(() => new App({ kind: 'node' }).validate(), (err) => Boolean(err.errors.port));
  await assert.rejects(() => new App({ kind: 'static' }).validate(), (err) => !err.errors.port);
});

test('App requires name, repoFullName, branch, port, nodeVersion', async () => {
  const app = new App({});
  await assert.rejects(() => app.validate(), (err) => {
    for (const field of ['name', 'repoFullName', 'branch', 'port', 'nodeVersion']) {
      assert.ok(err.errors[field], `expected a validation error for ${field}`);
    }
    return true;
  });
});

test('App saves with defaults for status, health and steps', async () => {
  const app = await App.create(makeApp());
  assert.equal(app.status, 'not_deployed');
  assert.equal(app.health.ok, false);
  assert.equal(app.steps.length, defaultSteps('my-app').length);
  assert.equal(app.steps[0].type, 'gitSync');
  assert.equal(app.envEncrypted, null);
});

test('App enforces a unique name', async () => {
  await App.create(makeApp({ name: 'dup-app' }));
  await assert.rejects(() => App.create(makeApp({ name: 'dup-app' })), (err) => {
    assert.equal(err.code, 11000);
    return true;
  });
});

test('App.steps preserves arbitrary per-step config', async () => {
  const app = await App.create(makeApp({
    steps: [
      { type: 'gitSync', enabled: true, config: {} },
      { type: 'nodeSetup', enabled: true, config: {} },
      { type: 'custom', enabled: true, config: { label: 'Migrate', command: 'npx prisma migrate deploy' } },
    ],
  }));
  const reloaded = await App.findById(app._id).lean();
  assert.equal(reloaded.steps[2].config.command, 'npx prisma migrate deploy');
});

function makeDeployment(appId, overrides = {}) {
  return { appId, number: 1, branch: 'main', mode: 'update', nodeVersion: '20', ...overrides };
}

test('Deployment requires appId, branch and mode', async () => {
  const deployment = new Deployment({});
  await assert.rejects(() => deployment.validate(), (err) => {
    for (const field of ['appId', 'branch', 'mode']) {
      assert.ok(err.errors[field], `expected a validation error for ${field}`);
    }
    return true;
  });
});

test('Deployment rejects an unknown mode or status', async () => {
  const deployment = new Deployment(makeDeployment(new mongoose.Types.ObjectId(), { mode: 'bogus' }));
  await assert.rejects(() => deployment.validate(), (err) => {
    assert.ok(err.errors.mode);
    return true;
  });
});

test('Deployment saves with default status "queued" and empty entries/steps', async () => {
  const app = await App.create(makeApp());
  const deployment = await Deployment.create(makeDeployment(app._id));
  assert.equal(deployment.status, 'queued');
  assert.deepEqual(deployment.entries, []);
  assert.deepEqual(deployment.steps, []);
  assert.ok(deployment.createdAt);
});

test('Deployment stores ordered log entries with stream and step', async () => {
  const app = await App.create(makeApp());
  const deployment = await Deployment.create(makeDeployment(app._id));
  await Deployment.updateOne(
    { _id: deployment._id },
    { $push: { entries: { $each: [
      { i: 0, step: 'gitSync', stream: 'cmd', text: 'git clone ...' },
      { i: 1, step: 'gitSync', stream: 'stdout', text: 'Cloning into ...' },
    ] } } },
  );
  const reloaded = await Deployment.findById(deployment._id).lean();
  assert.equal(reloaded.entries.length, 2);
  assert.equal(reloaded.entries[0].stream, 'cmd');
  assert.equal(reloaded.entries[1].stream, 'stdout');
});

test('Deployment has a query index on {appId, createdAt}', () => {
  const indexes = Deployment.schema.indexes();
  const hasCompoundIndex = indexes.some(([keys]) => keys.appId === 1 && keys.createdAt === -1);
  assert.ok(hasCompoundIndex, `expected {appId:1, createdAt:-1} index, got ${JSON.stringify(indexes)}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import App from '../src/models/App.js';
import { isPortFree, allocatePort, assertPortAvailable } from '../src/services/ports.js';
import { connectTestDB, clearTestDB, disconnectTestDB } from './helpers/db.js';

test.before(connectTestDB);
test.after(disconnectTestDB);
test.afterEach(clearTestDB);

function makeApp(overrides = {}) {
  return {
    name: 'app',
    repoFullName: 'me/app',
    branch: 'main',
    port: 4001,
    nodeVersion: '20',
    ...overrides,
  };
}

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

test('isPortFree resolves true for an unused port and false once bound', async () => {
  assert.equal(await isPortFree(4700), true);
  const server = await listenOn(4700);
  try {
    assert.equal(await isPortFree(4700), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('allocatePort returns APP_PORT_START when nothing is taken', async () => {
  const config = { APP_PORT_START: 4801 };
  const port = await allocatePort(config);
  assert.equal(port, 4801);
});

test('allocatePort skips ports already used by an App', async () => {
  await App.create(makeApp({ name: 'a1', port: 4901 }));
  await App.create(makeApp({ name: 'a2', port: 4902 }));
  const config = { APP_PORT_START: 4901 };
  const port = await allocatePort(config);
  assert.equal(port, 4903);
});

test('allocatePort skips a port that is free in the DB but actually bound on the machine', async () => {
  const server = await listenOn(5001);
  try {
    const config = { APP_PORT_START: 5001 };
    const port = await allocatePort(config);
    assert.equal(port, 5002);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('assertPortAvailable rejects a port already used by another App', async () => {
  await App.create(makeApp({ name: 'taken', port: 5101 }));
  await assert.rejects(() => assertPortAvailable(5101), /already used by app "taken"/);
});

test('assertPortAvailable allows a port when excluding the app that currently holds it', async () => {
  const app = await App.create(makeApp({ name: 'self', port: 5201 }));
  await assertPortAvailable(5201, app._id);
});

test('assertPortAvailable rejects a port bound on the machine but not tracked by any App', async () => {
  const server = await listenOn(5301);
  try {
    await assert.rejects(() => assertPortAvailable(5301), /already in use on this machine/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

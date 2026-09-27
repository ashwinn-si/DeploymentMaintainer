import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureNodeVersion, nodeBinDir, listInstalled, withNode } from '../src/services/node.js';
import { createShims, patchProcessEnv } from './helpers/shims.js';

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

test('withNode builds an fnm exec tuple', () => {
  const [cmd, argv] = withNode('20', 'node', ['-v']);
  assert.equal(cmd, 'fnm');
  assert.deepEqual(argv, ['exec', '--using=20', '--', 'node', '-v']);
});

test('ensureNodeVersion calls fnm install when the version is missing', async () => {
  await withShims(async (shims) => {
    await ensureNodeVersion('20');
    const calls = shims.readCalls();
    assert.ok(calls.some((c) => c === 'fnm list'));
    assert.ok(calls.some((c) => c === 'fnm install 20'));
    const installed = await listInstalled();
    assert.ok(installed.some((v) => v.startsWith('20.')));
  });
});

test('ensureNodeVersion is a no-op once fnm list reports the version installed', async () => {
  await withShims(async (shims) => {
    await ensureNodeVersion('20');
    const callsBefore = shims.readCalls().length;
    await ensureNodeVersion('20');
    const callsAfter = shims.readCalls();
    assert.ok(!callsAfter.slice(callsBefore).some((c) => c.startsWith('fnm install')));
  });
});

test('nodeBinDir resolves a real directory via the fnm exec passthrough', async () => {
  await withShims(async () => {
    const binDir = await nodeBinDir('20');
    assert.equal(typeof binDir, 'string');
    assert.ok(binDir.length > 0);
  });
});

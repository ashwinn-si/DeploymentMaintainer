import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  liveDir,
  stagingDir,
  previousDir,
  assertDiskForStaging,
  prepareStaging,
  promoteStaging,
  restorePrevious,
  removeStaging,
  repairInterruptedSwap,
  formatBytes,
  __setFreeBytesOverride,
} from '../src/services/staging.js';
import { safeRemoveAppDir, removeInsideAppsDir } from '../src/services/git.js';

async function makeConfig() {
  const appsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-staging-'));
  return { config: { APPS_DIR: appsDir }, appsDir };
}

async function writeDir(dir, files) {
  await fs.mkdir(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, file), content);
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function withApps(fn) {
  const { config, appsDir } = await makeConfig();
  try {
    await fn(config, appsDir);
  } finally {
    await fs.rm(appsDir, { recursive: true, force: true });
  }
}

test('path helpers build dotted siblings under APPS_DIR', () => {
  const config = { APPS_DIR: '/apps' };
  assert.equal(liveDir(config, 'x'), '/apps/x');
  assert.equal(stagingDir(config, 'x'), '/apps/x.staging');
  assert.equal(previousDir(config, 'x'), '/apps/x.previous');
});

test('prepareStaging removes stale .staging and .previous and returns the staging path', async () => {
  await withApps(async (config, appsDir) => {
    await writeDir(path.join(appsDir, 'app.staging'), { 'old.txt': 'stale' });
    await writeDir(path.join(appsDir, 'app.previous'), { 'old.txt': 'prev' });
    await writeDir(path.join(appsDir, 'app'), { 'live.txt': 'live' });

    const result = await prepareStaging(config, 'app');
    assert.equal(result, path.join(appsDir, 'app.staging'));
    assert.equal(await exists(path.join(appsDir, 'app.staging')), false);
    assert.equal(await exists(path.join(appsDir, 'app.previous')), false);
    assert.equal(await exists(path.join(appsDir, 'app', 'live.txt')), true, 'live dir untouched');
  });
});

test('promoteStaging moves live to .previous and staging to live', async () => {
  await withApps(async (config, appsDir) => {
    await writeDir(path.join(appsDir, 'app'), { 'v.txt': 'old' });
    await writeDir(path.join(appsDir, 'app.staging'), { 'v.txt': 'new' });

    const { hadPrevious } = await promoteStaging(config, 'app');
    assert.equal(hadPrevious, true);
    assert.equal(await fs.readFile(path.join(appsDir, 'app', 'v.txt'), 'utf8'), 'new');
    assert.equal(await fs.readFile(path.join(appsDir, 'app.previous', 'v.txt'), 'utf8'), 'old');
    assert.equal(await exists(path.join(appsDir, 'app.staging')), false);
  });
});

test('promoteStaging without a live dir reports hadPrevious false', async () => {
  await withApps(async (config, appsDir) => {
    await writeDir(path.join(appsDir, 'app.staging'), { 'v.txt': 'new' });

    const { hadPrevious } = await promoteStaging(config, 'app');
    assert.equal(hadPrevious, false);
    assert.equal(await fs.readFile(path.join(appsDir, 'app', 'v.txt'), 'utf8'), 'new');
    assert.equal(await exists(path.join(appsDir, 'app.previous')), false);
  });
});

test('promoteStaging puts the live dir back when the staging dir is missing', async () => {
  await withApps(async (config, appsDir) => {
    await writeDir(path.join(appsDir, 'app'), { 'v.txt': 'old' });

    await assert.rejects(() => promoteStaging(config, 'app'), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(appsDir, 'app', 'v.txt'), 'utf8'), 'old');
    assert.equal(await exists(path.join(appsDir, 'app.previous')), false);
  });
});

test('restorePrevious swaps .previous back into live and discards the failed live dir', async () => {
  await withApps(async (config, appsDir) => {
    await writeDir(path.join(appsDir, 'app'), { 'v.txt': 'bad' });
    await writeDir(path.join(appsDir, 'app.previous'), { 'v.txt': 'good' });

    await restorePrevious(config, 'app');
    assert.equal(await fs.readFile(path.join(appsDir, 'app', 'v.txt'), 'utf8'), 'good');
    assert.equal(await exists(path.join(appsDir, 'app.previous')), false);
    assert.equal(await exists(path.join(appsDir, 'app.failed')), false);
  });
});

test('restorePrevious works when the live dir is already gone', async () => {
  await withApps(async (config, appsDir) => {
    await writeDir(path.join(appsDir, 'app.previous'), { 'v.txt': 'good' });
    await restorePrevious(config, 'app');
    assert.equal(await fs.readFile(path.join(appsDir, 'app', 'v.txt'), 'utf8'), 'good');
  });
});

test('restorePrevious throws when there is no .previous', async () => {
  await withApps(async (config, appsDir) => {
    await writeDir(path.join(appsDir, 'app'), { 'v.txt': 'live' });
    await assert.rejects(() => restorePrevious(config, 'app'), /No previous version/);
    assert.equal(await fs.readFile(path.join(appsDir, 'app', 'v.txt'), 'utf8'), 'live');
  });
});

test('removeStaging is idempotent and never throws', async () => {
  await withApps(async (config, appsDir) => {
    await writeDir(path.join(appsDir, 'app.staging'), { 'v.txt': 'x' });
    await removeStaging(config, 'app');
    assert.equal(await exists(path.join(appsDir, 'app.staging')), false);
    await removeStaging(config, 'app');
    await removeStaging(config, '../escape');
  });
});

test('assertDiskForStaging passes with plenty of free space and fails with too little', async () => {
  await withApps(async (config, appsDir) => {
    await writeDir(path.join(appsDir, 'app'), { 'big.bin': 'x'.repeat(4096) });

    const ok = await assertDiskForStaging(config, 'app', { freeBytes: 10 * 1024 ** 3 });
    assert.ok(ok.required > 0);
    assert.equal(ok.free, 10 * 1024 ** 3);

    await assert.rejects(
      () => assertDiskForStaging(config, 'app', { freeBytes: 1024 }),
      /Not enough disk space/,
    );
  });
});

test('assertDiskForStaging works for a brand-new app (no live dir) and reads real free space by default', async () => {
  await withApps(async (config) => {
    await assert.rejects(() => assertDiskForStaging(config, 'new-app', { freeBytes: 0 }), /Not enough disk space/);
    const result = await assertDiskForStaging(config, 'new-app', { freeBytes: 1024 ** 4 });
    assert.equal(result.required, 500 * 1024 * 1024);
    // default path: statfs on APPS_DIR; only checks it resolves or throws the disk error, never something else
    await assertDiskForStaging(config, 'new-app').catch((err) => {
      assert.match(err.message, /Not enough disk space/);
    });
  });
});

test('safeRemoveAppDir also removes <name>.staging and <name>.previous', async () => {
  await withApps(async (config, appsDir) => {
    await writeDir(path.join(appsDir, 'app'), { a: '1' });
    await writeDir(path.join(appsDir, 'app.staging'), { a: '1' });
    await writeDir(path.join(appsDir, 'app.previous'), { a: '1' });
    await writeDir(path.join(appsDir, 'other'), { a: '1' });

    await safeRemoveAppDir(config, 'app');
    assert.equal(await exists(path.join(appsDir, 'app')), false);
    assert.equal(await exists(path.join(appsDir, 'app.staging')), false);
    assert.equal(await exists(path.join(appsDir, 'app.previous')), false);
    assert.equal(await exists(path.join(appsDir, 'other')), true);
  });
});

test('removeInsideAppsDir refuses path traversal', async () => {
  await withApps(async (config) => {
    await assert.rejects(() => removeInsideAppsDir(config, '../x'), /outside APPS_DIR/);
    await assert.rejects(() => removeInsideAppsDir(config, '.'), /outside APPS_DIR/);
  });
});

test('repairInterruptedSwap puts .previous back when the live dir is missing', async () => {
  await withApps(async (config, appsDir) => {
    await writeDir(path.join(appsDir, 'app.previous'), { 'v.txt': 'last good' });
    await writeDir(path.join(appsDir, 'app.staging'), { 'v.txt': 'new' });

    assert.equal(await repairInterruptedSwap(config, 'app'), true);
    assert.equal(await fs.readFile(path.join(appsDir, 'app', 'v.txt'), 'utf8'), 'last good');
    assert.equal(await exists(path.join(appsDir, 'app.previous')), false);
    assert.equal(await exists(path.join(appsDir, 'app.staging')), true, 'staging is left for removeStaging');
  });
});

test('repairInterruptedSwap does nothing when live exists or there is no .previous', async () => {
  await withApps(async (config, appsDir) => {
    await writeDir(path.join(appsDir, 'app'), { 'v.txt': 'live' });
    await writeDir(path.join(appsDir, 'app.previous'), { 'v.txt': 'older' });
    assert.equal(await repairInterruptedSwap(config, 'app'), false);
    assert.equal(await fs.readFile(path.join(appsDir, 'app', 'v.txt'), 'utf8'), 'live');
    assert.equal(await fs.readFile(path.join(appsDir, 'app.previous', 'v.txt'), 'utf8'), 'older');

    assert.equal(await repairInterruptedSwap(config, 'never-deployed'), false);
    assert.equal(await exists(path.join(appsDir, 'never-deployed')), false);
  });
});

test('the free-space test hook overrides the statfs reading until cleared', async () => {
  await withApps(async (config) => {
    __setFreeBytesOverride(10);
    try {
      await assert.rejects(() => assertDiskForStaging(config, 'app'), /have 10 B free/);
      // an explicit argument still wins over the hook
      await assertDiskForStaging(config, 'app', { freeBytes: 1024 ** 4 });
    } finally {
      __setFreeBytesOverride(undefined);
    }
    await assertDiskForStaging(config, 'app').catch((err) => assert.match(err.message, /Not enough disk space/));
  });
});

test('formatBytes picks a readable unit', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 ** 3), '5.0 GB');
});

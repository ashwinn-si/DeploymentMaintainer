import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config as migrateConfig, database, up, down, status } from 'migrate-mongo';
import { loadConfig } from '../src/config.js';
import { backfill, backupCollection } from '../scripts/migrate-helpers.js';

// Runs real migrate-mongo against a throwaway database and a temp migrations folder.
// `migrationsDir` points migrate-mongo at an existing folder (the real server/migrations) instead of a temp one.
async function withMigrationEnv(files, fn, { migrationsDir } = {}) {
  const mongoUri = loadConfig({ require: ['MONGO_URI'] }).MONGO_URI;
  const databaseName = `dm_migrate_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-migrations-'));
  for (const [name, source] of Object.entries(files)) await fs.writeFile(path.join(dir, name), source);

  migrateConfig.set({
    mongodb: { url: mongoUri, databaseName },
    migrationsDir: migrationsDir ?? dir,
    changelogCollectionName: 'migrations_changelog',
    migrationFileExtension: '.js',
    useFileHash: false,
    moduleSystem: 'esm',
  });
  const { db, client } = await database.connect();
  try {
    await fn({ db });
  } finally {
    await db.dropDatabase();
    await client.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const BACKFILL_MIGRATION = `
export async function up(db) {
  await db.collection('apps').updateMany({ rootDir: { $exists: false } }, { $set: { rootDir: '' } });
}
export async function down(db) {
  await db.collection('apps').updateMany({}, { $unset: { rootDir: '' } });
}
`;

test('migrate-mongo applies a backfill once, is idempotent and reverts with down', async () => {
  await withMigrationEnv({ '20260101000000-add-root-dir.js': BACKFILL_MIGRATION }, async ({ db }) => {
    await db.collection('apps').insertMany([{ name: 'legacy' }, { name: 'newer', rootDir: 'web' }]);

    assert.equal((await status(db))[0].appliedAt, 'PENDING');
    assert.equal((await up(db, db.client)).length, 1);
    assert.equal((await db.collection('apps').findOne({ name: 'legacy' })).rootDir, '');
    assert.equal((await db.collection('apps').findOne({ name: 'newer' })).rootDir, 'web');

    assert.equal((await up(db, db.client)).length, 0, 'a second run has nothing pending');

    assert.equal((await down(db, db.client)).length, 1);
    assert.equal((await db.collection('apps').findOne({ name: 'legacy' })).rootDir, undefined);
  });
});

test('backfill only touches documents that are missing the field', async () => {
  await withMigrationEnv({}, async ({ db }) => {
    await db.collection('apps').insertMany([{ name: 'a' }, { name: 'b', stagedDeploys: false }]);
    const result = await backfill(db, 'apps', { stagedDeploys: { $exists: false } }, { $set: { stagedDeploys: true } });
    assert.equal(result.modifiedCount, 1);
    assert.equal((await db.collection('apps').findOne({ name: 'b' })).stagedDeploys, false);
  });
});

test('backupCollection writes every document to a json file, and skips empty collections', async () => {
  await withMigrationEnv({}, async ({ db }) => {
    assert.equal(await backupCollection(db, 'apps', 'unit-test-empty'), null);
    await db.collection('apps').insertMany([{ name: 'a' }, { name: 'b' }]);
    const file = await backupCollection(db, 'apps', 'unit-test');
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(saved.map((d) => d.name).sort(), ['a', 'b']);
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

// --- the real migrations ------------------------------------------------------------

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_MIGRATIONS_DIR = path.join(SERVER_DIR, 'migrations');
const BACKUPS_DIR = path.join(SERVER_DIR, 'backups');
const ROOT_DIR_MIGRATION = '20261009000000-app-root-dir-and-staged-deploys.js';

// The migration backs the collection up into server/backups; remove only what a test run added.
async function withBackupCleanup(fn) {
  const before = new Set(await fs.readdir(BACKUPS_DIR).catch(() => []));
  try {
    await fn();
  } finally {
    for (const name of await fs.readdir(BACKUPS_DIR).catch(() => [])) {
      if (!before.has(name)) await fs.rm(path.join(BACKUPS_DIR, name), { force: true });
    }
  }
}

function legacyApps() {
  // Shaped like documents written before rootDir / stagedDeploys existed, plus ones that already have them.
  return [
    { name: 'legacy-a', repoFullName: 'me/a', branch: 'main', port: 4001 },
    { name: 'legacy-b', repoFullName: 'me/b', branch: 'main', port: 4002 },
    { name: 'modern', repoFullName: 'me/c', branch: 'main', port: 4003, rootDir: 'apps/web', stagedDeploys: false },
    { name: 'half', repoFullName: 'me/d', branch: 'main', port: 4004, stagedDeploys: false },
  ];
}

test('the real app-root-dir-and-staged-deploys migration backfills legacy apps, is idempotent and reverts', async () => {
  await withBackupCleanup(() => withMigrationEnv({}, async ({ db }) => {
    const migration = await import(pathToFileURL(path.join(REAL_MIGRATIONS_DIR, ROOT_DIR_MIGRATION)).href);
    assert.equal(typeof migration.up, 'function');
    assert.equal(typeof migration.down, 'function');
    const apps = db.collection('apps');
    await apps.insertMany(legacyApps());
    const byName = async (name) => apps.findOne({ name });

    await migration.up(db);
    assert.equal((await byName('legacy-a')).rootDir, '');
    assert.equal((await byName('legacy-a')).stagedDeploys, true);
    assert.equal((await byName('legacy-b')).rootDir, '');
    assert.equal((await byName('legacy-b')).stagedDeploys, true);
    // Values that were already set survive.
    assert.equal((await byName('modern')).rootDir, 'apps/web');
    assert.equal((await byName('modern')).stagedDeploys, false);
    assert.equal((await byName('half')).rootDir, '');
    assert.equal((await byName('half')).stagedDeploys, false);

    const afterFirst = await apps.find({}).sort({ name: 1 }).toArray();
    await migration.up(db);
    assert.deepEqual(await apps.find({}).sort({ name: 1 }).toArray(), afterFirst, 'a second run changes nothing');

    await migration.down(db);
    for (const doc of await apps.find({}).toArray()) {
      assert.equal(doc.rootDir, undefined, `${doc.name} rootDir removed`);
      assert.equal(doc.stagedDeploys, undefined, `${doc.name} stagedDeploys removed`);
      assert.ok(doc.repoFullName, `${doc.name} keeps its other fields`);
    }
  }));
});

test('migrate-mongo discovers and applies the real migrations folder', async () => {
  await withBackupCleanup(() => withMigrationEnv({}, async ({ db }) => {
    await db.collection('apps').insertMany(legacyApps().slice(0, 2));

    const pending = await status(db);
    assert.ok(pending.some((m) => m.fileName === ROOT_DIR_MIGRATION && m.appliedAt === 'PENDING'));

    const applied = await up(db, db.client);
    assert.ok(applied.includes(ROOT_DIR_MIGRATION));
    assert.equal((await db.collection('apps').findOne({ name: 'legacy-a' })).rootDir, '');
    assert.ok((await status(db)).every((m) => m.appliedAt !== 'PENDING'));
    assert.equal((await up(db, db.client)).length, 0, 'nothing left to apply');

    // Revert whatever ran last-to-first back to the ones that touch apps, leaving the collection legacy-shaped.
    for (let i = 0; i < applied.length; i += 1) await down(db, db.client);
    assert.equal((await db.collection('apps').findOne({ name: 'legacy-a' })).rootDir, undefined);
  }, { migrationsDir: REAL_MIGRATIONS_DIR }));
});

// --- request-stat-indexes ------------------------------------------------------------------

const STATS_MIGRATION = '20261010000000-request-stat-indexes.js';

async function indexNames(db, collection) {
  return (await db.collection(collection).indexes()).map((i) => i.name);
}

test('the real request-stat-indexes migration creates the unique and TTL indexes, is idempotent and reverts', async () => {
  await withMigrationEnv({}, async ({ db }) => {
    const migration = await import(pathToFileURL(path.join(REAL_MIGRATIONS_DIR, STATS_MIGRATION)).href);
    assert.equal(typeof migration.up, 'function');
    assert.equal(typeof migration.down, 'function');

    await migration.up(db);
    await migration.up(db); // second run changes nothing and does not throw

    const stats = await db.collection('requeststats').indexes();
    const unique = stats.find((i) => i.name === 'appId_1_hour_1');
    assert.deepEqual(unique.key, { appId: 1, hour: 1 });
    assert.equal(unique.unique, true);
    const ttl = stats.find((i) => i.name === 'expireAt_1');
    assert.deepEqual(ttl.key, { expireAt: 1 });
    assert.equal(ttl.expireAfterSeconds, 0);
    assert.ok((await indexNames(db, 'analyticsoffsets')).includes('appName_1'));

    // The unique index really rejects a duplicate (appId, hour).
    const doc = { appId: 'a', hour: new Date('2026-10-10T00:00:00Z'), total: 1 };
    await db.collection('requeststats').insertOne({ ...doc });
    await assert.rejects(() => db.collection('requeststats').insertOne({ ...doc }), (err) => err.code === 11000);

    await migration.down(db);
    await migration.down(db); // already gone: not an error
    assert.deepEqual(await indexNames(db, 'requeststats'), ['_id_']);
    assert.deepEqual(await indexNames(db, 'analyticsoffsets'), ['_id_']);
  });
});

test('down on a database that never had the collections is not an error', async () => {
  await withMigrationEnv({}, async ({ db }) => {
    const migration = await import(pathToFileURL(path.join(REAL_MIGRATIONS_DIR, STATS_MIGRATION)).href);
    await migration.down(db);
  });
});

test('migrate-mongo applies the request-stat-indexes migration from the real folder', async () => {
  await withBackupCleanup(() => withMigrationEnv({}, async ({ db }) => {
    const applied = await up(db, db.client);
    assert.ok(applied.includes(STATS_MIGRATION));
    assert.ok((await indexNames(db, 'requeststats')).includes('expireAt_1'));
  }, { migrationsDir: REAL_MIGRATIONS_DIR }));
});

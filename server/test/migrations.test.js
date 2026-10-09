import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config as migrateConfig, database, up, down, status } from 'migrate-mongo';
import { loadConfig } from '../src/config.js';
import { backfill, backupCollection } from '../scripts/migrate-helpers.js';

// Runs real migrate-mongo against a throwaway database and a temp migrations folder.
async function withMigrationEnv(files, fn) {
  const mongoUri = loadConfig({ require: ['MONGO_URI'] }).MONGO_URI;
  const databaseName = `dm_migrate_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-migrations-'));
  for (const [name, source] of Object.entries(files)) await fs.writeFile(path.join(dir, name), source);

  migrateConfig.set({
    mongodb: { url: mongoUri, databaseName },
    migrationsDir: dir,
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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { loadConfig } from '../src/config.js';
import { copyDatabase, runDryRun } from '../scripts/migrate-dry-run.js';

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_MIGRATIONS_DIR = path.join(SERVER_DIR, 'migrations');
const BACKUPS_DIR = path.join(SERVER_DIR, 'backups');
const HELPERS_URL = pathToFileURL(path.join(SERVER_DIR, 'scripts', 'migrate-helpers.js')).href;
const REAL_FILES = [
  '20261009000000-app-root-dir-and-staged-deploys.js',
  '20261009000100-request-stat-indexes.js',
  '20261009000200-deployment-restored-previous.js',
];

const silent = () => {};

// A throwaway "production" database on the test Mongo server, plus a client to inspect the server.
async function withSourceDb(fn) {
  const mongoUri = loadConfig({ require: ['MONGO_URI'] }).MONGO_URI;
  const databaseName = `dm_dryrun_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const client = new mongoose.mongo.MongoClient(mongoUri);
  await client.connect();
  const db = client.db(databaseName);
  try {
    await fn({ mongoUri, databaseName, db, client });
  } finally {
    // Also removes any scratch database a failing test left behind.
    const { databases } = await client.db().admin().listDatabases();
    for (const { name } of databases) {
      if (name === databaseName || name.startsWith(`${databaseName}_dryrun_`)) await client.db(name).dropDatabase();
    }
    await client.close();
  }
}

async function databaseNames(client) {
  const { databases } = await client.db().admin().listDatabases();
  return databases.map((d) => d.name);
}

// Raw BSON of every document of every collection (+ index names), to prove the source was not touched.
async function fingerprint(db) {
  const out = {};
  for (const { name } of await db.listCollections().toArray()) {
    const docs = await db.collection(name).find({}, { raw: true }).toArray();
    out[name] = {
      docs: docs.map((d) => Buffer.from(d).toString('hex')),
      indexes: (await db.collection(name).indexes()).map((i) => i.name).sort(),
    };
  }
  return out;
}

async function backupFiles() {
  return (await fs.readdir(BACKUPS_DIR).catch(() => [])).sort();
}

function legacyApps() {
  return [
    { name: 'legacy-a', repoFullName: 'me/a', branch: 'main', port: 4001, nodeVersion: '22' },
    { name: 'legacy-b', repoFullName: 'me/b', branch: 'main', port: 4002, nodeVersion: '22' },
    { name: 'half', repoFullName: 'me/d', branch: 'main', port: 4004, nodeVersion: '20', stagedDeploys: false },
    { name: 'site', repoFullName: 'me/s', branch: 'main', kind: 'static', nodeVersion: '22', rootDir: 'dist' },
  ];
}

async function seedLegacy(db) {
  const { insertedIds } = await db.collection('apps').insertMany(legacyApps());
  await db.collection('deployments').insertMany([
    { appId: insertedIds[0], number: 1, branch: 'main', nodeVersion: '22', mode: 'fresh', status: 'success' },
    { appId: insertedIds[1], number: 1, branch: 'main', nodeVersion: '22', mode: 'update', status: 'failed' },
    { appId: insertedIds[1], number: 2, branch: 'main', nodeVersion: '22', mode: 'update', status: 'failed', restoredPrevious: true },
  ]);
  // A changelog entry for a migration that no longer ships, as a long-lived production database would have.
  await db.collection('migrations_changelog').insertOne({ fileName: '20250101000000-baseline.js', appliedAt: new Date('2025-01-01') });
}

// A temp migrations folder holding the real migrations (helper import made absolute) plus extra files.
async function tempMigrationsDir(extra = {}, { includeReal = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-dryrun-migrations-'));
  if (includeReal) {
    for (const file of REAL_FILES) {
      const source = await fs.readFile(path.join(REAL_MIGRATIONS_DIR, file), 'utf8');
      await fs.writeFile(path.join(dir, file), source.replaceAll('../scripts/migrate-helpers.js', HELPERS_URL));
    }
  }
  for (const [name, source] of Object.entries(extra)) await fs.writeFile(path.join(dir, name), source);
  return dir;
}

test('dry run passes on legacy-shaped data, leaves the source untouched and drops the scratch database', async () => {
  await withSourceDb(async ({ mongoUri, databaseName, db, client }) => {
    await seedLegacy(db);
    const sourceBefore = await fingerprint(db);
    const backupsBefore = await backupFiles();
    const lines = [];

    const result = await runDryRun({ mongoUri, databaseName, log: (l) => lines.push(l) });

    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.deepEqual(result.pending, REAL_FILES);
    assert.deepEqual(result.applied, REAL_FILES);
    assert.match(result.scratchDb, new RegExp(`^${databaseName}_dryrun_\\d{14}`));

    const apps = result.collections.find((c) => c.name === 'apps');
    assert.deepEqual(apps, { name: 'apps', before: 4, after: 4 });
    assert.equal(result.collections.find((c) => c.name === 'deployments').after, 3);
    assert.equal(result.validation.deployments.checked, 3);
    assert.equal(result.validation.apps.checked, 4);
    assert.equal(result.validation.apps.invalid, 0);
    assert.equal(result.validation.deployments.invalid, 0);
    assert.ok(lines.some((l) => l.includes('MIGRATED: 20261009000000-app-root-dir-and-staged-deploys.js')));

    assert.deepEqual(await fingerprint(db), sourceBefore, 'source data, indexes and migrations_changelog are byte-identical');
    assert.ok(!(await databaseNames(client)).includes(result.scratchDb), 'scratch database dropped');
    assert.deepEqual(await backupFiles(), backupsBefore, 'a dry run writes no backup files');
    assert.equal(process.env.MIGRATE_DRY_RUN, undefined, 'the dry-run flag is restored afterwards');
  });
});

test('keep leaves the migrated scratch database in place', async () => {
  await withSourceDb(async ({ mongoUri, databaseName, db, client }) => {
    await seedLegacy(db);
    const result = await runDryRun({ mongoUri, databaseName, keep: true, log: silent });
    assert.equal(result.ok, true);
    assert.ok((await databaseNames(client)).includes(result.scratchDb), 'scratch database kept');

    const scratch = client.db(result.scratchDb);
    assert.equal((await scratch.collection('apps').findOne({ name: 'legacy-a' })).rootDir, '');
    assert.equal((await scratch.collection('migrations_changelog').countDocuments({})), 4, 'copied changelog + 3 new entries');
    assert.equal(await db.collection('apps').countDocuments({ rootDir: { $exists: true } }), 1, 'only the seeded app had a rootDir in the source');
    await scratch.dropDatabase();
  });
});

test('an empty source database passes', async () => {
  await withSourceDb(async ({ mongoUri, databaseName, client }) => {
    const result = await runDryRun({ mongoUri, databaseName, log: silent });
    assert.equal(result.ok, true, result.errors.join('; '));
    assert.deepEqual(result.applied, REAL_FILES);
    assert.ok(!(await databaseNames(client)).includes(result.scratchDb));
  });
});

test('nothing pending still passes and says so', async () => {
  await withSourceDb(async ({ mongoUri, databaseName, db }) => {
    await seedLegacy(db);
    await db.collection('migrations_changelog').insertMany(REAL_FILES.map((fileName) => ({ fileName, appliedAt: new Date() })));
    // Already-migrated data, as it would be in production.
    await db.collection('apps').updateMany({ rootDir: { $exists: false } }, { $set: { rootDir: '' } });
    await db.collection('apps').updateMany({ stagedDeploys: { $exists: false } }, { $set: { stagedDeploys: true } });
    await db.collection('deployments').updateMany({ restoredPrevious: { $exists: false } }, { $set: { restoredPrevious: false } });
    const lines = [];

    const result = await runDryRun({ mongoUri, databaseName, log: (l) => lines.push(l) });

    assert.equal(result.ok, true, result.errors.join('; '));
    assert.deepEqual(result.pending, []);
    assert.deepEqual(result.applied, []);
    assert.ok(lines.some((l) => l.includes('none: the database is already up to date')));
  });
});

test('a migration that throws fails the run, names the file, and still cleans up', async () => {
  const dir = await tempMigrationsDir({
    '20261009000300-explode.js': 'export async function up() { throw new Error("kaboom"); }\nexport async function down() {}\n',
  });
  try {
    await withSourceDb(async ({ mongoUri, databaseName, db, client }) => {
      await seedLegacy(db);
      const sourceBefore = await fingerprint(db);

      const result = await runDryRun({ mongoUri, databaseName, migrationsDir: dir, log: silent });

      assert.equal(result.ok, false);
      assert.equal(result.pending.length, 4);
      assert.deepEqual(result.applied, REAL_FILES, 'the real migrations ran before the bad one');
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0], /20261009000300-explode\.js/);
      assert.match(result.errors[0], /kaboom/);
      assert.ok(!(await databaseNames(client)).includes(result.scratchDb), 'scratch database dropped even though the run failed');
      assert.deepEqual(await fingerprint(db), sourceBefore);
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('documents that were already invalid before migrating only warn, and the run still passes', async () => {
  await withSourceDb(async ({ mongoUri, databaseName, db, client }) => {
    await seedLegacy(db);
    const { insertedId } = await db.collection('apps').insertOne({
      name: 'broken', repoFullName: 'me/x', branch: 'main', port: 4100, nodeVersion: '22', kind: 'cobol',
    });
    // The shape seen on a real server: deployment log entries with empty text.
    await db.collection('deployments').insertOne({
      appId: insertedId, number: 99, branch: 'main', mode: 'update', status: 'success',
      entries: [{ i: 0, t: new Date(), stream: 'info', text: 'ok' }, { i: 1, t: new Date(), stream: 'info', text: '' }],
    });

    const result = await runDryRun({ mongoUri, databaseName, log: silent });

    assert.equal(result.ok, true, result.errors.join('; '));
    assert.equal(result.validationBefore.apps.invalid, 1);
    assert.equal(result.validation.apps.invalid, 1);
    assert.equal(result.validation.apps.examples[0].id, String(insertedId));
    assert.match(result.validation.apps.examples[0].message, /kind/);
    assert.deepEqual(result.regressions, []);
    assert.ok(result.warnings.some((w) => /already invalid before migrating/.test(w)), result.warnings.join('; '));
    assert.ok(!(await databaseNames(client)).includes(result.scratchDb));
  });
});

const BREAKS_AN_APP = `
export async function up(db) { await db.collection('apps').updateOne({ name: 'legacy-a' }, { $set: { kind: 'cobol' } }); }
export async function down(db) { await db.collection('apps').updateOne({ name: 'legacy-a' }, { $set: { kind: 'node' } }); }
`;

test('a migration that makes a valid document invalid fails the run, with examples', async () => {
  const dir = await tempMigrationsDir({ '20261009000300-breaks-an-app.js': BREAKS_AN_APP });
  try {
    await withSourceDb(async ({ mongoUri, databaseName, db, client }) => {
      await seedLegacy(db);
      const result = await runDryRun({ mongoUri, databaseName, migrationsDir: dir, roundtrip: false, log: silent });

      assert.equal(result.ok, false);
      assert.equal(result.regressions.length, 1);
      assert.equal(result.regressions[0].collection, 'apps');
      assert.match(result.regressions[0].problems.join(' '), /kind/);
      assert.ok(result.errors.some((e) => /fail model validation after migrating that did not before/.test(e)), result.errors.join('; '));
      assert.ok(!(await databaseNames(client)).includes(result.scratchDb));
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a migration that leaves an app without rootDir / stagedDeploys fails the extra App check', async () => {
  const dir = await tempMigrationsDir({ '20261009000300-noop.js': 'export async function up() {}\nexport async function down() {}\n' }, { includeReal: false });
  try {
    await withSourceDb(async ({ mongoUri, databaseName, db }) => {
      await db.collection('apps').insertOne(legacyApps()[0]);
      const result = await runDryRun({ mongoUri, databaseName, migrationsDir: dir, log: silent });
      assert.equal(result.ok, false);
      assert.equal(result.validation.apps.invalid, 1);
      assert.match(result.validation.apps.examples[0].message, /rootDir must be a string/);
      assert.match(result.validation.apps.examples[0].message, /stagedDeploys must be a boolean/);
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const NOT_REVERSIBLE = `
// up inserts a row each time, down forgets to remove it: neither idempotent nor reversible.
export async function up(db) { await db.collection('things').insertOne({ n: 1 }); }
export async function down() {}
`;

test('the round trip catches a migration whose down does not undo up; --no-roundtrip skips it', async () => {
  const dir = await tempMigrationsDir({ '20261009000300-not-reversible.js': NOT_REVERSIBLE });
  try {
    await withSourceDb(async ({ mongoUri, databaseName, db, client }) => {
      await seedLegacy(db);

      const strict = await runDryRun({ mongoUri, databaseName, migrationsDir: dir, log: silent });
      assert.equal(strict.ok, false);
      assert.ok(strict.errors.some((e) => /round trip: things had 1 documents/.test(e) && /2 after down\+up/.test(e)), strict.errors.join('; '));
      assert.ok(!(await databaseNames(client)).includes(strict.scratchDb));

      const lenient = await runDryRun({ mongoUri, databaseName, migrationsDir: dir, roundtrip: false, log: silent });
      assert.equal(lenient.ok, true, lenient.errors.join('; '));
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the round trip proves the real migrations are reversible and keeps counts equal', async () => {
  await withSourceDb(async ({ mongoUri, databaseName, db }) => {
    await seedLegacy(db);
    const lines = [];
    const result = await runDryRun({ mongoUri, databaseName, log: (l) => lines.push(l) });
    assert.equal(result.ok, true, result.errors.join('; '));
    assert.ok(lines.some((l) => l.includes('REVERTED: 20261009000100-request-stat-indexes.js')));
    assert.ok(lines.some((l) => l.includes('document counts unchanged after down+up')));
    assert.deepEqual(result.warnings, []);
  });
});

test('the round trip keeps values users had already set (down only reverts backfilled defaults)', async () => {
  await withSourceDb(async ({ mongoUri, databaseName, db }) => {
    await seedLegacy(db); // 'half' has stagedDeploys:false and 'site' has rootDir:'dist' before any migration ran
    const result = await runDryRun({ mongoUri, databaseName, log: silent });
    assert.equal(result.ok, true, result.errors.join('; '));
    assert.deepEqual(result.warnings, []);
  });
});

test('copyDatabase reproduces documents byte for byte and recreates indexes with their options', async () => {
  await withSourceDb(async ({ mongoUri, databaseName, db, client }) => {
    const { Int32, Double, Long } = mongoose.mongo;
    await db.collection('things').insertMany([
      { _id: 'string-id', i: new Int32(5), d: new Double(5), l: Long.fromNumber(2 ** 40), when: new Date('2026-01-02T03:04:05Z'), nested: { a: [1, 'x', null] } },
      { x: 1 },
    ]);
    await db.collection('things').createIndex({ x: 1 }, { name: 'x_unique', unique: true, partialFilterExpression: { x: { $exists: true } } });
    await db.collection('things').createIndex({ when: 1 }, { name: 'when_ttl', expireAfterSeconds: 3600 });
    const bulk = Array.from({ length: 1234 }, (_, n) => ({ n }));
    await db.collection('many').insertMany(bulk);

    const target = client.db(`${databaseName}_dryrun_copytest`);
    const { collections, warnings } = await copyDatabase(db, target);

    assert.deepEqual(warnings, []);
    assert.deepEqual(collections.map((c) => [c.name, c.copied]).sort(), [['many', 1234], ['things', 2]]);
    assert.deepEqual(await fingerprint(target), await fingerprint(db));
    const indexes = await target.collection('things').indexes();
    assert.equal(indexes.find((i) => i.name === 'x_unique').unique, true);
    assert.deepEqual(indexes.find((i) => i.name === 'x_unique').partialFilterExpression, { x: { $exists: true } });
    assert.equal(indexes.find((i) => i.name === 'when_ttl').expireAfterSeconds, 3600);
  });
});

test('a scratch name that is already taken gets a different name instead of being overwritten', async () => {
  await withSourceDb(async ({ mongoUri, databaseName, db, client }) => {
    await seedLegacy(db);
    // Occupy every name the run could pick during this second.
    const taken = [];
    for (const offset of [-1, 0, 1, 2]) {
      const t = new Date(Date.now() + offset * 1000).toISOString().replace(/\D/g, '').slice(0, 14);
      const name = `${databaseName}_dryrun_${t}`;
      await client.db(name).collection('precious').insertOne({ keep: true });
      taken.push(name);
    }

    const result = await runDryRun({ mongoUri, databaseName, log: silent });

    assert.equal(result.ok, true, result.errors.join('; '));
    assert.ok(!taken.includes(result.scratchDb));
    for (const name of taken) assert.equal(await client.db(name).collection('precious').countDocuments({}), 1, `${name} untouched`);
  });
});

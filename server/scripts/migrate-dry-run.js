// Rehearses `migrate:up` on a throwaway copy of the real database, so a broken migration is found
// before it touches production data.
//
//   node scripts/migrate-dry-run.js [--keep] [--no-roundtrip]
//   npm run migrate:dry-run -w server -- [--keep] [--no-roundtrip]
//
// Steps: copy every collection + index of $MONGO_URI's database into <db>_dryrun_<timestamp> (the source is only
// ever read), run the pending migrations there, validate the migrated documents with the real Mongoose models,
// then (unless --no-roundtrip) run `down` for what was applied and `up` again. The scratch database is always
// dropped afterwards unless --keep. Exit code 0 = safe to run migrate:up, 1 = do NOT migrate production.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { config as migrateConfig, database, up, down, status } from 'migrate-mongo';
import { parseMongoUri } from './migrate-helpers.js';
import App from '../src/models/App.js';
import Deployment from '../src/models/Deployment.js';
import RequestStat from '../src/models/RequestStat.js';
import AnalyticsOffset from '../src/models/AnalyticsOffset.js';

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = 'migrations_changelog';
const BATCH_SIZE = 500;
const MAX_EXAMPLES = 5;
const MAX_DB_NAME_BYTES = 63;

const MODELS = [App, Deployment, RequestStat, AnalyticsOffset];

function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

// --- copying -----------------------------------------------------------------------------------

async function userCollections(db) {
  const all = await db.listCollections({}, { nameOnly: false }).toArray();
  return all.filter((c) => c.type !== 'view' && !c.name.startsWith('system.'));
}

// Copies every collection (documents, then indexes) from `source` to `target`. Only reads from `source`.
// Documents are read with promoteValues:false so Int32/Double/Long/Decimal come back as BSON wrappers and are
// written with exactly the type they had. Returns { collections: [{ name, copied }], warnings }.
export async function copyDatabase(source, target, log = () => {}) {
  const warnings = [];
  const collections = [];
  const specs = await userCollections(source);

  for (const spec of specs) {
    const { name } = spec;
    try {
      await target.createCollection(name, spec.options && Object.keys(spec.options).length ? spec.options : undefined);
    } catch (err) {
      warnings.push(`${name}: could not recreate collection options (${err.message}); copied without them`);
      await target.createCollection(name).catch(() => {});
    }

    const src = source.collection(name);
    const dst = target.collection(name);
    let copied = 0;
    let batch = [];
    const flush = async () => {
      if (batch.length === 0) return;
      await dst.insertMany(batch, { ordered: false, bypassDocumentValidation: true });
      copied += batch.length;
      batch = [];
    };
    const cursor = src.find({}, { promoteValues: false, promoteLongs: false, batchSize: BATCH_SIZE });
    for await (const doc of cursor) {
      batch.push(doc);
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();

    const expected = await src.estimatedDocumentCount();
    if (expected !== copied) {
      warnings.push(`${name}: source reports ~${expected} documents but ${copied} were copied (estimate can lag; documents may have changed while copying)`);
    }

    for (const index of await src.indexes()) {
      if (index.name === '_id_') continue;
      const { v, ns, background, ...rest } = index; // eslint-disable-line no-unused-vars
      try {
        await dst.createIndexes([rest]);
      } catch (err) {
        warnings.push(`${name}: index ${index.name} was not copied (${err.message})`);
      }
    }
    collections.push({ name, copied });
    log(`  copied ${name}: ${copied} documents`);
  }
  return { collections, warnings };
}

async function countAll(db) {
  const counts = {};
  for (const { name } of await userCollections(db)) counts[name] = await db.collection(name).countDocuments({});
  return counts;
}

// Order-independent fingerprint of a collection's content, used to compare before/after a round trip.
async function digest(db, name) {
  const hash = crypto.createHash('sha256');
  const docs = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
  for (const doc of docs) hash.update(JSON.stringify(doc));
  return hash.digest('hex');
}

async function digestAll(db) {
  const out = {};
  for (const { name } of await userCollections(db)) if (name !== CHANGELOG) out[name] = await digest(db, name);
  return out;
}

// --- validation --------------------------------------------------------------------------------

// Hydrates every document with the real Mongoose model (never saves) and collects schema violations.
// App documents must additionally carry an explicit rootDir (string) and stagedDeploys (boolean), which only
// holds after migrating, so the pre-migration pass passes requireAppDefaults: false.
export async function validateModels(db, { requireAppDefaults = true } = {}) {
  const report = {};
  for (const Model of MODELS) {
    const name = Model.collection.name;
    const entry = { checked: 0, invalid: 0, examples: [] };
    report[name] = entry;
    const present = (await db.listCollections({ name }).toArray()).length > 0;
    if (!present) continue;
    for await (const doc of db.collection(name).find({})) {
      entry.checked += 1;
      const problems = [];
      try {
        await new Model(doc).validate(); // hydrate + validate only: nothing is saved
      } catch (err) {
        problems.push(err.message);
      }
      if (Model === App && requireAppDefaults) {
        if (typeof doc.rootDir !== 'string') problems.push(`rootDir must be a string, got ${doc.rootDir === undefined ? 'nothing' : typeof doc.rootDir}`);
        if (typeof doc.stagedDeploys !== 'boolean') problems.push(`stagedDeploys must be a boolean, got ${doc.stagedDeploys === undefined ? 'nothing' : typeof doc.stagedDeploys}`);
      }
      if (problems.length > 0) {
        entry.invalid += 1;
        if (entry.examples.length < MAX_EXAMPLES) entry.examples.push({ id: String(doc._id), message: problems.join('; ') });
      }
    }
  }
  return report;
}

function totalInvalid(validation) {
  return Object.values(validation).reduce((sum, v) => sum + v.invalid, 0);
}

function printValidation(validation, log) {
  for (const [name, v] of Object.entries(validation)) {
    log(`  ${name.padEnd(18)} checked ${String(v.checked).padStart(5)}, invalid ${v.invalid}`);
    for (const example of v.examples) log(`      ${example.id}: ${example.message}`);
  }
}

function printTable(rows, log) {
  const width = Math.max(10, ...rows.map((r) => r.name.length));
  log(`  ${'collection'.padEnd(width)}  ${'before'.padStart(8)}  ${'after'.padStart(8)}`);
  for (const r of rows) log(`  ${r.name.padEnd(width)}  ${String(r.before).padStart(8)}  ${String(r.after).padStart(8)}`);
}

// --- the dry run -------------------------------------------------------------------------------

export async function runDryRun({
  mongoUri,
  databaseName,
  migrationsDir = path.join(SERVER_DIR, 'migrations'),
  keep = false,
  roundtrip = true,
  log = console.log,
} = {}) {
  const result = {
    ok: false,
    pending: [],
    applied: [],
    collections: [],
    validation: {},
    validationBefore: {},
    warnings: [],
    errors: [],
    scratchDb: null,
  };
  const fail = (message) => result.errors.push(message);

  const previousFlag = process.env.MIGRATE_DRY_RUN;
  process.env.MIGRATE_DRY_RUN = '1'; // backupCollection becomes a no-op: the scratch copy needs no backup files

  const client = new mongoose.mongo.MongoClient(mongoUri);
  let scratch = null;
  let migrateClient = null;
  try {
    await client.connect();
    const source = client.db(databaseName);

    // Scratch database name: <db>_dryrun_<YYYYMMDDHHmmss>, with a suffix if that name is somehow taken.
    let name = `${databaseName}_dryrun_${timestamp()}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const taken = await client.db(name).listCollections({}, { nameOnly: true }).toArray();
      if (taken.length === 0) break;
      name = `${databaseName}_dryrun_${timestamp()}_${Math.random().toString(36).slice(2, 6)}`;
    }
    if (Buffer.byteLength(name) > MAX_DB_NAME_BYTES) {
      throw new Error(`scratch database name "${name}" is longer than MongoDB's ${MAX_DB_NAME_BYTES}-byte limit; use a shorter database name`);
    }
    if ((await client.db(name).listCollections({}, { nameOnly: true }).toArray()).length > 0) {
      throw new Error(`scratch database ${name} already exists and is not empty; refusing to overwrite it`);
    }
    result.scratchDb = name;
    scratch = client.db(name);

    log(`Source database: ${databaseName} (read only)`);
    log(`Scratch database: ${name}`);

    // (b) copy
    log('\nCopying data into the scratch database...');
    const copy = await copyDatabase(source, scratch, log);
    result.warnings.push(...copy.warnings);
    if (copy.collections.length === 0) log('  source database is empty (no collections)');
    for (const w of copy.warnings) log(`  warning: ${w}`);
    const before = await countAll(scratch);

    log('\nValidating the copied data with the Mongoose models (before migrating)...');
    result.validationBefore = await validateModels(scratch, { requireAppDefaults: false });
    printValidation(result.validationBefore, log);
    if (totalInvalid(result.validationBefore) > 0) {
      result.warnings.push(`${totalInvalid(result.validationBefore)} document(s) already fail model validation before migrating`);
    }

    // (c) migrate-mongo against the scratch database
    migrateConfig.set({
      mongodb: { url: mongoUri, databaseName: name },
      migrationsDir,
      changelogCollectionName: CHANGELOG,
      migrationFileExtension: '.js',
      useFileHash: false,
      moduleSystem: 'esm',
    });
    const connection = await database.connect();
    migrateClient = connection.client;
    const migrateDb = connection.db;

    const items = await status(migrateDb);
    result.pending = items.filter((i) => i.appliedAt === 'PENDING').map((i) => i.fileName);
    log('\nPending migrations:');
    if (result.pending.length === 0) log('  none: the database is already up to date');
    for (const file of result.pending) log(`  ${file}`);

    let upOk = true;
    if (result.pending.length > 0) {
      log('\nRunning up on the scratch database...');
      try {
        result.applied = await up(migrateDb, migrateClient);
        for (const file of result.applied) log(`  MIGRATED: ${file}`);
      } catch (err) {
        upOk = false;
        result.applied = err.migrated ?? [];
        fail(err.message);
      }
    }

    if (upOk) {
      // (d) counts + validation
      const after = await countAll(scratch);
      const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
      result.collections = names.map((n) => ({ name: n, before: before[n] ?? 0, after: after[n] ?? 0 }));
      log('\nDocument counts:');
      printTable(result.collections, log);

      log('\nValidating the migrated data with the Mongoose models...');
      result.validation = await validateModels(scratch);
      printValidation(result.validation, log);
      const invalid = totalInvalid(result.validation);
      if (invalid > 0) fail(`${invalid} migrated document(s) fail model validation`);

      // (e) round trip: down what was just applied, then up again
      if (roundtrip && result.applied.length > 0) {
        log('\nRound trip: down, then up again...');
        const migratedState = await digestAll(scratch);
        let downOk = true;
        try {
          for (let i = 0; i < result.applied.length; i += 1) {
            for (const file of await down(migrateDb, migrateClient)) log(`  REVERTED: ${file}`);
          }
        } catch (err) {
          downOk = false;
          fail(`round trip: ${err.message}`);
        }
        if (downOk) {
          try {
            const again = await up(migrateDb, migrateClient);
            for (const file of again) log(`  MIGRATED: ${file}`);
            if (JSON.stringify(again) !== JSON.stringify(result.applied)) {
              fail(`round trip: second up applied [${again.join(', ')}] but the first applied [${result.applied.join(', ')}]`);
            }
          } catch (err) {
            fail(`round trip: ${err.message}`);
          }
        }
        const finalCounts = await countAll(scratch);
        const changed = result.collections.filter((c) => (finalCounts[c.name] ?? 0) !== c.after);
        for (const c of changed) fail(`round trip: ${c.name} had ${c.after} documents after the first up but ${finalCounts[c.name] ?? 0} after down+up`);
        if (changed.length === 0) log('  document counts unchanged after down+up');
        const finalState = await digestAll(scratch);
        for (const n of Object.keys(migratedState)) {
          if (finalState[n] !== migratedState[n]) {
            result.warnings.push(`round trip: ${n} content differs after down+up (counts are equal); check that down restores what up changed`);
            log(`  warning: ${result.warnings[result.warnings.length - 1]}`);
          }
        }
      } else if (roundtrip) {
        log('\nRound trip skipped: nothing was applied.');
      }
    }
  } catch (err) {
    fail(err.message);
  } finally {
    if (migrateClient) await migrateClient.close().catch(() => {});
    if (scratch) {
      if (keep) {
        log(`\nScratch database kept: ${result.scratchDb} (drop it with: db.getSiblingDB('${result.scratchDb}').dropDatabase())`);
      } else {
        try {
          await scratch.dropDatabase();
          log(`\nScratch database ${result.scratchDb} dropped.`);
        } catch (err) {
          result.warnings.push(`could not drop scratch database ${result.scratchDb}: ${err.message}`);
          log(`\nwarning: ${result.warnings[result.warnings.length - 1]}`);
        }
      }
    }
    await client.close().catch(() => {});
    if (previousFlag === undefined) delete process.env.MIGRATE_DRY_RUN;
    else process.env.MIGRATE_DRY_RUN = previousFlag;
  }

  result.ok = result.errors.length === 0;
  return result;
}

// --- CLI ---------------------------------------------------------------------------------------

async function main() {
  await import('dotenv/config');
  const args = new Set(process.argv.slice(2));
  const unknown = [...args].filter((a) => !['--keep', '--no-roundtrip'].includes(a));
  if (unknown.length > 0) {
    console.error(`Unknown option(s): ${unknown.join(' ')}\nUsage: node scripts/migrate-dry-run.js [--keep] [--no-roundtrip]`);
    process.exit(2);
  }
  const { url, databaseName } = parseMongoUri(process.env.MONGO_URI);
  const result = await runDryRun({
    mongoUri: url,
    databaseName,
    migrationsDir: path.join(SERVER_DIR, 'migrations'),
    keep: args.has('--keep'),
    roundtrip: !args.has('--no-roundtrip'),
  });
  console.log('');
  if (result.ok) {
    console.log('DRY RUN PASSED — safe to run: npm run migrate:up -w server');
    process.exit(0);
  }
  console.log('DRY RUN FAILED — do NOT migrate production');
  for (const e of result.errors) console.log(`  - ${e}`);
  process.exit(1);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`DRY RUN FAILED — do NOT migrate production\n  - ${err.message}`);
    process.exit(1);
  });
}

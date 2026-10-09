import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKUP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'backups');

// Writes every document of `collectionName` to backups/<timestamp>-<label>.json before a migration touches it.
// Returns the file path (or null for an empty collection, which has nothing to lose).
export async function backupCollection(db, collectionName, label) {
  const docs = await db.collection(collectionName).find({}).toArray();
  if (docs.length === 0) return null;
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `${stamp}-${label}.json`);
  await fs.writeFile(file, JSON.stringify(docs, null, 2), { mode: 0o600 });
  return file;
}

// Applies one idempotent backfill and logs how many documents it matched/changed.
export async function backfill(db, collectionName, filter, update) {
  const result = await db.collection(collectionName).updateMany(filter, update);
  console.log(`  ${collectionName}: matched ${result.matchedCount}, modified ${result.modifiedCount}`);
  return result;
}

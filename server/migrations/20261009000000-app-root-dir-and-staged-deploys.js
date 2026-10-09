// Backfills the fields added to App after the baseline snapshot (mongoose-drift 1.0.0 -> 1.1.0):
//   rootDir       sub-folder of the repo the app lives in; '' = repo root (every app before this existed)
//   stagedDeploys build in a staging folder and swap in on success (the default for existing apps too)
// Idempotent: only documents missing a field are touched, so a second run changes nothing.
import { backfill, backupCollection } from '../scripts/migrate-helpers.js';

export async function up(db) {
  const backup = await backupCollection(db, 'apps', 'apps-root-dir');
  if (backup) console.log(`  backup written to ${backup}`);
  await backfill(db, 'apps', { rootDir: { $exists: false } }, { $set: { rootDir: '' } });
  await backfill(db, 'apps', { stagedDeploys: { $exists: false } }, { $set: { stagedDeploys: true } });
}

// Only reverts what `up` backfilled (the default values), so a later `up` can't lose settings users chose since:
// an app with a real rootDir or stagedDeploys: false keeps it.
export async function down(db) {
  await db.collection('apps').updateMany({ rootDir: '' }, { $unset: { rootDir: '' } });
  await db.collection('apps').updateMany({ stagedDeploys: true }, { $unset: { stagedDeploys: '' } });
}

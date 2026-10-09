// Backfills the field added to Deployment after snapshot 1.2.0 (mongoose-drift 1.2.0 -> 1.3.0):
//   restoredPrevious  a staged deploy failed after the swap and the previous version was put back (false for every older deploy)
// Idempotent: only documents missing the field are touched, so a second run changes nothing.
import { backfill, backupCollection } from '../scripts/migrate-helpers.js';

export async function up(db) {
  const backup = await backupCollection(db, 'deployments', 'deployments-restored-previous');
  if (backup) console.log(`  backup written to ${backup}`);
  await backfill(db, 'deployments', { restoredPrevious: { $exists: false } }, { $set: { restoredPrevious: false } });
}

// Only removes the backfilled default; a deployment that really restored the previous version keeps its `true`.
export async function down(db) {
  await db.collection('deployments').updateMany({ restoredPrevious: false }, { $unset: { restoredPrevious: '' } });
}

// Analytics (mongoose-drift 1.1.0 -> 1.2.0): two new collections, so there is nothing to back up or backfill, only indexes.
//   requeststats      unique { appId, hour } (one document per app per UTC hour) and a TTL index on expireAt (hour + 90 days)
//   analyticsoffsets  unique { appName } (how far the collector has read each access log)
// Idempotent: createIndex is a no-op when the same index (same name and options) already exists, e.g. built by Mongoose.
const INDEXES = [
  { collection: 'requeststats', keys: { appId: 1, hour: 1 }, options: { name: 'appId_1_hour_1', unique: true } },
  { collection: 'requeststats', keys: { expireAt: 1 }, options: { name: 'expireAt_1', expireAfterSeconds: 0 } },
  { collection: 'analyticsoffsets', keys: { appName: 1 }, options: { name: 'appName_1', unique: true } },
];

export async function up(db) {
  for (const { collection, keys, options } of INDEXES) {
    await db.collection(collection).createIndex(keys, options);
  }
}

export async function down(db) {
  for (const { collection, options } of INDEXES) {
    try {
      await db.collection(collection).dropIndex(options.name);
    } catch (err) {
      // IndexNotFound (27) / NamespaceNotFound (26): already gone, which is the state down wants.
      if (err.code !== 27 && err.code !== 26) throw err;
    }
  }
}

import mongoose from 'mongoose';

// One document per app per UTC hour; counters are incremented by the analytics collector.
// Small by design (apps x 24 rows/day): no per-request documents.
const requestStatSchema = new mongoose.Schema({
  appId: { type: mongoose.Schema.Types.ObjectId, ref: 'App', required: true },
  appName: { type: String },
  // UTC, floored to the hour.
  hour: { type: Date, required: true },
  total: { type: Number, default: 0 },
  s2xx: { type: Number, default: 0 },
  s3xx: { type: Number, default: 0 },
  s4xx: { type: Number, default: 0 },
  s5xx: { type: Number, default: 0 },
  bytes: { type: Number, default: 0 },
  // hour + 90 days, set on insert; MongoDB's TTL monitor deletes the document once it passes.
  expireAt: { type: Date },
});

requestStatSchema.index({ appId: 1, hour: 1 }, { unique: true });
requestStatSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.RequestStat || mongoose.model('RequestStat', requestStatSchema);

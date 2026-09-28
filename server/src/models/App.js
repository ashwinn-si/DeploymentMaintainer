import mongoose from 'mongoose';

const stepSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const healthSchema = new mongoose.Schema(
  {
    ok: { type: Boolean, default: false },
    statusCode: { type: Number, default: null },
    latencyMs: { type: Number, default: null },
    checkedAt: { type: Date, default: null },
  },
  { _id: false },
);

const appSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    repoFullName: { type: String, required: true },
    branch: { type: String, required: true },
    port: { type: Number, required: true },
    nodeVersion: { type: String, required: true },
    // AES-256-GCM blob from services/crypto.js, or null before the first save.
    envEncrypted: { type: mongoose.Schema.Types.Mixed, default: null },
    steps: { type: [stepSchema], default: [] },
    status: {
      type: String,
      enum: ['not_deployed', 'deploying', 'online', 'stopped', 'failed'],
      default: 'not_deployed',
    },
    health: { type: healthSchema, default: () => ({}) },
    currentCommitSha: { type: String, default: null },
    lastDeployedAt: { type: Date, default: null },
    // Atomically incremented (findOneAndUpdate $inc) to hand out per-app deployment numbers.
    deploySeq: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export default mongoose.models.App || mongoose.model('App', appSchema);

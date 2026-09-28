import mongoose from 'mongoose';

const deploymentStepSchema = new mongoose.Schema(
  {
    // e.g. "3-install" — matches the `step` field on this step's log entries.
    id: { type: String, required: true },
    type: { type: String, required: true },
    label: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'success', 'failed', 'skipped'],
      default: 'pending',
    },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  { _id: false },
);

const entrySchema = new mongoose.Schema(
  {
    // Monotonic per-deployment index assigned by services/deployLog.js; stable array position.
    i: { type: Number, required: true },
    t: { type: Date, default: Date.now },
    step: { type: String, default: null },
    stream: { type: String, enum: ['cmd', 'stdout', 'stderr', 'info', 'error'], required: true },
    text: { type: String, required: true },
  },
  { _id: false },
);

const deploymentSchema = new mongoose.Schema(
  {
    appId: { type: mongoose.Schema.Types.ObjectId, ref: 'App', required: true },
    // Per-app sequence number ("#N"), assigned atomically off App.deploySeq.
    number: { type: Number, required: true },
    branch: { type: String, required: true },
    commitSha: { type: String, default: null },
    previousSha: { type: String, default: null },
    nodeVersion: { type: String, required: true },
    mode: { type: String, enum: ['update', 'fresh', 'rollback'], required: true },
    rollbackOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Deployment', default: null },
    autoRollbackOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Deployment', default: null },
    status: {
      type: String,
      enum: ['queued', 'running', 'success', 'failed', 'cancelled'],
      default: 'queued',
    },
    error: { type: String, default: null },
    steps: { type: [deploymentStepSchema], default: [] },
    // Capped at ~1MB by services/deployLog.js before entries reach here.
    entries: { type: [entrySchema], default: [] },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

deploymentSchema.index({ appId: 1, createdAt: -1 });

export default mongoose.models.Deployment || mongoose.model('Deployment', deploymentSchema);

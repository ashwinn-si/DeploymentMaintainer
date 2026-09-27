import mongoose from 'mongoose';

const deploymentStepSchema = new mongoose.Schema(
  {
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
    branch: { type: String, required: true },
    commitSha: { type: String, default: null },
    mode: { type: String, enum: ['update', 'fresh', 'rollback'], required: true },
    rollbackOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Deployment', default: null },
    autoRollbackOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Deployment', default: null },
    status: {
      type: String,
      enum: ['queued', 'running', 'success', 'failed', 'cancelled'],
      default: 'queued',
    },
    steps: { type: [deploymentStepSchema], default: [] },
    // Capped at ~1MB by services/deployLog.js before entries reach here.
    entries: { type: [entrySchema], default: [] },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

deploymentSchema.index({ appId: 1, createdAt: -1 });

export default mongoose.models.Deployment || mongoose.model('Deployment', deploymentSchema);

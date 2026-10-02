import mongoose from 'mongoose';

const serverSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    url: { type: String, required: true, unique: true },
    serverId: { type: String, required: true, unique: true },
    secretEncrypted: { type: mongoose.Schema.Types.Mixed, required: true },
    version: { type: String, default: null },
    hostname: { type: String, default: null },
    lastSeenAt: { type: Date, default: null },
    lastStatus: { type: String, enum: ['online', 'offline', 'unauthorized', null], default: null },
  },
  { timestamps: true },
);

export default mongoose.models.Server || mongoose.model('Server', serverSchema);

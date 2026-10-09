import mongoose from 'mongoose';

// How far the collector has read into each app's access log, so a restart never recounts.
const analyticsOffsetSchema = new mongoose.Schema({
  appName: { type: String, required: true, unique: true },
  // Inode of the log file the offset belongs to (a new inode means the log was rotated).
  inode: { type: String, default: '' },
  // Bytes consumed so far, always at a line boundary.
  offset: { type: Number, default: 0 },
});

export default mongoose.models.AnalyticsOffset || mongoose.model('AnalyticsOffset', analyticsOffsetSchema);

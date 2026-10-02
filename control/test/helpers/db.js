import mongoose from 'mongoose';
import '../../src/models/User.js';
import '../../src/models/Server.js';

let connected = false;

// node --test runs each test file as its own process, so a per-process suffix
// gives every file a distinct database; otherwise one file's dropDatabase()
// would wipe data another file is still using.
const RUN_ID = `${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

export async function connectTestDB() {
  if (connected) return mongoose.connection;
  const base = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/deployment_control';
  const uri = base.replace(/\/([^/?]+)(\?|$)/, `/$1_test_${RUN_ID}$2`);
  await mongoose.connect(uri);
  // Build unique indexes up front so duplicate-key assertions don't race index creation.
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  connected = true;
  return mongoose.connection;
}

export async function clearTestDB() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

export async function disconnectTestDB() {
  if (!connected) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  connected = false;
}

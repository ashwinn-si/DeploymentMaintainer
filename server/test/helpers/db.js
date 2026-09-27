import mongoose from 'mongoose';
import { loadConfig } from '../../src/config.js';

let connected = false;

// node --test runs each test file as its own process, so process.pid makes a
// distinct database per file — otherwise files running concurrently against
// the same "_test" database race, and one file's dropDatabase() (in
// disconnectTestDB) can wipe data another file is still using.
const RUN_ID = `${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

export async function connectTestDB() {
  if (connected) return mongoose.connection;
  const config = loadConfig({ require: ['MONGO_URI'] });
  const uri = config.MONGO_URI.replace(/\/([^/?]+)(\?|$)/, `/$1_test_${RUN_ID}$2`);
  await mongoose.connect(uri);
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

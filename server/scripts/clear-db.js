import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import mongoose from 'mongoose';
import { loadConfig } from '../src/config.js';
import { connectDB, disconnectDB } from '../src/db.js';

async function main() {
  let config;
  try {
    config = loadConfig({ require: ['MONGO_URI'] });
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  console.warn('WARNING: this permanently drops the entire database.');
  console.warn('PM2 processes, app folders on disk, and Nginx config files are NOT touched.');
  console.warn('Consider exporting your config from Settings first if this server has apps deployed.');

  await connectDB(config.MONGO_URI);
  const dbName = mongoose.connection.name;

  const skipConfirm = process.argv.includes('--yes');
  if (!skipConfirm) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(`Type the database name (${dbName}) to confirm: `);
    rl.close();
    if (answer.trim() !== dbName) {
      console.error('Confirmation did not match. Aborting; nothing was dropped.');
      await disconnectDB();
      process.exitCode = 1;
      return;
    }
  }

  await mongoose.connection.dropDatabase();
  console.log(`Dropped database "${dbName}". Run "npm run seed" to recreate the admin user.`);
  await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

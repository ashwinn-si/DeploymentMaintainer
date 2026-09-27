import bcrypt from 'bcryptjs';
import { loadConfig } from '../src/config.js';
import { connectDB, disconnectDB } from '../src/db.js';
import User from '../src/models/User.js';

const BCRYPT_COST = 12;

async function main() {
  let config;
  try {
    config = loadConfig({ require: ['MONGO_URI', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'] });
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  await connectDB(config.MONGO_URI);
  try {
    const email = config.ADMIN_EMAIL.toLowerCase();
    const passwordHash = await bcrypt.hash(config.ADMIN_PASSWORD, BCRYPT_COST);

    const existing = await User.findOne({ email });
    if (existing) {
      existing.passwordHash = passwordHash;
      existing.tokenVersion += 1;
      await existing.save();
      console.log(`Reset password for existing admin ${email}; previous sessions invalidated.`);
    } else {
      await User.create({ email, passwordHash });
      console.log(`Created admin user ${email}.`);
    }
  } finally {
    await disconnectDB();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

import 'dotenv/config';
import { parseMongoUri } from './scripts/migrate-helpers.js';

const { url, databaseName } = parseMongoUri(process.env.MONGO_URI);

export default {
  mongodb: { url, databaseName },
  migrationsDir: 'migrations',
  changelogCollectionName: 'migrations_changelog',
  migrationFileExtension: '.js',
  // Hash-less: a migration is identified by its file name only, so reformatting one never re-runs it.
  useFileHash: false,
  moduleSystem: 'esm',
};

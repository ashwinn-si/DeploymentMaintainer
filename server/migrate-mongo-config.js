import 'dotenv/config';

// Splits MONGO_URI into the server part and the database name migrate-mongo wants separately.
function parseMongoUri(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/]+)\/([^/?]+)/.exec(uri ?? '');
  if (!match) {
    throw new Error('MONGO_URI must look like mongodb://host:27017/<database> to run migrations');
  }
  return { url: uri, databaseName: match[2] };
}

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

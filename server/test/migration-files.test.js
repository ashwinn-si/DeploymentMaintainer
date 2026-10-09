import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const NAME_PATTERN = /^\d{14}-[a-z0-9]+(-[a-z0-9]+)*\.js$/;

async function migrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith('.js')).map((e) => e.name).sort();
}

test('every file in server/migrations is named YYYYMMDDHHmmss-kebab-description.js', async () => {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'README.md') continue;
    assert.ok(entry.isFile(), `${entry.name}: only migration files belong in server/migrations`);
    assert.match(entry.name, NAME_PATTERN, `${entry.name} must match ${NAME_PATTERN} (e.g. 20261009000100-request-stat-indexes.js)`);
  }
});

test('migration names are unique and carry a real UTC date-time', async () => {
  const files = await migrationFiles();
  assert.ok(files.length > 0, 'there is at least one migration');
  assert.equal(new Set(files).size, files.length);
  for (const file of files) {
    const [, y, mo, d, h, mi, s] = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-/.exec(file);
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    assert.equal(date.toISOString().slice(0, 19).replace(/\D/g, ''), file.slice(0, 14), `${file}: timestamp is not a valid date-time`);
  }
});

test('every migration exports up and down functions', async () => {
  for (const file of await migrationFiles()) {
    const migration = await import(pathToFileURL(path.join(MIGRATIONS_DIR, file)).href);
    assert.equal(typeof migration.up, 'function', `${file} must export up()`);
    assert.equal(typeof migration.down, 'function', `${file} must export down()`);
  }
});

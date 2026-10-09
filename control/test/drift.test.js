import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTROL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Fails when a Mongoose model changed without a new mongoose-drift snapshot.
test('the Mongoose models match the latest committed mongoose-drift snapshot', () => {
  const run = spawnSync(process.execPath, ['scripts/drift-check.js'], { cwd: CONTROL_DIR, encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stderr}${run.stdout}`);
});

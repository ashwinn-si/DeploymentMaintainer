import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptJSON, decryptJSON } from '../src/lib/crypto.js';

const config = { ENCRYPTION_KEY: 'b'.repeat(64) };

test('encryptJSON/decryptJSON round-trip', () => {
  const blob = encryptJSON(config, { secret: 'hunter2' });
  assert.ok(blob.iv && blob.tag && blob.data);
  assert.ok(!JSON.stringify(blob).includes('hunter2'));
  assert.deepEqual(decryptJSON(config, blob), { secret: 'hunter2' });
});

test('decryptJSON fails with a different key or tampered data', () => {
  const blob = encryptJSON(config, { secret: 'x' });
  assert.throws(() => decryptJSON({ ENCRYPTION_KEY: 'c'.repeat(64) }, blob));
  assert.throws(() => decryptJSON(config, { ...blob, data: Buffer.from('tampered').toString('base64') }));
});

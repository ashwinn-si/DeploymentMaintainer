import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptJSON,
  decryptJSON,
  encryptWithPassphrase,
  decryptWithPassphrase,
} from '../src/services/crypto.js';
import { HttpError } from '../src/lib/httpError.js';

const config = { ENCRYPTION_KEY: 'a'.repeat(64) };
const otherConfig = { ENCRYPTION_KEY: 'b'.repeat(64) };

test('encryptJSON/decryptJSON round-trips an object', () => {
  const obj = { API_KEY: 'super-secret', COUNT: 3, nested: { ok: true } };
  const blob = encryptJSON(config, obj);
  assert.equal(typeof blob.iv, 'string');
  assert.equal(typeof blob.tag, 'string');
  assert.equal(typeof blob.data, 'string');
  assert.notEqual(blob.data, JSON.stringify(obj));
  assert.deepEqual(decryptJSON(config, blob), obj);
});

test('decryptJSON with the wrong key throws HttpError 400', () => {
  const blob = encryptJSON(config, { a: 1 });
  assert.throws(
    () => decryptJSON(otherConfig, blob),
    (err) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 400);
      assert.match(err.message, /Wrong passphrase or corrupted data/);
      return true;
    },
  );
});

test('encryptWithPassphrase/decryptWithPassphrase round-trips with a random salt', () => {
  const obj = { hello: 'world' };
  const blob1 = encryptWithPassphrase(obj, 'correct horse battery staple');
  const blob2 = encryptWithPassphrase(obj, 'correct horse battery staple');
  assert.notEqual(blob1.salt, blob2.salt, 'salt should be random per call');
  assert.deepEqual(decryptWithPassphrase(blob1, 'correct horse battery staple'), obj);
});

test('decryptWithPassphrase with the wrong passphrase throws HttpError 400', () => {
  const blob = encryptWithPassphrase({ a: 1 }, 'right-passphrase');
  assert.throws(
    () => decryptWithPassphrase(blob, 'wrong-passphrase'),
    (err) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 400);
      return true;
    },
  );
});

test('decryptWithPassphrase on corrupted/missing-salt data throws HttpError 400', () => {
  assert.throws(() => decryptWithPassphrase({ iv: 'x', tag: 'y', data: 'z' }, 'pw'), HttpError);
});

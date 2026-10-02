import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../src/config.js';

const VALID = {
  MONGO_URI: 'mongodb://127.0.0.1:27017/x',
  JWT_SECRET: 'j'.repeat(32),
  ENCRYPTION_KEY: 'a'.repeat(64),
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'p'.repeat(12),
};
const MANAGED = [...Object.keys(VALID), 'PORT', 'NODE_ENV', 'ALLOW_INSECURE_SERVER_URLS'];

function withEnv(env, fn) {
  const saved = Object.fromEntries(MANAGED.map((k) => [k, process.env[k]]));
  for (const k of MANAGED) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of MANAGED) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('loadConfig applies defaults', () => {
  const config = withEnv(VALID, () => loadConfig());
  assert.equal(config.PORT, 3100);
  assert.equal(config.NODE_ENV, 'development');
  assert.equal(config.ALLOW_INSECURE_SERVER_URLS, false);
});

test('loadConfig reports every missing/invalid required var', () => {
  assert.throws(
    () => withEnv({ JWT_SECRET: 'short', ENCRYPTION_KEY: 'zz' }, () => loadConfig()),
    (err) => {
      assert.ok(err instanceof ConfigError);
      const text = err.issues.join('\n');
      assert.match(text, /MONGO_URI/);
      assert.match(text, /JWT_SECRET/);
      assert.match(text, /ENCRYPTION_KEY/);
      return true;
    },
  );
});

test('seed-style require enforces ADMIN_* only when asked', () => {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ...rest } = VALID;
  assert.doesNotThrow(() => withEnv(rest, () => loadConfig()));
  assert.throws(() => withEnv({ ...rest, ADMIN_EMAIL, ADMIN_PASSWORD: 'short' }, () => loadConfig({ require: ['ADMIN_EMAIL', 'ADMIN_PASSWORD'] })), /ADMIN_PASSWORD/);
});

test('ALLOW_INSECURE_SERVER_URLS parses booleans', () => {
  const config = withEnv({ ...VALID, ALLOW_INSECURE_SERVER_URLS: 'true' }, () => loadConfig());
  assert.equal(config.ALLOW_INSECURE_SERVER_URLS, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../src/config.js';

const REQUIRED_KEYS = [
  'MONGO_URI',
  'SERVER_ID',
  'SERVER_SECRET',
  'ENCRYPTION_KEY',
  'APPS_DIR',
  'NGINX_APPS_DIR',
];

// Also isolate the defaulted/optional keys: a real server/.env may already
// be loaded into process.env (dotenv runs as a side effect of importing
// config.js), and these tests must not depend on whatever it happens to
// contain.
const ALL_CONFIG_KEYS = [
  ...REQUIRED_KEYS,
  'PORT',
  'APP_PORT_START',
  'DEFAULT_NODE_VERSION',
  'NGINX_ENABLED',
  'ANALYTICS_ENABLED',
  'ACCESS_LOG_DIR',
  'NODE_ENV',
  'GITHUB_TOKEN',
  'GIT_REMOTE_BASE',
];

const VALID_ENV = {
  MONGO_URI: 'mongodb://127.0.0.1:27017/test',
  SERVER_ID: 'test-server-01',
  SERVER_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: 'a'.repeat(64),
  APPS_DIR: '/tmp/apps',
  NGINX_APPS_DIR: '/tmp/nginx-apps',
};

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of ALL_CONFIG_KEYS) saved[key] = process.env[key];
  for (const key of ALL_CONFIG_KEYS) delete process.env[key];
  Object.assign(process.env, overrides);
  try {
    return fn();
  } finally {
    for (const key of ALL_CONFIG_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('loadConfig succeeds with a fully valid env and returns a frozen object', () => {
  withEnv(VALID_ENV, () => {
    const config = loadConfig();
    assert.equal(config.MONGO_URI, VALID_ENV.MONGO_URI);
    assert.equal(config.PORT, 3000);
    assert.equal(config.NGINX_ENABLED, true);
    assert.throws(() => {
      config.PORT = 9999;
    });
  });
});

test('loadConfig throws ConfigError listing every missing required var', () => {
  withEnv({}, () => {
    assert.throws(
      () => loadConfig(),
      (err) => {
        assert.ok(err instanceof ConfigError);
        for (const key of REQUIRED_KEYS) {
          assert.ok(
            err.issues.some((issue) => issue.startsWith(key)),
            `expected an issue for ${key}, got: ${err.issues.join(', ')}`,
          );
        }
        return true;
      },
    );
  });
});

test('loadConfig rejects a too-short SERVER_SECRET', () => {
  withEnv({ ...VALID_ENV, SERVER_SECRET: 'too-short' }, () => {
    assert.throws(() => loadConfig(), /SERVER_SECRET/);
  });
});

test('loadConfig rejects a malformed SERVER_ID', () => {
  for (const bad of ['short', 'has space!', 'x'.repeat(65)]) {
    withEnv({ ...VALID_ENV, SERVER_ID: bad }, () => {
      assert.throws(() => loadConfig(), /SERVER_ID/);
    });
  }
});

test('loadConfig rejects a malformed ENCRYPTION_KEY', () => {
  withEnv({ ...VALID_ENV, ENCRYPTION_KEY: 'not-hex' }, () => {
    assert.throws(() => loadConfig(), /ENCRYPTION_KEY/);
  });
});

test('loadConfig respects a narrower require list (e.g. for clear-db)', () => {
  withEnv({ MONGO_URI: VALID_ENV.MONGO_URI }, () => {
    const config = loadConfig({ require: ['MONGO_URI'] });
    assert.equal(config.MONGO_URI, VALID_ENV.MONGO_URI);
  });
});

test('a narrower require list still validates the format of vars that are present', () => {
  withEnv({ MONGO_URI: VALID_ENV.MONGO_URI, SERVER_ID: 'bad id' }, () => {
    assert.throws(() => loadConfig({ require: ['MONGO_URI'] }), /SERVER_ID/);
  });
});

test('analytics settings default to enabled with the standard nginx log directory and can be overridden', () => {
  withEnv(VALID_ENV, () => {
    const config = loadConfig();
    assert.equal(config.ANALYTICS_ENABLED, true);
    assert.equal(config.ACCESS_LOG_DIR, '/var/log/nginx/deployer');
  });
  withEnv({ ...VALID_ENV, ANALYTICS_ENABLED: 'false', ACCESS_LOG_DIR: '/srv/logs' }, () => {
    const config = loadConfig();
    assert.equal(config.ANALYTICS_ENABLED, false);
    assert.equal(config.ACCESS_LOG_DIR, '/srv/logs');
  });
});

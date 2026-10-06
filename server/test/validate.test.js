import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOwner,
  validateRepo,
  validateRef,
  validateAppName,
  validatePort,
  validateNodeVersion,
  validateEnvKey,
  validateEnvValue,
  validateCommitSha,
  validateNginxPath,
  validateHealthCheckPath,
  validateEnvFilename,
  validateStaticDir,
  refinable,
  RESERVED_APP_NAMES,
} from '../src/lib/validate.js';
import { HttpError } from '../src/lib/httpError.js';

test('validateOwner accepts valid owners', () => {
  assert.equal(validateOwner('octocat'), 'octocat');
  assert.equal(validateOwner('my-org-1'), 'my-org-1');
});

test('validateOwner rejects invalid owners', () => {
  for (const bad of ['../x', 'a b', '', 'a/b', 'x'.repeat(40)]) {
    assert.throws(() => validateOwner(bad), HttpError);
  }
});

test('validateRepo accepts valid repo names', () => {
  assert.equal(validateRepo('my-repo'), 'my-repo');
  assert.equal(validateRepo('my.repo_name'), 'my.repo_name');
});

test('validateRepo rejects invalid repo names', () => {
  for (const bad of ['../x', 'a b', '', 'a/b']) {
    assert.throws(() => validateRepo(bad), HttpError);
  }
});

test('validateRef accepts valid refs', () => {
  assert.equal(validateRef('main'), 'main');
  assert.equal(validateRef('feature/foo-bar'), 'feature/foo-bar');
});

test('validateRef rejects path traversal, flags, spaces and double dots', () => {
  for (const bad of ['../x', '-rf', 'a b', 'a..b', '', 'x'.repeat(256)]) {
    assert.throws(() => validateRef(bad), HttpError);
  }
});

test('validateAppName accepts a lowercase slug', () => {
  assert.equal(validateAppName('api-main'), 'api-main');
});

test('validateAppName rejects bad slugs and reserved names', () => {
  for (const bad of ['API-Main', 'has space', 'a'.repeat(41), '']) {
    assert.throws(() => validateAppName(bad), HttpError);
  }
  for (const reserved of RESERVED_APP_NAMES) {
    assert.throws(() => validateAppName(reserved), HttpError);
  }
});

test('validatePort accepts the 1024-65535 range', () => {
  assert.equal(validatePort(1024), 1024);
  assert.equal(validatePort(65535), 65535);
  assert.equal(validatePort('4001'), 4001);
});

test('validatePort rejects out-of-range or non-integer ports', () => {
  for (const bad of [1023, 65536, 0, -1, 3.5, 'nope']) {
    assert.throws(() => validatePort(bad), HttpError);
  }
});

test('validateNodeVersion accepts bare major, semver and "lts"', () => {
  assert.equal(validateNodeVersion('20'), '20');
  assert.equal(validateNodeVersion('20.11.0'), '20.11.0');
  assert.equal(validateNodeVersion('lts'), 'lts');
});

test('validateNodeVersion rejects garbage', () => {
  for (const bad of ['v20', '20.x', 'latest', '']) {
    assert.throws(() => validateNodeVersion(bad), HttpError);
  }
});

test('validateEnvKey accepts SCREAMING_SNAKE_CASE', () => {
  assert.equal(validateEnvKey('API_KEY'), 'API_KEY');
  assert.equal(validateEnvKey('_PRIVATE'), '_PRIVATE');
});

test('validateEnvKey rejects lowercase, leading digits and stray characters', () => {
  for (const bad of ['api_key', '1KEY', 'KEY-NAME', '']) {
    assert.throws(() => validateEnvKey(bad), HttpError);
  }
});

test('validateEnvValue accepts ordinary strings including empty', () => {
  assert.equal(validateEnvValue(''), '');
  assert.equal(validateEnvValue('postgres://user:pass@host/db'), 'postgres://user:pass@host/db');
});

test('validateEnvValue rejects newlines and null bytes', () => {
  for (const bad of ['a\nb', 'a\rb', 'a\0b']) {
    assert.throws(() => validateEnvValue(bad), HttpError);
  }
});

test('validateCommitSha accepts 7-40 char hex shas', () => {
  assert.equal(validateCommitSha('abc1234'), 'abc1234');
  assert.equal(validateCommitSha('a'.repeat(40)), 'a'.repeat(40));
});

test('validateCommitSha rejects too-short, too-long or non-hex values', () => {
  for (const bad of ['abc12', 'a'.repeat(41), 'ABCDEFG', 'zzzzzzz']) {
    assert.throws(() => validateCommitSha(bad), HttpError);
  }
});

test('validateNginxPath accepts single and multi-segment lowercase paths', () => {
  assert.equal(validateNginxPath('/my-app'), '/my-app');
  assert.equal(validateNginxPath('/team/my-app'), '/team/my-app');
});

test('validateNginxPath rejects missing leading slash, trailing slash and uppercase', () => {
  for (const bad of ['my-app', '/My-App', '/my-app/', '/']) {
    assert.throws(() => validateNginxPath(bad), HttpError);
  }
});

test('validateHealthCheckPath accepts ordinary URL paths', () => {
  assert.equal(validateHealthCheckPath('/'), '/');
  assert.equal(validateHealthCheckPath('/health'), '/health');
  assert.equal(validateHealthCheckPath('/api/v1/health'), '/api/v1/health');
});

test('validateHealthCheckPath rejects spaces, newlines and overly long paths', () => {
  for (const bad of ['/has space', '/has\nnewline', '/has\rcr', `/${'a'.repeat(200)}`, 'no-leading-slash']) {
    assert.throws(() => validateHealthCheckPath(bad), HttpError);
  }
});

test('validateEnvFilename accepts plain and dotfile names', () => {
  assert.equal(validateEnvFilename('.env'), '.env');
  assert.equal(validateEnvFilename('.env.production'), '.env.production');
  assert.equal(validateEnvFilename('env-vars.txt'), 'env-vars.txt');
});

test('validateEnvFilename rejects path traversal and path separators', () => {
  for (const bad of ['..', '.', '../../etc/passwd', 'a/b', '']) {
    assert.throws(() => validateEnvFilename(bad), HttpError);
  }
});

test('refinable wraps a throwing validator into a boolean predicate, passing undefined through', () => {
  const predicate = refinable(validateNginxPath);
  assert.equal(predicate(undefined), true);
  assert.equal(predicate('/ok'), true);
  assert.equal(predicate('bad'), false);
});

test('validateStaticDir accepts valid relative paths', () => {
  assert.equal(validateStaticDir('.'), '.');
  assert.equal(validateStaticDir('dist'), 'dist');
  assert.equal(validateStaticDir('build/public'), 'build/public');
});

test('validateStaticDir rejects path traversal, absolute paths and injection', () => {
  for (const bad of ['../etc', '/var/www', 'dist; evil', 'dist\n', 'a b', '-flag', '']) {
    assert.throws(() => validateStaticDir(bad), HttpError);
  }
});


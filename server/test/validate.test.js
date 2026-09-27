import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOwner, validateRepo, validateRef } from '../src/lib/validate.js';
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

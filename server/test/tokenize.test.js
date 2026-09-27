import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeCommand } from '../src/services/shell.js';

test('splits on whitespace', () => {
  assert.deepEqual(tokenizeCommand('npm run build'), ['npm', 'run', 'build']);
  assert.deepEqual(tokenizeCommand('  a   b  '), ['a', 'b']);
});

test('single quotes preserve literal content including spaces', () => {
  assert.deepEqual(tokenizeCommand("echo 'hello world'"), ['echo', 'hello world']);
  assert.deepEqual(tokenizeCommand("echo 'a|b;c'"), ['echo', 'a|b;c']);
});

test('double quotes support backslash escapes', () => {
  assert.deepEqual(tokenizeCommand('echo "a\\"b"'), ['echo', 'a"b']);
  assert.deepEqual(tokenizeCommand('echo "line one"'), ['echo', 'line one']);
  assert.deepEqual(tokenizeCommand('echo "back\\\\slash"'), ['echo', 'back\\slash']);
});

test('backslash escapes a space outside quotes', () => {
  assert.deepEqual(tokenizeCommand('echo foo\\ bar'), ['echo', 'foo bar']);
});

test('adjacent quoted and unquoted segments join into one token', () => {
  assert.deepEqual(tokenizeCommand('echo foo"bar baz"qux'), ['echo', 'foobar bazqux']);
});

test('rejects unquoted shell operators', () => {
  for (const bad of ['ls | grep x', 'a; b', 'a && b', 'a > out.txt', 'a < in.txt', 'echo `id`', 'echo $(id)']) {
    assert.throws(() => tokenizeCommand(bad), /shell operators are not supported/);
  }
});

test('allows those characters when quoted', () => {
  assert.deepEqual(tokenizeCommand('echo "a;b|c"'), ['echo', 'a;b|c']);
  assert.deepEqual(tokenizeCommand("echo '$(not substituted)'"), ['echo', '$(not substituted)']);
});

test('throws on unterminated quotes', () => {
  assert.throws(() => tokenizeCommand("echo 'unterminated"), /unterminated quote/);
  assert.throws(() => tokenizeCommand('echo "unterminated'), /unterminated quote/);
});

test('empty string yields no tokens', () => {
  assert.deepEqual(tokenizeCommand(''), []);
  assert.deepEqual(tokenizeCommand('   '), []);
});

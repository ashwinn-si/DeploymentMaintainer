import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { run } from '../src/services/shell.js';

test('captures stdout and stderr, reports exit code 0', async () => {
  const result = await run('node', ['-e', "process.stdout.write('out-line\\n'); process.stderr.write('err-line\\n');"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /out-line/);
  assert.match(result.stderr, /err-line/);
});

test('reports non-zero exit codes', async () => {
  const result = await run('node', ['-e', 'process.exit(3)']);
  assert.equal(result.code, 3);
});

test('onLine delivers full lines, including a trailing partial line flushed on close', async () => {
  const script = "process.stdout.write('line1\\nline2\\n'); process.stdout.write('partial-no-newline');";
  const lines = [];
  const result = await run('node', ['-e', script], {
    onLine: ({ stream, text }) => lines.push({ stream, text }),
  });
  assert.equal(result.code, 0);
  assert.deepEqual(
    lines.filter((l) => l.stream === 'stdout'),
    [
      { stream: 'stdout', text: 'line1' },
      { stream: 'stdout', text: 'line2' },
      { stream: 'stdout', text: 'partial-no-newline' },
    ],
  );
});

test('onLine handles a line split across two chunks', async () => {
  const script = [
    "process.stdout.write('abc');",
    'setTimeout(() => {',
    "  process.stdout.write('def\\n');",
    '}, 50);',
  ].join('\n');
  const lines = [];
  const result = await run('node', ['-e', script], {
    onLine: ({ stream, text }) => lines.push({ stream, text }),
  });
  assert.equal(result.code, 0);
  assert.deepEqual(
    lines.filter((l) => l.stream === 'stdout'),
    [{ stream: 'stdout', text: 'abcdef' }],
  );
});

test('rejects non-string cmd or argv', async () => {
  await assert.rejects(() => run(123, []), TypeError);
  await assert.rejects(() => run('node', ['ok', 5]), TypeError);
});

test('abort kills the whole process group promptly, including background children', async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const resultPromise = run('sh', ['-c', 'sleep 30 & sleep 30 & wait'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 200);

  const result = await resultPromise;
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.aborted, true);
  assert.ok(elapsedMs < 5000, `expected termination well under 5s, took ${elapsedMs}ms`);

  await new Promise((resolve) => setTimeout(resolve, 200));
  let stillRunning = true;
  try {
    execSync('pgrep -f "sleep 30"', { stdio: 'ignore' });
  } catch {
    stillRunning = false;
  }
  assert.equal(stillRunning, false, 'no orphaned sleep processes should remain');
});

test('timeoutMs aborts a long-running command', async () => {
  const startedAt = Date.now();
  const result = await run('node', ['-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 300 });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(result.timedOut, true);
  assert.ok(elapsedMs < 5000, `expected termination well under 5s, took ${elapsedMs}ms`);
});

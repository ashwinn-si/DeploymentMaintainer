import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeployLog, deployEvents } from '../src/services/deployLog.js';

function collectingPersist(store) {
  return async (deploymentId, entries) => {
    store.push(...entries);
  };
}

test('entries flow through to persist and get flushed', async () => {
  const store = [];
  const log = createDeployLog({ _id: 'dep1' }, { persist: collectingPersist(store), flushIntervalMs: 20 });
  log.info('hello', 'step1');
  log.cmd('npm ci', 'step1');
  await log.flush();
  assert.equal(store.length, 2);
  assert.equal(store[0].stream, 'info');
  assert.equal(store[0].text, 'hello');
  assert.equal(store[0].step, 'step1');
  assert.equal(store[1].stream, 'cmd');
});

test('onLine(step) tags stdout/stderr lines with that step', async () => {
  const store = [];
  const log = createDeployLog({ _id: 'dep2' }, { persist: collectingPersist(store) });
  const handler = log.onLine('install');
  handler({ stream: 'stdout', text: 'added 0 packages' });
  handler({ stream: 'stderr', text: 'a warning' });
  await log.flush();
  assert.equal(store.length, 2);
  assert.equal(store[0].step, 'install');
  assert.equal(store[0].stream, 'stdout');
  assert.equal(store[1].stream, 'stderr');
});

test('redacts secret values (token, env values, auth header) from all streams', async () => {
  const store = [];
  const secret = 'ghp_supersecrettoken1234567890';
  const envValue = 'sk-verysecretkey';
  const authHeader = 'basic ZmFrZS1hdXRoLWhlYWRlcg==';
  const log = createDeployLog(
    { _id: 'dep3' },
    { persist: collectingPersist(store), secrets: [secret, envValue, authHeader] },
  );

  log.cmd(`git -c http.extraheader=AUTHORIZATION: ${authHeader} fetch`, 'gitSync');
  log.info(`using token ${secret}`, 'gitSync');
  log.info(`API_KEY=${envValue}`, 'writeEnv');
  await log.flush();

  const allText = store.map((e) => e.text).join('\n');
  assert.ok(!allText.includes(secret));
  assert.ok(!allText.includes(envValue));
  assert.ok(!allText.includes(authHeader));
  assert.ok(allText.includes('••••'));
});

test('short strings (<4 chars) are never treated as secrets', async () => {
  const store = [];
  const log = createDeployLog({ _id: 'dep4' }, { persist: collectingPersist(store), secrets: ['ok', ''] });
  log.info('this is ok text', 'step');
  await log.flush();
  assert.equal(store[0].text, 'this is ok text');
});

test('truncates once the byte cap is exceeded and stops accepting further entries', async () => {
  const store = [];
  const log = createDeployLog({ _id: 'dep5' }, { persist: collectingPersist(store), maxBytes: 20 });
  log.info('0123456789'); // 10 bytes, under cap
  log.info('0123456789'); // pushes total to 20, still under (not over) — allowed
  log.info('this pushes us well over the cap'); // now truncates
  log.info('should be dropped entirely');
  await log.flush();

  const texts = store.map((e) => e.text);
  assert.ok(texts.includes('…log truncated'));
  assert.ok(!texts.includes('should be dropped entirely'));
  assert.equal(texts[texts.length - 1], '…log truncated');
});

test('stepStart/stepEnd bypass truncation so the step timeline stays accurate', async () => {
  const store = [];
  const log = createDeployLog({ _id: 'dep5b' }, { persist: collectingPersist(store), maxBytes: 10 });
  log.info('well over the ten byte cap, so this truncates');
  log.stepStart('install');
  log.stepEnd('install', 'success');
  await log.flush();

  const texts = store.map((e) => e.text);
  assert.ok(texts.some((t) => t.includes('▶ install')));
  assert.ok(texts.some((t) => t.includes('✔ install')));
});

test('info/cmd/error accept {force:true} to bypass truncation', async () => {
  const store = [];
  const log = createDeployLog({ _id: 'dep5c' }, { persist: collectingPersist(store), maxBytes: 5 });
  log.info('this alone exceeds the cap and truncates');
  log.error('final summary: deploy failed', null, { force: true });
  await log.flush();

  const texts = store.map((e) => e.text);
  assert.ok(texts.includes('final summary: deploy failed'));
});

test('a persist failure is caught, entries are retried on the next flush, and nothing throws', async () => {
  let attempts = 0;
  const store = [];
  const flaky = async (deploymentId, entries) => {
    attempts += 1;
    if (attempts === 1) throw new Error('mongo is down');
    store.push(...entries);
  };
  const originalConsoleError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(' '));

  try {
    const log = createDeployLog({ _id: 'dep8' }, { persist: flaky });
    log.info('hello');
    await assert.doesNotReject(() => log.flush());
    assert.equal(store.length, 0, 'first flush failed, nothing persisted yet');
    assert.ok(errors.some((e) => e.includes('flush failed')));

    await log.flush();
    assert.equal(store.length, 1, 'retried flush persists the buffered entry');
    assert.equal(store[0].text, 'hello');
  } finally {
    console.error = originalConsoleError;
  }
});

test('stepStart/stepEnd emit "step" events and close() emits "done"', async () => {
  const seen = { step: [], done: [] };
  const onStep = (payload) => { if (payload.deploymentId === 'dep6') seen.step.push(payload); };
  const onDone = (payload) => { if (payload.deploymentId === 'dep6') seen.done.push(payload); };
  deployEvents.on('step', onStep);
  deployEvents.on('done', onDone);

  try {
    const store = [];
    const log = createDeployLog({ _id: 'dep6' }, { persist: collectingPersist(store) });
    log.stepStart('gitSync');
    log.stepEnd('gitSync', 'success');
    await log.close();

    assert.equal(seen.step.length, 2);
    assert.equal(seen.step[0].status, 'running');
    assert.equal(seen.step[1].status, 'success');
    assert.equal(seen.done.length, 1);
  } finally {
    deployEvents.off('step', onStep);
    deployEvents.off('done', onDone);
  }
});

test('"line" events carry the deploymentId for SSE filtering', async () => {
  const seen = [];
  const onLine = (payload) => { if (payload.deploymentId === 'dep7') seen.push(payload); };
  deployEvents.on('line', onLine);
  try {
    const store = [];
    const log = createDeployLog({ _id: 'dep7' }, { persist: collectingPersist(store) });
    log.info('hi', 'stepX');
    await log.flush();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].text, 'hi');
    assert.equal(seen[0].step, 'stepX');
  } finally {
    deployEvents.off('line', onLine);
  }
});

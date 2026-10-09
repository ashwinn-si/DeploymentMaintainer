import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import App from '../src/models/App.js';
import RequestStat from '../src/models/RequestStat.js';
import AnalyticsOffset from '../src/models/AnalyticsOffset.js';
import {
  parseCombinedLine,
  bucketLines,
  startAnalytics,
  stopAnalytics,
  getAnalyticsWarnings,
  __runAnalyticsTick,
  __resetAnalyticsState,
} from '../src/services/analytics.js';
import { logLine } from './helpers/accessLog.js';
import { connectTestDB, clearTestDB, disconnectTestDB } from './helpers/db.js';

// --- parseCombinedLine / bucketLines -------------------------------------------------

test('parseCombinedLine reads a standard combined line', () => {
  const parsed = parseCombinedLine(
    '203.0.113.9 - bob [09/Oct/2026:10:15:30 +0000] "POST /my-app/api/items?x=1 HTTP/2.0" 201 512 "https://example.com/" "Mozilla/5.0 (X11; Linux x86_64)"',
  );
  assert.deepEqual(parsed, {
    time: new Date('2026-10-09T10:15:30.000Z'),
    status: 201,
    bytes: 512,
    path: '/my-app/api/items?x=1',
    method: 'POST',
  });
});

test('parseCombinedLine converts a non-UTC timestamp to UTC and handles "-" bytes', () => {
  const parsed = parseCombinedLine('10.0.0.1 - - [09/Oct/2026:23:30:00 -0500] "GET / HTTP/1.1" 304 - "-" "-"');
  assert.equal(parsed.time.toISOString(), '2026-10-10T04:30:00.000Z');
  assert.equal(parsed.bytes, 0);
  assert.equal(parsed.status, 304);
  const east = parseCombinedLine('10.0.0.1 - - [09/Oct/2026:01:30:00 +0530] "GET / HTTP/1.1" 200 1 "-" "-"');
  assert.equal(east.time.toISOString(), '2026-10-08T20:00:00.000Z');
});

test('parseCombinedLine accepts IPv6 clients', () => {
  const parsed = parseCombinedLine('2001:db8::1 - - [09/Oct/2026:10:15:30 +0000] "GET /a HTTP/1.1" 200 5 "-" "UA"');
  assert.equal(parsed.path, '/a');
  assert.equal(parseCombinedLine('::1 - - [09/Oct/2026:10:15:30 +0000] "GET /a HTTP/1.1" 200 5 "-" "UA"').status, 200);
});

test('parseCombinedLine tolerates quotes (escaped or not) and brackets in the user agent', () => {
  const escaped = parseCombinedLine('1.2.3.4 - - [09/Oct/2026:10:15:30 +0000] "GET /a HTTP/1.1" 200 5 "-" "Evil \\x22quoted\\x22 [bot]"');
  assert.equal(escaped.status, 200);
  const raw = parseCombinedLine('1.2.3.4 - - [09/Oct/2026:10:15:30 +0000] "GET /a HTTP/1.1" 404 5 "http://r/" "weird "agent" \\"x\\""');
  assert.equal(raw.status, 404);
});

test('parseCombinedLine returns null for malformed lines', () => {
  for (const bad of [
    '',
    'garbage',
    '1.2.3.4 - - [not a date] "GET / HTTP/1.1" 200 5 "-" "-"',
    '1.2.3.4 - - [09/Oct/2026:10:15:30 +0000] "-" 400 0 "-" "-"',
    '1.2.3.4 - - [09/Oct/2026:10:15:30 +0000] "GET / HTTP/1.1" abc 5 "-" "-"',
    '1.2.3.4 - - [09/Xyz/2026:10:15:30 +0000] "GET / HTTP/1.1" 200 5 "-" "-"',
    '2026/10/09 10:15:30 [error] 1#1: *1 connect() failed',
  ]) {
    assert.equal(parseCombinedLine(bad), null, `expected null for: ${bad}`);
  }
  assert.equal(parseCombinedLine(undefined), null);
});

test('bucketLines aggregates by UTC hour and status class and ignores malformed lines', () => {
  const buckets = bucketLines([
    logLine('2026-10-09T10:00:00Z', { status: 200, bytes: 10 }),
    logLine('2026-10-09T10:59:59Z', { status: 204, bytes: 20 }),
    logLine('2026-10-09T10:30:00Z', { status: 301, bytes: 1 }),
    logLine('2026-10-09T11:00:00Z', { status: 404, bytes: 2 }),
    logLine('2026-10-09T11:10:00Z', { status: 502, bytes: 3 }),
    logLine('2026-10-09T11:11:00Z', { status: 500, bytes: 4 }),
    logLine('2026-10-09T11:12:00Z', { status: 101, bytes: 0 }),
    'not a log line',
    '',
  ]);
  assert.equal(buckets.size, 2);
  assert.deepEqual(buckets.get(Date.parse('2026-10-09T10:00:00Z')), { total: 3, s2xx: 2, s3xx: 1, s4xx: 0, s5xx: 0, bytes: 31 });
  // 1xx only counts towards the total.
  assert.deepEqual(buckets.get(Date.parse('2026-10-09T11:00:00Z')), { total: 4, s2xx: 0, s3xx: 0, s4xx: 1, s5xx: 2, bytes: 9 });
});

// --- collector ------------------------------------------------------------------------

test.before(connectTestDB);
test.after(disconnectTestDB);
test.afterEach(async () => {
  stopAnalytics();
  __resetAnalyticsState();
  await clearTestDB();
});

async function withLogDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-access-logs-'));
  try {
    await fn(dir, { ACCESS_LOG_DIR: dir, ANALYTICS_ENABLED: true });
  } finally {
    await fs.chmod(dir, 0o755).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function makeApp(name, port = 4001) {
  return App.create({ name, repoFullName: `me/${name}`, branch: 'main', port, nodeVersion: '20' });
}

async function statsFor(app) {
  const rows = await RequestStat.find({ appId: app._id }).sort({ hour: 1 }).lean();
  return rows.map((r) => ({
    hour: r.hour.toISOString(),
    total: r.total,
    s2xx: r.s2xx,
    s3xx: r.s3xx,
    s4xx: r.s4xx,
    s5xx: r.s5xx,
    bytes: r.bytes,
  }));
}

const lines = (...ls) => `${ls.join('\n')}\n`;

test('a tick buckets log lines into the right hours and a second tick does not double count', async () => {
  await withLogDir(async (dir, config) => {
    const app = await makeApp('site');
    await fs.writeFile(
      path.join(dir, 'site.log'),
      lines(
        logLine('2026-10-09T10:05:00Z', { status: 200, bytes: 10 }),
        logLine('2026-10-09T10:50:00Z', { status: 404, bytes: 5 }),
        logLine('2026-10-09T11:01:00Z', { status: 500, bytes: 1 }),
      ),
    );
    await __runAnalyticsTick(config);
    const expected = [
      { hour: '2026-10-09T10:00:00.000Z', total: 2, s2xx: 1, s3xx: 0, s4xx: 1, s5xx: 0, bytes: 15 },
      { hour: '2026-10-09T11:00:00.000Z', total: 1, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 1, bytes: 1 },
    ];
    assert.deepEqual(await statsFor(app), expected);

    await __runAnalyticsTick(config);
    assert.deepEqual(await statsFor(app), expected, 'unchanged log adds nothing');

    const row = await RequestStat.findOne({ appId: app._id, hour: new Date('2026-10-09T10:00:00Z') }).lean();
    assert.equal(row.appName, 'site');
    assert.equal(row.expireAt.toISOString(), '2027-01-07T10:00:00.000Z', 'expireAt = hour + 90 days');
  });
});

test('appended lines are added on the next tick, only once', async () => {
  await withLogDir(async (dir, config) => {
    const app = await makeApp('site');
    const file = path.join(dir, 'site.log');
    await fs.writeFile(file, lines(logLine('2026-10-09T10:05:00Z')));
    await __runAnalyticsTick(config);
    await fs.appendFile(file, lines(logLine('2026-10-09T10:06:00Z'), logLine('2026-10-09T12:06:00Z', { status: 301 })));
    await __runAnalyticsTick(config);
    await __runAnalyticsTick(config);

    const stats = await statsFor(app);
    assert.equal(stats.length, 2);
    assert.equal(stats[0].total, 2);
    assert.equal(stats[1].s3xx, 1);
  });
});

test('offsets persist in Mongo, so a fresh process does not recount', async () => {
  await withLogDir(async (dir, config) => {
    const app = await makeApp('site');
    const file = path.join(dir, 'site.log');
    await fs.writeFile(file, lines(logLine('2026-10-09T10:05:00Z')));
    await __runAnalyticsTick(config);

    const saved = await AnalyticsOffset.findOne({ appName: 'site' }).lean();
    assert.equal(saved.offset, (await fs.stat(file)).size);
    assert.equal(saved.inode, String((await fs.stat(file)).ino));

    __resetAnalyticsState(); // nothing else is kept in memory between ticks; the offset lives in the database
    await __runAnalyticsTick(config);
    assert.equal((await statsFor(app))[0].total, 1);
  });
});

test('a rotated (new inode) or truncated log restarts from the beginning', async () => {
  await withLogDir(async (dir, config) => {
    const app = await makeApp('site');
    const file = path.join(dir, 'site.log');
    await fs.writeFile(file, lines(logLine('2026-10-09T10:05:00Z'), logLine('2026-10-09T10:06:00Z'), logLine('2026-10-09T10:07:00Z')));
    await __runAnalyticsTick(config);
    assert.equal((await statsFor(app))[0].total, 3);

    // Rotation: the old file moves away (keeping its inode), nginx creates a new, smaller one.
    await fs.rename(file, path.join(dir, 'site.log.1'));
    await fs.writeFile(file, lines(logLine('2026-10-09T11:00:00Z')));
    await __runAnalyticsTick(config);
    let stats = await statsFor(app);
    assert.equal(stats.length, 2);
    assert.equal(stats[1].total, 1, 'the new file is read from byte 0');

    // Truncation in place (same inode, shorter than the saved offset).
    await fs.writeFile(file, lines(logLine('2026-10-09T12:00:00Z', { url: '/' })));
    await __runAnalyticsTick(config);
    stats = await statsFor(app);
    assert.equal(stats.length, 3);
    assert.equal(stats[2].total, 1);
  });
});

test('a new log that is bigger than the old offset but has a different inode is still read from 0', async () => {
  await withLogDir(async (dir, config) => {
    const app = await makeApp('site');
    const file = path.join(dir, 'site.log');
    await fs.writeFile(file, lines(logLine('2026-10-09T10:05:00Z')));
    await __runAnalyticsTick(config);
    await fs.rename(file, path.join(dir, 'site.log.1'));
    await fs.writeFile(file, lines(...Array.from({ length: 5 }, (_, i) => logLine(`2026-10-09T11:0${i}:00Z`))));
    await __runAnalyticsTick(config);
    assert.equal((await statsFor(app)).at(-1).total, 5);
  });
});

test('a partial last line is not consumed until it is completed', async () => {
  await withLogDir(async (dir, config) => {
    const app = await makeApp('site');
    const file = path.join(dir, 'site.log');
    const complete = logLine('2026-10-09T10:05:00Z');
    const second = logLine('2026-10-09T10:06:00Z', { status: 500 });
    const half = second.slice(0, 40);

    await fs.writeFile(file, `${complete}\n${half}`);
    await __runAnalyticsTick(config);
    assert.equal((await statsFor(app))[0].total, 1);
    assert.equal((await AnalyticsOffset.findOne({ appName: 'site' }).lean()).offset, Buffer.byteLength(`${complete}\n`));

    await fs.appendFile(file, `${second.slice(40)}\n`);
    await __runAnalyticsTick(config);
    const stats = await statsFor(app);
    assert.equal(stats[0].total, 2);
    assert.equal(stats[0].s5xx, 1);
  });
});

test('a missing log file is skipped silently and a tick covers several apps', async () => {
  await withLogDir(async (dir, config) => {
    const a = await makeApp('with-log', 4001);
    const b = await makeApp('no-log', 4002);
    await fs.writeFile(path.join(dir, 'with-log.log'), lines(logLine('2026-10-09T10:05:00Z')));
    await __runAnalyticsTick(config);
    assert.equal((await statsFor(a))[0].total, 1);
    assert.deepEqual(await statsFor(b), []);
    assert.deepEqual(getAnalyticsWarnings(), []);
    assert.equal(await AnalyticsOffset.countDocuments({ appName: 'no-log' }), 0);
  });
});

test('a missing log directory is not an error', async () => {
  await makeApp('site');
  await __runAnalyticsTick({ ACCESS_LOG_DIR: path.join(os.tmpdir(), 'dm-does-not-exist-xyz'), ANALYTICS_ENABLED: true });
  assert.equal(await RequestStat.countDocuments(), 0);
  assert.deepEqual(getAnalyticsWarnings(), []);
});

test('an unreadable log records a warning for that app and the others still count', {
  skip: process.getuid?.() === 0 ? 'running as root: permissions are not enforced' : false,
}, async () => {
  await withLogDir(async (dir, config) => {
    const locked = await makeApp('locked', 4001);
    const open = await makeApp('open', 4002);
    await fs.writeFile(path.join(dir, 'locked.log'), lines(logLine('2026-10-09T10:05:00Z')));
    await fs.writeFile(path.join(dir, 'open.log'), lines(logLine('2026-10-09T10:05:00Z')));
    await fs.chmod(path.join(dir, 'locked.log'), 0o000);

    await __runAnalyticsTick(config);
    assert.deepEqual(await statsFor(locked), []);
    assert.equal((await statsFor(open))[0].total, 1);
    const warnings = getAnalyticsWarnings();
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].app, 'locked');
    assert.match(warnings[0].message, /permission denied/i);

    // Fixing the permissions clears the warning and the backlog is counted.
    await fs.chmod(path.join(dir, 'locked.log'), 0o644);
    await __runAnalyticsTick(config);
    assert.deepEqual(getAnalyticsWarnings(), []);
    assert.equal((await statsFor(locked))[0].total, 1);
  });
});

test('startAnalytics is a no-op when ANALYTICS_ENABLED is false', async () => {
  await withLogDir(async (dir) => {
    const app = await makeApp('site');
    await fs.writeFile(path.join(dir, 'site.log'), lines(logLine('2026-10-09T10:05:00Z')));
    startAnalytics({ ACCESS_LOG_DIR: dir, ANALYTICS_ENABLED: false });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(await statsFor(app), []);
    stopAnalytics();
  });
});

test('startAnalytics runs a first tick right away and stopAnalytics is safe to repeat', async () => {
  await withLogDir(async (dir, config) => {
    const app = await makeApp('site');
    await fs.writeFile(path.join(dir, 'site.log'), lines(logLine('2026-10-09T10:05:00Z')));
    startAnalytics(config);
    startAnalytics(config); // second call is ignored
    for (let i = 0; i < 40 && (await RequestStat.countDocuments()) === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    stopAnalytics();
    stopAnalytics();
    assert.equal((await statsFor(app))[0].total, 1);
  });
});

test('RequestStat enforces one document per app per hour and carries a TTL index', async () => {
  const app = await makeApp('site');
  await RequestStat.init();
  const hour = new Date('2026-10-09T10:00:00Z');
  await RequestStat.create({ appId: app._id, hour });
  await assert.rejects(() => RequestStat.create({ appId: app._id, hour }), (err) => err.code === 11000);

  const indexes = await RequestStat.collection.indexes();
  assert.ok(indexes.some((i) => i.unique && i.key.appId === 1 && i.key.hour === 1));
  assert.ok(indexes.some((i) => i.key.expireAt === 1 && i.expireAfterSeconds === 0));
});

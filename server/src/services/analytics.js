import fs from 'node:fs/promises';
import path from 'node:path';
import App from '../models/App.js';
import RequestStat from '../models/RequestStat.js';
import AnalyticsOffset from '../models/AnalyticsOffset.js';

const TICK_INTERVAL_MS = 30 * 1000;
const MAX_READ_BYTES = 8 * 1024 * 1024; // per app per tick; a bigger backlog is drained over several ticks
const HOUR_MS = 60 * 60 * 1000;
const RETENTION_MS = 90 * 24 * HOUR_MS;

let timer = null;
let ticking = false;
// appName -> message, for apps whose log exists but cannot be read.
const warnings = new Map();

export function getAnalyticsWarnings() {
  return [...warnings].map(([app, message]) => ({ app, message }));
}

// --- parsing -----------------------------------------------------------------------

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// remote - user [dd/Mon/yyyy:hh:mm:ss +zzzz] "METHOD /path HTTP/x" status bytes "referer" "user-agent"
// Everything after the byte count (referer, user agent) is ignored, so the common format and stray
// quotes inside those fields still parse.
const COMBINED_RE =
  /^(\S+) \S+ \S+ \[(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})\] "([A-Za-z]+) (\S+)(?: [^"]*)?" (\d{3}) (\d+|-)(?:\s.*)?$/;

/**
 * Parses one nginx `combined` access-log line.
 * @returns {{ time: Date, status: number, bytes: number, path: string, method: string } | null}
 *          null for anything that is not a well-formed request line.
 */
export function parseCombinedLine(line) {
  if (typeof line !== 'string') return null;
  const m = COMBINED_RE.exec(line);
  if (!m) return null;

  const month = MONTHS[m[3]];
  if (month === undefined) return null;
  const sign = m[8] === '-' ? -1 : 1;
  const offsetMs = sign * (Number(m[9]) * 60 + Number(m[10])) * 60 * 1000;
  const utcMs = Date.UTC(Number(m[4]), month, Number(m[2]), Number(m[5]), Number(m[6]), Number(m[7])) - offsetMs;
  if (Number.isNaN(utcMs)) return null;

  return {
    time: new Date(utcMs),
    status: Number(m[13]),
    bytes: m[14] === '-' ? 0 : Number(m[14]),
    path: m[12],
    method: m[11],
  };
}

function emptyCounters() {
  return { total: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0, bytes: 0 };
}

export function floorToHour(date) {
  return Math.floor(date.getTime() / HOUR_MS) * HOUR_MS;
}

/**
 * Aggregates log lines into hourly counters bucketed by each request's own timestamp (UTC hour).
 * @returns {Map<number, {total, s2xx, s3xx, s4xx, s5xx, bytes}>} keyed by the hour's epoch milliseconds.
 *          Malformed lines are ignored. Statuses outside 2xx-5xx only count towards `total`.
 */
export function bucketLines(lines) {
  const buckets = new Map();
  for (const line of lines) {
    const entry = parseCombinedLine(line);
    if (!entry) continue;
    const hour = floorToHour(entry.time);
    let counters = buckets.get(hour);
    if (!counters) {
      counters = emptyCounters();
      buckets.set(hour, counters);
    }
    counters.total += 1;
    counters.bytes += entry.bytes;
    const cls = Math.floor(entry.status / 100);
    if (cls >= 2 && cls <= 5) counters[`s${cls}xx`] += 1;
  }
  return buckets;
}

// --- collector ---------------------------------------------------------------------

// Reads the complete new lines of one app's log. Returns null when there is nothing to do.
async function readNewLines(file, saved) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    const inode = String(stat.ino);
    // A different inode or a shorter file means the log was rotated or truncated: start over.
    const resumable = saved && saved.inode === inode && stat.size >= saved.offset;
    const start = resumable ? saved.offset : 0;
    const length = Math.min(stat.size - start, MAX_READ_BYTES);

    if (length <= 0) {
      return { lines: [], inode, offset: start, changed: !saved || !resumable };
    }

    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    const chunk = buffer.subarray(0, bytesRead);
    const lastNewline = chunk.lastIndexOf(0x0a);

    let consumed;
    if (lastNewline >= 0) {
      consumed = lastNewline + 1;
    } else if (bytesRead >= MAX_READ_BYTES) {
      consumed = bytesRead; // a single line longer than the cap would otherwise wedge the reader forever
    } else {
      consumed = 0; // partial line: wait for nginx to finish writing it
    }

    const lines = chunk.subarray(0, consumed).toString('utf8').split('\n');
    return { lines, inode, offset: start + consumed, changed: true };
  } finally {
    await handle.close();
  }
}

async function analyticsTick(config) {
  if (ticking) return;
  ticking = true;
  try {
    const apps = await App.find().select('_id name').lean();
    const savedByName = new Map((await AnalyticsOffset.find().lean()).map((o) => [o.appName, o]));
    const currentNames = new Set(apps.map((a) => a.name));
    for (const name of warnings.keys()) {
      if (!currentNames.has(name)) warnings.delete(name);
    }

    const statOps = [];
    const offsetOps = [];

    for (const app of apps) {
      const file = path.join(config.ACCESS_LOG_DIR, `${app.name}.log`);
      let result;
      try {
        result = await readNewLines(file, savedByName.get(app.name));
      } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
          warnings.delete(app.name);
        } else if (err.code === 'EACCES' || err.code === 'EPERM') {
          warnings.set(app.name, `Cannot read ${file}: permission denied. Give the agent user read access (see DEPLOYMENT.md 4.11).`);
        } else {
          warnings.set(app.name, `Cannot read ${file}: ${err.message}`);
        }
        continue;
      }
      warnings.delete(app.name);

      for (const [hour, counters] of bucketLines(result.lines)) {
        statOps.push({
          updateOne: {
            filter: { appId: app._id, hour: new Date(hour) },
            update: {
              $inc: counters,
              $setOnInsert: { appName: app.name, expireAt: new Date(hour + RETENTION_MS) },
            },
            upsert: true,
          },
        });
      }

      if (result.changed) {
        offsetOps.push({
          updateOne: {
            filter: { appName: app.name },
            update: { $set: { inode: result.inode, offset: result.offset } },
            upsert: true,
          },
        });
      }
    }

    // Counters first, offsets second: a crash in between double counts one tick instead of losing it,
    // and a failed counter write leaves the offsets alone so the same bytes are retried.
    if (statOps.length > 0) await RequestStat.bulkWrite(statOps, { ordered: false });
    if (offsetOps.length > 0) await AnalyticsOffset.bulkWrite(offsetOps, { ordered: false });
  } catch (err) {
    console.error(`analytics: tick failed: ${err.message}`);
  } finally {
    ticking = false;
  }
}

export function startAnalytics(config) {
  if (timer || !config.ANALYTICS_ENABLED) return;
  timer = setInterval(() => analyticsTick(config), TICK_INTERVAL_MS);
  timer.unref?.();
  analyticsTick(config);
}

export function stopAnalytics() {
  if (timer) clearInterval(timer);
  timer = null;
}

// Test-only hooks: drive a tick directly instead of waiting on the timer.
export async function __runAnalyticsTick(config) {
  await analyticsTick(config);
}
export function __resetAnalyticsState() {
  warnings.clear();
}

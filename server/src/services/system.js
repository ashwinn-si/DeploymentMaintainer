import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { run } from './shell.js';

const VERSION_CACHE_TTL_MS = 10 * 60 * 1000;
const FOLDER_SIZE_CACHE_TTL_MS = 5 * 60 * 1000;
// A du failure is usually transient (missing dir before first deploy, a brief
// resource crunch); caching that for the full 5min TTL would leave diskBytes
// stuck at null for a long time, so failures get a much shorter retry backoff.
const FOLDER_SIZE_RETRY_MS = 15 * 1000;

// --- CPU -------------------------------------------------------------------

// os.cpus() gives cumulative counters, so % requires a delta between two
// samples; we keep the previous one here and diff against it on each call.
let prevCpuTimes = null;

function sampleCpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

function pctFromDelta(prev, curr) {
  const totalDelta = curr.total - prev.total;
  if (totalDelta <= 0) return 0;
  const idleDelta = curr.idle - prev.idle;
  return Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
}

export async function getCpuPct() {
  const curr = sampleCpuTimes();
  if (!prevCpuTimes) {
    // No prior sample yet: take a second one a beat later for a real delta.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const curr2 = sampleCpuTimes();
    const pct = pctFromDelta(curr, curr2);
    prevCpuTimes = curr2;
    return pct;
  }
  const pct = pctFromDelta(prevCpuTimes, curr);
  prevCpuTimes = curr;
  return pct;
}

// --- Memory ------------------------------------------------------------------

function readProcMeminfo() {
  const text = fs.readFileSync('/proc/meminfo', 'utf8');
  const get = (key) => {
    const m = text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
    return m ? Number(m[1]) * 1024 : null;
  };
  return {
    memAvailable: get('MemAvailable'),
    swapTotal: get('SwapTotal'),
    swapFree: get('SwapFree'),
  };
}

export function getMemInfo() {
  const memTotal = os.totalmem();
  let memUsed = memTotal - os.freemem();
  let swapUsed = 0;
  let swapTotal = 0;

  if (process.platform === 'linux') {
    try {
      const { memAvailable, swapTotal: st, swapFree } = readProcMeminfo();
      if (memAvailable !== null) memUsed = memTotal - memAvailable;
      if (st !== null && swapFree !== null) {
        swapTotal = st;
        swapUsed = st - swapFree;
      }
    } catch {
      // fall back to the totalmem/freemem figures already computed above
    }
  }

  return { memUsed, memTotal, swapUsed, swapTotal };
}

// --- Disks -------------------------------------------------------------------

async function statDisk(targetPath) {
  const stats = await fsp.statfs(targetPath);
  const total = stats.blocks * stats.bsize;
  const free = stats.bavail * stats.bsize;
  const used = total - stats.bfree * stats.bsize;
  return { total, used, free };
}

export async function getDisks(config) {
  const mounts = [{ mount: '/', dirPath: '/' }];

  try {
    const rootDev = (await fsp.stat('/')).dev;
    const appsDir = config.APPS_DIR;
    if (appsDir) {
      const appsDev = await fsp.stat(appsDir).then((s) => s.dev).catch(() => null);
      if (appsDev !== null && appsDev !== rootDev) {
        mounts.push({ mount: appsDir, dirPath: appsDir });
      }
    }
  } catch {
    // if even stat('/') fails, fall through and let statDisk('/') below surface the error per-mount
  }

  const disks = [];
  for (const { mount, dirPath } of mounts) {
    try {
      const { total, used, free } = await statDisk(dirPath);
      disks.push({ mount, total, used, free });
    } catch {
      // unreadable mount — skip it rather than failing the whole sample
    }
  }
  return disks;
}

// --- Version info (pm2 -v, nginx -v), cached ---------------------------------

let versionCache = { pm2Version: null, nginxVersion: null, expiresAt: 0 };

async function readVersionOutput(cmd, argv) {
  try {
    const result = await run(cmd, argv);
    const text = (result.stderr || result.stdout || '').trim();
    return text.length > 0 ? text : null;
  } catch {
    // binary not on PATH, or failed to spawn — tolerate as "unknown"
    return null;
  }
}

async function refreshVersionCache() {
  const [pm2Version, nginxVersion] = await Promise.all([
    readVersionOutput('pm2', ['-v']),
    readVersionOutput('nginx', ['-v']),
  ]);
  versionCache = { pm2Version, nginxVersion, expiresAt: Date.now() + VERSION_CACHE_TTL_MS };
  return versionCache;
}

async function getVersions() {
  if (versionCache.expiresAt > Date.now()) return versionCache;
  return refreshVersionCache();
}

export async function getInfo(config) {
  const { pm2Version, nginxVersion } = await getVersions();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    uptimeSec: Math.floor(os.uptime()),
    nodeVersion: process.version,
    pm2Version,
    nginxVersion,
    cpuCount: os.cpus().length,
  };
}

// --- Combined sample -----------------------------------------------------------

export async function getCurrentSample(config, { disks: precomputedDisks } = {}) {
  const cpuPct = await getCpuPct();
  const { memUsed, memTotal, swapUsed, swapTotal } = getMemInfo();
  const [load1, load5, load15] = os.loadavg();
  const disks = precomputedDisks ?? (await getDisks(config));
  const diskUsedPct = disks[0] ? (disks[0].used / disks[0].total) * 100 : 0;

  return {
    t: new Date().toISOString(),
    cpuPct,
    memUsed,
    memTotal,
    swapUsed,
    swapTotal,
    load1,
    load5,
    load15,
    diskUsedPct,
  };
}

// --- Per-app folder size (du), cached and computed off the request path -------

const folderSizeCache = new Map();

export function getCachedFolderSize(appName) {
  return folderSizeCache.get(appName)?.bytes ?? null;
}

export function refreshFolderSize(config, appName) {
  const entry = folderSizeCache.get(appName);
  const now = Date.now();
  if (entry && (entry.computing || entry.expiresAt > now)) return;

  folderSizeCache.set(appName, { bytes: entry?.bytes ?? null, expiresAt: entry?.expiresAt ?? 0, computing: true });
  const dir = path.join(config.APPS_DIR, appName);

  run('du', ['-sk', dir])
    .then((result) => {
      if (result.code !== 0) throw new Error(`du exited with code ${result.code}`);
      const kb = parseInt(result.stdout.trim().split(/\s+/)[0], 10);
      const bytes = Number.isFinite(kb) ? kb * 1024 : null;
      folderSizeCache.set(appName, { bytes, expiresAt: Date.now() + FOLDER_SIZE_CACHE_TTL_MS, computing: false });
    })
    .catch(() => {
      // Directory doesn't exist yet (not deployed), or du itself failed transiently —
      // either way, retry soon rather than being stuck for the full TTL.
      const prevBytes = folderSizeCache.get(appName)?.bytes ?? null;
      folderSizeCache.set(appName, { bytes: prevBytes, expiresAt: Date.now() + FOLDER_SIZE_RETRY_MS, computing: false });
    });
}

export function __resetSystemCaches() {
  prevCpuTimes = null;
  versionCache = { pm2Version: null, nginxVersion: null, expiresAt: 0 };
  folderSizeCache.clear();
}

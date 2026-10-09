import fsp from 'node:fs/promises';
import path from 'node:path';
import { removeInsideAppsDir } from './git.js';
import { getFolderSizeBytes, statDisk } from './system.js';

// Staged deploys build in `<name>.staging`, then swap it in for the live dir.
// App names are [a-z0-9-], so the dotted siblings can never collide with an app.
const DISK_HEADROOM_FACTOR = 1.2;
const DISK_HEADROOM_BYTES = 500 * 1024 * 1024;

// Test hook (like __resetDeployerState): pretend the APPS_DIR disk has this much free space; undefined = read it.
let freeBytesOverride;
export function __setFreeBytesOverride(bytes) {
  freeBytesOverride = bytes;
}

export function liveDir(config, name) {
  return path.join(config.APPS_DIR, name);
}

export function stagingDir(config, name) {
  return `${liveDir(config, name)}.staging`;
}

export function previousDir(config, name) {
  return `${liveDir(config, name)}.previous`;
}

function failedDir(config, name) {
  return `${liveDir(config, name)}.failed`;
}

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

async function exists(dir) {
  try {
    await fsp.access(dir);
    return true;
  } catch {
    return false;
  }
}

// Fails early (before anything is touched) when a second copy of the app wouldn't fit.
// `freeBytes` overrides the statfs reading so tests don't depend on the real disk.
export async function assertDiskForStaging(config, name, { freeBytes = freeBytesOverride } = {}) {
  let liveSize = 0;
  if (await exists(liveDir(config, name))) {
    liveSize = (await getFolderSizeBytes(liveDir(config, name))) ?? 0;
  }
  const required = Math.ceil(liveSize * DISK_HEADROOM_FACTOR + DISK_HEADROOM_BYTES);

  let free = freeBytes;
  if (free === undefined) {
    await fsp.mkdir(config.APPS_DIR, { recursive: true });
    free = (await statDisk(config.APPS_DIR)).free;
  }

  if (free < required) {
    throw new Error(
      `Not enough disk space for a staged deploy: need ~${formatBytes(required)}, have ${formatBytes(free)} free `
      + '(a second copy of the app is built before going live)',
    );
  }
  return { required, free };
}

// Clears crash leftovers and the old `.previous` so peak disk use is live + staging.
export async function prepareStaging(config, name) {
  await removeInsideAppsDir(config, `${name}.staging`);
  await removeInsideAppsDir(config, `${name}.previous`);
  return stagingDir(config, name);
}

// Both renames are atomic (same filesystem). If the second fails the old live dir is put back.
export async function promoteStaging(config, name) {
  const live = liveDir(config, name);
  const staging = stagingDir(config, name);
  const previous = previousDir(config, name);

  const hadPrevious = await exists(live);
  if (hadPrevious) await fsp.rename(live, previous);
  try {
    await fsp.rename(staging, live);
  } catch (err) {
    if (hadPrevious) {
      await fsp.rename(previous, live).catch(() => {});
    }
    throw err;
  }
  return { hadPrevious };
}

// Swap-back after a post-promote failure: the failed live dir is discarded, `.previous` becomes live.
export async function restorePrevious(config, name) {
  const live = liveDir(config, name);
  const previous = previousDir(config, name);
  const failed = failedDir(config, name);

  if (!(await exists(previous))) {
    throw new Error(`No previous version of "${name}" to restore`);
  }
  await fsp.rm(failed, { recursive: true, force: true });
  if (await exists(live)) await fsp.rename(live, failed);
  await fsp.rename(previous, live);
  await fsp.rm(failed, { recursive: true, force: true }).catch(() => {});
}

export async function removeStaging(config, name) {
  try {
    await removeInsideAppsDir(config, `${name}.staging`);
  } catch {
    // best effort: a leftover staging dir is cleaned by the next deploy's prepareStaging
  }
}

// Startup repair for a promote that was interrupted between its two renames (live -> previous, staging -> live):
// the live folder is gone but `.previous` is the last good version, so put it back.
export async function repairInterruptedSwap(config, name) {
  const live = liveDir(config, name);
  const previous = previousDir(config, name);
  if (await exists(live) || !(await exists(previous))) return false;
  await fsp.rename(previous, live);
  return true;
}

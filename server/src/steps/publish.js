import fs from 'node:fs/promises';
import path from 'node:path';
import { validateStaticDir } from '../lib/validate.js';
import { appWorkDir } from '../lib/appEnv.js';

export const type = 'publish';

export function label(config) {
  const dir = config?.staticDir || '.';
  return `Publish static build (${dir})`;
}

export function getPublishedBaseDir(config) {
  if (config?.PUBLISHED_DIR) return config.PUBLISHED_DIR;
  return path.join(path.dirname(config.APPS_DIR || './.data/apps'), 'published');
}

export function getPublishedAppCurrentDir(config, appName) {
  return path.join(getPublishedBaseDir(config), appName, 'current');
}

export function getPublishedAppDir(config, appName) {
  return path.join(getPublishedBaseDir(config), appName);
}

// Static apps have no process to ping; "healthy" means the live release is in place and has the page.
// checkPath is a URL path inside the site; "/" (or a directory) means its index.html.
export async function checkPublished(config, appName, checkPath = '/') {
  const root = getPublishedAppCurrentDir(config, appName);
  const clean = String(checkPath).split(/[?#]/)[0].replace(/^\/+/, '');
  const target = path.resolve(root, clean);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    return { ok: false, statusCode: 404 };
  }
  const candidates = clean === '' || clean.endsWith('/') ? [path.join(target, 'index.html')] : [target, path.join(target, 'index.html')];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return { ok: true, statusCode: 200 };
    } catch {
      // try the next candidate
    }
  }
  return { ok: false, statusCode: 404 };
}

export async function removePublishedApp(config, appName) {
  await fs.rm(getPublishedAppDir(config, appName), { recursive: true, force: true });
}

// Never publish VCS data, dependencies or env files, even when staticDir is the repo root.
const EXCLUDED_NAMES = new Set(['.git', 'node_modules', '.github']);

async function shouldCopy(src) {
  const name = path.basename(src);
  if (EXCLUDED_NAMES.has(name)) return false;
  if (name === '.env' || name.startsWith('.env.')) return false;
  // A repo symlink (e.g. -> /home/ubuntu/server/.env) would otherwise be served by Nginx as a file.
  if ((await fs.lstat(src)).isSymbolicLink()) return false;
  return true;
}

// Nginx runs as another user, so every directory above the site needs the "other: execute" bit.
// On Ubuntu /home/ubuntu is 750, which makes Nginx answer 403 for a deploy that otherwise looked fine.
export async function findDirNginxCannotTraverse(dir) {
  let current = await fs.realpath(dir);
  for (;;) {
    const mode = (await fs.stat(current)).mode;
    if ((mode & 0o001) === 0) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function pruneOldReleases(releasesDir, keepCount = 5) {
  try {
    const entries = await fs.readdir(releasesDir, { withFileTypes: true });
    const releaseDirs = entries.filter((e) => e.isDirectory());
    if (releaseDirs.length <= keepCount) return;

    // Stat each dir to sort by creation time (oldest first)
    const withTimes = await Promise.all(
      releaseDirs.map(async (e) => {
        const fullPath = path.join(releasesDir, e.name);
        const stat = await fs.stat(fullPath);
        return { name: e.name, fullPath, mtime: stat.mtimeMs };
      }),
    );
    withTimes.sort((a, b) => a.mtime - b.mtime);

    const toRemove = withTimes.slice(0, withTimes.length - keepCount);
    for (const item of toRemove) {
      await fs.rm(item.fullPath, { recursive: true, force: true });
    }
  } catch {
    // ignore pruning errors
  }
}

// "auto" picks the first conventional build output that has a page; without a build, the repo root.
export async function resolveStaticDir(appDir, staticDir, { buildEnabled }) {
  if (staticDir !== 'auto') return staticDir;
  const candidates = buildEnabled ? ['dist', 'build', 'out'] : ['.'];
  for (const candidate of candidates) {
    for (const name of ['index.html', 'index.htm']) {
      try {
        await fs.access(path.join(appDir, candidate, name));
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  throw new Error(`Static publish failed: no index.html found in ${candidates.join(', ')}. Set the Static directory in the Publish step.`);
}

export async function run(ctx) {
  const { app, deployment, config, log, step, stepId } = ctx;
  const configured = step?.config?.staticDir || '.';
  validateStaticDir(configured);

  const appDir = path.resolve(appWorkDir(config, app));
  const buildEnabled = Boolean(app.steps?.some((s) => s.type === 'build' && s.enabled));
  const staticDir = await resolveStaticDir(appDir, configured, { buildEnabled });
  if (staticDir !== configured) log.info(`auto-detected output directory: ${staticDir}`, stepId);

  const sourceDir = path.resolve(appDir, staticDir);
  log.info(`publishing from ${sourceDir}`, stepId);

  // Check that index.html exists
  const indexPath = path.join(sourceDir, 'index.html');
  const indexHtmPath = path.join(sourceDir, 'index.htm');
  let indexExists = false;
  try {
    await fs.access(indexPath);
    indexExists = true;
  } catch {
    try {
      await fs.access(indexHtmPath);
      indexExists = true;
    } catch {
      indexExists = false;
    }
  }

  if (!indexExists) {
    throw new Error(`Static publish failed: index.html not found in "${sourceDir}"`);
  }

  const appPublishedDir = getPublishedAppDir(config, app.name);
  const releasesDir = path.join(appPublishedDir, 'releases');
  const releaseId = String(deployment?._id || deployment?.number || Date.now());
  const targetReleaseDir = path.join(releasesDir, releaseId);

  await fs.mkdir(targetReleaseDir, { recursive: true, mode: 0o755 });
  await fs.cp(sourceDir, targetReleaseDir, { recursive: true, filter: shouldCopy });

  if (config.NGINX_ENABLED) {
    const blocked = await findDirNginxCannotTraverse(targetReleaseDir);
    if (blocked) {
      await fs.rm(targetReleaseDir, { recursive: true, force: true });
      throw new Error(
        `Nginx could not read the published site: ${blocked} is not world-executable. ` +
          'Set PUBLISHED_DIR to a folder Nginx can reach, e.g. /var/www/deployer (sudo mkdir -p /var/www/deployer && sudo chown ubuntu:ubuntu /var/www/deployer).',
      );
    }
  }

  const currentSymlink = path.join(appPublishedDir, 'current');
  const tmpSymlink = path.join(appPublishedDir, `.current.tmp-${Date.now()}`);

  try {
    await fs.symlink(targetReleaseDir, tmpSymlink);
    await fs.rename(tmpSymlink, currentSymlink);
  } catch (err) {
    await fs.rm(tmpSymlink, { force: true }).catch(() => {});
    throw err;
  }

  await pruneOldReleases(releasesDir, 5);
  log.info(`published to ${currentSymlink} -> ${targetReleaseDir}`, stepId);

  return { published: true, releaseDir: targetReleaseDir, currentSymlink };
}

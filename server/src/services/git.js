import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { run } from './shell.js';
import { validateRef, validateCommitSha, validateOwner, validateRepo } from '../lib/validate.js';
import { HttpError } from '../lib/httpError.js';

function buildRemoteUrl(config, repoFullName) {
  const [owner, repo] = String(repoFullName).split('/');
  const validOwner = validateOwner(owner);
  const validRepo = validateRepo(repo);
  return `${config.GIT_REMOTE_BASE}/${validOwner}/${validRepo}.git`;
}

// -c http.extraheader is per-invocation only, so the token never lands in .git/config.
function authArgs(config, remoteUrl) {
  if (!config.GITHUB_TOKEN || !remoteUrl.startsWith('https://')) return [];
  const basic = Buffer.from(`x-access-token:${config.GITHUB_TOKEN}`).toString('base64');
  return ['-c', `http.extraheader=AUTHORIZATION: basic ${basic}`];
}

// The only place a secret can appear in argv is the "-c http.extraheader=..."
// pair built by authArgs(); strip it before any argv makes it into a message.
function redactAuthArg(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-c' && typeof args[i + 1] === 'string' && args[i + 1].startsWith('http.extraheader=')) {
      out.push('-c', 'http.extraheader=<redacted>');
      i += 1;
    } else {
      out.push(args[i]);
    }
  }
  return out;
}

async function git(cwd, args, { onLine, signal } = {}) {
  const result = await run('git', args, { cwd, onLine, signal });
  if (result.code !== 0 && !result.aborted) {
    const displayArgs = redactAuthArg(args).join(' ');
    throw new Error(`git ${displayArgs} exited with code ${result.code}: ${result.stderr.slice(-500)}`);
  }
  return result;
}

// Resolves `name` under APPS_DIR and refuses anything that would escape it.
function resolveInsideAppsDir(config, name) {
  const appsDir = path.resolve(config.APPS_DIR);
  const target = path.resolve(appsDir, name);
  const rel = path.relative(appsDir, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new HttpError(400, 'Refusing to remove a path outside APPS_DIR');
  }
  return target;
}

// Removes exactly one directory under APPS_DIR (used by staging cleanup too).
export async function removeInsideAppsDir(config, name) {
  await fsp.rm(resolveInsideAppsDir(config, name), { recursive: true, force: true });
}

// Also removes the staged-deploy siblings so deleting an app leaves nothing behind.
export async function safeRemoveAppDir(config, name) {
  const target = resolveInsideAppsDir(config, name);
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.rm(resolveInsideAppsDir(config, `${name}.staging`), { recursive: true, force: true });
  await fsp.rm(resolveInsideAppsDir(config, `${name}.previous`), { recursive: true, force: true });
}

export async function getHeadSha(dir) {
  const result = await run('git', ['rev-parse', 'HEAD'], { cwd: dir });
  if (result.code !== 0) {
    throw new Error(`git rev-parse HEAD failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

export async function syncRepo({ dir, repoFullName, branch, sha, fresh, seedFrom, config, onLine, signal }) {
  const validBranch = validateRef(branch);
  const validSha = sha ? validateCommitSha(sha) : null;
  const remoteUrl = buildRemoteUrl(config, repoFullName);
  const auth = authArgs(config, remoteUrl);

  if (fresh) {
    await removeInsideAppsDir(config, path.basename(dir));
  }

  const exists = fs.existsSync(path.join(dir, '.git'));

  if (!exists) {
    await fsp.mkdir(path.dirname(dir), { recursive: true });
    // Seeding from the live checkout borrows its objects so only new ones come over the network;
    // --dissociate copies them in, since the seed dir is deleted/renamed after promotion.
    const seedArgs = !fresh && seedFrom && fs.existsSync(path.join(seedFrom, '.git'))
      ? ['--reference', seedFrom, '--dissociate']
      : [];
    await git(
      path.dirname(dir),
      [...auth, 'clone', ...seedArgs, '--branch', validBranch, '--single-branch', '--', remoteUrl, dir],
      { onLine, signal },
    );
  } else {
    // Explicit refspec: a plain branch name wouldn't update origin/<branch> after a --single-branch clone of a different branch.
    const refspec = `+refs/heads/${validBranch}:refs/remotes/origin/${validBranch}`;
    await git(dir, [...auth, 'fetch', 'origin', refspec], { onLine, signal });
    await git(dir, ['checkout', '-B', validBranch, `origin/${validBranch}`, '--'], { onLine, signal });
  }

  const resetTarget = validSha ?? `origin/${validBranch}`;
  await git(dir, ['reset', '--hard', resetTarget, '--'], { onLine, signal });

  return getHeadSha(dir);
}

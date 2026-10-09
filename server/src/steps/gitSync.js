import fs from 'node:fs';
import path from 'node:path';
import { syncRepo } from '../services/git.js';

export const type = 'gitSync';

export function label() {
  return 'Sync repository';
}

export async function run(ctx) {
  const { app, config, log, signal, state, stepId, branch, sha, fresh } = ctx;
  const targetBranch = branch ?? app.branch;
  // The repo is always cloned whole. The deployer pre-sets state.repoDir to the staging dir for staged deploys;
  // state.appDir (set below) is where the work happens: the repo folder plus the app's root directory.
  const dir = state.repoDir ?? path.join(config.APPS_DIR, app.name);

  log.cmd(`git sync ${app.repoFullName}@${targetBranch}${sha ? ` -> ${sha}` : ''}`, stepId);
  const resolvedSha = await syncRepo({
    dir,
    repoFullName: app.repoFullName,
    branch: targetBranch,
    sha,
    fresh: Boolean(fresh),
    seedFrom: state.seedFrom,
    config,
    onLine: log.onLine(stepId),
    signal,
  });

  const rootDir = app.rootDir || '';
  const workDir = path.join(dir, rootDir);
  if (rootDir) {
    const notFound = new Error(`Root directory '${rootDir}' not found in ${app.repoFullName}@${resolvedSha.slice(0, 7)}`);
    if (!fs.statSync(workDir, { throwIfNoEntry: false })?.isDirectory()) throw notFound;
    // A symlinked folder in the repo must not point the app's work dir outside the clone.
    const realRepo = fs.realpathSync(dir);
    const realWork = fs.realpathSync(workDir);
    if (realWork !== realRepo && !realWork.startsWith(`${realRepo}${path.sep}`)) throw notFound;
  }

  state.repoDir = dir;
  state.appDir = workDir;
  state.sha = resolvedSha;
  log.info(`HEAD is now ${resolvedSha}`, stepId);
  return { sha: resolvedSha };
}

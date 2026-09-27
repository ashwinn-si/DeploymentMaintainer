import path from 'node:path';
import { syncRepo } from '../services/git.js';

export const type = 'gitSync';

export function label() {
  return 'Sync repository';
}

export async function run(ctx) {
  const { app, config, log, signal, state, stepId, branch, sha, fresh } = ctx;
  const targetBranch = branch ?? app.branch;
  const dir = path.join(config.APPS_DIR, app.name);

  log.cmd(`git sync ${app.repoFullName}@${targetBranch}${sha ? ` -> ${sha}` : ''}`, stepId);
  const resolvedSha = await syncRepo({
    dir,
    repoFullName: app.repoFullName,
    branch: targetBranch,
    sha,
    fresh: Boolean(fresh),
    config,
    onLine: log.onLine(stepId),
    signal,
  });

  state.appDir = dir;
  state.sha = resolvedSha;
  log.info(`HEAD is now ${resolvedSha}`, stepId);
  return { sha: resolvedSha };
}

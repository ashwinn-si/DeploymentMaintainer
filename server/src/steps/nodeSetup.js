import { ensureNodeVersion, nodeBinDir, runNode } from '../services/node.js';

export const type = 'nodeSetup';

export function label() {
  return 'Set up Node.js';
}

export async function run(ctx) {
  const { app, log, signal, state, stepId } = ctx;
  const version = app.nodeVersion;

  log.cmd(`fnm install ${version} (if missing)`, stepId);
  await ensureNodeVersion(version, { onLine: log.onLine(stepId), signal });
  state.binDir = await nodeBinDir(version, { signal });

  const nodeVersionResult = await runNode(version, 'node', ['-v'], { signal });
  log.info(`node ${nodeVersionResult.stdout.trim()}`, stepId);
  const npmVersionResult = await runNode(version, 'npm', ['-v'], { signal });
  log.info(`npm ${npmVersionResult.stdout.trim()}`, stepId);
}

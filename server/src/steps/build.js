import path from 'node:path';
import { run as shellRun, tokenizeCommand } from '../services/shell.js';
import { withNode } from '../services/node.js';

export const type = 'build';

export function label(config) {
  return config?.command || 'npm run build';
}

export async function run(ctx) {
  const { app, env, config, log, signal, state, step, stepId } = ctx;
  const dir = state.appDir ?? path.join(config.APPS_DIR, app.name);
  const command = step?.config?.command || 'npm run build';

  log.cmd(command, stepId);
  const [bin, ...args] = tokenizeCommand(command);
  const [cmd, argv] = withNode(app.nodeVersion, bin, args);
  const result = await shellRun(cmd, argv, {
    cwd: dir,
    env: { ...process.env, ...env, PORT: String(app.port) },
    onLine: log.onLine(stepId),
    signal,
  });
  if (result.code !== 0) {
    throw new Error(`"${command}" exited with code ${result.code}`);
  }
}

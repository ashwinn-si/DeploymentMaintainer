import fs from 'node:fs';
import path from 'node:path';
import { run as shellRun, tokenizeCommand } from '../services/shell.js';
import { withNode } from '../services/node.js';

export const type = 'install';

export function label(config) {
  return config?.command || 'npm ci';
}

export async function run(ctx) {
  const { app, env, config, log, signal, state, step, stepId } = ctx;
  const dir = state.appDir ?? path.join(config.APPS_DIR, app.name);
  const configured = step?.config?.command;
  const hasLockfile = fs.existsSync(path.join(dir, 'package-lock.json'));
  const command = configured || (hasLockfile ? 'npm ci' : 'npm install');

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

import { run as shellRun, tokenizeCommand } from '../services/shell.js';
import { withNode } from '../services/node.js';
import { portEnv, appWorkDir } from '../lib/appEnv.js';

export const type = 'custom';

export function label(config) {
  return config?.label || config?.command || 'Custom step';
}

export async function run(ctx) {
  const { app, env, config, log, signal, state, step, stepId } = ctx;
  const command = step?.config?.command;
  if (!command) {
    throw new Error('custom step is missing a command');
  }

  const dir = state.appDir ?? appWorkDir(config, app);
  const [bin, ...args] = tokenizeCommand(command);
  const [cmd, argv] = withNode(app.nodeVersion, bin, args);

  log.cmd(command, stepId);
  const result = await shellRun(cmd, argv, {
    cwd: dir,
    env: { ...process.env, ...env, ...portEnv(app) },
    onLine: log.onLine(stepId),
    signal,
  });
  if (result.code !== 0) {
    throw new Error(`"${label(step.config)}" exited with code ${result.code}`);
  }
}

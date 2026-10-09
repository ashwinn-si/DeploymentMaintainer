import fs from 'node:fs/promises';
import path from 'node:path';
import { run as shellRun, tokenizeCommand } from '../services/shell.js';
import { withNode } from '../services/node.js';
import { portEnv, appWorkDir } from '../lib/appEnv.js';
import { planStaticBuild } from '../lib/frontend.js';

export const type = 'build';

export function label(config) {
  return config?.command || 'npm run build';
}

async function readPackageJson(dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

export async function run(ctx) {
  const { app, env, config, log, signal, state, step, stepId } = ctx;
  const dir = state.appDir ?? appWorkDir(config, app);
  let command = step?.config?.command || 'npm run build';
  let extraEnv = {};

  // Static sites are served under /<name>/, so the build must know its base path.
  if (app.kind === 'static') {
    const nginxStep = app.steps?.find((s) => s.type === 'nginx');
    const routePath = nginxStep?.config?.path || `/${app.name}`;
    const plan = planStaticBuild({ command, pkg: await readPackageJson(dir), routePath });
    command = plan.command;
    extraEnv = plan.env;
    for (const note of plan.notes) log.info(note, stepId);
  }

  log.cmd(command, stepId);
  const [bin, ...args] = tokenizeCommand(command);
  const [cmd, argv] = withNode(app.nodeVersion, bin, args);
  const result = await shellRun(cmd, argv, {
    cwd: dir,
    env: { ...process.env, ...env, ...extraEnv, ...portEnv(app) },
    onLine: log.onLine(stepId),
    signal,
  });
  if (result.code !== 0) {
    throw new Error(`"${command}" exited with code ${result.code}`);
  }
}

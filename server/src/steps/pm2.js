import path from 'node:path';
import * as pm2Service from '../services/pm2.js';
import { appWorkDir } from '../lib/appEnv.js';

export const type = 'pm2';

export function label(config) {
  return `pm2 start / restart (${config?.command || 'npm start'})`;
}

export async function run(ctx) {
  const { app, env, config, log, signal, state, step, stepId, fresh } = ctx;
  const startCommand = step?.config?.command || 'npm start';
  const name = pm2Service.pm2Name(app.name);
  const onLine = log.onLine(stepId);

  // Read the previous definition before writeEcosystem overwrites it; the '.previous' folder is where a
  // staged deploy leaves the old live folder.
  // Both live under the same root directory inside their repo folder.
  const workDir = appWorkDir(config, app);
  const previousWorkDir = path.join(config.APPS_DIR, `${app.name}.previous`, app.rootDir || '');
  const previous = (await pm2Service.readEcosystem(pm2Service.ecosystemPath(workDir)))
    ?? (await pm2Service.readEcosystem(pm2Service.ecosystemPath(previousWorkDir)));

  const ecoPath = await pm2Service.writeEcosystem(app, {
    env,
    binDir: state.binDir,
    dir: workDir,
    startCommand,
  });
  const next = await pm2Service.readEcosystem(ecoPath);

  const existing = (await pm2Service.jlist({ signal }))[name];

  let recreateReason = null;
  if (!existing) recreateReason = 'new process';
  else if (fresh) recreateReason = 'fresh deploy; recreating the process';
  else {
    const change = pm2Service.describeDefinitionChange(previous, next);
    if (change) recreateReason = `${change}; recreating the process`;
  }

  if (recreateReason) {
    log.info(`pm2 start ${name} (${recreateReason})`, stepId);
    if (existing) await pm2Service.deleteQuiet(name, { onLine, signal });
    log.cmd(`pm2 start ${ecoPath} --update-env`, stepId);
    await pm2Service.start(ecoPath, { onLine, signal });
  } else {
    log.info(`pm2 restart ${name} (existing process)`, stepId);
    log.cmd(`pm2 restart ${ecoPath} --update-env`, stepId);
    await pm2Service.restartFromEcosystem(ecoPath, { onLine, signal });
  }

  await pm2Service.save({ onLine, signal });
  log.info(`pm2 process ${name} ${recreateReason ? 'started' : 'restarted'}`, stepId);
}

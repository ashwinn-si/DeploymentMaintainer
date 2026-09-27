import * as pm2Service from '../services/pm2.js';

export const type = 'pm2';

export function label(config) {
  return `pm2 start (${config?.command || 'npm start'})`;
}

export async function run(ctx) {
  const { app, env, config, log, signal, state, step, stepId } = ctx;
  const startCommand = step?.config?.command || 'npm start';

  const ecoPath = await pm2Service.writeEcosystem(app, {
    env,
    binDir: state.binDir,
    appsDir: config.APPS_DIR,
    startCommand,
  });

  log.cmd(`pm2 startOrReload ${ecoPath} --update-env`, stepId);
  await pm2Service.startOrReload(ecoPath, { onLine: log.onLine(stepId), signal });
  await pm2Service.save({ onLine: log.onLine(stepId), signal });
  log.info(`pm2 process ${pm2Service.pm2Name(app.name)} started/reloaded`, stepId);
}

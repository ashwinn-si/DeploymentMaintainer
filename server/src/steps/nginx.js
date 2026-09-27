import * as nginxService from '../services/nginx.js';

export const type = 'nginx';

export function label(config) {
  return `Nginx route ${config?.path || ''}`.trim();
}

// Runs even when disabled (see steps/index.js ALWAYS_INVOKE) so turning
// routing off for an app removes a stale route file instead of leaving it.
export async function run(ctx) {
  const { app, config, log, signal, step, stepId } = ctx;

  if (step?.enabled === false) {
    const result = await nginxService.removeAppRoute(app, { config, onLine: log.onLine(stepId), signal });
    log.info(result.removed ? 'removed nginx route' : 'no nginx route to remove', stepId);
    return result;
  }

  const result = await nginxService.applyAppRoute(app, {
    config,
    stepConfig: step?.config,
    onLine: log.onLine(stepId),
    signal,
  });
  log.info(result.applied ? 'nginx route updated' : 'nginx route unchanged', stepId);
  return result;
}

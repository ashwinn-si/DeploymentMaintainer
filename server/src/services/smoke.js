import fs from 'node:fs/promises';
import path from 'node:path';
import * as pm2Service from './pm2.js';
import { allocatePort } from './ports.js';
import { requestOnce, sleep, logAppOutput, MIN_OK_STATUS, MAX_OK_STATUS } from '../steps/healthCheck.js';

const SMOKE_ECOSYSTEM_FILENAME = 'ecosystem.smoke.config.cjs';
const DEFAULT_TIMEOUT_SEC = 60;
const DEFAULT_INTERVAL_SEC = 2;

export function smokeName(appName) {
  return `${pm2Service.pm2Name(appName)}-smoke`;
}

// Boots the staged build on a spare port and polls it, so a build that compiles but
// crashes on start is caught before the live app is touched. Returns a result, never throws on app failure.
export async function runSmokeTest(app, { config, env, binDir, stagingPath, healthConfig = {}, log, signal, stepId }) {
  const name = smokeName(app.name);
  const checkPath = healthConfig.path || '/';
  const timeoutMs = (healthConfig.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
  const intervalMs = (healthConfig.intervalSec ?? DEFAULT_INTERVAL_SEC) * 1000;
  const startCommand = (app.steps || []).find((s) => s.type === 'pm2')?.config?.command || 'npm start';
  // stagingPath is the whole staged repo folder; the app runs inside its root directory.
  const workPath = path.join(stagingPath, app.rootDir || '');
  const ecoPath = path.join(workPath, SMOKE_ECOSYSTEM_FILENAME);

  try {
    const port = await allocatePort(config, { exclude: app.port ? [app.port] : [] });
    await pm2Service.writeEcosystem(app, {
      env,
      binDir,
      startCommand,
      dir: workPath,
      name,
      port,
      filename: SMOKE_ECOSYSTEM_FILENAME,
    });

    log.info(`smoke test: starting staged build on spare port ${port}`, stepId);
    log.cmd(`pm2 start ${ecoPath} (${name})`, stepId);
    await pm2Service.startOrReload(ecoPath, { onLine: log.onLine(stepId), signal });

    const startedAt = Date.now();
    let attempt = 0;
    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) return { ok: false, reason: 'aborted' };
      attempt += 1;

      const proc = (await pm2Service.jlist())[name];
      if (proc?.pm2_env?.status === 'errored') {
        log.error('smoke test: staged process errored', stepId);
        await logAppOutput(app, log, stepId, name);
        return { ok: false, reason: 'staged build crashed on start' };
      }

      const result = await requestOnce(port, checkPath);
      if (result.ok && result.statusCode >= MIN_OK_STATUS && result.statusCode <= MAX_OK_STATUS) {
        log.info(`smoke test: GET ${checkPath} -> ${result.statusCode} (attempt ${attempt})`, stepId);
        return { ok: true };
      }
      log.info(`smoke test: GET ${checkPath} -> ${result.statusCode ?? 'error'} (attempt ${attempt})`, stepId);

      const remaining = timeoutMs - (Date.now() - startedAt);
      await sleep(Math.min(intervalMs, Math.max(0, remaining)), signal);
    }

    log.error(`smoke test: staged build did not answer ${checkPath} within ${timeoutMs / 1000}s`, stepId);
    await logAppOutput(app, log, stepId, name);
    return { ok: false, reason: 'timed out' };
  } catch (err) {
    return { ok: false, reason: err.message };
  } finally {
    // Always tear the throwaway process down, even on abort/failure, and never leave the file in staging.
    await pm2Service.deleteQuiet(name).catch(() => {});
    await fs.rm(ecoPath, { force: true }).catch(() => {});
  }
}

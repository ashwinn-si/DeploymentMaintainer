import http from 'node:http';
import * as pm2Service from '../services/pm2.js';
import { checkPublished } from './publish.js';

export const type = 'healthCheck';

export const MIN_OK_STATUS = 200;
export const MAX_OK_STATUS = 399;
const CRASH_LOOP_RESTART_DELTA = 3;

export function label(config) {
  return `Health check ${config?.path || '/'}`;
}

export function requestOnce(port, requestPath) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: requestPath, timeout: 5000 }, (res) => {
      res.resume();
      resolve({ ok: true, statusCode: res.statusCode });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: null });
    });
    req.on('error', () => resolve({ ok: false, statusCode: null }));
  });
}

export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

// Surfaces the app's own output so a crash is diagnosable from the deploy log.
export async function logAppOutput(app, log, stepId, processName = pm2Service.pm2Name(app.name)) {
  try {
    const out = await pm2Service.logs(processName, 30);
    const text = out.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (text) log.error(`app output (last 30 lines):\n${text}`, stepId);
  } catch (err) {
    log.warn?.(`could not read app logs: ${err.message}`, stepId);
  }
}

// Returns a result rather than throwing: fail/auto-rollback is the 3b deployer's decision.
export async function run(ctx) {
  const { app, config, log, signal, step, stepId } = ctx;
  const cfg = step?.config ?? {};
  const checkPath = cfg.path || '/';
  const timeoutMs = (cfg.timeoutSec ?? 60) * 1000;
  const intervalMs = (cfg.intervalSec ?? 2) * 1000;
  const isStatic = app.kind === 'static';

  const startedAt = Date.now();
  let attempt = 0;
  let baselineRestarts = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      return { ok: false, reason: 'aborted' };
    }
    attempt += 1;

    if (!isStatic) {
      const procs = await pm2Service.jlist();
      const proc = procs[pm2Service.pm2Name(app.name)];
      const restarts = proc?.pm2_env?.restart_time ?? 0;
      if (baselineRestarts === null) baselineRestarts = restarts;

      if (proc?.pm2_env?.status === 'errored') {
        log.error('pm2 process errored', stepId);
        await logAppOutput(app, log, stepId);
        return { ok: false, reason: 'pm2 process errored' };
      }
      if (restarts - baselineRestarts >= CRASH_LOOP_RESTART_DELTA) {
        log.error('pm2 restart count climbing (crash loop)', stepId);
        await logAppOutput(app, log, stepId);
        return { ok: false, reason: 'crash loop detected' };
      }
    }

    let result;
    if (isStatic) {
      result = await checkPublished(config, app.name, checkPath);
    } else {
      result = await requestOnce(app.port, checkPath);
    }

    if (result.ok && result.statusCode >= MIN_OK_STATUS && result.statusCode <= MAX_OK_STATUS) {
      log.info(`GET ${checkPath} -> ${result.statusCode} (attempt ${attempt})`, stepId);
      return { ok: true, statusCode: result.statusCode, attempts: attempt };
    }
    log.info(`GET ${checkPath} -> ${result.statusCode ?? 'error'} (attempt ${attempt})`, stepId);

    const remaining = timeoutMs - (Date.now() - startedAt);
    await sleep(Math.min(intervalMs, Math.max(0, remaining)), signal);
  }

  return { ok: false, reason: 'timed out' };
}

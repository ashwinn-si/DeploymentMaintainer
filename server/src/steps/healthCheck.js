import http from 'node:http';
import * as pm2Service from '../services/pm2.js';

export const type = 'healthCheck';

const MIN_OK_STATUS = 200;
const MAX_OK_STATUS = 399;
const CRASH_LOOP_RESTART_DELTA = 3;

export function label(config) {
  return `Health check ${config?.path || '/'}`;
}

function requestOnce(port, requestPath) {
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

function sleep(ms, signal) {
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

// Returns a result rather than throwing: fail/auto-rollback is the 3b deployer's decision.
export async function run(ctx) {
  const { app, log, signal, step, stepId } = ctx;
  const cfg = step?.config ?? {};
  const checkPath = cfg.path || '/';
  const timeoutMs = (cfg.timeoutSec ?? 60) * 1000;
  const intervalMs = (cfg.intervalSec ?? 2) * 1000;

  const startedAt = Date.now();
  let attempt = 0;
  let baselineRestarts = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      return { ok: false, reason: 'aborted' };
    }
    attempt += 1;

    const procs = await pm2Service.jlist();
    const proc = procs[pm2Service.pm2Name(app.name)];
    const restarts = proc?.pm2_env?.restart_time ?? 0;
    if (baselineRestarts === null) baselineRestarts = restarts;

    if (proc?.pm2_env?.status === 'errored') {
      log.error('pm2 process errored', stepId);
      return { ok: false, reason: 'pm2 process errored' };
    }
    if (restarts - baselineRestarts >= CRASH_LOOP_RESTART_DELTA) {
      log.error('pm2 restart count climbing (crash loop)', stepId);
      return { ok: false, reason: 'crash loop detected' };
    }

    const result = await requestOnce(app.port, checkPath);
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

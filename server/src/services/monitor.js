import http from 'node:http';
import App from '../models/App.js';
import * as system from './system.js';
import { checkPublished } from '../steps/publish.js';

const SAMPLE_INTERVAL_MS = 30 * 1000;
const HEALTH_INTERVAL_MS = 60 * 1000;
const RING_BUFFER_SIZE = 120; // 1 hour at 30s samples
const HEALTH_CHECK_TIMEOUT_MS = 5000;
const HEALTH_CHECK_CONCURRENCY = 5;

let history = [];
let sampleTimer = null;
let healthTimer = null;

export function isHealthMonitorRunning() {
  return healthTimer !== null;
}

export function getHistory() {
  return history.slice();
}

export function getLatestSample() {
  return history[history.length - 1] ?? null;
}

async function sampleTick(config) {
  try {
    const sample = await system.getCurrentSample(config);
    history.push(sample);
    if (history.length > RING_BUFFER_SIZE) history.shift();
  } catch (err) {
    console.error(`monitor: sample tick failed: ${err.message}`);
  }
}

function checkOnce(app, healthPath) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: app.port, path: healthPath, timeout: HEALTH_CHECK_TIMEOUT_MS },
      (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, statusCode: res.statusCode });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: null });
    });
    req.on('error', () => resolve({ ok: false, statusCode: null }));
  });
}

async function checkApp(app, config) {
  const hcStep = app.steps.find((s) => s.type === 'healthCheck');
  const healthPath = hcStep?.config?.path || '/';
  const startedAt = Date.now();
  const result = app.kind === 'static' ? await checkPublished(config, app.name, healthPath) : await checkOnce(app, healthPath);
  const latencyMs = Date.now() - startedAt;
  await App.updateOne(
    { _id: app._id },
    { health: { ok: result.ok, statusCode: result.statusCode, latencyMs, checkedAt: new Date() } },
  );
}

async function healthTick(config) {
  try {
    const apps = await App.find({ status: 'online' });
    const eligible = apps.filter((app) => app.steps.some((s) => s.type === 'healthCheck' && s.enabled));

    let cursor = 0;
    async function worker() {
      for (;;) {
        const app = eligible[cursor];
        cursor += 1;
        if (!app) return;
        try {
          await checkApp(app, config);
        } catch (err) {
          console.error(`monitor: health check failed for ${app.name}: ${err.message}`);
        }
      }
    }

    const workerCount = Math.min(HEALTH_CHECK_CONCURRENCY, eligible.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
  } catch (err) {
    console.error(`monitor: health tick failed: ${err.message}`);
  }
}

export function startMonitor(config) {
  if (sampleTimer) return;

  sampleTimer = setInterval(() => sampleTick(config), SAMPLE_INTERVAL_MS);
  sampleTimer.unref?.();
  if (config.HEALTH_MONITOR) {
    healthTimer = setInterval(() => healthTick(config), HEALTH_INTERVAL_MS);
    healthTimer.unref?.();
  }

  // So /system has data immediately instead of waiting up to 30s for the first tick.
  sampleTick(config);
}

export function stopMonitor() {
  if (sampleTimer) clearInterval(sampleTimer);
  if (healthTimer) clearInterval(healthTimer);
  sampleTimer = null;
  healthTimer = null;
}

// Test-only hooks: drive a tick directly instead of waiting on the timers.
export async function __runSampleTick(config) {
  await sampleTick(config);
}
export async function __runHealthTick(config) {
  await healthTick(config);
}
export function __resetMonitorState() {
  history = [];
}

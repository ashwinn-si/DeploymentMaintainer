import { EventEmitter } from 'node:events';
import Deployment from '../models/Deployment.js';

const DEFAULT_FLUSH_INTERVAL_MS = 500;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const TRUNCATED_MESSAGE = '…log truncated';

// Shared by all in-flight deployments; stage 3b routes subscribe by filtering on payload.deploymentId.
export const deployEvents = new EventEmitter();
deployEvents.setMaxListeners(0);

async function defaultPersist(deploymentId, entries) {
  await Deployment.updateOne({ _id: deploymentId }, { $push: { entries: { $each: entries } } });
}

// deploymentId (string) -> { getUnflushed }. Lets a late SSE subscriber see
// entries that were pushed (and emitted as 'line') before it connected but
// haven't hit the flush interval yet, so they're missing from both the DB
// replay and the live event stream it just subscribed to.
const activeLogs = new Map();

export function getUnflushedEntries(deploymentId) {
  const entry = activeLogs.get(String(deploymentId));
  return entry ? entry.getUnflushed() : [];
}

export function createDeployLog(deployment, options = {}) {
  const {
    secrets = [],
    persist = defaultPersist,
    flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
    maxBytes = DEFAULT_MAX_BYTES,
  } = options;

  const deploymentId = deployment?._id ?? deployment;
  const secretValues = secrets.filter((s) => typeof s === 'string' && s.length >= 4);

  let buffer = [];
  let totalBytes = 0;
  let truncated = false;
  let closed = false;
  let flushTimer = null;
  let nextIndex = 0;

  const registryKey = String(deploymentId);
  activeLogs.set(registryKey, { getUnflushed: () => buffer.slice() });

  function redact(text) {
    let out = text;
    for (const secret of secretValues) {
      out = out.split(secret).join('••••');
    }
    return out;
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, flushIntervalMs);
    flushTimer.unref?.();
  }

  function pushEntry({ stream, text, step = null, force = false }) {
    if (closed) return;
    if (truncated && !force) return;
    const redacted = redact(String(text ?? ''));
    const size = Buffer.byteLength(redacted, 'utf8');

    if (!force && totalBytes + size > maxBytes) {
      truncated = true;
      const entry = { i: nextIndex, t: new Date(), step, stream: 'error', text: TRUNCATED_MESSAGE };
      nextIndex += 1;
      buffer.push(entry);
      deployEvents.emit('line', { deploymentId, ...entry });
      scheduleFlush();
      return;
    }

    if (!force) totalBytes += size;
    const entry = { i: nextIndex, t: new Date(), step, stream, text: redacted };
    nextIndex += 1;
    buffer.push(entry);
    deployEvents.emit('line', { deploymentId, ...entry });
    scheduleFlush();
  }

  async function flush() {
    if (buffer.length === 0) return;
    const toPersist = buffer;
    buffer = [];
    try {
      await persist(deploymentId, toPersist);
    } catch (err) {
      // Keep the entries (bounded by maxBytes already) and retry on the next flush instead of throwing into a timer callback.
      buffer = toPersist.concat(buffer);
      console.error(`deployLog: flush failed for deployment ${deploymentId}: ${err.message}`);
      if (!closed) scheduleFlush();
    }
  }

  return {
    info: (text, step = null, opts = {}) => pushEntry({ stream: 'info', text, step, force: !!opts.force }),
    cmd: (text, step = null, opts = {}) => pushEntry({ stream: 'cmd', text, step, force: !!opts.force }),
    error: (text, step = null, opts = {}) => pushEntry({ stream: 'error', text, step, force: !!opts.force }),
    stdout: (text, step = null) => pushEntry({ stream: 'stdout', text, step }),
    stderr: (text, step = null) => pushEntry({ stream: 'stderr', text, step }),
    onLine: (step) => ({ stream, text }) => pushEntry({ stream, text, step }),
    // Step markers always get through even after truncation, so the timeline stays accurate.
    stepStart: (step) => {
      pushEntry({ stream: 'info', text: `▶ ${step}`, step, force: true });
      deployEvents.emit('step', { deploymentId, step, status: 'running' });
    },
    stepEnd: (step, status) => {
      const mark = status === 'success' ? '✔' : status === 'skipped' ? '–' : '✖';
      pushEntry({ stream: 'info', text: `${mark} ${step} · ${status}`, step, force: true });
      deployEvents.emit('step', { deploymentId, step, status });
    },
    flush,
    close: async () => {
      await flush();
      closed = true;
      activeLogs.delete(registryKey);
      deployEvents.emit('done', { deploymentId });
    },
  };
}

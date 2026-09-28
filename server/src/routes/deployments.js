import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import Deployment from '../models/Deployment.js';
import App from '../models/App.js';
import { HttpError } from '../lib/httpError.js';
import { serializeDeploymentSummary, serializeDeploymentDetail, serializeLogEntry } from '../lib/serializers.js';
import { cancelDeployment, rollbackTo } from '../services/deployer.js';
import { deployEvents, getUnflushedEntries } from '../services/deployLog.js';

const HEARTBEAT_MS = 15000;
const TERMINAL_STATUSES = new Set(['success', 'failed', 'cancelled']);

function toIso(d) {
  return d ? new Date(d).toISOString() : null;
}

async function findDeploymentOr404(id, projection) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Deployment not found');
  const deployment = await Deployment.findById(id, projection).lean();
  if (!deployment) throw new HttpError(404, 'Deployment not found');
  return deployment;
}

async function appNamesFor(deployments) {
  const appIds = [...new Set(deployments.map((d) => String(d.appId)))];
  const apps = await App.find({ _id: { $in: appIds } }, 'name repoFullName').lean();
  const byId = new Map(apps.map((a) => [String(a._id), a]));
  return byId;
}

// SSE: subscribe to deployEvents before doing the DB replay, buffer anything
// that arrives during the replay, then drain de-duping by entry index — this
// avoids the gap between "read from Mongo" and "start listening for new lines".
async function streamHandler(req, res) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Deployment not found');
  const exists = await Deployment.exists({ _id: id });
  if (!exists) throw new HttpError(404, 'Deployment not found');

  const afterRaw = Number(req.query.after);
  const after = Number.isFinite(afterRaw) ? afterRaw : -1;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();

  let mode = 'buffering';
  let closed = false;
  let doneSent = false;
  let lastSentIndex = after;
  const pending = [];

  function write(event, data) {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function sendLine(entry) {
    if (entry.i <= lastSentIndex) return;
    lastSentIndex = entry.i;
    write('line', serializeLogEntry(entry));
  }
  function sendStep(payload) {
    write('step', {
      id: payload.id ?? payload.step,
      status: payload.status,
      startedAt: payload.startedAt ?? null,
      endedAt: payload.endedAt ?? null,
    });
  }
  // deployLog's own 'done' event (from log.close()) carries no status — the
  // deployer always emits 'status' just before it, so remember it for 'done'.
  let lastKnownStatus = null;
  function sendStatus(payload) {
    lastKnownStatus = payload.status;
    write('status', {
      status: payload.status,
      commitSha: payload.commitSha ?? null,
      error: payload.error ?? null,
      finishedAt: payload.finishedAt ?? null,
    });
  }
  function sendDone(payload) {
    if (doneSent) return;
    doneSent = true;
    write('done', { status: payload.status ?? lastKnownStatus });
    end();
  }

  function dispatch(type, payload) {
    if (type === 'line') sendLine(payload);
    else if (type === 'step') sendStep(payload);
    else if (type === 'status') sendStatus(payload);
    else if (type === 'done') sendDone(payload);
  }

  function makeHandler(type) {
    return (payload) => {
      if (String(payload.deploymentId) !== id) return;
      if (mode === 'buffering') pending.push({ type, payload });
      else dispatch(type, payload);
    };
  }

  const lineHandler = makeHandler('line');
  const stepHandler = makeHandler('step');
  const statusHandler = makeHandler('status');
  const doneHandler = makeHandler('done');
  deployEvents.on('line', lineHandler);
  deployEvents.on('step', stepHandler);
  deployEvents.on('status', statusHandler);
  deployEvents.on('done', doneHandler);

  // Taken synchronously, right after subscribing: entries pushed (and thus
  // already emitted as a 'line' event we missed) before we connected but not
  // yet flushed to Mongo would otherwise be lost — absent from both the DB
  // replay below and the live events we're now buffering.
  const unflushed = getUnflushedEntries(id);

  let heartbeat = null;
  function cleanupListeners() {
    deployEvents.off('line', lineHandler);
    deployEvents.off('step', stepHandler);
    deployEvents.off('status', statusHandler);
    deployEvents.off('done', doneHandler);
  }
  function end() {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    cleanupListeners();
    res.end();
  }
  req.on('close', end);

  const doc = await Deployment.findById(id).lean();
  if (!doc) {
    end();
    return;
  }

  const byIndex = new Map();
  for (const entry of doc.entries) byIndex.set(entry.i, entry);
  for (const entry of unflushed) byIndex.set(entry.i, entry);
  const replayEntries = [...byIndex.values()].sort((a, b) => a.i - b.i);
  for (const entry of replayEntries) {
    if (entry.i > after) sendLine(entry);
  }
  for (const s of doc.steps) {
    sendStep({ id: s.id, status: s.status, startedAt: toIso(s.startedAt), endedAt: toIso(s.endedAt) });
  }

  mode = 'live';
  const toDrain = pending.splice(0);
  for (const { type, payload } of toDrain) {
    if (closed) break;
    if (type === 'line' && payload.i <= lastSentIndex) continue;
    dispatch(type, payload);
  }

  if (!closed && TERMINAL_STATUSES.has(doc.status) && !doneSent) {
    dispatch('status', {
      status: doc.status,
      commitSha: doc.commitSha ?? null,
      error: doc.error ?? null,
      finishedAt: toIso(doc.finishedAt),
    });
    dispatch('done', { status: doc.status });
  }

  if (!closed) {
    heartbeat = setInterval(() => {
      if (!closed) res.write(': ping\n\n');
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
  }
}

export function createDeploymentsRouter(config) {
  const router = Router();
  router.use(requireAuth(config));

  router.get('/active', async (req, res) => {
    const deployments = await Deployment.find({ status: { $in: ['queued', 'running'] } })
      .sort({ createdAt: -1 })
      .lean();
    const byId = await appNamesFor(deployments);
    res.json({
      deployments: deployments.map((d) => serializeDeploymentSummary(d, { appName: byId.get(String(d.appId))?.name })),
    });
  });

  router.get('/', async (req, res) => {
    const query = {};
    if (req.query.app) query.appId = req.query.app;
    if (req.query.status) query.status = req.query.status;
    if (req.query.branch) query.branch = req.query.branch;
    if (req.query.mode) query.mode = req.query.mode;
    if (req.query.before) query.createdAt = { $lt: new Date(String(req.query.before)) };
    const limit = Math.min(Number(req.query.limit) > 0 ? Number(req.query.limit) : 50, 200);

    const deployments = await Deployment.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    const byId = await appNamesFor(deployments);
    const nextBefore = deployments.length === limit ? deployments[deployments.length - 1].createdAt.toISOString() : null;

    res.json({
      deployments: deployments.map((d) => serializeDeploymentSummary(d, { appName: byId.get(String(d.appId))?.name })),
      nextBefore,
    });
  });

  router.get('/:id', async (req, res) => {
    const deployment = await findDeploymentOr404(req.params.id);
    const app = await App.findById(deployment.appId, 'name repoFullName').lean();
    res.json({ deployment: serializeDeploymentDetail(deployment, { appName: app?.name, repoFullName: app?.repoFullName }) });
  });

  router.get('/:id/entries', async (req, res) => {
    const deployment = await findDeploymentOr404(req.params.id, 'entries');
    const afterRaw = Number(req.query.after);
    const after = Number.isFinite(afterRaw) ? afterRaw : -1;
    const limit = Math.min(Number(req.query.limit) > 0 ? Number(req.query.limit) : 2000, 5000);
    const entries = deployment.entries.filter((e) => e.i > after).slice(0, limit);
    res.json({ entries: entries.map((e) => serializeLogEntry(e)) });
  });

  router.get('/:id/stream', streamHandler);

  router.get('/:id/download', async (req, res) => {
    const deployment = await findDeploymentOr404(req.params.id);
    const app = await App.findById(deployment.appId, 'name').lean();
    const lines = deployment.entries.map((e) => {
      const stepTag = e.step ? `(${e.step}) ` : '';
      return `[${new Date(e.t).toISOString()}] ${stepTag}${e.stream}: ${e.text}`;
    });
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${app?.name ?? 'app'}-${deployment.number}.log"`);
    res.send(lines.join('\n'));
  });

  router.post('/:id/cancel', async (req, res) => {
    const deployment = await cancelDeployment(req.params.id);
    const app = await App.findById(deployment.appId, 'name').lean();
    res.json({ deployment: serializeDeploymentSummary(deployment, { appName: app?.name }) });
  });

  router.post('/:id/rollback', async (req, res) => {
    const deployment = await rollbackTo(req.params.id, config);
    const app = await App.findById(deployment.appId, 'name').lean();
    res.json({ deployment: serializeDeploymentSummary(deployment, { appName: app?.name }) });
  });

  return router;
}

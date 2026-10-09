import App from '../models/App.js';
import Deployment from '../models/Deployment.js';
import { HttpError } from '../lib/httpError.js';
import { validateRef } from '../lib/validate.js';
import { decryptAppEnv } from './crypto.js';
import { createDeployLog, deployEvents } from './deployLog.js';
import { REGISTRY, ALWAYS_INVOKE } from '../steps/index.js';

const KEEP_DEPLOYMENTS_PER_APP = 50;
const COMMON_ENV_VALUES = new Set([
  'true', 'false', 'production', 'development', 'test', 'staging', 'localhost',
]);

// appId -> deploymentId of the currently running/queued deployment for that app.
const runningByApp = new Map();
// deploymentId -> AbortController for the in-flight pipeline.
const controllers = new Map();

export function getActiveDeploymentId(appId) {
  return runningByApp.get(String(appId)) ?? null;
}

function toIso(d) {
  return d ? new Date(d).toISOString() : null;
}

function isCommonEnvValue(value) {
  if (COMMON_ENV_VALUES.has(value.toLowerCase())) return true;
  if (/^-?\d+(\.\d+)?$/.test(value)) return true;
  return false;
}

function buildSecrets(config, env) {
  const secrets = [];
  if (config.GITHUB_TOKEN) {
    secrets.push(config.GITHUB_TOKEN);
    secrets.push(Buffer.from(`x-access-token:${config.GITHUB_TOKEN}`).toString('base64'));
  }
  for (const value of Object.values(env)) {
    if (typeof value === 'string' && value.length >= 4 && !isCommonEnvValue(value)) {
      secrets.push(value);
    }
  }
  return secrets;
}

function emitStepEvent(deploymentId, stepId, status, { startedAt, endedAt } = {}) {
  deployEvents.emit('step', {
    deploymentId: String(deploymentId),
    id: stepId,
    status,
    startedAt: toIso(startedAt) ?? null,
    endedAt: toIso(endedAt) ?? null,
  });
}

function emitStatusEvent(deploymentId, status, commitSha, error, finishedAt) {
  deployEvents.emit('status', {
    deploymentId: String(deploymentId),
    status,
    commitSha: commitSha ?? null,
    error: error ?? null,
    finishedAt: toIso(finishedAt),
  });
}

async function setStepStatus(deploymentId, index, status, { startedAt, endedAt } = {}) {
  const set = { [`steps.${index}.status`]: status };
  if (startedAt) set[`steps.${index}.startedAt`] = startedAt;
  if (endedAt) set[`steps.${index}.endedAt`] = endedAt;
  await Deployment.updateOne({ _id: deploymentId }, { $set: set });
}

async function getLastStderrLines(deploymentId, n) {
  const doc = await Deployment.findById(deploymentId).select('entries').lean();
  const stderrLines = (doc?.entries ?? []).filter((e) => e.stream === 'stderr').map((e) => e.text);
  return stderrLines.slice(-n);
}

async function appendFinalNote(deploymentId, text) {
  const doc = await Deployment.findById(deploymentId).select('entries').lean();
  if (!doc) return;
  const i = doc.entries.length;
  const entry = { i, t: new Date(), step: null, stream: 'info', text };
  await Deployment.updateOne({ _id: deploymentId }, { $push: { entries: entry } });
  deployEvents.emit('line', { deploymentId: String(deploymentId), ...entry });
}

async function pruneOldDeployments(appId) {
  const stale = await Deployment.find({ appId }).sort({ createdAt: -1 }).skip(KEEP_DEPLOYMENTS_PER_APP).select('_id');
  if (stale.length > 0) {
    await Deployment.deleteMany({ _id: { $in: stale.map((d) => d._id) } });
  }
}

// currentIndex is where the abort was observed; stepWasRunning distinguishes
// "the step at currentIndex had already been marked running" from "we never got that far".
async function handleCancellation(app, deployment, log, stepDefs, currentIndex, stepWasRunning, pm2Reached, previousAppStatus) {
  const finishedAt = new Date();

  if (stepWasRunning) {
    const meta = deployment.steps[currentIndex];
    await setStepStatus(deployment._id, currentIndex, 'failed', { endedAt: finishedAt });
    emitStepEvent(deployment._id, meta.id, 'failed', { endedAt: finishedAt });
  }
  const skipFrom = stepWasRunning ? currentIndex + 1 : currentIndex;
  for (let j = skipFrom; j < stepDefs.length; j += 1) {
    const meta = deployment.steps[j];
    await setStepStatus(deployment._id, j, 'skipped');
    emitStepEvent(deployment._id, meta.id, 'skipped');
  }

  const error = 'Cancelled by user';
  await Deployment.updateOne({ _id: deployment._id }, { status: 'cancelled', error, finishedAt });
  const newAppStatus = pm2Reached ? 'failed' : previousAppStatus;
  await App.updateOne({ _id: app._id }, { status: newAppStatus });
  emitStatusEvent(deployment._id, 'cancelled', deployment.commitSha, error, finishedAt);

  log.info(
    pm2Reached
      ? 'cancelled after pm2 had already started/reloaded the new version — check the app before relying on it'
      : 'cancelled before pm2 ran; the previous version is still serving',
    null,
    { force: true },
  );

  return { autoRollback: null };
}

async function finalizeSuccess(app, deployment, log) {
  const finishedAt = new Date();
  await Deployment.updateOne({ _id: deployment._id }, { status: 'success', finishedAt });
  await App.updateOne({ _id: app._id }, {
    status: 'online',
    currentCommitSha: deployment.commitSha,
    lastDeployedAt: finishedAt,
  });
  emitStatusEvent(deployment._id, 'success', deployment.commitSha, null, finishedAt);
  log.info(`deploy succeeded in ${finishedAt.getTime() - deployment.createdAt.getTime()}ms`, null, { force: true });
  return { autoRollback: null };
}

async function finalizeFailure(app, deployment, log, { error, pm2Reached, previousAppStatus, healthCheckFailure }) {
  const finishedAt = new Date();
  await Deployment.updateOne({ _id: deployment._id }, { status: 'failed', error, finishedAt });
  const newAppStatus = pm2Reached ? 'failed' : previousAppStatus;
  await App.updateOne({ _id: app._id }, { status: newAppStatus });
  emitStatusEvent(deployment._id, 'failed', deployment.commitSha, error, finishedAt);

  await log.flush();
  const lastStderr = await getLastStderrLines(deployment._id, 20);
  if (lastStderr.length > 0) {
    log.error(`last ${lastStderr.length} stderr line(s):\n${lastStderr.join('\n')}`, null, { force: true });
  }
  log.error(`deploy failed: ${error}`, null, { force: true });

  let autoRollback = null;
  // Never chain a rollback off a failed rollback — that would walk further and
  // further back through history instead of just leaving the last-known-good version up.
  if (healthCheckFailure && deployment.mode !== 'rollback') {
    const hcConfig = app.steps.find((s) => s.type === 'healthCheck')?.config ?? {};
    const autoRollbackEnabled = hcConfig.autoRollback !== false;
    if (autoRollbackEnabled) {
      const prevSuccess = await Deployment.findOne({ appId: app._id, status: 'success' }).sort({ createdAt: -1 });
      if (prevSuccess?.commitSha && prevSuccess.commitSha !== deployment.commitSha) {
        log.info(`auto-rollback: will roll back to #${prevSuccess.number} (${prevSuccess.commitSha})`, null, { force: true });
        autoRollback = { sha: prevSuccess.commitSha, branch: prevSuccess.branch };
      }
    }
  }

  return { autoRollback };
}

// Steps a force deploy may ignore. The rest (clone, node, env, process start, nginx, publish) are
// what make the app reachable at all, so failing them can't be papered over.
const FORCEABLE_STEPS = new Set(['install', 'build', 'custom', 'healthCheck']);

async function runPipeline(app, deployment, config, controller, opts, log) {
  const { branch: branchUsed, mode, sha, rollbackOf, env, previousAppStatus, force } = opts;

  log.info(`${app.name} — ${app.repoFullName}@${branchUsed} (${mode})`, null, { force: true });
  log.info(`node ${deployment.nodeVersion}  previous sha: ${deployment.previousSha ?? '(none)'}`, null, { force: true });
  if (mode === 'rollback' && rollbackOf) {
    const target = await Deployment.findById(rollbackOf).select('number').lean();
    log.info(`rolling back to ${sha} from deployment #${target?.number ?? '?'}`, null, { force: true });
  }

  const stepDefs = app.steps;
  const state = {};
  let pm2Reached = false;

  for (let i = 0; i < stepDefs.length; i += 1) {
    if (controller.signal.aborted) {
      return handleCancellation(app, deployment, log, stepDefs, i, false, pm2Reached, previousAppStatus);
    }

    const stepDef = stepDefs[i];
    const stepMeta = deployment.steps[i];
    const shouldRun = stepDef.enabled || ALWAYS_INVOKE.has(stepDef.type);

    if (!shouldRun) {
      await setStepStatus(deployment._id, i, 'skipped');
      emitStepEvent(deployment._id, stepMeta.id, 'skipped');
      log.info(`– ${stepMeta.label} · disabled`, stepMeta.id, { force: true });
      continue;
    }

    const startedAt = new Date();
    await setStepStatus(deployment._id, i, 'running', { startedAt });
    emitStepEvent(deployment._id, stepMeta.id, 'running', { startedAt });
    log.info(`▶ Step ${i + 1}/${stepDefs.length} · ${stepMeta.label}`, stepMeta.id, { force: true });

    const ctx = {
      app, deployment, env, config, log,
      signal: controller.signal,
      state, step: stepDef, stepId: stepMeta.id,
      branch: branchUsed, sha, fresh: mode === 'fresh', mode,
    };

    let result;
    let stepError = null;
    try {
      result = await REGISTRY[stepDef.type].run(ctx);
    } catch (err) {
      stepError = err;
    }

    if (!stepError && stepDef.type === 'healthCheck' && result && result.ok === false) {
      stepError = new Error(result.reason || 'health check failed');
      stepError.healthCheckFailure = true;
    }

    if (stepError) {
      if (controller.signal.aborted) {
        return handleCancellation(app, deployment, log, stepDefs, i, true, pm2Reached, previousAppStatus);
      }
      const endedAt = new Date();
      await setStepStatus(deployment._id, i, 'failed', { endedAt });
      emitStepEvent(deployment._id, stepMeta.id, 'failed', { endedAt });
      log.error(`✖ ${stepMeta.label} · failed (${endedAt.getTime() - startedAt.getTime()}ms)`, stepMeta.id, { force: true });
      if (force && FORCEABLE_STEPS.has(stepDef.type)) {
        log.info(`force deploy: ignoring failure of ${stepMeta.label} (${stepError.message}) and continuing`, stepMeta.id, { force: true });
        continue;
      }
      return finalizeFailure(app, deployment, log, {
        error: `${stepMeta.label} failed: ${stepError.message}`,
        pm2Reached,
        previousAppStatus,
        healthCheckFailure: Boolean(stepError.healthCheckFailure),
      });
    }

    // pm2 (node) / publish (static) is where the new version goes live; a later failure leaves it up.
    if (stepDef.type === 'pm2' || stepDef.type === 'publish') pm2Reached = true;
    if (stepDef.type === 'gitSync' && result?.sha) {
      await Deployment.updateOne({ _id: deployment._id }, { commitSha: result.sha });
      deployment.commitSha = result.sha;
    }

    const endedAt = new Date();
    await setStepStatus(deployment._id, i, 'success', { endedAt });
    emitStepEvent(deployment._id, stepMeta.id, 'success', { endedAt });
    log.info(`✔ ${stepMeta.label} (${endedAt.getTime() - startedAt.getTime()}ms)`, stepMeta.id, { force: true });
  }

  return finalizeSuccess(app, deployment, log);
}

async function executeDeployment(app, deployment, config, controller, opts, log) {
  let outcome;
  try {
    outcome = await runPipeline(app, deployment, config, controller, opts, log);
  } catch (err) {
    // A bug in a step or the pipeline itself — fail the deployment rather than hang it in "running".
    console.error(`deployer: pipeline crashed for deployment ${deployment._id}: ${err.stack || err}`);
    try {
      await finalizeFailure(app, deployment, log, {
        error: `internal error: ${err.message}`,
        pm2Reached: false,
        previousAppStatus: opts.previousAppStatus,
        healthCheckFailure: false,
      });
    } catch (finalizeErr) {
      console.error(`deployer: failed to finalize crashed deployment ${deployment._id}: ${finalizeErr.message}`);
    }
    outcome = { autoRollback: null };
  } finally {
    await log.close();
    runningByApp.delete(String(app._id));
    controllers.delete(String(deployment._id));
    try {
      await pruneOldDeployments(app._id);
    } catch (err) {
      console.error(`deployer: pruneOldDeployments failed: ${err.message}`);
    }
  }

  if (outcome?.autoRollback) {
    try {
      const rollback = await startDeployment(String(app._id), config, {
        branch: outcome.autoRollback.branch,
        mode: 'rollback',
        sha: outcome.autoRollback.sha,
        autoRollbackOf: deployment._id,
      });
      await appendFinalNote(deployment._id, `auto-rollback started: deployment #${rollback.number}`);
    } catch (err) {
      console.error(`deployer: auto-rollback failed to start for app ${app._id}: ${err.message}`);
    }
  }
}

export async function startDeployment(appId, config, opts = {}) {
  const { branch, mode, sha, rollbackOf = null, autoRollbackOf = null, force = false } = opts;
  if (!['update', 'fresh', 'rollback'].includes(mode)) {
    throw new HttpError(400, 'mode must be one of update, fresh, rollback');
  }

  const appIdStr = String(appId);

  // Reserve the slot synchronously — has()+set() with no await between them —
  // so two near-simultaneous calls for the same app can't both see it empty.
  if (runningByApp.has(appIdStr)) {
    throw new HttpError(409, 'A deployment is already running for this app');
  }
  runningByApp.set(appIdStr, 'pending');

  try {
    const app = await App.findById(appIdStr);
    if (!app) throw new HttpError(404, 'App not found');

    const existingActive = await Deployment.exists({ appId: app._id, status: { $in: ['queued', 'running'] } });
    if (existingActive) {
      throw new HttpError(409, 'A deployment is already running for this app');
    }

    const branchUsed = branch || app.branch;
    if (branch && branch !== app.branch) {
      validateRef(branch);
    }
    const previousAppStatus = app.status;

    // Fail before touching deploySeq/status or creating the Deployment doc if
    // the app's env can't be decrypted (e.g. ENCRYPTION_KEY changed since save).
    const env = decryptAppEnv(config, app.envEncrypted);

    const updatedApp = await App.findByIdAndUpdate(
      appIdStr,
      { $inc: { deploySeq: 1 }, branch: branchUsed, status: 'deploying' },
      { new: true },
    );
    const number = updatedApp.deploySeq;

    const stepMetas = updatedApp.steps.map((s, i) => ({
      id: `${i + 1}-${s.type}`,
      type: s.type,
      label: REGISTRY[s.type].label(s.config),
      status: 'pending',
      startedAt: null,
      endedAt: null,
    }));

    const deployment = await Deployment.create({
      appId: updatedApp._id,
      number,
      branch: branchUsed,
      commitSha: null,
      previousSha: updatedApp.currentCommitSha,
      nodeVersion: updatedApp.nodeVersion,
      mode,
      rollbackOf,
      autoRollbackOf,
      status: 'running',
      steps: stepMetas,
      entries: [],
    });

    const controller = new AbortController();
    runningByApp.set(appIdStr, String(deployment._id));
    controllers.set(String(deployment._id), controller);

    const secrets = buildSecrets(config, env);
    const log = createDeployLog(deployment, { secrets });

    executeDeployment(updatedApp, deployment, config, controller, {
      branch: branchUsed, mode, sha, rollbackOf, autoRollbackOf, env, previousAppStatus, force,
    }, log).catch((err) => {
      console.error(`deployer: unhandled error running deployment ${deployment._id}: ${err.stack || err}`);
    });

    return deployment;
  } catch (err) {
    // Only clears our own reservation — once the real deployment id is set,
    // nothing below can throw, so this never touches a live deployment's slot.
    if (runningByApp.get(appIdStr) === 'pending') {
      runningByApp.delete(appIdStr);
    }
    throw err;
  }
}

export async function cancelDeployment(id) {
  const deployment = await Deployment.findById(id);
  if (!deployment) throw new HttpError(404, 'Deployment not found');
  if (!['queued', 'running'].includes(deployment.status)) {
    throw new HttpError(409, 'Deployment is not running');
  }
  const controller = controllers.get(String(id));
  if (controller) controller.abort();
  return deployment;
}

export async function rollbackTo(deploymentId, config) {
  const target = await Deployment.findById(deploymentId);
  if (!target) throw new HttpError(404, 'Deployment not found');
  if (target.status !== 'success' || !target.commitSha) {
    throw new HttpError(400, 'Only a successful deployment with a recorded commit can be rolled back to');
  }
  return startDeployment(String(target.appId), config, {
    branch: target.branch,
    mode: 'rollback',
    sha: target.commitSha,
    rollbackOf: target._id,
  });
}

export async function recoverInterruptedDeployments() {
  const stuck = await Deployment.find({ status: { $in: ['queued', 'running'] } });
  await Promise.all(stuck.map(async (dep) => {
    const finishedAt = new Date();
    await Deployment.updateOne(
      { _id: dep._id },
      { status: 'failed', error: 'Dashboard restarted during deploy', finishedAt },
    );
    await App.updateOne({ _id: dep.appId, status: 'deploying' }, { status: 'failed' });
  }));
  return stuck.length;
}

// Only meaningful within a single test run/process; exported for test cleanup between cases.
export function __resetDeployerState() {
  runningByApp.clear();
  controllers.clear();
}

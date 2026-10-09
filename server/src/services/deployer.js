import fsp from 'node:fs/promises';
import path from 'node:path';
import App from '../models/App.js';
import Deployment from '../models/Deployment.js';
import { HttpError } from '../lib/httpError.js';
import { validateRef } from '../lib/validate.js';
import { decryptAppEnv } from './crypto.js';
import { createDeployLog, deployEvents } from './deployLog.js';
import { REGISTRY, ALWAYS_INVOKE } from '../steps/index.js';
import { readCurrentRelease, restoreCurrentRelease } from '../steps/publish.js';
import { appWorkDir } from '../lib/appEnv.js';
import * as pm2Service from './pm2.js';
import { runSmokeTest } from './smoke.js';
import { getFolderSizeBytes } from './system.js';
import {
  liveDir,
  previousDir,
  formatBytes,
  assertDiskForStaging,
  prepareStaging,
  promoteStaging,
  restorePrevious,
  removeStaging,
  removePrevious,
  repairInterruptedSwap,
} from './staging.js';

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
// `cleanup` (staged deploys, cancelled before the swap) removes the staging folder. A cancel after the swap keeps
// today's behaviour: nothing is swapped back, and the log says the new version may already be live.
async function handleCancellation(app, deployment, log, stepDefs, currentIndex, stepWasRunning, pm2Reached, previousAppStatus, cleanup = null) {
  const finishedAt = new Date();
  if (cleanup) await cleanup();

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

// `restoredPrevious`: a staged deploy failed after the swap and the previous version is serving again, so the app
// goes back to the status it had before the deploy and the rebuild-based auto-rollback is not needed.
async function finalizeFailure(app, deployment, log, { error, pm2Reached, previousAppStatus, healthCheckFailure, restoredPrevious = false }) {
  const finishedAt = new Date();
  const update = { status: 'failed', error, finishedAt };
  if (restoredPrevious) {
    update.restoredPrevious = true;
    deployment.restoredPrevious = true;
  }
  await Deployment.updateOne({ _id: deployment._id }, update);
  const newAppStatus = pm2Reached && !restoredPrevious ? 'failed' : previousAppStatus;
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
  if (healthCheckFailure && !restoredPrevious && deployment.mode !== 'rollback') {
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

async function skipSteps(deployment, stepDefs, from) {
  for (let j = from; j < stepDefs.length; j += 1) {
    const meta = deployment.steps[j];
    await setStepStatus(deployment._id, j, 'skipped');
    emitStepEvent(deployment._id, meta.id, 'skipped');
  }
}

async function dirExists(dir) {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

// Staged deploy, failure after the swap: put the previous folder (and process / published release) back.
// Returns true when the old version is serving again; false means the caller falls back to today's failure handling.
async function restoreAfterPromote(app, config, deployment, log, state, previousAppStatus) {
  const startedAt = Date.now();
  const onLine = log.onLine(null);
  try {
    log.info('restoring the previous version…', null, { force: true });
    const isStatic = app.kind === 'static';
    // Stop the new process before its folder is swapped away.
    if (!isStatic) await pm2Service.deleteQuiet(pm2Service.pm2Name(app.name), { onLine });
    await restorePrevious(config, app.name);

    if (isStatic) {
      // The publish step already pointed `current` at the new release; point it back.
      if (state.previousRelease && !(await restoreCurrentRelease(config, app.name, state.previousRelease))) {
        throw new Error('the previous published release no longer exists');
      }
    } else if (previousAppStatus === 'stopped') {
      log.info('the app was stopped before this deploy; leaving it stopped', null, { force: true });
    } else {
      const ecoPath = pm2Service.ecosystemPath(appWorkDir(config, app));
      if (await pm2Service.readEcosystem(ecoPath)) {
        log.cmd(`pm2 start ${ecoPath} --update-env`, null, { force: true });
        await pm2Service.start(ecoPath, { onLine });
        await pm2Service.save({ onLine });
      } else {
        log.error(`warning: ${ecoPath} not found in the restored version, so its process was not started`, null, { force: true });
      }
    }
    log.info(
      `restored the previous version (${deployment.previousSha ?? 'unknown commit'}) in ${Date.now() - startedAt}ms`,
      null,
      { force: true },
    );
    return true;
  } catch (err) {
    log.error(`could not restore the previous version: ${err.message}`, null, { force: true });
    return false;
  }
}

async function runPipeline(app, deployment, config, controller, opts, log) {
  const state = {};
  try {
    return await runPipelineSteps(app, deployment, config, controller, opts, log, state);
  } catch (err) {
    // An internal error before the swap must not leave a half-built staging folder behind.
    if (app.stagedDeploys !== false && !state.promoted) await removeStaging(config, app.name);
    throw err;
  }
}

async function runPipelineSteps(app, deployment, config, controller, opts, log, state) {
  const { branch: branchUsed, mode, sha, rollbackOf, env, previousAppStatus, force } = opts;

  log.info(`${app.name} — ${app.repoFullName}@${branchUsed} (${mode})`, null, { force: true });
  log.info(`node ${deployment.nodeVersion}  previous sha: ${deployment.previousSha ?? '(none)'}`, null, { force: true });
  if (mode === 'rollback' && rollbackOf) {
    const target = await Deployment.findById(rollbackOf).select('number').lean();
    log.info(`rolling back to ${sha} from deployment #${target?.number ?? '?'}`, null, { force: true });
  }

  const stepDefs = app.steps;
  let pm2Reached = false;

  // Staged deploys: everything before the first enabled pm2/publish step runs in `<name>.staging`; the folder is
  // swapped in (after a smoke test for node apps) right before that step. `stagedDeploys: false` = in place.
  const staged = app.stagedDeploys !== false;
  const promoteIndex = staged
    ? (() => {
        const idx = stepDefs.findIndex((s) => (s.type === 'pm2' || s.type === 'publish') && s.enabled);
        return idx === -1 ? stepDefs.length : idx;
      })()
    : -1;
  const cancelCleanup = () => (staged && !state.promoted ? () => removeStaging(config, app.name) : null);

  if (staged) {
    try {
      await assertDiskForStaging(config, app.name);
    } catch (err) {
      // Nothing has been touched yet: the live folder and process keep serving as they were.
      log.error(err.message, null, { force: true });
      await skipSteps(deployment, stepDefs, 0);
      return finalizeFailure(app, deployment, log, {
        error: err.message,
        pm2Reached: false,
        previousAppStatus,
        healthCheckFailure: false,
      });
    }
    state.repoDir = await prepareStaging(config, app.name);
    if (mode !== 'fresh' && (await dirExists(liveDir(config, app.name)))) state.seedFrom = liveDir(config, app.name);
    log.info(`staged deploy: building in ${path.basename(state.repoDir)}; the live version keeps serving until it passes`, null, { force: true });
  }

  // Runs once, right before the first pm2/publish step: smoke test, then swap staging in as the live folder.
  // Returns an outcome to end the pipeline with, or null to carry on.
  async function smokeAndPromote(i) {
    const fail = async (error) => {
      await removeStaging(config, app.name);
      await skipSteps(deployment, stepDefs, i);
      return finalizeFailure(app, deployment, log, { error, pm2Reached: false, previousAppStatus, healthCheckFailure: false });
    };

    const healthStep = stepDefs.find((s) => s.type === 'healthCheck' && s.enabled);
    if (stepDefs[i]?.type === 'pm2' && app.kind !== 'static' && healthStep) {
      const result = await runSmokeTest(app, {
        config,
        env,
        binDir: state.binDir,
        stagingPath: state.repoDir,
        healthConfig: healthStep.config ?? {},
        log,
        signal: controller.signal,
        stepId: deployment.steps[i].id,
      });
      if (controller.signal.aborted) {
        return handleCancellation(app, deployment, log, stepDefs, i, false, false, previousAppStatus, cancelCleanup());
      }
      if (!result.ok) {
        const message = `Smoke test failed: ${result.reason}`;
        log.error(message, deployment.steps[i].id, { force: true });
        if (!force) return fail(message);
        log.info(`force deploy: ignoring the failed smoke test (${result.reason}) and promoting anyway`, null, { force: true });
      }
    }

    if (stepDefs[i]?.type === 'publish') state.previousRelease = await readCurrentRelease(config, app.name);

    let hadPrevious;
    try {
      ({ hadPrevious } = await promoteStaging(config, app.name));
    } catch (err) {
      log.error(`could not swap in the staged build: ${err.message}`, null, { force: true });
      return fail(`Promoting the staged build failed: ${err.message}`);
    }
    state.repoDir = liveDir(config, app.name);
    state.appDir = path.join(state.repoDir, app.rootDir || '');
    state.promoted = true;
    state.hadPrevious = hadPrevious;
    log.info(
      `promoted staged build (previous version kept at ${path.basename(previousDir(config, app.name))} until the deploy passes)`,
      null,
      { force: true },
    );
    return null;
  }

  for (let i = 0; i < stepDefs.length; i += 1) {
    if (controller.signal.aborted) {
      return handleCancellation(app, deployment, log, stepDefs, i, false, pm2Reached, previousAppStatus, cancelCleanup());
    }

    if (staged && !state.promoted && i === promoteIndex) {
      const outcome = await smokeAndPromote(i);
      if (outcome) return outcome;
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
        return handleCancellation(app, deployment, log, stepDefs, i, true, pm2Reached, previousAppStatus, cancelCleanup());
      }
      const endedAt = new Date();
      await setStepStatus(deployment._id, i, 'failed', { endedAt });
      emitStepEvent(deployment._id, stepMeta.id, 'failed', { endedAt });
      log.error(`✖ ${stepMeta.label} · failed (${endedAt.getTime() - startedAt.getTime()}ms)`, stepMeta.id, { force: true });
      if (force && FORCEABLE_STEPS.has(stepDef.type)) {
        log.info(`force deploy: ignoring failure of ${stepMeta.label} (${stepError.message}) and continuing`, stepMeta.id, { force: true });
        continue;
      }
      const error = `${stepMeta.label} failed: ${stepError.message}`;

      if (staged && !state.promoted) {
        // The live folder and process were never touched: drop the staging folder, no rollback of any kind.
        await removeStaging(config, app.name);
        await skipSteps(deployment, stepDefs, i + 1);
        return finalizeFailure(app, deployment, log, { error, pm2Reached: false, previousAppStatus, healthCheckFailure: false });
      }

      let restoredPrevious = false;
      if (staged) {
        await skipSteps(deployment, stepDefs, i + 1);
        // Only a version that deployed successfully is worth swapping back to.
        if (state.hadPrevious && deployment.previousSha) {
          restoredPrevious = await restoreAfterPromote(app, config, deployment, log, state, previousAppStatus);
        }
      }
      return finalizeFailure(app, deployment, log, {
        error,
        pm2Reached,
        previousAppStatus,
        healthCheckFailure: Boolean(stepError.healthCheckFailure),
        restoredPrevious,
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

  // A pipeline with no pm2/publish step promotes once every step has passed.
  if (staged && !state.promoted) {
    const outcome = await smokeAndPromote(stepDefs.length);
    if (outcome) return outcome;
  }

  if (staged && state.hadPrevious) {
    // Every step, including the live health check, has passed: the old version has done its job (it only exists to
    // be swapped back if something after the swap fails), so free its disk instead of keeping a second copy.
    let bytes = null;
    try {
      bytes = await getFolderSizeBytes(previousDir(config, app.name));
    } catch {
      // size is informational only
    }
    if (await removePrevious(config, app.name)) {
      log.info(`deleted the previous version${bytes === null ? '' : ` (freed ${formatBytes(bytes)})`}`, null, { force: true });
    }
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
      { returnDocument: 'after' },
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

// With `config`, also cleans up after the interrupted deploy's staged folders: a half-built `<name>.staging` is
// removed, and a swap cut between its two renames (live folder missing, `.previous` present) is repaired.
export async function recoverInterruptedDeployments(config = null) {
  const stuck = await Deployment.find({ status: { $in: ['queued', 'running'] } });
  await Promise.all(stuck.map(async (dep) => {
    if (config) {
      try {
        const app = await App.findById(dep.appId).select('name stagedDeploys').lean();
        if (app) {
          if (app.stagedDeploys !== false && (await repairInterruptedSwap(config, app.name))) {
            console.log(`deployer: restored ${app.name} from ${app.name}.previous after an interrupted swap`);
          }
          await removeStaging(config, app.name);
        }
      } catch (err) {
        console.error(`deployer: staging cleanup failed for deployment ${dep._id}: ${err.message}`);
      }
    }
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

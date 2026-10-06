function toIso(d) {
  return d ? new Date(d).toISOString() : null;
}

function nginxPathFor(app) {
  const nginxStep = (app.steps || []).find((s) => s.type === 'nginx');
  if (!nginxStep?.enabled) return null;
  return nginxStep.config?.path || `/${app.name}`;
}

const EMPTY_PM2 = { status: null, cpu: null, memory: null, restarts: null, uptimeMs: null };

export function serializeAppSummary(app, { pm2 = null, activeDeploymentId = null } = {}) {
  return {
    id: String(app._id),
    name: app.name,
    repoFullName: app.repoFullName,
    branch: app.branch,
    port: app.port,
    nodeVersion: app.nodeVersion,
    path: nginxPathFor(app),
    status: app.status,
    pm2: pm2 ?? EMPTY_PM2,
    health: {
      ok: app.health?.ok ?? false,
      statusCode: app.health?.statusCode ?? null,
      latencyMs: app.health?.latencyMs ?? null,
      checkedAt: toIso(app.health?.checkedAt),
    },
    currentCommitSha: app.currentCommitSha ?? null,
    lastDeployedAt: toIso(app.lastDeployedAt),
    activeDeploymentId: activeDeploymentId ?? null,
    createdAt: toIso(app.createdAt),
    updatedAt: toIso(app.updatedAt),
  };
}

export function serializeAppDetail(app, { pm2, activeDeploymentId, env = [], diskBytes = null } = {}) {
  return {
    ...serializeAppSummary(app, { pm2, activeDeploymentId }),
    env,
    steps: (app.steps || []).map((s) => ({ type: s.type, enabled: s.enabled, config: s.config ?? {} })),
    diskBytes,
  };
}

export function serializeDeploymentSummary(deployment, { appName = null } = {}) {
  const createdAt = deployment.createdAt;
  const finishedAt = deployment.finishedAt;
  const durationMs = finishedAt ? new Date(finishedAt).getTime() - new Date(createdAt).getTime() : null;

  return {
    id: String(deployment._id),
    number: deployment.number,
    appId: String(deployment.appId),
    appName,
    branch: deployment.branch,
    commitSha: deployment.commitSha ?? null,
    previousSha: deployment.previousSha ?? null,
    mode: deployment.mode,
    rollbackOf: deployment.rollbackOf ? String(deployment.rollbackOf) : null,
    autoRollbackOf: deployment.autoRollbackOf ? String(deployment.autoRollbackOf) : null,
    status: deployment.status,
    nodeVersion: deployment.nodeVersion,
    error: deployment.error ?? null,
    createdAt: toIso(createdAt),
    finishedAt: toIso(finishedAt),
    durationMs,
    steps: (deployment.steps || []).map((s) => ({
      id: s.id,
      type: s.type,
      label: s.label,
      status: s.status,
      startedAt: toIso(s.startedAt),
      endedAt: toIso(s.endedAt),
    })),
  };
}

export function serializeDeploymentDetail(deployment, { appName = null, repoFullName = null } = {}) {
  return {
    ...serializeDeploymentSummary(deployment, { appName }),
    entryCount: (deployment.entries || []).length,
    repoFullName,
  };
}

export function serializeLogEntry(entry) {
  return {
    i: entry.i,
    t: toIso(entry.t),
    step: entry.step ?? null,
    stream: entry.stream,
    text: entry.text,
  };
}

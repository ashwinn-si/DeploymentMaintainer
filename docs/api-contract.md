# API contract (shared by backend 3b/4 and frontend 6/7)

All under `/api`, cookie auth (401 = dashboard session invalid, nothing else returns 401).
Errors: `{ error: string, issues?: ZodIssue[] }`. Dates are ISO strings. IDs are `id` (string), never `_id`.

## Shapes

```ts
AppSummary = {
  id, name, repoFullName, branch, port, nodeVersion,
  path: string | null,            // nginx path if nginx step enabled, else null ("localhost only")
  status: 'not_deployed'|'deploying'|'online'|'stopped'|'failed',
  pm2: { status: string|null, cpu: number|null, memory: number|null /*bytes*/, restarts: number|null, uptimeMs: number|null } ,
  health: { ok: boolean, statusCode: number|null, latencyMs: number|null, checkedAt: string|null },
  currentCommitSha: string|null, lastDeployedAt: string|null,
  activeDeploymentId: string|null, // running/queued deployment, if any
  createdAt, updatedAt
}
AppDetail = AppSummary & {
  env: { key: string, value: string }[],   // decrypted, admin only
  steps: { type, enabled, config }[],
  diskBytes: number|null
}
DeploymentSummary = {
  id, number /*per-app sequence, #N*/, appId, appName, branch, commitSha, previousSha,
  mode: 'update'|'fresh'|'rollback', rollbackOf: string|null, autoRollbackOf: string|null,
  status: 'queued'|'running'|'success'|'failed'|'cancelled',
  nodeVersion, error: string|null, createdAt, finishedAt, durationMs: number|null,
  steps: { id /*e.g. "3-install"*/, type, label, status: 'pending'|'running'|'success'|'failed'|'skipped', startedAt, endedAt }[]
}
DeploymentDetail = DeploymentSummary & { entryCount: number, repoFullName }
LogEntry = { i /*index*/, t, step: string|null /*step id*/, stream: 'cmd'|'stdout'|'stderr'|'info'|'error', text }
```

## Endpoints

- `GET /repos?q=&refresh=1` → `{ repos: [{ fullName, name, owner, private, defaultBranch, pushedAt, description, htmlUrl }] }`
- `GET /repos/:owner/:repo/branches` → `{ branches: string[] }` (default first)
- `GET /repos/:owner/:repo/node-version?ref=` → `{ version: string|null, source }`
- `GET /apps` → `{ apps: AppSummary[] }`
- `GET /apps/defaults?name=` → `{ steps, port /*next free*/, nodeVersion /*server default*/ }`
- `POST /apps` body `{ name, repoFullName, branch, port?, nodeVersion, env: [{key,value}], steps, deploy?: boolean }` → `{ app: AppDetail, deployment: DeploymentSummary|null }`
- `GET /apps/:id` → `{ app: AppDetail }`
- `PATCH /apps/:id` body any of `{ branch, port, nodeVersion, env, steps }` → `{ app: AppDetail }` (name immutable)
- `DELETE /apps/:id` body `{ confirmName }` → `{ ok: true }`
- `POST /apps/:id/duplicate` body `{ name, branch, port?, nodeVersion?, copyEnv: boolean, deploy?: boolean }` → `{ app, deployment|null }`
- `POST /apps/:id/deploy` body `{ branch?, mode: 'update'|'fresh' }` → `{ deployment: DeploymentSummary }` (409 if one is running)
- `POST /apps/:id/restart` | `/stop` → `{ app: AppSummary }`
- `GET /apps/:id/logs?lines=200` → `{ text: string }` (pm2 runtime logs)
- `GET /apps/:id/deployments?limit=&before=` → `{ deployments: DeploymentSummary[] }`
- `GET /deployments?app=<id>&status=&branch=&mode=&limit=50&before=<iso>` → `{ deployments: DeploymentSummary[], nextBefore: string|null }`
- `GET /deployments/active` → `{ deployments: DeploymentSummary[] }` (queued/running, for sidebar dot + activity panel)
- `GET /deployments/:id` → `{ deployment: DeploymentDetail }`
- `GET /deployments/:id/entries?after=<i>&limit=2000` → `{ entries: LogEntry[] }`
- `GET /deployments/:id/stream?after=<i>` → SSE. Events:
  - `event: line` data `LogEntry`
  - `event: step` data `{ id, status, startedAt, endedAt }`
  - `event: status` data `{ status, commitSha, error, finishedAt }`
  - `event: done` data `{ status }` then the server closes.
  Replays stored entries with index > after first. Heartbeat comment every 15s.
- `GET /deployments/:id/download` → `text/plain` attachment `<app>-<number>.log`
- `POST /deployments/:id/cancel` → `{ deployment }`
- `POST /deployments/:id/rollback` → `{ deployment }` (only for success deployments with a sha)
- `GET /ports` → `{ dashboard: { port }, rows: [{ port, appId, appName, repoFullName, branch, path, nodeVersion, pm2Status, health, nginx: boolean, lastDeployedAt, conflict: string|null }] }`
- `GET /node/versions` → `{ installed: string[], default: string }`
- `GET /system` → `{ current: SystemSample, history: SystemSample[], info: { hostname, platform, uptimeSec, nodeVersion, pm2Version, nginxVersion, cpuCount }, disks: [{ mount, total, used, free }], apps: [{ appId, appName, pm2Status, cpu, memory, restarts, uptimeMs, diskBytes, health }] }`
  - `SystemSample = { t, cpuPct, memUsed, memTotal, swapUsed, swapTotal, load1, load5, load15, diskUsedPct }`
- `GET /settings/info` → `{ github: { login, scopes, rateLimitRemaining } | { error }, appsDir, nginxEnabled, domainHint: null }`
- `POST /settings/password` body `{ currentPassword, newPassword }` → `{ ok: true }` (re-issues cookie)
- `POST /config/export` body `{ appIds?: string[], passphrase }` → JSON file download (`application/json`, attachment)
- `POST /config/import/preview` body `{ file: object, passphrase }` → `{ rows: [{ name, repoFullName, branch, port, conflict: null|'name'|'port', suggestedName }] }`
- `POST /config/import` body `{ file, passphrase, rows: [{ name /*original*/, action: 'skip'|'create', newName? }], deploy?: boolean }` → `{ created: AppSummary[], deployments: DeploymentSummary[] }`

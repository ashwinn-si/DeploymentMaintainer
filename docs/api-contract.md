# API reference

Two HTTP APIs:

- **Control plane API** (`control/`): what the browser (`web/src/api.js`) talks to. Cookie auth, owns the admin account and the server list, and proxies to agents.
- **Agent API** (`server/`): one per managed server. Bearer-secret auth, no UI, no users. The browser never calls it directly; the control plane forwards to it.

Keep both in sync with `web/src/api.js` when changing an endpoint.

Common to both: errors are `{ error: string, issues?: ZodIssue[] }` (`issues` on validation failures with status 400). Dates are ISO strings. IDs are `id` (string), never `_id`. Secrets (`SERVER_SECRET`, JWTs, passwords) are never returned.

## Control plane API

All under `/api`. Auth is the `dm_session` httpOnly cookie (JWT, 7 days, `Secure` in production, `SameSite=Lax`).

**Only the control plane's own session check returns 401** (`{ error: 'Not authenticated' }`), and the UI treats any 401 as "logged out". Anything that goes wrong on the agent side reaches the browser as 4xx/5xx other than 401 (see the proxy rule below).

### Shapes

```ts
ServerSummary = {
  id,                    // control plane record id (used in URLs), not the agent's SERVER_ID
  name, url,             // url is a normalized origin, e.g. "https://api.example.com"
  serverId,              // the agent's SERVER_ID
  version: string|null, hostname: string|null,
  status: 'online'|'offline'|'unauthorized',
  lastSeenAt: string|null, createdAt
}
```
`status` comes from a handshake plus auth check per server, cached in memory for 15s (5s timeout each). `unauthorized` means the agent is reachable but rejected the stored secret.

### Endpoints

- `GET /health` → `{ ok: true }` (no auth)

Auth (`/auth`):
- `POST /auth/login` body `{ email, password }` → sets the `dm_session` cookie, `{ user: { id, email } }` (rate-limited 10 / 15 min; bad credentials → 401)
- `POST /auth/logout` → clears the cookie, `{ ok: true }`
- `GET /auth/me` → `{ user: { id, email } }` or 401

Account:
- `POST /settings/password` body `{ currentPassword, newPassword /*min 12*/ }` → `{ ok: true }`. Bumps the token version (other sessions end) and re-issues the cookie. Wrong current password or an unchanged password → **400**, never 401. Rate-limited 10 / 15 min.

Servers (all require the session):
- `GET /servers` → `{ servers: ServerSummary[] }`
- `POST /servers` body `{ name /*1-60*/, url, serverId /*^[A-Za-z0-9_-]{8,64}$*/, secret /*min 32*/ }` → `{ server: ServerSummary }`. The URL must be `https://` (plain `http://` only for localhost, or when `ALLOW_INSECURE_SERVER_URLS` is on); path, query and hash are dropped. The control plane verifies before saving: it calls the agent's `GET /deployment-manager`, compares `serverId`, then `GET /api/auth/check` with the secret. The secret is stored AES-256-GCM encrypted.
  - 400 invalid URL; 400 `Server ID mismatch: the server reports "<X>" — check SERVER_ID in its .env`; 400 `The server rejected the secret — check SERVER_SECRET in its .env and reload it`
  - 502 `Could not reach the server at <url>`; 502 `That URL is not a Deployment Maintainer server`
  - 409 if the `serverId` or the URL is already registered
- `GET /servers/:id` → `{ server: ServerSummary }` (404 for an unknown or malformed id)
- `PATCH /servers/:id` body `{ name?, url? }` (at least one) → `{ server }`. A changed URL is re-verified with the stored secret and `serverId` first (same errors as above).
- `POST /servers/:id/secret` body `{ secret }` → `{ server }`. Verifies the new secret against the agent, then replaces the stored one (the rotation flow: set it in the agent's `.env` and reload it first).
- `DELETE /servers/:id` → `{ ok: true }`. Only removes the registration; the agent is not contacted.

### Proxy rule

`ANY /servers/:id/api/*` forwards to the agent: the request `/api/servers/:id/api/<rest>?<query>` becomes `<server.url>/api/<rest>?<query>`. Requires the session. `:id` is the control plane record id. So every [Agent API](#agent-api) endpoint below is reached by the browser as `/api/servers/:id/api/<path>`.

Request: same method; the body streams through untouched. Only `Content-Type`, `Content-Length`, `Accept` and `Last-Event-ID` are forwarded, plus `Authorization: Bearer <stored secret>`. The browser's cookie and `Authorization` header are never forwarded.

Response: the upstream status and body stream back, with `Content-Type`, `Content-Disposition`, `Cache-Control` and `X-Accel-Buffering` copied. SSE and file downloads stream unbuffered.

Failures:

| Case | Result |
|---|---|
| No session | 401 `Not authenticated` |
| Unknown or malformed `:id` | 404 `Server not found` |
| Upstream answers **401** (stored secret rejected) | **502** `The server rejected the stored secret — rotate it in Servers`, and the server is marked `unauthorized`. The upstream 401 never reaches the browser. |
| Agent unreachable / connection error | 502 `Server unreachable` (the connection is dropped if the response had already started) |
| No response within 60s (not applied to `text/event-stream`) | 504 `The server took too long to respond` |
| Any other upstream status (403, 404, 409, 429, 5xx, …) | passed through unchanged |

If the browser disconnects, the upstream request is cancelled, so the agent's SSE listeners are cleaned up.

## Agent API

One per managed server. Served by `server/` on `:3000` behind Nginx on that server's own domain. Normally reached through the proxy above; you can also call it directly with the bearer secret.

**Auth:** `Authorization: Bearer <SERVER_SECRET>` on everything under `/api` except `/api/health`. Missing or wrong → `401 { error: 'Invalid server secret' }`. Failed attempts are limited per IP (20 / 15 min, then 429); a valid secret is never limited. Every agent response other than `/deployment-manager` should be treated as private.

### Handshake and auth check

- `GET /deployment-manager` (**no auth**, at the server root, not under `/api`; rate-limited 60/min per IP) → `{ service: 'deployment-maintainer', serverId, version }`. This is how the control plane recognizes an agent before it has a working secret.
- `GET /api/auth/check` (bearer) → `{ ok: true, serverId, hostname }`. Used to verify a secret.
- `GET /api/health` (no auth) → `{ ok: true }`
- Any other unknown path → `404 { error: 'Not found' }`. `GET /` is a 404 too: agents serve no UI.

### Shapes

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

### Endpoints

Paths below are relative to `/api` on the agent.

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
- `GET /settings/info` → `{ github: { login, scopes, rateLimitRemaining } | { error }, appsDir, nginxEnabled, domainHint: null, serverId, hostname }`
- `POST /config/export` body `{ appIds?: string[], passphrase }` → JSON file download (`application/json`, attachment)
- `POST /config/import/preview` body `{ file: object, passphrase }` → `{ rows: [{ name, repoFullName, branch, port, conflict: null|'name'|'port', suggestedName }] }`
- `POST /config/import` body `{ file, passphrase, rows: [{ name /*original*/, action: 'skip'|'create', newName? }], deploy?: boolean }` → `{ created: AppSummary[], deployments: DeploymentSummary[] }`

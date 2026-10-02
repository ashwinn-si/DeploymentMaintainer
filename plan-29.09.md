# plan-29.09: Multi-server control plane for Deployment Maintainer

> Save this file as `plan-29.09.md` in the repo root. It's written for an executor with **no prior context** (e.g. Antigravity). Read it fully before changing anything.

---

## 0. Context

### 0.1 What the project is today
`deployment_maintainer` is a self-hosted "mini-Vercel" for an Ubuntu EC2. It's an npm-workspaces monorepo on branch `master`:

- **`server/`**: Node 20+ ESM, Express 5, Mongoose 9, zod 4. It runs on the EC2 at `:3000` behind Nginx and does everything:
  - admin login (JWT httpOnly cookie `dm_session`, `User` model with `tokenVersion`, `npm run seed`)
  - GitHub repo listing
  - the deploy pipeline (git → fnm → install/build → PM2 → health check → Nginx path routing, with live SSE logs, rollback, auto-rollback and cancel)
  - server health, ports, config export/import
  - serving the built UI (`web/dist`) with an SPA fallback
- **`web/`**: React 19 + Vite + Tailwind v4, plain JSX, glassmorphism design system in `style.md`. It calls `/api/*` on the same origin.
- **`deploy/`**: Nginx site, sudoers rule, PM2 ecosystem. **`DEPLOYMENT.md`**: the full AWS guide. **`docs/api-contract.md`**: the API reference.

Result: **one UI = one server.**

### 0.2 What we want
One dashboard managing **many servers** (`https://api.ashwinsi.in`, `https://api2.ashwinsi.in`, …). Registration flow (owner's design):

1. In the dashboard, **Add Server** → enter a name and a URL.
2. The UI generates a unique **SERVER_ID** and a **SERVER_SECRET** and shows them as a `.env` snippet.
3. The owner pastes the snippet into that server's `server/.env` and reloads it.
4. The dashboard calls `GET <url>/deployment-manager`. The server replies "I am a Deployment Maintainer, id = X". If X matches and the secret is accepted, the server is registered.

### 0.3 Decisions already made (don't revisit)
- **A new control plane (`control/`) proxies everything.**
  - It owns the admin login and stores the server list (URL, id, **encrypted** secret) in **its own MongoDB database**.
  - It forwards `/api/servers/:serverId/api/*` to the right server, adding `Authorization: Bearer <SERVER_SECRET>`.
  - The browser never receives stored secrets. Servers need **no CORS**.
- The **control plane runs on the same EC2 as server 1**: its own PM2 process (`deployment-control`), port `3100`, database `deployment_control`, and domain (e.g. `deploy.ashwinsi.in`). Server 1's agent stays on `:3000` at `api.ashwinsi.in`.
- `server/` becomes an **API-only agent**: no users, no UI serving, bearer-secret auth.
- The deploy pipeline and per-app behaviour are **unchanged**. Each server keeps its own apps and deployments in its own MongoDB.
- **Out of scope:** the known issue that a changed PM2 start command isn't applied on redeploy. Don't touch `server/src/services/deployer.js`, `server/src/services/pm2.js` or the `server/src/steps/*` logic.

### 0.4 Target architecture
```
Browser ──cookie login──▶ control/  (deploy.ashwinsi.in → :3100, Mongo DB "deployment_control")
                           • serves web/dist (SPA)
                           • admin User, seed, change password (moved from server/)
                           • Server records: name, url, serverId, secretEncrypted, lastSeenAt, version, hostname
                           • /api/servers/:serverId/api/*  ──Bearer SERVER_SECRET──▶  server/ agent on each box (:3000)
                                                                                      (api.ashwinsi.in, api2.ashwinsi.in, …)
```

---

## 1. Conventions (must follow)
- ESM everywhere (`"type": "module"`), async/await, small modules.
- **Minimal comments**: one short line, only for a non-obvious *why*. No JSDoc blocks restating code.
- Validate at boundaries with **zod**. Throw `HttpError(status, message)` (see `server/src/lib/httpError.js`). The API error shape is always `{ error: string, issues?: [] }`.
- API responses use `id`, never `_id`.
- **Only the control plane's own session check may return 401.** The UI treats any 401 as "logged out". Upstream/agent auth failures must reach the browser as **502**.
- Never log or return secrets (SERVER_SECRET, JWT, passwords, GitHub token).
- In `server/`, every process spawn goes through `server/src/services/shell.js` `run()` (`shell:false`).
- UI follows `style.md` (glass tiers, tokens, radii, `dark:` pairs for any `white/…`/`black/…` literal, 44px touch targets, hover = translateY(-2px), no horizontal scroll at 375px). There's a checklist in §22 of `style.md`.
- Tests use the built-in `node --test` + `supertest`. They need MongoDB on `127.0.0.1:27017`, and each test process uses its own DB name suffixed with `process.pid` (see `server/test/helpers/db.js`).
- Commits: one per stage, conventional style (`feat(control): …`), ending with a `Co-Authored-By:` line if your tooling adds one. Don't push.
- **No browser/preview verification.** Verify with tests, builds and curl.

---

## 2. Stage A: turn `server/` into an API-only agent

### A1. Config (`server/src/config.js`, `server/.env.example`)
- Add `SERVER_ID`: required, regex `^[A-Za-z0-9_-]{8,64}$`.
- Add `SERVER_SECRET`: required, min length 32.
- Remove `JWT_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the schema, `DEFAULT_REQUIRED` and `.env.example`.
- In `.env.example`, document that both values come from the dashboard's **Add Server** dialog.

### A2. Bearer auth (`server/src/middleware/auth.js`)
Replace the JWT-cookie middleware entirely:
```js
export function requireAuth(config) → (req, res, next)
```
- Read `Authorization: Bearer <token>`.
- Compare `sha256(token)` with `sha256(config.SERVER_SECRET)` via `crypto.timingSafeEqual`. Both digests are 32 bytes, so lengths always match.
- Missing or wrong → `401 { error: 'Invalid server secret' }`.
- Add a per-IP limiter on **failed** attempts only (express-rate-limit, 20 per 15 min, `skipSuccessfulRequests: true`). Copy the limiter style from the current `server/src/routes/auth.js` before deleting that file.
- Every router already does `router.use(requireAuth(config))`, so keep that signature and don't edit the routers.

### A3. Handshake endpoints
- New file `server/src/routes/handshake.js`.
- `GET /deployment-manager` (**no auth**, mounted at the app root, not under `/api`) → `{ service: 'deployment-maintainer', serverId: config.SERVER_ID, version: <server/package.json version> }`. Rate-limit it (60/min per IP).
- `GET /api/auth/check` (**auth required**) → `{ ok: true, serverId, hostname: os.hostname() }`.
- Mount both in `server/src/index.js`.

### A4. Remove per-server users
- Delete `server/src/routes/auth.js`, `server/src/models/User.js` and `server/scripts/seed.js`.
- Remove the `seed` script from `server/package.json`.
- In `server/src/routes/settings.js`, delete the `POST /password` route and its imports. `GET /info` also returns `serverId` and `hostname`.
- Remove the `cookie-parser` usage in `index.js`. Uninstall `cookie-parser`, `jsonwebtoken` and `bcryptjs` from `server/` if nothing else imports them (grep first).
- Remove any `User` import from `server/test/helpers/db.js` model-init lists.

### A5. API-only
- In `server/src/index.js`, remove the block that serves `web/dist` plus the SPA fallback. Unknown non-API paths → `404 { error: 'Not found' }`.
- `server/src/lib/validate.js`: `RESERVED_APP_NAMES` = `new Set(['api', 'deployment-manager'])`.

### A6. Tests (`server/test/`)
- `helpers/testServer.js`:
  - Config gets `SERVER_ID: 'test-server-01'` and `SERVER_SECRET: 'x'.repeat(40)`.
  - Replace the logged-in `request.agent` with a helper that sets `Authorization: Bearer <secret>` on every request. Keep the returned API shape so existing tests need minimal edits; e.g. return an object whose `get/post/patch/delete(path)` methods pre-set the header.
- Delete or replace the old auth/password/seed tests.
- Add:
  - bearer ok → 200
  - missing → 401
  - wrong → 401
  - repeated wrong → 429
  - `GET /deployment-manager` with no auth → correct shape
  - `GET /api/auth/check` → `serverId` + `hostname`
  - `GET /api/settings/info` contains `serverId`
  - `GET /` → 404 JSON
- Update the config tests for the new required vars.
- **Acceptance:** `npm test --workspace=server` passes; `grep -rn "dm_session\|jsonwebtoken\|ADMIN_EMAIL" server/` returns nothing.

---

## 3. Stage B: new `control/` workspace (control plane)
Stage B can be built in parallel with Stage A, since it's a separate folder.

### B1. Scaffold
- `control/package.json`: `"type":"module"`, engines node ≥20.
- Scripts:
  - `dev`: `node --watch src/index.js`
  - `start`: `node src/index.js`
  - `seed`: `node scripts/seed.js`
  - `clear-db`: `node scripts/clear-db.js`
  - `test`: `node --test test/`
- Deps: express@5, mongoose@9, zod@4, helmet, cookie-parser, jsonwebtoken, bcryptjs, express-rate-limit, dotenv. Dev: supertest.
- Root `package.json`: add `"control"` to `workspaces`.

### B2. Config (`control/src/config.js`, `control/.env.example`)
- Same zod `loadConfig({ require })` pattern as `server/src/config.js` (copy and trim).
- Vars:
  - `PORT` (default 3100)
  - `MONGO_URI` (default example `mongodb://127.0.0.1:27017/deployment_control`)
  - `JWT_SECRET` (min 32)
  - `ENCRYPTION_KEY` (64 hex)
  - `ADMIN_EMAIL`, `ADMIN_PASSWORD` (min 12)
  - `NODE_ENV`
  - `ALLOW_INSECURE_SERVER_URLS` (bool, default false; allows `http://` for non-localhost hosts in dev)
- dotenv with `quiet: true`.

### B3. Move auth into control (copy from `server/` **before** Stage A deletes it, or from git history `git show HEAD:server/src/...`)
- `control/src/models/User.js`, `control/src/middleware/auth.js` (JWT cookie `dm_session`, `tokenVersion`, `issueSessionCookie`, `clearSessionCookie`, `requireAuth`), `control/src/routes/auth.js` (login/logout/me + rate limit), `control/scripts/seed.js` and `control/scripts/clear-db.js`. Keep behaviour identical to the current server versions.
- `control/src/routes/account.js`: `POST /api/settings/password` `{ currentPassword, newPassword }`, copied from the current `server/src/routes/settings.js` password route. A wrong current password → **400**, never 401. Bump `tokenVersion` and re-issue the cookie; rate limit 10/15min.
- `control/src/lib/httpError.js`: copy of the server's.
- `control/src/lib/crypto.js`: `encryptJSON` / `decryptJSON` (AES-256-GCM with `ENCRYPTION_KEY`), copied from `server/src/services/crypto.js`. Only these two functions are needed.

### B4. Server model (`control/src/models/Server.js`)
```
name: String (required, 1–60 chars, trimmed)
url: String (required, normalized origin, unique)
serverId: String (required, unique)
secretEncrypted: Mixed (required)
version: String|null, hostname: String|null
lastSeenAt: Date|null, lastStatus: 'online'|'offline'|'unauthorized'|null
timestamps
```

### B5. Agent client (`control/src/services/agentClient.js`)
- `normalizeServerUrl(input, config)`:
  - parse with `new URL`
  - protocol must be `https:`, or `http:` when the host is `localhost`/`127.0.0.1`/`[::1]` or `ALLOW_INSECURE_SERVER_URLS`
  - strip path, query, hash and trailing slash; return the `origin`
  - invalid → `HttpError(400, 'Invalid server URL')`
- `handshake(url)`: `GET <url>/deployment-manager`, 5s timeout. It must return JSON with `service === 'deployment-maintainer'`; otherwise throw the matching error:
  - network/timeout → `HttpError(502, 'Could not reach the server at <url>')`
  - non-JSON or wrong service → `HttpError(502, 'That URL is not a Deployment Maintainer server')`
- `checkAuth(url, secret)`: `GET <url>/api/auth/check` with bearer, 5s timeout. A 401 → `HttpError(400, 'The server rejected the secret — check SERVER_SECRET in its .env and reload it')`. Returns `{ serverId, hostname }`.
- `verifyServer({ url, serverId, secret })`: run the handshake; if its `serverId` doesn't match → `HttpError(400, 'Server ID mismatch: the server reports "<X>" — check SERVER_ID in its .env')`. Then `checkAuth`. Return `{ version, hostname }`.

### B6. Servers API (`control/src/routes/servers.js`, all behind `requireAuth`)
- `GET /api/servers` → `{ servers: [ServerSummary] }`.
  - `ServerSummary = { id, name, url, serverId, version, hostname, status: 'online'|'offline'|'unauthorized', lastSeenAt, createdAt }`.
  - Status comes from a cached handshake plus auth check per server (15s in-memory cache, checks in parallel, 5s timeout each). Update `lastSeenAt`/`lastStatus`.
  - Never include the secret.
- `POST /api/servers` `{ name, url, serverId, secret }`:
  - zod: `serverId` regex `^[A-Za-z0-9_-]{8,64}$`, `secret` min 32.
  - Normalize the URL. A duplicate `serverId` or `url` → 409.
  - `verifyServer`, then save with `secretEncrypted = encryptJSON(config, { secret })`. Return `{ server }`.
- `GET /api/servers/:id` → `{ server }`.
- `PATCH /api/servers/:id` `{ name?, url? }`: if the URL changed, re-verify with the stored secret before saving.
- `POST /api/servers/:id/secret` `{ secret }`: `verifyServer` with the stored `serverId` and the new secret, then replace it. This is the rotation flow.
- `DELETE /api/servers/:id` → `{ ok: true }`. It only removes the registration; nothing is sent to the agent.
- `:id` is the Mongo id of the Server record. Validate with `mongoose.isValidObjectId`; invalid → 404.

### B7. Proxy (`control/src/routes/proxy.js`)
- Route: `app.all('/api/servers/:id/api/*rest', requireAuth, proxyHandler)` (Express 5 wildcard syntax). **Mount it before `express.json()`** so the raw body stream is intact.
- Look up the Server and decrypt the secret. Build the upstream URL `<server.url>/api/<rest>` plus the original query string.
- Use `node:http` / `node:https` `request` (no proxy library):
  - Method: same as the incoming request.
  - Headers: forward only `content-type`, `content-length`, `accept` and `last-event-id`, plus `Authorization: Bearer <secret>`.
  - **Never forward** `cookie`, `authorization` or hop-by-hop headers (`connection`, `keep-alive`, `transfer-encoding`, `upgrade`, `te`, `trailer`, `proxy-*`).
  - `req.pipe(upstreamReq)`.
- Response:
  - If upstream status is **401** → consume and discard its body, then respond `502 { error: 'The server rejected the stored secret — rotate it in Servers' }` and mark the server `unauthorized` in the status cache.
  - Otherwise copy the status and these headers: `content-type`, `content-disposition`, `cache-control`, `x-accel-buffering`. Call `res.flushHeaders()` and `upstreamRes.pipe(res)`. This is what makes SSE and file downloads stream.
- Timeouts:
  - If the upstream `content-type` is `text/event-stream`, no timeout.
  - Otherwise 60s → `504 { error: 'The server took too long to respond' }` (only if headers haven't been sent yet).
- Errors:
  - Upstream connection error → `502 { error: 'Server unreachable' }` (if headers aren't sent), or `res.destroy()` if they are.
  - `req.on('close')` → `upstreamReq.destroy()`, so the agent's SSE listeners are cleaned up.

### B8. App wiring (`control/src/index.js`)
- `createApp(config)`: `trust proxy 1`, helmet, cookie-parser, then **the proxy route**, then `express.json({ limit: '2mb' })`, then the auth, account and servers routers.
- `GET /api/health` → `{ ok: true }`.
- JSON 404 for other `/api/*` paths.
- Serve `web/dist` + SPA fallback if it exists (move the exact block removed from `server/src/index.js`).
- Error handler: the same shape as `server/src/index.js` (ZodError → 400 with issues; HttpError → its status; else 500).
- `main()`: loadConfig, connect the DB, listen; graceful SIGINT/SIGTERM (close server, disconnect Mongo).

### B9. Tests (`control/test/`)
- **Fake agent helper:** starts a `node:http` server on a random port. It implements `/deployment-manager`, `/api/auth/check` (bearer check), `/api/echo` (returns method, headers, body and query as JSON), `/api/stream` (SSE writing 3 events 100ms apart) and `/api/file` (with `Content-Disposition`). Its id and secret are configurable.
- Cover:
  - auth (moved tests: login ok/bad, `/me`, logout, reseed invalidates the cookie)
  - change password (wrong current → 400; success invalidates the old cookie)
  - add server: success; wrong id → 400 mismatch message; wrong secret → 400; unreachable port → 502; not-a-DM URL → 502; duplicate → 409; http non-localhost URL rejected
  - `GET /api/servers` shows `online`, and never contains `secret`/`secretEncrypted`
  - rotate secret
  - delete
  - proxy:
    - bearer added upstream, browser cookie **not** forwarded, POST body and query forwarded
    - upstream 401 → 502 with the rotate message
    - SSE events arrive incrementally (assert the first event arrives before the upstream finishes)
    - `Content-Disposition` passes through
    - unknown server id → 404
    - unauthenticated → 401
- **Acceptance:** `npm test --workspace=control` passes.

---

## 4. Stage C: client (`web/`) becomes multi-server
Do this after Stage B.

### C1. API layer (`web/src/api.js`)
- Keep `request()`, `ApiError`, `onSessionExpired`, `toQuery` and `auth`. A global 401 → session-expired → login is still correct, because only the control plane returns 401 now.
- Add:
  - `serversApi` = `list`, `get`, `create`, `update`, `rotateSecret`, `remove` → `/servers…`
  - `accountApi.changePassword` → `POST /settings/password`
- Convert the per-server helper groups (`reposApi`, `appsApi`, `deploymentsApi`, `portsApi`, `nodeApi`, `systemApi`, `settingsApi`, `configApi`) into a factory:
  ```js
  export function serverApi(serverId) { const base = `/servers/${serverId}/api`; return { repos:{…}, apps:{…}, deployments:{…, streamUrl, downloadUrl}, ports, node, system, settings:{ info }, config:{…} } }
  ```
  Paths inside stay exactly as they are today; only the prefix changes. `streamUrl`/`downloadUrl` return `/api/servers/:serverId/api/deployments/...`.
- `settingsApi.changePassword` moves to `accountApi`.

### C2. Server context + routing (`web/src/App.jsx`, new `web/src/context/ServerContext.jsx`)
- Routes:
  - `/login`
  - `/` → new **Servers** page
  - `/settings` → new **Account** page
  - `/s/:serverId` layout: loads the server via `serversApi.get`, provides `{ server, api: serverApi(server.id) }` through `ServerContext`, and renders an `<Outlet/>`
  - under it, existing pages with relative paths: `index` → Apps, `new` → NewApp, `apps/:id` → AppDetail, `deployments` → Deployments, `deployments/:id` → DeploymentDetail, `ports`, `server` → Server, `settings` → ServerSettings (renamed from the current Settings page minus the password card)
  - `*` → NotFound
- Add a `useServer()` hook. Every page and component that currently imports the global API groups switches to `const { api } = useServer()`. Every internal link/navigate becomes server-relative (`/s/${server.id}/apps/...`); add a small `serverPath(path)` helper to the context.
- Files that need this change include `pages/Apps.jsx`, `NewApp.jsx`, `AppDetail.jsx`, `Deployments.jsx`, `DeploymentDetail.jsx`, `Ports.jsx`, `Server.jsx`, `Settings.jsx`, and `components/ActivityPanel.jsx`, `RepoPicker.jsx`, `BranchPicker.jsx`, `NodeVersionPicker.jsx`, `DeployDialog.jsx`, `DuplicateDialog.jsx`, `DeploymentRow.jsx`, `ServerHealthCard.jsx`, `DiskBanner.jsx`, `LogViewer.jsx` (download). Grep for `Api.` and `'/apps`, `'/deployments` etc. to find them all.
- `Settings.jsx`'s export uses a raw `fetch('/api/config/export')`. Rebase it to `/api/servers/:id/api/config/export`.

### C3. Hooks keyed per server
- `web/src/hooks/useActiveDeployments.js`: takes a `serverId` and polls `api.deployments.active()`; its state resets when `serverId` changes.
- `web/src/hooks/useSystemStats.js`: the module-level singleton becomes a `Map<serverId, {cache, subscribers, timer}>`; `useSystemStats(serverId)`.
- `web/src/hooks/useDeploymentStream.js`: take `(serverId, deploymentId)` and use `api.deployments.streamUrl`. Keep the existing reconnect-by-index, de-dupe and `requestAnimationFrame` batching. EventSource works unchanged (same-origin cookie).
- The Sidebar "deploying" dot and deploy-finished toasts are driven by the current server's active deployments (only when inside `/s/:serverId`).

### C4. Servers page (`web/src/pages/Servers.jsx`)
- PageHeader "Servers" with an **Add Server** primary button.
- A grid of `glass-card glass-interactive` cards per server: name, URL, `StatusPill` (online = teal, offline = rose, unauthorized = amber "secret rejected"), version, hostname, last seen (relative).
- When online, a lazy summary fetched through the proxy: app count (`api.apps.list`), active deploys (`api.deployments.active`) and small CPU/RAM/disk bars (`api.system.get`). Tolerate failures silently.
- Click → `/s/:id`. Kebab menu: Rename, Edit URL, Rotate secret, Remove (ConfirmDialog, type the name).
- Empty state: explain the flow, plus an Add Server CTA.
- Poll `serversApi.list` every 15s while the tab is visible.

### C5. Add Server wizard (`web/src/components/AddServerDialog.jsx`, Modal)
1. **Details:** name + URL (`Input`s; client-side URL check that it starts with `https://` or `http://localhost`).
2. **Configure the server:** generate `serverId = crypto.randomUUID()` and `secret` = 32 random bytes (`crypto.getRandomValues`) base64url-encoded. Show a copyable block:
   ```
   SERVER_ID=<id>
   SERVER_SECRET=<secret>
   ```
   Tell the user: "Add these to `server/.env` on that server, then run `pm2 reload deployment-maintainer`." Add a Copy button, and **regenerate** only if the user explicitly clicks "Generate new".
3. **Verify & add:** `serversApi.create({ name, url, serverId, secret })`. Show the server's error message inline (mismatch, wrong secret, unreachable) with a Retry button. On success: toast, close, refresh the list, navigate to `/s/:id`.
- The same component in "rotate" mode skips step 1, keeps the stored serverId (shown read-only), generates a new secret and calls `serversApi.rotateSecret`.
- Secrets exist only in component state and are cleared on close.

### C6. Layout
- `web/src/components/layout/Sidebar.jsx`:
  - At the top, a **server switcher** (`SelectSheet`) listing servers with status dots, plus a "All servers" entry → `/`.
  - Inside `/s/:serverId`, show the per-server nav (Apps, New App, Deployments, Ports, Server, Settings) with server-relative links.
  - Always show a global "Servers" link and an "Account" link (`/settings`) in the footer area next to the ThemeToggle/user card.
- `Navbar.jsx` (mobile drawer): same structure.
- `DiskBanner` only renders inside a server context.

### C7. Account page (`web/src/pages/Account.jsx`)
The change-password card, moved from the current `Settings.jsx`, using `accountApi.changePassword`.

### C8. Dev mock (`web/src/dev/mockApi.js`)
- Add `/api/servers` CRUD with two fake servers (one online, one offline).
- Route all existing mock handlers under `/api/servers/:serverId/api/*`, with separate fake data per server.
- It must remain dev-only (`import.meta.env.DEV && localStorage.mockApi === '1'`) and tree-shaken from production.

### C9. Vite
`web/vite.config.js` proxies `/api` to `http://localhost:3100` (the control plane) instead of 3000.

**Acceptance:** `npm run build --workspace=web` is clean (no warnings); `grep -r "mockApi\|installMockFetch" web/dist` returns nothing; there are no remaining imports of the removed global API groups.

---

## 5. Stage D: ops and docs

### D1. `deploy/`
- Rename `nginx-site.conf` → `nginx-server.conf` (agent site, `server_name YOUR_SERVER_DOMAIN`):
  - `location /api/` → `http://127.0.0.1:3000`
  - SSE-safe `location /api/deployments/` (keep the existing directives: `proxy_buffering off`, `proxy_cache off`, `proxy_read_timeout 1h`, `proxy_http_version 1.1`, `Connection ''`)
  - `location = /deployment-manager` → `:3000`
  - `location = / { return 404; }`
  - keep `include /etc/nginx/deployer-apps/*.conf;` inside the server block, and `client_max_body_size 2m`
- New `nginx-control.conf` (`server_name YOUR_CONTROL_DOMAIN`):
  - `location /` → `http://127.0.0.1:3100`
  - SSE-safe `location /api/servers/` (same SSE directives, `proxy_read_timeout 1h`)
  - `client_max_body_size 2m`
- `ecosystem.dashboard.cjs` → rename to `ecosystem.server.cjs` (PM2 name stays `deployment-maintainer`, cwd `server/`).
- New `ecosystem.control.cjs` (name `deployment-control`, cwd `control/`, script `src/index.js`, `NODE_ENV=production`, fork mode, a single instance).
- Update `deploy/README.md` (file index) accordingly.

### D2. `DEPLOYMENT.md`
Update the existing guide; keep its structure and tone.

- **Part 1 (AWS):** unchanged, plus a note to add **two DNS A records** on server 1: `api` (agent) and `deploy` (control plane), both → the same Elastic IP.
- **Part 3 (Server setup):** this becomes the **agent** install, done on every server:
  - `server/.env` now has `SERVER_ID`/`SERVER_SECRET`, taken from the dashboard's Add Server dialog. For the very first server, the control plane doesn't exist yet, so generate temporary values with `node -e "console.log(require('crypto').randomUUID())"` and `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`, and enter the same values in Add Server later. Add Server accepts a user-supplied id+secret.
  - **Add this to Stage C5:** in step 2, an "I already have an ID and secret" toggle lets the user paste existing values instead of generating new ones.
  - Remove the seed step. Install `nginx-server.conf` and `ecosystem.server.cjs`.
- **New Part: Control plane (on server 1):**
  - `cp control/.env.example control/.env`, then fill `JWT_SECRET`, `ENCRYPTION_KEY`, `ADMIN_*`, `MONGO_URI=mongodb://127.0.0.1:27017/deployment_control` and `NODE_ENV=production`.
  - `npm ci && npm run build && npm run seed`
  - Install `nginx-control.conf` with the control domain, run `sudo certbot --nginx -d YOUR_CONTROL_DOMAIN`, then `pm2 start deploy/ecosystem.control.cjs && pm2 save`.
  - Log in at `https://YOUR_CONTROL_DOMAIN` → Add Server with `https://YOUR_SERVER_DOMAIN`.
- **New Part: Add another server:** Parts 1 and 3 on a new EC2 with its own domain (skip the control plane) → in the dashboard, Add Server → paste the snippet into the new server's `.env` → `pm2 reload deployment-maintainer` → Verify.
- **Day-2:**
  - Updating: `git pull && npm ci && npm run build`, then `pm2 reload deployment-maintainer` on every server and `pm2 reload deployment-control` on server 1.
  - Rotating a server secret: use the dashboard's Rotate flow, update that server's `.env`, reload, then Verify.
  - Forgotten password: `npm run seed` in `control/`.
  - Backups now include the `deployment_control` DB.
- **Troubleshooting**, new rows:
  - "Server shows *unauthorized*" → the secret changed; rotate it.
  - "Server ID mismatch" → `.env` `SERVER_ID` differs from the one entered.
  - "Server offline" → the agent is down, DNS/TLS isn't set up, or `/deployment-manager` isn't proxied by Nginx.
  - "Live logs don't stream" → both Nginx sites need the SSE blocks.

### D3. Other files
- `README.md`: architecture section (control plane + agents, with the diagram from §0.4); features (multi-server); project layout adds `control/`; local dev (below); scripts table; Known limitations add "the control plane shares server 1's box — if server 1 is down, the dashboard is too" and keep the existing items.
- `docs/api-contract.md`:
  - Split into **Control plane API** (auth, account, servers, proxy rule) and **Agent API**. The agent API is the existing endpoints, now reached via `/api/servers/:serverId/api/...` from the browser, or directly with a bearer.
  - Document `/deployment-manager` and `/api/auth/check`.
  - Remove the agent-side auth endpoints.
- Root `package.json` scripts:
  - `dev` → server
  - `dev:control`
  - `dev:web`
  - `start` → server
  - `start:control`
  - `seed` → control
  - `clear-db` → server
  - `clear-db:control`
  - `build` → web
  - `test` → `npm run test --workspaces --if-present`
- **Local dev recipe** (for the README):
  1. Run MongoDB.
  2. `server/.env`: `SERVER_ID=local-server-1`, a 32+ char `SERVER_SECRET`, `NGINX_ENABLED=false`, `APPS_DIR`/`NGINX_APPS_DIR` under `./.data`.
  3. `control/.env`: its own `JWT_SECRET`/`ENCRYPTION_KEY`/`ADMIN_*` and DB `deployment_control`.
  4. `npm run seed`, then `npm run dev`, `npm run dev:control`, `npm run dev:web`.
  5. Open `http://localhost:5173`, log in, and Add Server `http://localhost:3000` using the "I already have an ID and secret" option with the values from `server/.env`.

---

## 6. End-to-end verification (run after all stages)
1. `npm install && npm test` at the root: all workspaces pass.
2. Start MongoDB, then **two agents** and the control plane:
   - Agent 1: `PORT=3000`, `SERVER_ID=local-server-1`, secret A, DB `dm_agent1`.
   - Agent 2: `PORT=3001`, `SERVER_ID=local-server-2`, secret B, DB `dm_agent2`, its own `APPS_DIR`.
     Env vars on the command line override `.env`, because dotenv doesn't override existing vars.
   - Control: `PORT=3100`, then `npm run seed`.
3. With curl + a cookie jar against `:3100`:
   - log in
   - `POST /api/servers` for agent 1 and agent 2 → 200
   - wrong id → 400 mismatch; wrong secret → 400; `http://localhost:3999` → 502 unreachable
   - `GET /api/servers` → both online, and no secret appears in the output
   - `GET /api/servers/<id1>/api/apps` and `…/<id2>/api/apps` → 200 with separate data
   - `GET /api/servers/<id1>/api/system` → 200
   - `curl -N …/api/servers/<id>/api/deployments/<depId>/stream` streams, if a deployment exists; otherwise the Stage B SSE test covers it
   - rotate agent 2's secret to C, but restart agent 2 still on B → proxy returns 502 "rotate it" and the list shows `unauthorized`; restart agent 2 with C → online
4. Direct agent checks: `curl :3000/api/apps` → 401; with `Authorization: Bearer A` → 200; `curl :3000/deployment-manager` → id JSON; `curl :3000/` → 404.
5. `npm run build` is clean, and no mock code ends up in `web/dist`. Start the control plane with `NODE_ENV=production` and check `GET /` returns the SPA HTML and `GET /s/x/apps` returns the SPA HTML (fallback).
6. Code-review the client flows: login → Servers home → Add Server (generate + "already have" modes) → open a server → deploy an app → the live log streams → switch server via the sidebar → rotate secret → remove server → Account change password.

## 7. Commit sequence
1. `feat(server): make the server an API-only agent with bearer secret and handshake`
2. `feat(control): add control plane with server registry and authenticated proxy`
3. `feat(web): manage multiple servers through the control plane`
4. `docs: document control plane setup and multi-server deployment`

# Deployment Maintainer — self-hosted mini-Vercel for one EC2

## Context
Deploying Node backends to EC2 today is manual: SSH in, `git clone`/`git pull`, hand-write `.env`, `npm install`, `pm2 start/restart`, edit Nginx. This app replaces that with a web dashboard running on the same EC2:
log in → pick a GitHub repo + branch → name it, set env, Node version and pipeline steps → Deploy. Every later deploy is one click with a branch picker. Bad deploy → one-click rollback. The admin sees live deploy logs, app health and server health (CPU/RAM/disk).
Single user (seeded), single EC2, single domain with **path-based routing** (`/server1` → port 4001). The same repo can be deployed many times as independent apps (e.g. `api-main` on `main`, `api-dev` on `dev`), each with its own branch, env, port, Node version and steps. v1 runtime is Node + PM2; the step system is the extension point.

Greenfield — `/Users/ashwinsi/projects/deployment_maintainer` contains only `style.md` (UI reference).

## Stack
- **server/**: Node.js 20+ + Express + Mongoose (MongoDB). Also serves the built frontend.
- **web/**: React + Vite + Tailwind v4 + react-router + framer-motion + lucide-react + react-hot-toast. Styled per `style.md`. Built to `web/dist`, served by Express (one process, one PM2 entry).
- GitHub: **one fine-grained PAT** (all repos, Contents + Metadata read) in server `.env` — lists repos/branches via REST and clones over HTTPS.
- Node versions per app: **fnm** on the EC2 (`fnm install`, `fnm exec --using=<v>`) — a real binary, so it works with `shell:false` (nvm is a shell function and doesn't).

## Layout
```
deployment_maintainer/
  package.json            root scripts: dev, build, start, seed, clear-db
  server/
    src/
      index.js  config.js  db.js
      middleware/auth.js      JWT httpOnly cookie guard (checks user.tokenVersion)
      models/  User.js  App.js  Deployment.js
      routes/  auth.js  settings.js  repos.js  apps.js  deployments.js  ports.js  system.js  config-io.js
      services/
        shell.js              run(cmd, argv, {cwd, env, onLine, signal}) — spawn detached, shell:false; kill process group on abort
        github.js             list repos / branches
        git.js                clone / fetch / checkout+reset to branch or sha; token via -c http.extraheader (never persisted)
        crypto.js             AES-256-GCM for env at rest; scrypt+passphrase variant for export files
        ports.js              allocate next free ≥ APP_PORT_START (DB + bind test) / validate override
        node.js               fnm list/install, resolve bin dir for a version
        pm2.js                ecosystem file, startOrReload / stop / delete / jlist / logs
        nginx.js              per-app location file, nginx -t, reload, rollback; remove
        deployer.js           queue/lock per app, runs enabled steps, cancel, rollback, auto-rollback
        deployLog.js          structured entries, redaction, batched persist, EventEmitter for SSE
        monitor.js            every 60s: pings each app's health path; samples CPU/RAM/disk into a 1h ring buffer
        system.js             os + fs.statfs + /proc stats, per-app folder sizes (du, cached 5 min)
      steps/                  one module per step type: { id, label, run(ctx) } — idempotent
        gitSync.js  nodeSetup.js  writeEnv.js  install.js  build.js  custom.js  pm2.js  healthCheck.js  nginx.js
        index.js              registry + default pipeline
    scripts/
      seed.js                 upsert admin from ADMIN_EMAIL / ADMIN_PASSWORD
      clear-db.js             drop the database (typed confirm, or --yes)
    .env.example
  web/src/
    index.css                 tokens + glass utilities from style.md
    components/ui/            GlassCard, Button, Input, Toggle, SelectSheet, Modal, PageHeader, StatusPill, Meter, Sparkline, Loader
    components/layout/        Sidebar, Navbar, ThemeToggle
    components/               EnvEditor, StepsEditor, LogViewer, StepTimeline, ActivityPanel, ServerHealthCard,
                              RepoPicker, BranchPicker, NodeVersionPicker, DeployDialog, DuplicateDialog
    hooks/                    useDeploymentStream.js (SSE + resume), useSystemStats.js
    pages/                    Login, Apps, NewApp, AppDetail, Deployments, DeploymentDetail, Ports, Server, Settings
    api.js
  deploy/
    nginx-site.conf  sudoers-deployer  README.md (one-time EC2 bootstrap)
```

## Scripts
- `npm run seed` — creates/updates the admin user from `.env` (bcrypt). Re-running resets the password to the `.env` value (the recovery path if you forget a UI-changed password).
- `npm run clear-db` — drops the Mongo DB after a typed confirmation (`--yes` skips). Warns that PM2 processes, app folders and nginx files are **not** touched, and suggests exporting config first. Run `npm run seed` after.

## Data models
- **User**: email, passwordHash, tokenVersion (bumped on password change → other sessions logged out).
- **App** (unique by `name`; repo is *not* unique → same repo, many apps):
  - name (slug `^[a-z0-9-]{1,40}$`; folder name + URL path), repoFullName, branch, port, nodeVersion (e.g. `20`, `22.11.0`)
  - envEncrypted
  - steps: ordered array `{ type, enabled, config }`
    - `gitSync` — always first, can't disable
    - `nodeSetup` — always on; `fnm install <v>` if missing
    - `writeEnv` — config: filename (default `.env`)
    - `install` — command (default `npm ci`, falls back to `npm install` with no lockfile)
    - `build` — command (default `npm run build`), off by default
    - `custom` — any number; label + command (e.g. `npx prisma migrate deploy`); tokenized to argv, shell:false
    - `pm2` — start command (default `npm start`)
    - `healthCheck` — path (default `/`), expected status 200–399, timeout 60s, interval 2s, autoRollback (default on)
    - `nginx` — path (default `/<name>`), stripPrefix (default true)
  - status, health `{ ok, statusCode, latencyMs, checkedAt }`, currentCommitSha, lastDeployedAt
- **Deployment**: appId, branch, commitSha, mode (`update|fresh|rollback`), rollbackOf?, autoRollbackOf?, status (`queued|running|success|failed|cancelled`), steps[{type, label, status, startedAt, endedAt}], entries (log, capped), createdAt, finishedAt.

Reserved names: `api`, `assets`, `login`, `ports`, `apps`, `new`, `deployments`, `server`, `settings`.

## Deploy pipeline (deployer.js)
Every deploy runs the app's **enabled steps in order**. Each step is idempotent, so there's no separate "first-time init" path. All commands run via `fnm exec --using=<nodeVersion> -- <cmd>`, so the right Node/npm is used.
- `gitSync`: folder missing → `git clone --branch <b>`; else `git fetch origin <b>` + `git checkout -B <b> origin/<b>` + `git reset --hard <origin/b | rollback sha>`. Records the sha.
- `nodeSetup`: install the version if absent; log `node -v` / `npm -v`.
- `writeEnv`: decrypted env + `PORT=<port>`, mode 600.
- `install` / `build` / `custom`: run in the app folder, stream output.
- `pm2`: writes `ecosystem.config.cjs` (name `app-<name>`, `interpreter: none`, PATH prefixed with the fnm node bin dir for the version, PORT) → `pm2 startOrReload` → `pm2 save`.
- `healthCheck`: polls `http://127.0.0.1:<port><path>` until the status is in range, or it times out. Also fails early if PM2 reports `errored` or the restart count climbs (crash loop). On failure with autoRollback on and a previous successful deploy existing → queues a **rollback** deployment to that sha (linked via `autoRollbackOf`, shown in the log).
- `nginx`: renders the location block; unchanged → skip; else write → `sudo nginx -t` → reload, rollback file on failure. Step **disabled** with an existing file → remove + reload.

**Deploy dialog**: branch picker (defaults to current; a different branch updates `App.branch`), mode **Update** (fetch + reset in place) or **Fresh** (delete folder, re-clone, run all), summary of steps that will run.

**Rollback**: every successful deployment in history has a "Rollback to this" button → new deployment with `mode: rollback`, same branch, `git reset --hard <sha>`, and all enabled steps. It uses the app's **current** env and steps, and the dialog says so.

**Cancel**: a running deploy has a Stop button → aborts the current step's process group (SIGTERM, SIGKILL after 5s), marks remaining steps skipped, status `cancelled`. If cancelled before the `pm2` step, the old version keeps serving. The log states whether pm2 was reached.

**Concurrency**: one deployment per app at a time (lock + DB). A second click is rejected with a toast. Different apps deploy in parallel. On server restart, any `running` deployment is marked `failed` ("dashboard restarted during deploy").

**Other app actions**: Restart / Stop (pm2); Delete (pm2 delete, nginx file removed + reload, folder removed, docs deleted; confirm by typing the name).

**Duplicate app**: button on App detail → dialog with new name (suggested `<name>-copy`), branch, port (auto), Node version, "copy env" toggle (default on) → creates a new app with the same repo, steps and health check, then optionally deploys it right away.

## Deployment logs (visible to the admin everywhere)
**Entries** `{ t, step, stream: 'cmd'|'stdout'|'stderr'|'info'|'error', text }`:
- Header: app, repo@branch, mode, Node version, previous → new sha (rollback: "rolling back to <sha> from deployment #N").
- Per step: `▶ Step 3/9 · install`, the exact command (`$ npm ci`), all output, then `✔ install · 12.4s` or `✖ install · exit code 1`. Skipped: `– build · disabled`. Health check logs each attempt (`GET /health → 502 (attempt 4)`).
- Summary: result, total duration, failing step + last 20 stderr lines.
- **Redaction**: the PAT and every env value are masked (`••••`) before storing or sending.

**Storage**: batched every ~500ms, capped at ~1 MB per deployment, last 50 deployments per app.
**Live**: `GET /api/deployments/:id/stream` (SSE) replays stored entries, pushes new lines and step changes, and sends `done` at the end. The client resumes with `?after=<index>`.

**Where the admin sees them**:
- **Home (Apps)**: Activity panel with live deploys (current step + last ~8 lines) and the last 10 finished across all apps.
- **Deployments page**: all deployments, filter by app / status / branch / mode.
- **Deployment detail**: StepTimeline (status + duration) beside the full LogViewer. Click a step to filter. stderr rose, commands brand tint. Auto-scroll with a pause toggle. Copy, download .log, Stop (if running), Rollback to this (if success). Sha links to GitHub.
- **App detail → Deployments tab**; after clicking Deploy you land on the live detail; toasts link to the log.
- **Runtime logs** (the app's own output) are separate: App detail tab showing `pm2 logs app-<name> --lines 200 --nostream`, with refresh.

## Server & app health
- **Server page** (`/server`) plus a compact **ServerHealthCard** on home:
  - CPU % (from `os.cpus()` deltas) + load average, RAM used/total (+ swap), disk used/free on `/` (and `APPS_DIR` mount if different) via `fs.statfs`, uptime, Node/PM2/Nginx versions.
  - Meters colored by threshold (teal < 70%, amber 70–90%, rose > 90%) + 1-hour sparklines (sampled every 30s in memory).
  - Per-app table: PM2 status, CPU, memory, restarts, uptime, **folder size on disk** (incl. node_modules), health.
  - Disk-full warning banner at > 90% (on every page).
- **App health**: `monitor.js` pings each running app's healthCheck path every 60s → App.health. Shown as a healthy/unhealthy pill with latency on app cards, App detail and the Ports page.
- **Log growth**: bootstrap installs `pm2-logrotate` (10 MB, keep 7); deployment logs are capped as above.

## Ports page
| Port | App | Repo @ branch | Path | Node | PM2 | Health | Nginx | Last deploy |
- Row 0 is the dashboard itself. Conflict flag if another app or an unmanaged process holds the port (bind test). Nginx-disabled apps are marked "localhost only". Rows link to App detail. The port can be edited on App detail and applies on next deploy.

## Settings page
- **Change password**: current + new (min 12 chars) + confirm → bcrypt, bump tokenVersion, re-issue your own cookie.
- **Export config**: choose apps (default all) + a passphrase → downloads `deployer-config-<date>.json` with name, repo, branch, port, nodeVersion, steps, healthCheck. Env is encrypted with the passphrase (scrypt → AES-GCM), so it can be imported on a new EC2 with a different ENCRYPTION_KEY.
- **Import config**: upload file + passphrase → preview (new / name conflict / port conflict), per-row skip or rename → creates apps in `not deployed` state → optional "Deploy all imported".
- Read-only info: GitHub token owner + scopes check, domain, APPS_DIR.

## API (under /api, JWT-guarded except login)
- `POST /auth/login` (rate-limited), `POST /auth/logout`, `GET /auth/me`, `POST /settings/password`
- `GET /repos`, `GET /repos/:owner/:repo/branches`
- `GET /apps`, `POST /apps`, `GET /apps/:id`, `PATCH /apps/:id`, `DELETE /apps/:id`, `POST /apps/:id/duplicate`
- `POST /apps/:id/deploy` `{ branch?, mode }`, `POST /apps/:id/restart`, `/stop`, `GET /apps/:id/logs`
- `GET /apps/:id/deployments`, `GET /deployments?app=&status=&branch=&mode=`, `GET /deployments/:id`, `GET /deployments/:id/stream`, `GET /deployments/:id/download`, `POST /deployments/:id/cancel`, `POST /deployments/:id/rollback`
- `GET /ports`, `GET /system` (current + 1h history), `GET /node/versions`
- `POST /config/export`, `POST /config/import/preview`, `POST /config/import`

## Frontend pages
- **Login**.
- **Apps** (home): ServerHealthCard + Activity panel on top; card grid of apps (name, `/path`, repo@branch, Node version, status + health pills, port, last deploy, Deploy quick action).
- **New App**: RepoPicker → BranchPicker → name (suggested `repo-branch`) → port (auto) → NodeVersionPicker (default from repo `.nvmrc`/`engines.node`, else server default) → EnvEditor (rows + "paste .env") → StepsEditor (toggles, commands, custom steps, health-check settings) → Create & Deploy.
- **App detail**: header (status, health, Deploy / Restart / Stop / Duplicate / Delete); tabs Overview, Environment, Steps, Deployments, Runtime logs.
- **Deployments**, **Deployment detail**, **Ports**, **Server**, **Settings** as above.

## Frontend styling — follow `style.md` exactly
- **`web/src/index.css`**: `--page-bg`, `--glass-*`, `--text-*`, `--data-*` tokens with `[data-theme="dark"]` overrides and Tailwind v4 `@custom-variant dark` (§2–3, 7–8, 20); glass utilities + `.btn-base/.btn-ghost` (§4, §10) with `-webkit-backdrop-filter`; scrollbars (§19); mobile polish (§21).
- **Brand tint** (style.md leaves it open): sage-emerald `--brand: #2F7D52` light / `#5FBF86` dark, `--brand-soft` for orbs, focus rings, primary button, wordmark. Single token.
- **Fonts**: Poppins headings (`-0.02em`) + Open Sans body via `@fontsource`.
- **Components**: GlassCard (§5), Button (§10, 44px targets), PageHeader (§12), Modal as mobile bottom sheet / desktop dialog (§13) for Deploy / Duplicate / Rollback / Delete / Import preview, frosted-well inputs (§14), SelectSheet, Toggle. Meter uses the §17 Ring style for CPU/RAM/disk on the Server page (bar meters in compact cards). Sparklines use `--data-*` colors.
- **Layout**: `glass-strong` sidebar on lg+ (Apps, New App, Deployments, Ports, Server, Settings, theme toggle, user card + logout), mobile Navbar + drawer (§11). Pulsing brand dot on "Deployments" while a deploy runs.
- **Status mapping** (§15 pills): deploying = brand + pulse, online/success/healthy = teal, stopped/cancelled = amber, failed/errored/unhealthy = rose. LogViewer = darker frosted well, mono 12px, `custom-scrollbar`. Tables → stacked `glass-light` cards below `sm`. Toasts per §16.
- §22 checklist on every surface.

## Security essentials
- `shell:false` everywhere; strict validation on name/branch/sha/repo/path/port/node version; env keys `^[A-Z_][A-Z0-9_]*$`, no newlines in values.
- Custom step commands are arbitrary execution by design — only the authenticated admin sets them; they run as unprivileged `ubuntu` in the app folder.
- PAT, JWT_SECRET, ENCRYPTION_KEY only in server `.env`; app env encrypted in Mongo; export files passphrase-encrypted; token never written into repos; logs redacted.
- Sudoers allows only `nginx -t` and `systemctl reload nginx`; `NGINX_APPS_DIR` owned by `ubuntu`.
- httpOnly + secure + sameSite cookie, helmet, login rate limit, tokenVersion session invalidation.

## Server .env
`PORT=3000, MONGO_URI, JWT_SECRET, ENCRYPTION_KEY (32-byte hex), GITHUB_TOKEN, ADMIN_EMAIL, ADMIN_PASSWORD, APPS_DIR=/home/ubuntu/apps, NGINX_APPS_DIR=/etc/nginx/deployer-apps, APP_PORT_START=4001, DEFAULT_NODE_VERSION=20, NGINX_ENABLED=true` (false on Mac dev → nginx step logs "skipped").

## One-time EC2 bootstrap (deploy/README.md)
Install fnm + default Node, PM2 (+ `pm2 install pm2-logrotate`), Nginx, MongoDB (or Atlas) → clone this repo → fill `.env` → `npm install && npm run build && npm run seed` → `pm2 start` + `pm2 startup` + `pm2 save` → install `deploy/nginx-site.conf` (`/` → :3000, `include NGINX_APPS_DIR/*.conf;`) → sudoers file → certbot (manual).

## Execution workflow (Sonnet implements, Opus reviews, commit per stage)
- **Stage 0 (me)**: `git init`, `.gitignore` (`node_modules`, `.env`, `dist`, `*.log`), commit `style.md` → "chore: init repo with style guide".
- **Each stage below**:
  1. **Implement**: spawn a `general-purpose` agent with `model: sonnet`. Its prompt is self-contained: this plan's path, the stage's exact scope and files, the conventions (shell:false, validation, redaction, style.md), what earlier stages already provide, and "do not commit".
  2. **Review (Opus, me)**: read the full diff against the plan. Check correctness, security (injection, secret leakage, auth on every route), idempotency of steps, and style.md fidelity for UI stages. For bigger stages, also run `/code-review` on the working tree.
  3. **Fix**: send findings back to the same Sonnet agent via SendMessage (it keeps context). Re-review until clean. Tiny fixes I make directly.
  4. **Verify**: run what the stage enables (server boots, seed/clear-db, curl endpoints, a real local deploy, UI in the browser pane light/dark/375px).
  5. **Commit**: stage specific files, conventional message (`feat(server): …`), Co-Authored-By trailer. No pushes unless asked.
- Local prerequisites I'll check first: Node 20+, Docker (for Mongo) or a `MONGO_URI`, fnm, pm2, and a GitHub PAT in `server/.env` for stages 2+. If any are missing, I'll ask.

## Build order (one commit each, at minimum)
1. Root + server skeleton: config, db, User model, auth routes + middleware, seed, clear-db, shell.js (with abort)
2. github service + repos routes
3. services (git, crypto, ports, node/fnm, pm2, nginx, deployLog) + steps + deployer (deploy, cancel, rollback, auto-rollback) + apps/deployments/ports routes. May split into 3a services/steps and 3b deployer + routes.
4. monitor + system routes; settings (password, export/import)
5. web foundation: Vite/Tailwind setup, index.css tokens/utilities, ui components, layout, Login
6. web pages: Apps (+ Activity, ServerHealthCard) → NewApp → AppDetail + Deploy/Duplicate dialogs → Deployments + detail
7. web pages: Ports, Server, Settings
8. deploy/ templates + README; final end-to-end verification pass

## Verification
- Local (Mac, Mongo in Docker, fnm installed, `NGINX_ENABLED=false`): `npm run seed` → log in → create `test-main` from a small Express repo (with `/health`) on `main`, Node 20 → `curl localhost:4001` works → create `test-dev` from the **same repo** on `dev`, Node 22, different env → `/` shows the dev env value and `node -v` is 22 in the log.
- Deploy dialog: switch branch (Update) → new sha; Fresh → folder recreated; disable `build` → skipped; custom step runs.
- Health: push a commit that crashes on boot → deploy fails at healthCheck → auto-rollback deployment appears, app back on the old sha and healthy. Manual "Rollback to this" on an older deploy works.
- Cancel: add a `custom` step `sleep 60`, deploy, press Stop → status cancelled within ~5s, no orphan `sleep` process (`ps`), old version still serving.
- Duplicate `test-main` → `test-main-copy` gets the next port, same steps/env, deploys fine.
- Server page shows CPU/RAM/disk that match `top`/`df -h` roughly; per-app folder sizes shown; sparkline fills over a few minutes.
- Logs: live on home + detail; refresh mid-deploy resumes cleanly; PAT and env values absent from stored/downloaded logs.
- Settings: change password → old session elsewhere logged out, new password works; export with passphrase → `npm run clear-db` → `npm run seed` → import with passphrase → apps restored with env intact → deploy one.
- Negative: reserved/duplicate name, taken port, bad env key, bad node version, concurrent deploy, wrong import passphrase — all rejected clearly.
- UI: every page in the browser pane in light + dark and at 375px against style.md.
- EC2: `curl https://domain/test-main/` → 200; toggle nginx off → 404; reboot → `pm2 resurrect` restores dashboard + apps.

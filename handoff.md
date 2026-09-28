# Handoff — Deployment Maintainer

Self-hosted "mini-Vercel" for a single Ubuntu EC2: log in, pick a GitHub repo + branch, set env / Node version / pipeline steps, deploy with PM2 behind Nginx path routing (`/app-name` → `127.0.0.1:<port>`). Single seeded admin.

- Full spec: [docs/plan.md](docs/plan.md)
- API contract (frontend and backend both follow it): [docs/api-contract.md](docs/api-contract.md)
- UI design system: [style.md](style.md)
- EC2 setup: [deploy/README.md](deploy/README.md)

Branch `master`. Status as of 2026-09-28: **all 10 build stages committed; 183 server tests passing.** What remains is the deferred redeploy issue (§2) and verification on a real EC2 (§3).

---

## 1. What's done (committed)

| Commit | Stage | Contents |
|---|---|---|
| `72e1afa` | 0 | Repo init, `style.md` |
| `151bb07` | 1 | Express 5 + Mongoose server, zod config, JWT cookie auth with `tokenVersion`, `npm run seed`, `npm run clear-db`, `shell.js` (spawn `shell:false`, process-group kill, `tokenizeCommand`) |
| `e58a31a` | 2 | GitHub service (repos, branches, Node version from `.nvmrc`/`engines`), `HttpError`, shared validators |
| `db82dbb` | 3a | App/Deployment models; git, fnm, pm2, nginx, ports, crypto and deployLog services; the 9 idempotent pipeline steps |
| `1ddc4bc` | 3b | Deployer (lock, cancel, rollback, auto-rollback, restart recovery, retention), `/apps`, `/deployments` (incl. SSE), `/ports`, `/node/versions` |
| `e433c83` | 5 | Web foundation: Vite/React/Tailwind v4, glass tokens + UI kit, shell, login |
| `6cfdea8` | 6 | Apps home, New App wizard, App detail, Deploy/Duplicate dialogs, Deployments + live log view, dev-only mock API |
| `9f1190d` | 7 | Ports, Server, Settings pages; shared `/system` poller; disk-full banner; route code-splitting |
| `08ec5f8` | 8 | `deploy/` nginx site, sudoers, dashboard PM2 ecosystem, EC2 README, root README |
| `b16e683` | 4 | Monitor (1h CPU/RAM/disk history, 60s app health checks), `/system`, `/settings/info`, password change, config export/import, graceful SIGINT/SIGTERM shutdown |

Tests: `npm test` → **183 passing** (server only; there are no frontend tests). They run the real deploy code against a local bare-git fixture with fake `fnm`/`pm2`/`sudo` executables (`server/test/helpers/`). They need MongoDB on `127.0.0.1:27017` and create a per-process test DB.

---

## 2. What's left

### 2.1 Redeploy issue (deferred by the owner)
**Changing an app's start command** (pm2 step `command`) is not applied to an already-running process by `pm2 startOrReload`; pm2 needs `pm2 delete` + `start` when the script or args change. The owner reported redeploy issues and asked to skip them for now.
- Where: `server/src/services/pm2.js` (`writeEcosystem`, `startOrReload`) and `server/src/steps/pm2.js`.
- Suggested fix: read the previous `ecosystem.config.cjs` (or `pm2 jlist` `pm_exec_path`/`args`). If the script or args differ, `pm2 delete app-<name>` (ignore "not found") before `startOrReload`, then add a test with the pm2 shim.
- Worth reproducing the owner's actual redeploy problem on EC2 first; it may be this or something environment-specific (fnm PATH, sudo rule).

### 2.2 Integration checks not yet done
See §3 "Not yet verified". Stage 4 endpoints were smoke-tested against the production build (all return 200; `/repos` returns 503 until `GITHUB_TOKEN` is set).

### 2.3 Small follow-ups from the Stage 4 review
- Import validation is fail-fast: the error names only the first invalid row.
- An imported app's custom nginx path isn't checked for collisions with existing apps' paths.
- There's no test for the password-change rate limit.

## 3. Known issues and risks

### Not yet verified (highest priority)
- **Never run on a real Ubuntu box.** All pipeline tests use fake `pm2`/`fnm`/`sudo` scripts. The first real EC2 deploy is the true integration test. Check in particular: `fnm exec --using=<v> -- <cmd>` behaviour, PATH inside the generated `ecosystem.config.cjs`, `pm2 startOrReload --update-env`, the `sudo -n nginx -t` / `systemctl reload nginx` sudoers match, and `pm2 save` / `pm2 startup` surviving a reboot.
- **Frontend Stages 6–7 were only exercised against the dev mock** (`web/src/dev/mockApi.js`, enabled with `localStorage.mockApi='1'` in dev), not the real backend. Browser verification was stopped partway at the owner's request. An integration pass is needed: SSE via the Vite proxy and through Nginx, log download, the export blob download, the import flow, and error messages from real `{ error, issues }` responses at form fields.
- No frontend tests.

### Functional gaps / behaviours to know
- Changing an app's start command isn't applied on redeploy; see §2.1.
- **The deploy lock is in-memory.** The dashboard must run as a **single process**; never use pm2 cluster mode or multiple instances. `deploy/ecosystem.dashboard.cjs` is correctly fork mode; keep it that way.
- Restart recovery (`recoverInterruptedDeployments`) marks interrupted apps `failed`, because their previous status isn't remembered.
- Rollback uses the app's **current** env and steps, not the ones from the target deployment (by design; the UI says so).
- The per-deployment log is capped at ~1 MB (then "…log truncated"; step markers and the summary still get through). The UI renders the last 3000 lines only (no virtualization).
- `StepsEditor` only lets custom steps move within the custom group (between build and pm2); built-in step order is fixed.
- New App gets the default Node version from `/node/versions` rather than the `nodeVersion` from `/apps/defaults` (same value, redundant call).

### Security notes
- **Custom step commands are arbitrary code execution by design** (admin-only, run as `ubuntu`, `shell:false`, and shell operators are rejected by `tokenizeCommand`).
- **Redaction is best-effort.** Env values shorter than 4 chars, and common values (numbers, `true/false`, `production/development/test/staging`, `localhost`), are not masked in logs. A secret that an app prints in a transformed form (e.g. base64) is not caught.
- App env is stored encrypted in Mongo (AES-256-GCM, `ENCRYPTION_KEY`). It is **written in plaintext** to `APPS_DIR/<app>/.env` and to `ecosystem.config.cjs` (both mode 600), and to pm2's dump file. `GET /api/apps/:id` returns decrypted env to the logged-in admin.
- **Changing `ENCRYPTION_KEY` makes every stored env undecryptable.** Deploys then fail with a clear 500; export config (Settings → Backup) *before* rotating the key.
- The session cookie is `Secure` when `NODE_ENV=production`, so login fails over plain HTTP until certbot has run (noted in `deploy/README.md`).
- GitHub upstream 401/403 are mapped to 502/503 on purpose. **Never return 401 for anything except the dashboard session**, because the UI logs out on any 401.

### Housekeeping
- MongoDB 7.0's apt repo doesn't support Ubuntu 24.04; `deploy/README.md` notes using 8.0 there.
- `.claude/launch.json` (Vite dev-server entry for Claude's preview tool) is committed; delete it if unwanted.
- The owner's global git has `core.autocrlf=true`; `.gitattributes` forces LF, so keep it.
- Some remaining multi-line comments in server/web code could be trimmed; the style convention is minimal comments.

---

## 4. Local development

```bash
npm install
cp server/.env.example server/.env   # fill secrets; NGINX_ENABLED=false; APPS_DIR/NGINX_APPS_DIR under ./.data
npm run seed
npm run dev        # API on :3000
npm run dev:web    # UI on :5173 (proxies /api)
npm test
```

Without `GITHUB_TOKEN`, repo listing returns 503 with a clear message. Real deploys locally need `fnm` and `pm2` installed (the owner chose not to install them on the Mac).

## 5. Conventions to keep
- Every process goes through `server/src/services/shell.js` `run()` (`shell:false`, argv arrays). Never build shell strings.
- Validate at the boundary with zod and `server/src/lib/validate.js`; throw `HttpError(status, message)` for client-facing errors, with the error shape `{ error, issues? }`.
- API responses use `id`, never `_id`; serialize via `server/src/lib/serializers.js`.
- UI follows `style.md` (§22 checklist): tokens only, `dark:` pairs for literals, 44px targets, and hover lifts rather than scales.
- Conventional commits, one per stage.

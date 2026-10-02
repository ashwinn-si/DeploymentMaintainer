# Handoff — Deployment Maintainer (2026-10-02)

## What this is
A self-hosted "mini-Vercel": one dashboard that deploys and manages Node.js apps on one or more EC2 servers (git → fnm → install/build → PM2 → health check → Nginx path routing, with live logs, rollback and auto-rollback).

```
Browser ─▶ web/ (Vercel, deploy.ashwinsi.in)
              │  cookie login, VITE_API_URL
              ▼
           control/ (EC2 :3100, control.ashwinsi.in, Atlas DB deployment_control)
              │  /api/servers/:id/api/*  + Bearer SERVER_SECRET
              ▼
           server/ agent on each EC2 (:3000, api.ashwinsi.in, Atlas DB deployment_maintainer)
```

- `server/`: API-only agent. Bearer `SERVER_SECRET` auth, public `GET /deployment-manager` handshake, the deploy pipeline.
- `control/`: admin login (`npm run seed`), server registry with encrypted secrets, a streaming proxy to agents, CORS for the Vercel UI (`CORS_ORIGINS`) and a CSRF origin check.
- `web/`: React/Vite/Tailwind dashboard (slate + electric-blue theme, `style.md`). Servers home, Add Server wizard, all app pages per server.

**Docs:** `deployment-helper.md` (copy-paste EC2 setup, the one being followed now), `DEPLOYMENT.md` (full guide), `docs/api-contract.md`, `plan-29.09.md` (the multi-server design), `style.md`.

## Repo state
- Branch `master`, in sync with `origin/master` (`ashwinn-si/DeploymentMaintainer`, **public**). The latest pushed fix is `8349eb0`.
- Tests: `npm test` → server 193 / control 53, all passing. `npm run build` is clean.
- **Uncommitted:**
  - `deployment-helper.md`: up to date (Atlas, public repo, `.config.cjs` names, URI trimming fix), but it contains the owner's personal email in `ADMIN_EMAIL`/`LETSENCRYPT_EMAIL`. Swap those back to `you@example.com` before committing (the repo is public).
  - `.gitignore`: now ignores `server.md` (the owner's local notes, which contain credentials) and `*.secrets.md`.
- `server.md` must **never** be committed. It was never committed or pushed (verified).

## Live EC2 status (first server, being set up via `deployment-helper.md`)
| Step | Status |
|---|---|
| Packages, swap, fnm, PM2, clone, `npm ci` | Done |
| `server/.env`, `control/.env` (Atlas URIs fixed to one clean `?retryWrites=true&w=majority`) | Done |
| Admin password / `npm run seed` | Password was reset; confirm the seed printed "Created/Reset admin user" |
| Nginx sites `dm-agent` + `dm-control`, sudoers | Done |
| Certbot `control.ashwinsi.in` | ✅ issued |
| Certbot `api.ashwinsi.in` | ❌ **intentionally deferred**: `api.ashwinsi.in` still points to the **old server** |
| PM2 | Now runs `deployment-maintainer` + `deployment-control` from `deploy/*.config.cjs`, plus `pm2 save` and `pm2 startup` |
| `curl localhost:3000/deployment-manager` / `https://control…/api/health` | ❌ **Last seen: no response / 502.** Waiting on diagnostics (see below) |
| Nginx 301 fix on the EC2 (`location /api/servers` / `/api/deployments` without trailing slash) | Commands given; **not confirmed applied** |
| Vercel UI | Not set up yet |
| Add Server | Not done yet; plan is to use URL **`http://localhost:3000`** (allowed for localhost) until `api.ashwinsi.in` moves |

### Immediate next steps
1. On the EC2, apply the Nginx fix if not done:
   ```bash
   sudo sed -i 's#location /api/servers/ {#location /api/servers {#' /etc/nginx/sites-available/dm-control
   sudo sed -i 's#location /api/deployments/ {#location /api/deployments {#' /etc/nginx/sites-available/dm-agent
   sudo nginx -t && sudo systemctl reload nginx
   ```
2. Diagnose the 502:
   ```bash
   pm2 status
   pm2 logs deployment-maintainer --lines 40 --nostream
   pm2 logs deployment-control --lines 40 --nostream
   ```
   Both apps connect to MongoDB Atlas **before** listening. Likely causes, in order:
   - Atlas **Network Access** is missing the EC2's Elastic IP (`MongooseServerSelectionError`, after about 30s)
   - a wrong password in `MONGO_URI` (`bad auth`)
   - `Invalid configuration: …`, a bad `.env` line
   Success looks like `Server listening on port 3000` / `Control plane listening on port 3100`.
3. Expected checks: handshake JSON from `localhost:3000/deployment-manager`, `{"ok":true}` from `https://control.ashwinsi.in/api/health`, and **204** for the CORS preflight (`deployment-helper.md` §3.13).
4. Vercel (`deployment-helper.md` Part 5): import **only the `web` project** (not "Services"), Root Directory `web`, preset Vite, env `VITE_API_URL=https://control.ashwinsi.in`, then the custom domain `deploy.ashwinsi.in`. A `*.vercel.app` URL can't log in (same-site cookie).
5. Log in, then **Add Server** with URL `http://localhost:3000`, "I already have an ID and secret", and the values from `grep -E '^SERVER_(ID|SECRET)=' server/.env`.
6. Later, to move `api.ashwinsi.in`: point its DNS A record at this EC2, run `certbot` for it, then in the dashboard **Servers → Edit URL → `https://api.ashwinsi.in`**.

## Security to-dos (do these)
- **Rotate the GitHub token and the Atlas DB password.** Both were pasted into chat and sit in plain text in `server.md`. After rotating, update `GITHUB_TOKEN` and both `MONGO_URI`s on the EC2, then run `pm2 reload deployment-maintainer deployment-control`.
- **Rotate `SERVER_SECRET`** once things work (it was pasted in chat): **Servers → ⋯ → Rotate secret**, update `server/.env`, then `pm2 reload deployment-maintainer`.
- Clear secrets from the EC2 shell history if any were typed into commands: `history -c && history -w`.
- Prefer a dedicated Atlas user (e.g. `dm-app`, "Read and write to any database") over `root`.

## Bugs found and fixed during this deployment
- PM2 ran `deploy/ecosystem.*.cjs` as plain scripts, because PM2 only loads `*.config.(js|cjs|mjs)`. Renamed to `ecosystem.server.config.cjs` / `ecosystem.control.config.cjs` (`d2573ce`).
- Nginx returned 301 for `/api/servers` and `/api/deployments` because of trailing-slash locations (`8349eb0`).
- The helper's Atlas URI trimming broke on full URIs (duplicate `w=` option). It now keeps only up to `.mongodb.net` (in uncommitted `deployment-helper.md`).
- Login inputs: text overlapped the icons at ≥640px (`5ba65ec`).

## Known limitations / open items
- A changed PM2 start command isn't applied to an already-running app on redeploy (deferred by the owner). Workaround: `pm2 delete app-<name>`, then deploy.
- Agent and control plane must each run as a single process (in-memory deploy lock). Never use cluster mode.
- The control plane shares server 1's box: if it's down, the dashboard is down.
- The UI has only been verified by build + code review, not in a browser (owner preference). The first real browser session is the integration test.
- White text on `#0284C7` buttons is about 4.1:1 contrast. Consider `#0369A1` for button backgrounds if it looks light.
- Each additional server needs its own `AGENT_DB` name and its IP added in Atlas Network Access.

## Handy commands (EC2)
```bash
source ~/dm-setup.env
pm2 status
pm2 logs deployment-control --lines 100 --nostream
pm2 logs deployment-maintainer --lines 100 --nostream
sudo nginx -t && sudo systemctl reload nginx
cd ~/DeploymentMaintainer && git pull && npm ci && pm2 reload deployment-maintainer deployment-control
```

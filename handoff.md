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

## Live EC2 status (first server — control + agent, agent now on `api1.ashwinsi.in`)
| Step | Status |
|---|---|
| Packages, swap, fnm, PM2, clone, `npm ci` | Done |
| `server/.env`, `control/.env` (Atlas URIs fixed to one clean `?retryWrites=true&w=majority`) | Done |
| Admin password / `npm run seed` | Done |
| Nginx sites `dm-agent` + `dm-control`, sudoers | Done |
| Certbot `control.ashwinsi.in` | ✅ issued |
| Certbot `api1.ashwinsi.in` | ✅ issued. **`api.ashwinsi.in` was deliberately left alone** — it still points to the old server; this box's agent uses `api1.ashwinsi.in` instead, so the domain-migration plan in earlier notes no longer applies |
| PM2 | `deployment-maintainer` + `deployment-control`, both online and confirmed listening (3000 / 3100) |
| `curl localhost:3000/deployment-manager`, `localhost:3100/api/health`, `https://api1.ashwinsi.in/deployment-manager`, `https://control.ashwinsi.in/api/health` | ✅ all working |
| Vercel UI | Working — dashboard login confirmed |
| Add Server | In progress / being finished — URL `https://api1.ashwinsi.in`, "I already have an ID and secret" from `server/.env` |

### Bug found and fixed this session: PM2 silently never started the apps
Both `server/src/index.js` and `control/src/index.js` guarded their startup with:
```js
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main();
```
PM2's fork mode `require()`s the script into its own `ProcessContainerFork.js` wrapper instead of spawning it as a real `node script.js` process, so `process.argv[1]` is PM2's internal path, never the script's own URL. `main()` silently never ran — PM2 reported "online", CPU/memory looked plausible, but nothing ever listened and the log files stayed empty (0 bytes) no matter how many times the processes were restarted. `node src/index.js` run by hand always worked, which is what made it so confusing.

**Fix (commit `8e62f48`):** `main` is now exported from each `index.js`, and a new `server/src/start.js` / `control/src/start.js` calls it unconditionally. `deploy/ecosystem.*.config.cjs` now point PM2 at `src/start.js` instead of `src/index.js`. `npm start`/`npm run dev` and the test suites (which only import `createApp`) are unaffected. If PM2-managed apps ever show "online" with empty logs and nothing listening again, this is the first thing to check — confirm with:
```bash
sed -i '/^const isMain = /i console.log("argv1:", process.argv[1], "| url:", fileURLToPath(import.meta.url));' server/src/index.js
pm2 restart deployment-maintainer && pm2 logs deployment-maintainer --lines 5 --nostream
# then revert the sed edit
```

### Immediate next steps
1. Finish **Add Server** in the dashboard: URL `https://api1.ashwinsi.in`, "I already have an ID and secret", values from `grep -E '^SERVER_(ID|SECRET)=' server/.env` on the EC2.
2. Do the security to-dos below — several real secrets (Atlas password, `JWT_SECRET`, `ENCRYPTION_KEY`, admin password) were pasted into chat during debugging this session and must be rotated.
3. If a **second** agent-only server is added later, `deployment-helper.md` Part 7 now needs its `script: 'src/index.js'` references in the copy-paste commands double-checked against the new `src/start.js` entry point (the doc itself wasn't updated this session).

## Security to-dos (do these)
- **Rotate the GitHub token, the Atlas DB password, `JWT_SECRET`, `ENCRYPTION_KEY` (both `.env` files), and the admin password.** All were pasted into chat again during this session's PM2/Mongo debugging (not just `server.md` from before). After rotating Atlas/GitHub, update `GITHUB_TOKEN` and both `MONGO_URI`s on the EC2; after rotating `JWT_SECRET`/`ENCRYPTION_KEY`, every encrypted value they protect (stored server secrets, sessions) becomes unreadable, so expect to re-add servers and re-log-in; then run `pm2 reload deployment-maintainer deployment-control`.
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

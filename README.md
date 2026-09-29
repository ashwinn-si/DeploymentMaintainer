# Deployment Maintainer

A self-hosted "mini-Vercel" for one EC2 instance: log in, pick a GitHub repo and branch, configure
env vars and a deploy pipeline, and deploy. Every later deploy is one click with live logs, health
checks, one-click rollback, and Nginx path-based routing (`/my-app` → its own port). The same repo
can be deployed many times as independent apps, each with its own branch, port, env and steps.

## Features

- GitHub repo/branch picker, per-app Node version (via [fnm](https://github.com/Schniz/fnm))
- Configurable deploy pipeline — git sync, install, build, PM2 start, health check, Nginx routing,
  plus arbitrary custom steps
- Deploy any branch on demand (update in place or fresh re-clone); duplicate an app to run another branch side by side
- Live streaming deploy logs (SSE) on the home page, a global Deployments page and a per-deploy detail view, with step timeline, cancel, copy and download; secrets are masked
- Auto-rollback on a failed health check, one-click manual rollback to any past successful deploy
- Server health (CPU/RAM/disk with 1h history, per-app memory and disk use, app health pings) and a ports/routing overview
- Settings: change password, GitHub token status, passphrase-encrypted config export/import

## Local development

Requires Node 20+ and a MongoDB instance (local or Docker). The test suite expects MongoDB on
`127.0.0.1:27017` and uses fake `pm2`/`fnm`/`sudo` executables, so neither needs installing to run
tests. Running real deploys locally does need `fnm` and `pm2`.

```bash
npm install
cp server/.env.example server/.env
```

Fill in `server/.env` — at minimum `MONGO_URI`, `JWT_SECRET`, `ENCRYPTION_KEY`, `ADMIN_EMAIL`,
`ADMIN_PASSWORD`. Set `NGINX_ENABLED=false` for local dev (the nginx step then just logs
"skipped" instead of trying to write real Nginx config). `GITHUB_TOKEN` is optional until you
need to list real repos.

```bash
npm run seed        # creates the admin user from server/.env
npm run dev          # backend on :3000
npm run dev:web       # frontend dev server (Vite), proxies /api to :3000
npm test              # server test suite
```

## Project layout

```
server/   Express API, deploy pipeline (src/steps, src/services), scripts/seed + clear-db, tests
web/      React + Vite + Tailwind dashboard (styled per style.md)
deploy/   Nginx site, sudoers rule, PM2 ecosystem for the dashboard (see DEPLOYMENT.md)
docs/     API reference
style.md  UI design system
```

## Production deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)**: AWS setup (key pair, EC2, security group, Elastic IP, DNS),
the GitHub token, server bootstrap (fnm, PM2, MongoDB, Nginx, sudoers, certbot) and deploying your
first app.

## Scripts (repo root)

| Script | What it does |
| --- | --- |
| `npm run dev` | Backend dev server (`node --watch`) |
| `npm run dev:web` | Frontend dev server (Vite) |
| `npm run build` | Builds the frontend to `web/dist`, served by the backend |
| `npm start` | Backend in production mode (serves the built frontend) |
| `npm run seed` | Creates/resets the admin user from `server/.env` |
| `npm run clear-db` | Drops the database (typed confirmation, or `--yes`) |
| `npm test` | Runs the server test suite |

## Known limitations

- **Changed start command on redeploy**: `pm2 startOrReload` doesn't apply a new start command to an already-running app. Delete and redeploy the app, or run `pm2 delete app-<name>` before redeploying. (Deferred; fix belongs in `server/src/services/pm2.js`.)
- **Single process only**: the deploy lock is in memory, so never run the dashboard in pm2 cluster mode or as multiple instances.
- **Not yet verified on a real server**: pipeline tests use fake `pm2`/`fnm`/`sudo`, and several pages were only checked against the dev mock. Treat the first EC2 deploy as the integration test.
- **Secrets**: app env is encrypted in MongoDB but written in plaintext (mode 600) to each app's `.env`, its `ecosystem.config.cjs`, and pm2's dump. Log redaction is best-effort: values shorter than 4 chars and common values like `true` or `production` aren't masked. Custom step commands run arbitrary code by design.
- **`ENCRYPTION_KEY` rotation** makes stored env unreadable, so export config first (Settings → Backup).
- **Rollbacks** use the app's current env and steps, not the ones from the target deployment.

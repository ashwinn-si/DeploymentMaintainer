# AGENTS.md

Rules for anyone (people or AI agents) changing this repo. Product overview: `README.md`. Server setup and day-2
operations: `DEPLOYMENT.md`. API shapes: `docs/api-contract.md`. UI design system: `style.md`.

## Repo map

| Path | What it is |
| --- | --- |
| `server/` | **Agent** (one per EC2): Express + Mongoose API, deploy pipeline (`src/steps`, `src/services/deployer.js`), staging (`src/services/staging.js`, `smoke.js`), analytics collector, Nginx/PM2 services |
| `server/migrations/` | Database migrations (migrate-mongo). **Read the migration rules below before touching a model.** |
| `server/.mongoose-drift/server/` | mongoose-drift schema snapshots (`1.0.0.json`, `1.1.0.json`, ...). Committed, append-only |
| `server/scripts/` | `migrate-dry-run.js`, `migrate-helpers.js`, `drift-check.js`, `clear-db.js` |
| `control/` | **Control plane**: admin login, server registry, proxy to agents, serves `web/dist`. Own database and own `.mongoose-drift/control/` snapshots |
| `web/` | React + Vite + Tailwind dashboard. Mock API for UI work in `web/src/dev/mockApi.js` |
| `deploy/` | Nginx sites, sudoers rule, PM2 ecosystems, logrotate config |
| `docs/api-contract.md` | HTTP API reference. Update it whenever an endpoint or response shape changes |

## Commands

```bash
npm test                              # every workspace (needs MongoDB on 127.0.0.1:27017; pm2/fnm/sudo are faked)
npm test -w server                    # just the agent
npm run build                         # web build (also the UI check; there is no browser/preview step)
npm run drift:check -w server         # fails if models changed without a snapshot (also runs inside npm test)
npm run migrate:status -w server
npm run migrate:dry-run -w server     # rehearse pending migrations on a throwaway copy of the DB
npm run migrate:up -w server
```

## Database migration rules (mandatory)

Any change to a Mongoose model in `server/src/models/` or `control/src/models/` (new/removed/renamed field, changed
type/default/enum/required, new index or collection) **must ship with all of these in the same commit**:

1. **A new snapshot**: `npm run drift:snapshot -w server -- <next version>` (versions are `1.N.0`, take the next after the
   latest file in `server/.mongoose-drift/server/`). For `control/` use `-p control` from the `control/` folder.
   Never edit or delete an existing snapshot.
2. **A migration file** in `server/migrations/` (generate a stub with
   `cd server && npx mongoose-drift diff <prev> <next> -p server --stub`, move it into `server/migrations/`, delete the
   generated stub folder, fill in `up`/`down`).
3. **Docs**: `docs/api-contract.md` if the API shape changed, and the README/DEPLOYMENT notes if operators must do something.

`npm test` enforces this: `test/drift.test.js` fails when the models differ from the latest snapshot, and
`test/migration-files.test.js` checks file names and exports.

### Migration file rules

- **Name**: `YYYYMMDDHHmmss-kebab-description.js`, timestamp = when it was written (UTC). Example:
  `20261009000100-request-stat-indexes.js`. Files run in name order, so a new migration must sort after every existing
  one. Names are unique. Regex enforced by tests: `^\d{14}-[a-z0-9]+(-[a-z0-9]+)*\.js$`.
- **Shape**: ES module exporting `async function up(db)` and `async function down(db)` (native MongoDB `db` handle,
  not Mongoose models).
- **Idempotent**: running `up` twice changes nothing the second time (filter on "field missing", `createIndex`,
  `$setOnInsert`). `down` must also tolerate running twice and on data that never had the field.
- **Reversible without data loss**: `down` only reverts what `up` backfilled (match the default value); it must never wipe
  values users set since.
- **Back up before modifying documents**: `await backupCollection(db, '<collection>', '<label>')` from
  `scripts/migrate-helpers.js` (writes `server/backups/<timestamp>-<label>.json`, git-ignored). Index-only or
  new-collection migrations need none. Use `backfill(db, collection, filter, update)` for default backfills so counts are logged.
- **Old documents keep working**: application code must read new fields with a default (`app.rootDir ?? ''`) so the new
  code works before the migration has run. Defaults used by existing apps: `rootDir: ''` (repo root `/`),
  `stagedDeploys: true`, `restoredPrevious: false`.
- **Never edit or rename a migration that has run anywhere real**; add a new one.
- **Tests**: add a case in `server/test/migrations.test.js` style (legacy-shaped documents -> `up` -> second `up` is a
  no-op -> `down`) and extend the legacy seed in `test/migrate-dry-run.test.js` if a validated collection gained a field
  (`scripts/migrate-dry-run.js` validates migrated documents with the real models).

### Rolling out to a live server

1. Export a backup from the dashboard (Server settings -> Backup).
2. `git pull && npm ci`
3. `npm run migrate:status -w server`, then **`npm run migrate:dry-run -w server`**. It copies the real data into a
   `<db>_dryrun_<timestamp>` database, runs the pending migrations there, validates every document, round-trips
   `down`/`up`, drops the copy, and never writes to the real database. It must print `DRY RUN PASSED`.
4. Only then `npm run migrate:up -w server`, then `pm2 reload deployment-maintainer`.

## Other conventions

- ESM everywhere, semicolons, single quotes. Match the neighbouring file's style and comment density.
- Errors from agent auth failures must surface as 502 to the browser (the UI treats 401 as "logged out").
- The deploy lock is in memory: never run the agent in PM2 cluster mode.
- UI work follows `style.md`. Verify with `npm run build` and code review; no browser previews.
- Staged deploys (`app.stagedDeploys !== false`) build in `<app>.staging` and swap folders; code that touches app folders
  must use `appWorkDir(config, app)` (`server/src/lib/appEnv.js`) / `state.repoDir` / `state.appDir`, never hard-code
  `APPS_DIR/<name>`.
- Don't commit secrets, `.env*`, `*.pem`, `server/backups/`, or export files (all git-ignored).

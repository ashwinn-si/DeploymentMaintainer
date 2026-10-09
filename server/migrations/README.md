# Database migrations

Run by [migrate-mongo](https://github.com/seppevs/migrate-mongo); schema changes are tracked with
[mongoose-drift](https://github.com/ashwinn-si/mongoose-drift). Applied migrations are recorded in the
`migrations_changelog` collection (a migration is identified by its file name only).

## Conventions

- **File name**: `YYYYMMDDHHmmss-kebab-description.js`, the timestamp being the day/time the migration was written
  (UTC), e.g. `20261009000100-request-stat-indexes.js`. Migrations run in file-name order. A test
  (`test/migration-files.test.js`) enforces `^\d{14}-[a-z0-9]+(-[a-z0-9]+)*\.js$`, unique names, and that every file
  exports `up(db)` and `down(db)`. Never rename or edit a migration that has run anywhere real; add a new one.
- **Idempotent**: running `up` twice must change nothing the second time (filter on "field missing", use `createIndex`,
  `$setOnInsert`, ...). `down` must also tolerate being run twice and on a database that never had the data.
- **Reversible**: `down` undoes `up` (drop the index, `$unset` the field). It cannot restore values users changed after
  `up`; the dry run warns when `down` + `up` does not reproduce the data exactly.
- **Back up what you modify**: call `backupCollection(db, '<collection>', '<label>')` from `scripts/migrate-helpers.js`
  before changing existing documents (writes `server/backups/<timestamp>-<label>.json`). New collections / index-only
  migrations have nothing to back up. During a dry run `backupCollection` is a no-op (`MIGRATE_DRY_RUN=1`).
- Use `backfill(db, collection, filter, update)` so old documents get explicit defaults and the counts are logged.
- Code must still work *before* the migration runs (read new fields with a default, e.g. `app.rootDir ?? ''`).

## Changing a Mongoose model (snapshot + migration workflow)

```bash
npm run drift:check -w server                           # what changed since the latest snapshot (exit 1 = drift)
npm run drift:snapshot -w server -- 1.3.0               # snapshot the new schema (next version after the latest)
cd server && npx mongoose-drift diff 1.2.0 1.3.0 -p server --stub   # writes a migration stub
```

Move/rename the generated stub into `server/migrations/` using the naming convention above, fill in `up`/`down`, and
commit the new `.mongoose-drift/server/<version>.json` snapshot together with the migration. Never edit an old snapshot.

`npm run drift:check -w server` compares the latest snapshot with the models on disk and exits 1 with the diff if they
differ; `test/drift.test.js` runs it, so forgetting the snapshot + migration fails `npm test`. `control/` has the same
check (`npm run drift:check -w control`, snapshots in `control/.mongoose-drift/control`).

Validation only fails the dry run for what the migration breaks: a document that is invalid after migrating but was fine
before (or gained a new problem, or lacks a required default) fails it. Documents that were already invalid before and
are unchanged (for example old deployments with empty log lines) are printed as a note and counted in `warnings`.

## Running on a live server

Always rehearse first. The dry run only ever *reads* the real database:

```bash
npm run migrate:dry-run -w server               # copy the data to <db>_dryrun_<timestamp>, migrate it, validate, round-trip, drop it
npm run migrate:dry-run -w server -- --keep     # keep the scratch database for inspection (drop it yourself afterwards)
npm run migrate:dry-run -w server -- --no-roundtrip   # skip the down + up reversibility check
```

It copies every collection and index (including `migrations_changelog`) into a scratch database on the same Mongo
server, runs the pending migrations there, prints document counts before/after, validates every document of
`apps` / `deployments` / `requeststats` / `analyticsoffsets` with the real Mongoose models (and that every app has a
string `rootDir` and boolean `stagedDeploys`, and every deployment a boolean `restoredPrevious`), then runs `down` for what it applied and `up` again and checks the
counts are unchanged. It ends with `DRY RUN PASSED — safe to run: npm run migrate:up -w server` (exit 0) or
`DRY RUN FAILED — do NOT migrate production` plus the reasons (exit 1). It needs free disk/RAM for a second copy of
the database, so run it at a quiet moment on a large database.

Only when it passes:

```bash
npm run migrate:status -w server   # what is pending
npm run migrate:up -w server       # apply everything pending
npm run migrate:down -w server     # revert the last one
```

Export a backup from the dashboard (Server settings → Backup) before the first `migrate:up` on a live server.

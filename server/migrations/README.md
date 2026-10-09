# Database migrations

Run by [migrate-mongo](https://github.com/seppevs/migrate-mongo); schema changes are tracked with
[mongoose-drift](https://github.com/ashwinn-si/mongoose-drift). Applied migrations are recorded in the
`migrations_changelog` collection. Every migration must be **idempotent** (safe to run twice), take a
backup of what it touches with `backupCollection`, and have a working `down`.

## When you change a Mongoose model

```bash
npm run drift:snapshot -w server -- 1.1.0          # snapshot the new schema (pick the next version)
npx mongoose-drift diff 1.0.0 1.1.0 -p server --stub   # run from server/: writes a migration stub
```

Move/rename the generated stub into `server/migrations/` as `<timestamp>-<what-changed>.js`, fill in the
`up`/`down` bodies (use `backfill` from `scripts/migrate-helpers.js` so old documents get explicit defaults),
and commit the new `.mongoose-drift/server/<version>.json` snapshot with it. Code must still work *before*
the migration runs (read new fields with a default, e.g. `app.rootDir ?? ''`).

## Running

```bash
npm run migrate:status -w server   # what is pending
npm run migrate:up -w server       # apply everything pending
npm run migrate:down -w server     # revert the last one
```

Export a backup from the dashboard (Server settings → Backup) before the first `migrate:up` on a live server.

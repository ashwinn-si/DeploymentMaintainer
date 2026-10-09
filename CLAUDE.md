# CLAUDE.md

Read **AGENTS.md** first: repo map, commands and the mandatory database migration rules (snapshot + migration file
naming/shape/idempotency, dry run before `migrate:up`). UI follows `style.md`; verify UI changes with `npm run build`
and code review, not a browser preview.

<!-- mongoose-drift:start -->
## mongoose-drift — Mongoose Schema Versioning

This project uses [mongoose-drift](https://github.com/ashwinn-si/mongoose-drift) to version and diff Mongoose schemas.
Snapshots live in `.mongoose-drift/` as JSON files — each records every collection's fields, types, indexes, and options.

### Commands

| Command | Purpose |
|---------|---------|
| `npx mongoose-drift log [-p <project>]` | List all saved schema snapshots |
| `npx mongoose-drift show <version> [-p <project>]` | Print full schema for a snapshot as JSON |
| `npx mongoose-drift diff <from> HEAD [-p <project>]` | Compare a snapshot to the current live schema |
| `npx mongoose-drift diff <from> HEAD --json [-p <project>]` | Same diff as machine-readable JSON |
| `npx mongoose-drift diff <from> HEAD --txt [-p <project>]` | Export diff as a text file (useful for writing migrations) |
| `npx mongoose-drift snapshot --version <v> [-p <project>]` | Save current schema state |
| `npx mongoose-drift diff <from> <to> --stub [-p <project>]` | Generate a `migrate-mongo` migration stub |
| `npx mongoose-drift setup-ai` | Refresh these AI instruction files after adding snapshots |

### Notes for AI agents

- `HEAD` means "the live schema right now" — reads model files on disk, no snapshot needed.
- `npx mongoose-drift show <version> --json` outputs a JSON object keyed by collection name.
  Each collection has `fields` (record of fieldName → `{type, required?, default?, ref?, enum?, ...}`)
  and `indexes` (array of `{fields: {fieldName: 1|-1|"text"}, options?}`).
- Use `--json` flag when you need to parse diff output programmatically.
- Use `--txt` to produce a plain-text migration guide you can read and act on.
- Field types use Mongoose instance names: `String`, `Number`, `Boolean`, `Date`, `ObjectId`,
  `Array<String>`, `Mixed`, etc.

### How to inspect the schema

1. Run `npx mongoose-drift log` to see available snapshots.
2. Run `npx mongoose-drift show <latest-version>` to read field definitions.
3. Run `npx mongoose-drift diff <latest-version> HEAD` to see uncommitted changes.
<!-- mongoose-drift:end -->

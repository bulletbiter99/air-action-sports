# Migrations

D1 schema migrations for the Air Action Sports database (`air-action-sports-db`). Wrangler applies these in **alphabetic order by filename**, recording each in the database's internal migration log so already-applied files are skipped on subsequent runs.

## Convention

- **Forward-only.** No down-migrations. Schema is recovered via restore from backup, not by reversing migrations.
- **Numeric prefix + descriptive slug**: `NNNN_short_description.sql`. Pad to four digits.
- **Never rename, edit, or delete a previously-applied migration.** Once a file has been applied to any environment (local, staging, production), it is frozen. To change schema further, add a new migration that supersedes the previous state. Editing an applied file desynchronizes the migration log from the actual schema and can corrupt future runs.
- **Each migration is idempotent where possible.** Prefer `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN` (which D1/SQLite tolerates re-runs of), and `DROP TABLE IF EXISTS`. Cannot guarantee idempotency on data-mutating `INSERT`/`UPDATE` statements; document those carefully.
- **Comments at the top** explain the why. Cross-reference HANDOFF.md, the audit, or the relevant route file when the migration is non-obvious.

## The `0010_*` filename collision

Two files share the `0010_` prefix:

- [`0010_session_version.sql`](0010_session_version.sql) — adds `users.session_version` (closes SECURITY_AUDIT.md MED-9 / MED-10).
- [`0010_vendors.sql`](0010_vendors.sql) — creates the vendor MVP tables (`vendors`, `vendor_contacts`, `event_vendors`, `vendor_package_sections`, `vendor_documents`, `vendor_access_log`) plus the `vendor_package_sent` email template seed.

This is a one-time historical artifact from two parallel branches landing close together. Both files are independent (one ALTERs `users`, the other creates new vendor tables) — they do not share schema dependencies, so order between them does not matter for correctness.

Wrangler resolves alphabetically: `0010_session_version.sql` runs before `0010_vendors.sql`. Order is deterministic.

**Do not rename either file** — both have been applied to the production database. Renaming would cause Wrangler to treat the renamed file as a new migration on the next deploy and fail (since the schema state is already advanced). Documented here so future contributors don't try to "tidy" the numbering.

## How to add a new migration

1. Pick the next sequential number after the highest existing prefix (currently `0020`).
2. Create `migrations/NNNN_descriptive_slug.sql`.
3. Write the SQL with a header comment explaining the change and any cross-references.
4. Apply locally first if a local D1 environment is set up. Otherwise, apply directly to remote per the operator's deploy workflow.
5. Commit the migration in its own commit (or paired with the code change that depends on it).

## How to apply

Migrations are applied by `wrangler`, never by piping the `.sql` file into a database directly. Direct application bypasses Wrangler's migration log and will cause Wrangler to re-attempt the migration on the next deploy, failing or duplicating state.

```bash
# Apply pending migrations to the remote D1 database
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
  npx wrangler d1 migrations apply air-action-sports-db --remote

# List the migration log on the remote (which files have been applied)
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
  npx wrangler d1 migrations list air-action-sports-db --remote
```

The local D1 simulator (`--local`) is rarely used for this project — most schema testing happens directly against the remote development database.

## See also

- [HANDOFF.md](../HANDOFF.md) §6 — table-level schema overview
- [docs/audit/03-data-model.md](../docs/audit/03-data-model.md) — full ERD and migration history walkthrough
- [wrangler.toml](../wrangler.toml) `[[d1_databases]]` — DB binding name and ID

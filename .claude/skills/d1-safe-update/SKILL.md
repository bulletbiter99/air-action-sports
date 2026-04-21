---
name: d1-safe-update
description: Update rows in a Cloudflare D1 database by writing properly-escaped SQL to a file in scripts/, executing it with wrangler d1 execute --remote --file, and verifying the rowcount. Avoids the escaping pitfalls of inline --command. Trigger whenever the user asks to modify D1 data — email template content, seed data, bulk updates, config rows, template copy, repairing a bad value, or any "update the database" / "change what's in D1" / "fix this row" request where the change is non-trivial (contains HTML, multi-line strings, quotes, ampersands, or em-dashes). Also trigger for schema-preserving backfills. Do NOT trigger for migrations (use wrangler d1 migrations apply instead) or for read-only queries.
---

# D1 Safe Update

## When to use

Trigger whenever the user wants to write to a Cloudflare D1 database and the payload is anything more complex than a simple `UPDATE t SET x=? WHERE id=?` with scalar values. Typical phrases: "update the email template", "change the subject on ...", "fix the copy in ...", "seed this data", "update the taxes/fees row", "backfill the ... column", "re-apply the content for ...".

The skill exists because D1 inline commands via `--command="..."` have two footguns:
1. **Quote escaping.** Bash/PowerShell shell-quote rules clash with SQL string quotes, and multi-line strings are effectively impossible on Windows.
2. **Silent truncation.** Very long strings get mangled by shell line limits and you only find out when the rendered email looks broken.

The skill sidesteps both by writing SQL to a file and running `--file`.

Do NOT trigger for:
- Running a migration file (use `wrangler d1 migrations apply`)
- Read-only SELECT queries (`--command` is fine for quick reads)
- Simple single-value updates with no special characters (`--command` works)

## Workflow

### 1. Gather the change
Confirm: what table, which row(s) (WHERE clause), what column(s), what new value(s). Read the current row first if you're replacing content — always know what you're overwriting.

```bash
source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute <db-name> --remote --command="SELECT <cols> FROM <table> WHERE <cond>" --json
```

### 2. Write SQL to `scripts/<descriptive-name>.sql`

Pattern:
```sql
-- <One-line description of what this does and why>

UPDATE <table>
SET
  <col1> = '<escaped value>',
  <col2> = '<escaped value>'
WHERE <condition>;
```

**Escaping rules:**
- Wrap string values in SINGLE quotes (SQL standard). Double-quotes mean identifiers in SQLite.
- Escape embedded single quotes by doubling: `'it''s'` not `'it\'s'`.
- **Avoid straight `'` in content where possible** — use "it is" / "cannot" / "do not" instead of contractions. Fewer quotes to escape, no regex fragility.
- For HTML content, prefer entities over raw characters for ambiguous symbols: `&#9632;` (■), `&#9658;` (►), `&mdash;` (—), `&amp;` (&). This sidesteps both shell-encoding and email-client-rendering issues.
- Em-dashes in plain-text blocks are fine as `—` (UTF-8 is passed through).
- Newlines in string literals are fine in SQLite — just keep the opening quote on the same line as the `=`.

### 3. Execute against remote D1

```bash
source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute <db-name> --remote --file=scripts/<name>.sql
```

### 4. Verify rowcount

Wrangler's output JSON includes `rows_written` under `meta`. Confirm it matches your expected number of affected rows. If you UPDATEd one row, expect `rows_written: 1`. Mismatch = WHERE clause wrong or row didn't exist; STOP and investigate before re-running.

### 5. Commit

Always commit the SQL file, even for one-off updates:

```bash
git add scripts/<name>.sql && git commit -m "content: <what changed and why>"
```

Reasoning: the file is a record of the mutation. Six months from now "why does this row have X?" is answerable from `git log scripts/`. Inline `--command` invocations leave no trace.

## Example — email template rewrite

```sql
-- Realign event_reminder_24h template with booking_confirmation brand
-- (dark theme, militaristic tone, matches booking_confirmation/user_invite)

UPDATE email_templates
SET
  body_html = '<div style="font-family:system-ui,sans-serif;background:#1a1c18;color:#f2ede4;padding:32px;">
<div style="color:#d4541a;">&#9632; T-minus 24 hours</div>
<h1>{{event_name}}</h1>
<p>Hey {{player_name}},</p>
<p>Your op kicks off tomorrow. See you at {{event_location}}.</p>
<p><a href="{{waiver_link}}">&#9658; View Booking &amp; Waivers</a></p>
<p>&mdash; Air Action Sports</p>
</div>',
  body_text = 'T-MINUS 24 HOURS — {{event_name}}

Hey {{player_name}},

Your op kicks off tomorrow at {{event_location}}.

View waivers: {{waiver_link}}

— Air Action Sports'
WHERE slug = 'event_reminder_24h';
```

Notes on the example:
- `&#9632;` / `&#9658;` / `&mdash;` / `&amp;` in HTML — portable, no shell drama.
- No contractions (`cannot`, `do not`) — avoids `'` escaping.
- Em-dashes in plain text — fine as-is.
- Multi-line strings open right after `=` and stay in single quotes.

## Bulk updates / multi-row

Use multiple `UPDATE` statements in one file, semicolon-terminated. Wrangler executes them in one session but NOT in a single transaction — if you need atomicity, wrap in `BEGIN; ... COMMIT;`.

```sql
BEGIN;
UPDATE email_templates SET subject = 'New subject A' WHERE slug = 'a';
UPDATE email_templates SET subject = 'New subject B' WHERE slug = 'b';
COMMIT;
```

## When shell-quoting is unavoidable

If you genuinely need `--command` (quick ad-hoc during debugging), on Windows Git Bash:

```bash
source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute <db> --remote --command="SELECT * FROM t WHERE x = '\''val'\''"
```

The `'\''` sequence is "close single quote, escape a literal single quote, reopen single quote". Ugly and error-prone — prefer a file.

## Safety

- **This skill writes to production D1.** Every invocation is destructive until verified. If the user is ambiguous about which environment, ask before running.
- **Test reads first.** Always SELECT the target row(s) before UPDATE so you know what's being overwritten. Paste the "before" into your response so the user can verify.
- **No DROP / DELETE / TRUNCATE without explicit confirmation.** This skill is for UPDATE/INSERT. If the request involves destructive schema ops, pause and confirm the exact scope with the user first.

## Why it's structured this way

Writing SQL to a file instead of `--command` eliminates an entire class of escaping bugs that *look* like they worked (exit code 0, output looks normal) but silently corrupt content — double-escaped quotes, lost line breaks, truncated long strings. The git-committed SQL file also creates an audit trail for "who changed this and why" that inline commands can't. The overhead (two extra steps: write file, commit) is tiny compared to the class of bugs it prevents.

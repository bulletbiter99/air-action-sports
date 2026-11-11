# CLAUDE.md

This file is the entry point for any Claude session working in this repository. The full canonical onboarding lives in [HANDOFF.md](HANDOFF.md); this file gives you the short, durable rules.

**For a fresh session, use [`docs/next-session.md`](docs/next-session.md)** — it carries the current state, the work menu, and the consolidated operator-pending list. The live state is in the first ~60 lines of that file (the "START HERE" block); [HANDOFF.md](HANDOFF.md) carries a "Current" section plus the full project handoff. The running state recap that used to sit here was removed because those two files already carry it.

---

## Moved out of this file

- Milestone history (M1–M7, Post-M6 polish, Post-M5.5 work): [docs/milestone-history.md](docs/milestone-history.md)
- Session logs for 2026-05-31 and 2026-06-02 (Post-M7 work-menu, M8): [docs/session-history.md](docs/session-history.md)
- Event-content and image focal-point how-to (2026-06-02 sessions): `.claude/skills/event-content/SKILL.md`
- Session logs for 2026-06-03 → 2026-08-01 were removed as duplicates; see the DONE / "What shipped" sections of [docs/next-session.md](docs/next-session.md).
- Worker-side and test-side standing rules: [worker/CLAUDE.md](worker/CLAUDE.md) and [tests/CLAUDE.md](tests/CLAUDE.md) (loaded when working in those directories).

## Standing rules (carried over)

- **Claude Code never executes `wrangler d1 execute --remote` for MUTATIONS.** Read-only `.schema` / `SELECT sql FROM sqlite_master` queries — operator was permissive at B0-followup (4 tables); default remains operator-runs-it.
- **Pre-migration spot-check mandatory** for any batch creating or altering a table. Spot-check output → batch closing summary.
- **Production `email_templates.id` is `TEXT PRIMARY KEY` and `created_at` is `INTEGER NOT NULL` — both required.** Local D1 fixture has a more permissive schema, so migrations seeding `email_templates` rows pass unit tests but fail on remote apply if they omit these columns. **For any future migration that seeds `email_templates`, include `id='tpl_<slug>'` and `created_at=updated_at`** — match the dominant existing-row id convention (`tpl_event_reminder_24h`, `tpl_user_invite`).
- DNT files extended additively only (new functions/endpoints/`else if` branches — never modify existing)
- Any new INSERT must go through `writeAudit()` (worker/lib/auditLog.js), not raw SQL.
- A Node CLI script with `import 'node:child_process'` will break Cloudflare deploy if reachable from `worker/index.js`.
- A future event-day route needs to bypass `requireEventDayAuth` — this is a security regression; reroute through admin-side instead.
- **Resend webhooks need a sibling signed route, not an `else if` on `/stripe`** (Batch 8). Resend signs svix-style (`svix-id`/`svix-timestamp`/`svix-signature`, HMAC-SHA256 over a `whsec_` secret), incompatible with the Stripe verifier. `worker/lib/resendWebhook.js` is the svix verify; `/api/webhooks/resend` is the new route; the existing `/stripe` handler stays byte-untouched. The recipient email is NOT a valid Resend tag value (tags allow only `[a-zA-Z0-9_-]`) — keep it in subject/body.
- **`git add -A` stages `marketing/`**, which is deliberately never committed. Stage by explicit path.
- **Local Playwright runs WRITE missing baselines**, so a local "pass" can be circular (it compares against snapshots it just created). Baselines are CI-generated linux PNGs; never commit local `*-win32.png`.
- Baselines are CI-generated (linux) only — never commit local PNGs.
- **Cancel without killing the Stripe session is not cancel.** A webhook redelivery re-pays any non-`paid` booking (2026-06-03 lesson), so the C8 cancel expires the Checkout session BEFORE flipping status (additive `expireCheckoutSession` in stripe.js, the M6 helper pattern).
- **this app issues FULL refunds only** (`issueRefund` takes no amount, no `refund_amount_cents`), so partials happen in the Stripe dashboard and the booking row must be corrected or revenue overstates
- a **cash refund outside Stripe leaves the booking `status='paid'`** and overstates revenue (fix via `/admin/bookings/:id` → Record external refund → Cash, which always emails the customer per decision D06).
- hiding negative reviews moves the crawler-visible `aggregateRating`, which Google's review-snippet policy treats as a violation when done selectively — flag it each time, it stays the operator's call
- **Diagnosis signal (durable):** `bookings.stripe_session_id` prefix — `cs_test_` vs `cs_live_` — is the source of truth for which Stripe mode a booking used (`wrangler secret list` shows only names, never values, so it can't tell test from live).
- operator set live `STRIPE_WEBHOOK_SECRET` then `STRIPE_SECRET_KEY` (webhook-secret-before-API-key = safe order, so there's never a window where real cards charge but bookings can't confirm)
- Stripe Checkout for payments — **LIVE since 2026-06-03; production takes real money, so never run a "test" checkout against it**
- **AI crawlers are blocked at the Cloudflare edge.**
- **Editing `public/robots.txt` cannot change this** — the managed block is prepended at the edge and is not in the repo. Fix is Cloudflare → Security → Bots → AI Scrapers & Crawlers.
- **Production can change underneath a session** — the operator added a 4th site and flipped Foxtrot to `open` mid-session. Re-read `/api/sites` and `/api/events` live rather than trusting any doc.
- **Replacing an event image = a NEW content-hashed key + repoint the D1 `*_image_url` column, NOT an in-place overwrite.**
- `UPDATE` the column (reversible), and leave the old object **orphaned — don't hard-delete casually** (its bytes are the only copy; the operator hands you the *new* file)
- **Hard confirmation before destructive irreversible action.** The batch-promo-code modal pattern (preview + ⚠ warning + explicit "Yes, send N emails" button) prevents accidental click-throughs on email blasts. Re-use for any future bulk action that touches recipients or external services.
- **Bare element selectors in global stylesheets leak across the app.** `nav { position: fixed; ... }` was scoped by intent to the public site but applied everywhere. `admin.css` had a one-page workaround for the sidebar (`nav.admin-sidebar-nav` resetting position/width/etc.) — that workaround was a signal the global was wrong, not a fix. Whenever you add a global rule for a specific component, scope it to a class (e.g. `.site-nav`).

## Operating rules

### Run / test / build / lint

```bash
# Lint — use this form, NOT `npm run lint`.
# `npm run lint` is `eslint .`, which also walks the gitignored static-backup/
# and reports ~24 pre-existing errors CI never sees. Lint the tracked source to
# reproduce CI exactly. Currently 0 errors / ~640 warnings.
# (eslint.config.js has existed since M3 batch 0 — the old "lint is broken"
# note that used to sit here was years-stale and contradicted this file's own
# M3 section.)
npx eslint src worker tests scripts

# Tests — vitest unit suite. Current count is in docs/next-session.md; treat
# that as authoritative rather than any number written here.
#
# ⚠ Run under TZ=UTC to reproduce CI. The runner is UTC and a naive-ISO test
# fixture is ambient-TZ-dependent, so a suite that is green on a Mountain dev
# machine can be red on CI (and vice versa — a UTC-derived fixture compared
# against a Denver date fails only between 18:00 and 24:00 Mountain).
TZ=UTC npx vitest run

# Playwright VISUAL regression — these DO run in CI on every PR and BLOCK it.
# A UI change that shifts a baseline fails the PR until baselines are recaptured
# (add the `capture-baselines` label; the bot pushes new PNGs, then push a
# follow-up commit to clear GitHub's anti-recursion block).
```

See [docs/runbooks/visual-regression.md](docs/runbooks/visual-regression.md) for the baseline-capture workflow.

```bash
# Convenience: the deploy-air-action-sports skill (.claude/skills/deploy-air-action-sports/SKILL.md) wraps this.
# Auto-deploy on `git push origin main` is wired through Cloudflare Workers Builds; the dashboard's
# Deploy command is `npm run build && npx wrangler deploy`.
```

### Branch and PR etiquette

- **Small batches.** Aim for ≤10 files per change. Don't bundle a stack-wide refactor with a feature.
- **Plan-mode-first for non-trivial changes.** Read [docs/audit/06-do-not-touch.md](docs/audit/06-do-not-touch.md) before touching anything in Critical or High. If the planned change crosses that boundary, post the plan and pause for confirmation.
- **No `--force` ever.** No force-push, no `git reset --hard`, no `git checkout --` against uncommitted work, no `git rebase -i` (interactive editors break Claude Code).
- **Commit messages descriptive enough that the next session can rebuild the mental model from history alone.** Treat the commit log as durable documentation. Match the existing style (Conventional Commits with optional scope, e.g. `audit: stack inventory — ...`, `feat(events): per-surface cover images`, `fix(quote): return HTTP 400 when validation errors present`). See `git log --oneline` for examples.
- **Never skip hooks** (`--no-verify`) or signing flags unless explicitly requested.

### Do-not-touch list (mirrored from [docs/audit/06-do-not-touch.md](docs/audit/06-do-not-touch.md))

These files, functions, endpoints, tables, and components are off-limits without an explicit follow-up conversation. Sorted by risk; reasons in the audit.

#### Critical

- `worker/routes/webhooks.js` (entire file) — external webhook + handles payments + audit-log emitter
- `worker/lib/waiverLookup.js` `findExistingValidWaiver` — shared with public site + handles waivers (moved here from `webhooks.js` in M2 B4a; body byte-identical)
- `worker/routes/waivers.js` `POST /api/waivers/:qrToken` — handles waivers + audit-log emitter
- `worker/routes/waivers.js` `getLiveWaiverDocument` — handles waivers + integrity check
- `worker/lib/stripe.js` `verifyWebhookSignature` — external webhook + handles payments
- `worker/lib/stripe.js` `createCheckoutSession`, `issueRefund` — handles payments
- `worker/lib/pricing.js` (`calculateQuote`, `loadActiveTaxesFees`, `centsToDollars`) — shared with public site + handles payments
- `worker/routes/bookings.js` `POST /api/bookings/checkout` — handles payments + customer-facing
- `worker/routes/admin/bookings.js` `POST /api/admin/bookings/manual` — handles payments + audit-log emitter
- `worker/routes/admin/bookings.js` `POST /api/admin/bookings/:id/refund` — handles payments + audit-log emitter
- `bookings`, `attendees`, `events`, `waivers`, `waiver_documents`, `vendor_contract_documents`, `vendor_signatures` D1 tables
- `worker/lib/formatters.js` (`formatEvent`, `formatTicketType`, `formatBooking`, `safeJson`) — shared with public site
- `worker/lib/emailSender.js` — customer-facing email. The count has grown well past the "9 named senders" this list once cited; the operative rule is **never modify an existing sender, appending a new one is safe**.
- `worker/index.js` `serveUpload(...)` — shared with public site + security
- `worker/index.js` `rewriteEventOg(...)` — shared with public site
- `worker/index.js` `scheduled(...)` cron handler — cron-handler + audit-log emitter + customer-facing email

#### High

- `worker/lib/auth.js`, `worker/lib/session.js`, `worker/lib/vendorSession.js`, `worker/lib/vendorToken.js`, `worker/lib/password.js` — handles auth
- `worker/lib/ids.js` — shared with public site (ID format contract; qrToken length is what every printed ticket relies on)
- `worker/lib/rateLimit.js` — shared with public site + handles auth
- `worker/lib/email.js`, `worker/lib/templates.js` — customer-facing email
- `worker/lib/bodyGuard.js` — security
- `worker/lib/magicBytes.js` — security (used by both public feedback and admin uploads)
- `worker/routes/admin/waiverDocuments.js`, `worker/routes/admin/vendorContracts.js` — handles waivers
- `worker/routes/vendor.js` `vendor/:token/sign` — handles waivers + audit-log emitter
- `worker/routes/feedback.js` `POST /api/feedback` — shared with public site + audit-log emitter
- `worker/routes/admin/feedback.js` `PUT /:id` — security + R2 cascade
- `taxes_fees`, `email_templates`, `event_vendors`, `vendor_contacts`, `vendor_documents`, `audit_log` D1 tables
- `src/components/FeedbackModal.jsx` — shared between public footer + Feedback page + AdminLayout dropdown + AdminFeedback
- `src/styles/global.css` — applied to both public and admin shells
- `worker/index.js` `withSecurityHeaders` — security
- `worker/lib/auth.js` `requireRole(...)` role hierarchy
- `wrangler.toml [assets] run_worker_first = true` — without it, /api/* gets the SPA 404 fallback
- `migrations/*` — forward-only by convention; never rename or delete previously-applied migrations

See [docs/audit/06-do-not-touch.md](docs/audit/06-do-not-touch.md) for the Medium tier and modification protocols per entry.

### Test gate enforcement (added 2026-05-06 in m1-batch-8)

[scripts/test-gate-mapping.json](scripts/test-gate-mapping.json) is the machine-readable companion to the do-not-touch list above. Each entry under `gates` maps a source path → the test paths under [tests/](tests/) that lock its behavior.

**Rule:** before editing any path listed under `gates`, run the listed test paths and confirm they pass. After your edit, re-run them — they must still pass. If a test reveals current behavior conflicting with audit-documented behavior, **stop and ask** — do not adapt the test to match the new code.

The `uncovered` section of the gate map enumerates do-not-touch files without tests yet. (Groups E, F, G were promoted to `gates` in M2 B6 / M3 B7 / M4 B1a, and Group H was registered 2026-07-27 in #391 — so the punch list that used to be described here is done. Read the file for what is actually still uncovered.)

When adding tests for a gated path in a future batch, also append the new test paths to the relevant `gates[<path>].tests` array in [scripts/test-gate-mapping.json](scripts/test-gate-mapping.json) so the map stays current.

### Stop-and-ask conditions

Stop work and ask the user before continuing if you encounter any of:

1. **A committed credential** in any branch (none currently — confirmed by Phase 1 audit; flag immediately if a future change introduces one).
2. **A change that requires modifying or running production resources** to validate (live D1 writes, real Stripe charges, real Resend sends to real customer addresses).
3. **A do-not-touch candidate that appears broken or actively misbehaving.** Do not "fix" it — flag it and ask.
4. **Repo state is dirty / inconsistent** in a way that suggests work in progress (uncommitted changes, untracked files of substance, stash entries). **Except `?? marketing/`** — that directory is deliberately never committed and shows up on every clean checkout; it is not a signal.
5. **A change that could be visible to users** (public-site rendering, customer emails, admin role boundaries) that you can't verify locally.

When in doubt, ask. The cost of a confirmation is low; the cost of an unwanted change to a system that handles real bookings is high.

### Carry-forward: D1 quirks (added 2026-05-07 in m4-batch-0)

Four behaviors of Cloudflare D1 + wrangler discovered during M3 and M5.5 that bite any future migration or remote D1 operation. Read these before writing a `migrations/*.sql` file or running a `wrangler d1 execute --remote` command. Captured in detail in [docs/runbooks/m3-deploy.md](docs/runbooks/m3-deploy.md).

1. **No `BEGIN TRANSACTION` / `COMMIT` as executable statements** — D1 rejects them; it wraps each statement implicitly, so you never need to. ⚠️ This entry used to claim the word `TRANSACTION` was rejected *even inside SQL comments*, and prescribed rewording comments to avoid it. **That is disproven** — migrations 0039–0053 contain the word in comments and applied fine. Don't waste effort on the ritual.

2. **NOT NULL via table-rebuild fails on D1** with `FOREIGN KEY constraint failed` during `DROP TABLE`. D1 enforces FKs during DROP even though runtime FK enforcement is off by default, and the SQLite "create new table → copy → drop old → rename" pattern hits this. Use the SQLite 3.35+ **column-rename pattern** instead:
   ```sql
   ALTER TABLE foo ADD COLUMN bar_new TEXT NOT NULL DEFAULT '';
   UPDATE foo SET bar_new = bar;
   ALTER TABLE foo DROP COLUMN bar;
   ALTER TABLE foo RENAME COLUMN bar_new TO bar;
   ```
   Reference: [migrations/0023_customers_not_null.sql](migrations/0023_customers_not_null.sql) (M3 B6).

3. **`wrangler --remote --json --file` emits upload-progress UI characters before the JSON payload.** `JSON.parse(stdout)` fails on raw output. When parsing programmatically, strip everything before the first `[` or `{`. Reference: [scripts/backfill-customers.js](scripts/backfill-customers.js) (M3 B6 fix).

4. **(Added 2026-05-11 in M5.5 B2)** **`wrangler d1 execute --json --file=` returns a SUMMARY row, NOT the actual SELECT row data, when run against `--remote`.** Against `--local`, the same flag returns the real row data. Symptom: a Node script calling `--file` for a SELECT receives `[{"results": [{"Total queries executed": 1, "Rows read": N, "Rows written": 0, "Database size (MB)": "X"}], ...}]` instead of the expected `[{"results": [{...row}, ...]}]`. For read queries, **use `--command=` (NOT `--file=`)** — `--command` returns row data on both local and remote. `--file` is still appropriate for multi-statement WRITES (INSERT/UPDATE/CREATE), where the summary is acceptable. Reference: M5.5 B2's [scripts/seed-sites.js](scripts/seed-sites.js) + [scripts/backfill-events-site-id.js](scripts/backfill-events-site-id.js) (hotfix after the first remote run silently failed to update `events.site_id` because the script's read-back interpreted the summary row as one phantom "site").

5. **(Added 2026-05-27 in post-M6 Track C)** **`capabilities` table production column is `category`, NOT `scope`.** Production schema: `CREATE TABLE capabilities (key TEXT PRIMARY KEY, category TEXT NOT NULL, description TEXT NOT NULL, requires_capability_key TEXT REFERENCES capabilities(key), created_at INTEGER NOT NULL)`. Migration 0061's first apply failed with `table capabilities has no column named scope`. Spot-check via `SELECT sql FROM sqlite_master WHERE name='capabilities'` before authoring any migration that seeds caps. Verified: D1 transactional safety means the failed CREATE TABLE was NOT partial-applied — table didn't exist after failure. Reference: [migrations/0061_event_archive_links.sql](migrations/0061_event_archive_links.sql).

### Where to find each audit document

- [docs/audit/00-overview.md](docs/audit/00-overview.md) — executive summary; start here
- [docs/audit/05-coupling-analysis.md](docs/audit/05-coupling-analysis.md) ← read before touching anything in the do-not-touch list
- [docs/audit/06-do-not-touch.md](docs/audit/06-do-not-touch.md) ← mirrored above
- [HANDOFF.md](HANDOFF.md) — full session-start context (stack, deploy, schema, API surface, completed phases, gotchas)
- [docs/staff-job-descriptions.md](docs/staff-job-descriptions.md) — 22 role descriptions across 4 tiers; treat as a hypothesis source, not ground truth (per audit cross-references)

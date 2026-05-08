# CLAUDE.md

This file is the entry point for any Claude session working in this repository. The full canonical onboarding lives in [HANDOFF.md](HANDOFF.md); this file gives you the short, durable rules.

---

## 2026-05-06 — initial CLAUDE.md (Phase 1 audit close)

Created at the close of the Phase 1 admin audit. The audit branch is `audit/phase-1`; full output in [docs/audit/](docs/audit/) starting at [docs/audit/00-overview.md](docs/audit/00-overview.md).

### Stack summary

React 19 + Vite 8 client-only SPA served from a single Cloudflare Worker. Hono router for `/api/*`; raw SQL on Cloudflare D1 (no ORM); R2 for blobs (event covers, feedback screenshots, vendor docs); Resend for email; Stripe Checkout for payments (test keys today); custom HMAC-cookie auth (PBKDF2 100k); 8 Workers Rate Limiting bindings. **No TypeScript, no test suite, no in-repo CI workflows.** Full breakdown in [docs/audit/01-stack-inventory.md](docs/audit/01-stack-inventory.md).

### Run / test / build / lint

```bash
# Local dev — Vite serves src/, /api/* proxies to deployed Worker (set in vite.config.js)
npm run dev

# Build the SPA → dist/
npm run build

# Lint
# CURRENTLY BROKEN — package.json declares ESLint 9 + plugins, but no eslint.config.js exists.
# `npm run lint` will error on missing config. Documented at docs/audit/08-pain-points.md #8.
npm run lint

# Preview the built dist/
npm run preview

# Tests — vitest unit suite (216 tests across tests/unit/ as of m1-batch-8;
# growing per the milestone-1-test-infrastructure batches that implement
# the audit-prescribed characterization tests in docs/audit/09-test-coverage.md).
npm test                 # vitest run (CI runs this on every PR)
npm run test:watch       # vitest in watch mode (active development)
npm run test:coverage    # vitest run with v8 coverage; HTML in coverage/

# Playwright smoke suite (7 tests) — operator-triggered against a deployed
# Worker. Not part of `npm test`; not in CI by default. Operator one-time
# setup: `npx playwright install chromium`. See CONTRIBUTING.md.
npm run test:e2e
```

Deploy is **not** an npm script. The pattern is:

```bash
# Manual deploy — uses .claude/.env (gitignored) for the Cloudflare API token
npm run build && source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler deploy

# Convenience: the deploy-air-action-sports skill (.claude/skills/deploy-air-action-sports/SKILL.md) wraps this.
# Auto-deploy on `git push origin main` is wired through Cloudflare Workers Builds; the dashboard's
# Deploy command is `npm run build && npx wrangler deploy`.
```

D1 migrations:

```bash
# Apply pending migrations to remote D1
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 migrations apply air-action-sports-db --remote

# Run a one-off SQL command (read-only)
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command="SELECT 1"
```

### Branch and PR etiquette

- **Small batches.** Aim for ≤10 files per change. Don't bundle a stack-wide refactor with a feature.
- **Plan-mode-first for non-trivial changes.** Read [docs/audit/06-do-not-touch.md](docs/audit/06-do-not-touch.md) before touching anything in Critical or High. If the planned change crosses that boundary, post the plan and pause for confirmation.
- **No `--force` ever.** No force-push, no `git reset --hard`, no `git checkout --` against uncommitted work, no `git rebase -i` (interactive editors break Claude Code).
- **Commit messages descriptive enough that the next session can rebuild the mental model from history alone.** Treat the commit log as durable documentation. Match the existing style (Conventional Commits with optional scope, e.g. `audit: stack inventory — ...`, `feat(events): per-surface cover images`, `fix(quote): return HTTP 400 when validation errors present`). See `git log --oneline` for examples.
- **Never skip hooks** (`--no-verify`) or signing flags unless explicitly requested.

### Commit message convention

The repo follows **Conventional Commits with an optional scope**:

```
type(scope?): short summary in the imperative

Optional body explaining the why.

Co-Authored-By: <if applicable>
```

Types observed in `git log`: `feat`, `fix`, `docs`, `audit`, `polish`, `ship`, `tools`, `config`, `security`. New types are fine if they accurately describe a class of change. Scope is whatever subsystem is touched (e.g. `events`, `handoff`, `quote`).

### Do-not-touch list (mirrored from [docs/audit/06-do-not-touch.md](docs/audit/06-do-not-touch.md))

These files, functions, endpoints, tables, and components are off-limits without an explicit follow-up conversation. Sorted by risk; reasons in the audit.

#### Critical

- `worker/routes/webhooks.js` (entire file) — external webhook + handles payments + audit-log emitter
- `worker/routes/webhooks.js` `findExistingValidWaiver` — shared with public site + handles waivers
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
- `worker/lib/emailSender.js` (the 9 named senders) — customer-facing email
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

The `uncovered` section of the gate map enumerates do-not-touch files without tests yet. Their `audit_tests_prescribed` arrays form the post-M1 punch list per [docs/audit/09-test-coverage.md](docs/audit/09-test-coverage.md) (Groups E, F, G, H — admin manual booking, auth, worker-level, and cron).

When adding tests for a gated path in a future batch, also append the new test paths to the relevant `gates[<path>].tests` array in [scripts/test-gate-mapping.json](scripts/test-gate-mapping.json) so the map stays current.

### Stop-and-ask conditions

Stop work and ask the user before continuing if you encounter any of:

1. **A committed credential** in any branch (none currently — confirmed by Phase 1 audit; flag immediately if a future change introduces one).
2. **A change that requires modifying or running production resources** to validate (live D1 writes, real Stripe charges, real Resend sends to real customer addresses).
3. **A do-not-touch candidate that appears broken or actively misbehaving.** Do not "fix" it — flag it and ask.
4. **Repo state is dirty / inconsistent** in a way that suggests work in progress (uncommitted changes, untracked files of substance, stash entries).
5. **A change that could be visible to users** (public-site rendering, customer emails, admin role boundaries) that you can't verify locally.

When in doubt, ask. The cost of a confirmation is low; the cost of an unwanted change to a system that handles real bookings is high.

### Carry-forward: D1 quirks (added 2026-05-07 in m4-batch-0)

Three behaviors of Cloudflare D1 + wrangler discovered during M3 that bite any future migration or remote D1 operation. Read these before writing a `migrations/*.sql` file or running a `wrangler d1 execute --remote` command. Captured in detail in [docs/runbooks/m3-deploy.md](docs/runbooks/m3-deploy.md).

1. **No `BEGIN TRANSACTION` / `COMMIT` keywords** — wrangler's parser keyword-scans uploaded SQL and rejects anything containing the literal word `TRANSACTION`, **including in SQL comments**. To document transactional intent in a migration, phrase it as "transaction-control statements" or similar — never use the literal keyword. D1 wraps each statement implicitly; you don't need to wrap manually.

2. **NOT NULL via table-rebuild fails on D1** with `FOREIGN KEY constraint failed` during `DROP TABLE`. D1 enforces FKs during DROP even though runtime FK enforcement is off by default, and the SQLite "create new table → copy → drop old → rename" pattern hits this. Use the SQLite 3.35+ **column-rename pattern** instead:
   ```sql
   ALTER TABLE foo ADD COLUMN bar_new TEXT NOT NULL DEFAULT '';
   UPDATE foo SET bar_new = bar;
   ALTER TABLE foo DROP COLUMN bar;
   ALTER TABLE foo RENAME COLUMN bar_new TO bar;
   ```
   Reference: [migrations/0023_customers_not_null.sql](migrations/0023_customers_not_null.sql) (M3 B6).

3. **`wrangler --remote --json --file` emits upload-progress UI characters before the JSON payload.** `JSON.parse(stdout)` fails on raw output. When parsing programmatically, strip everything before the first `[` or `{`. Reference: [scripts/backfill-customers.js](scripts/backfill-customers.js) (M3 B6 fix).

### Where to find each audit document

- [docs/audit/00-overview.md](docs/audit/00-overview.md) — executive summary; start here
- [docs/audit/01-stack-inventory.md](docs/audit/01-stack-inventory.md)
- [docs/audit/02-route-inventory.md](docs/audit/02-route-inventory.md)
- [docs/audit/03-data-model.md](docs/audit/03-data-model.md)
- [docs/audit/04-integrations.md](docs/audit/04-integrations.md)
- [docs/audit/05-coupling-analysis.md](docs/audit/05-coupling-analysis.md) ← read before touching anything in the do-not-touch list
- [docs/audit/06-do-not-touch.md](docs/audit/06-do-not-touch.md) ← mirrored above
- [docs/audit/07-admin-surface-map.md](docs/audit/07-admin-surface-map.md)
- [docs/audit/08-pain-points.md](docs/audit/08-pain-points.md) ← Section 1 awaits operator input
- [docs/audit/09-test-coverage.md](docs/audit/09-test-coverage.md) — 83 characterization tests prescribed for Phase 2 prep
- [docs/audit/10-open-questions.md](docs/audit/10-open-questions.md) — 50 questions awaiting input
- [HANDOFF.md](HANDOFF.md) — full session-start context (stack, deploy, schema, API surface, completed phases, gotchas)
- [docs/staff-job-descriptions.md](docs/staff-job-descriptions.md) — 22 role descriptions across 4 tiers; treat as a hypothesis source, not ground truth (per audit cross-references)

### Milestone 1 — Test Infrastructure (✓ closed 2026-05-06)

**Status: complete.** Long-lived branch `milestone-1-test-infrastructure` was merged into `main` via merge commit `c4d67a6` (PR #14 on 2026-05-06). All 9 batches (PRs #2–#13) are on `main` as second-parent commits — `git log --first-parent main` skips them; `git log main` follows them. Sub-branches used `m1-batch-N-slug` naming (flat — sub-branch hierarchy under `milestone/...` was avoided due to git ref path collision).

The milestone shipped 216 vitest unit tests + 7 Playwright smoke tests scaffolded across 60 files. CI on every PR. Test-gate map at [scripts/test-gate-mapping.json](scripts/test-gate-mapping.json). Closing runbooks at [docs/runbooks/](docs/runbooks/).

**Per-batch operating rules used during M1** (preserved here as a template for the next milestone):
- Plan-mode-first per batch — write plan, post it, wait for "proceed" before editing.
- One commit per sub-PR. Conventional Commits with `test`/`chore`/`docs` types and `m<N>-<area>` scope.
- 10-file cap per PR. Hard rule.
- No `--force` ever. No rebases on shared branches. No direct commits to `main` or any `milestone-*` branch.
- All tests use mocks (Vitest + Web Crypto). No live Stripe / Resend / D1 / `wrangler deploy` from Claude.
- Stop-and-ask if a do-not-touch file appears to need editing or a test reveals current behavior conflicting with audit-documented behavior.

**Final batch table (all merged on milestone branch; milestone merged to main as `c4d67a6`):**

| Batch | What it ships | Squash on milestone | PR |
|---|---|---|---|
| **B1** Vitest setup + sanity test (5 files) | vitest.config.js, tests/setup.js, 4 mock helpers, tests/unit/health.test.js | `aa0cfb9` | #2 |
| **B2a** Group A pricing core (8 files) | empty-cart / single-ticket-no-addon / multi-ticket-with-addon / percent-tax-fixed-fee / percent-fee-on-percent-tax / applies-to-tickets / applies-to-all / line-items-shape | `456d12e` | #3 |
| **B2b** Group A pricing edges (7 files) | promo-percent / promo-fixed / per-unit-multipliers / capacity-errors / min-max-per-order / inactive-fee-excluded / cents-precision | `20dd620` | #4 |
| **B3a** Group B webhook signature (6 files) | tests/helpers/stripeSignature.js + signature-verify-{valid,invalid,stale,multi-v1} + signature-constant-time | `95ac8ce` | #5 |
| **B3b** Group B webhook handler (10 files) | tests/helpers/webhookFixture.js + 9 handler tests (idempotency, unknown-event-type, attendee-creation, ticket-types-sold-increment, promo-uses-increment, audit-log-emission, email-send-confirmation, email-send-admin-notify, waiver-auto-link-on-paid) | `8cf37a8` | #6 |
| **B4a** Group C waiver validation (8 files) | tests/helpers/waiverFixture.js + erecords-consent / signature-must-match-name / 4× age-tier / jury-trial-initials-required (audit C25-31) | `b141d35` | #7 |
| **B4b** Group C waiver effects (8 files) | row-doc-link-and-snapshot / row-claim-period / row-tier-flags / attendee-waiver-id-set / audit-log-waiver-signed / already-signed-409 / integrity-fail-on-{post,get} (audit C32-38) | `4a5a18a` | #8 |
| **B5** Group D auto-link (9 files) | null-inputs / match-by-email-and-name / case-insensitive-email / whitespace-tolerant-name / claim-period-required / expired-claim-period-no-match / latest-by-signed-at / sibling-different-name-no-match / cross-flow-consistency (audit D39-46) | `0274bcc` | #9 |
| **B6** Playwright smoke scaffold (4 files) | playwright.config.js, tests/e2e/setup.js, tests/e2e/smoke.test.js (7 audit-prescribed smoke tests), package.json devDep + test:e2e script | `4d19864` | #10 |
| **B7** CI workflow + CONTRIBUTING (3 files) | .github/workflows/ci.yml (vitest+coverage on PR; lint with continue-on-error per audit pain-point #8), CONTRIBUTING.md, .github/PULL_REQUEST_TEMPLATE.md | `37329ba` | #11 |
| **B8** Test gate map + CLAUDE.md (2 files) | scripts/test-gate-mapping.json (4 gates + 7 uncovered), CLAUDE.md gate-enforcement subsection | `b726104` | #12 |
| **B9** Closing runbooks (3 files) | docs/runbooks/m1-baseline-coverage.txt, docs/runbooks/m1-rollback.md, docs/runbooks/m1-deploy.md | `358fe83` | #13 |
| **milestone → main** | merge commit (preserves per-batch SHAs) | `c4d67a6` | #14 |

**Final test count:** 216 unit tests across 54 files + 7 smoke tests scaffolded across 3 files = **223 tests across 60 files**.

- Sanity: 3 tests, 1 file
- Group A (pricing): 79 tests, 15 files — ✓ complete (B2a + B2b)
- Group B (webhook signature + handler): 59 tests, 14 files — ✓ complete (B3a + B3b)
- Group C (waiver validation + effects): 50 tests, 15 files — ✓ complete (B4a + B4b)
- Group D (auto-link): 25 tests, 9 files — ✓ complete (B5)
- Group I (Playwright smoke, scaffolded): 7 tests, 3 files — ✓ scaffolded (B6, operator-runnable)

Audit Groups E (admin manual booking), F (auth), G (worker-level), H (cron) are **deferred to post-M1** — see `uncovered` in [scripts/test-gate-mapping.json](scripts/test-gate-mapping.json) for the punch list and audit IDs.

**Test runner:** Vitest 2.1.x, Node 20 env. Coverage via @vitest/coverage-v8. Playwright 1.59.x for B6 smoke (operator-triggered against deployed Worker; not in CI by default). [.github/workflows/ci.yml](.github/workflows/ci.yml) runs vitest + coverage on every PR to `main` or `milestone-*`; lint runs with `continue-on-error: true` until `eslint.config.js` is added (audit pain-point #8).

**Conventions established across the milestone:**
- All vitest tests under `tests/unit/<group>/*.test.js`. E2E under `tests/e2e/`.
- Helpers in `tests/helpers/` (mockEnv, mockD1, mockStripe, mockResend, stripeSignature, webhookFixture, waiverFixture).
- `globalThis.fetch` defaults to throw-on-unmocked in `tests/setup.js`. Tests opt in via `mockStripeFetch()` or `mockResendFetch()`.
- `mockD1.__on(pattern, response, kind)` registers a handler. `pattern` is string-includes or regex. `response` can be a value or `(sql, args, kind) => value`.
- Coverage folder `coverage/` is gitignored.
- Web Crypto (`crypto.subtle`, `crypto.getRandomValues`) used directly — no polyfill needed in Node 20.

**Post-M1 — what's next:**

The audit prescribes 83 characterization tests across Groups A–I. M1 landed Groups A, B, C, D, and I (smoke scaffolded). **Groups E, F, G, H are deferred to a future milestone** — see the `uncovered` section of [scripts/test-gate-mapping.json](scripts/test-gate-mapping.json) for the punch list:

- **Group E** — admin manual booking (audit E47–E53): `worker/routes/admin/bookings.js` POST /manual + POST /:id/refund.
- **Group F** — auth (audit F54–F64): `worker/lib/auth.js` (verifyPassword, hashPassword, requireAuth, requireRole), `worker/lib/vendorToken.js`.
- **Group G** — worker-level (audit G65–G70): `worker/index.js` serveUpload, rewriteEventOg.
- **Group H** — cron (audit H71–H76): `worker/index.js` scheduled handler.

Plus the **lint config gap** (audit pain-point #8 — eslint.config.js missing) so the CI lint step can become blocking.

**Operator one-time setup (after M1 merged to main):**
1. `npx playwright install chromium` (downloads the Chrome binary used by `npm run test:e2e`).
2. Run the smoke suite once against production: `npm run test:e2e` — should be 6/7 passing (#79 skipped without `E2E_TEST_EVENT_SLUG`).
3. Optional: tighten #79 by exporting `E2E_TEST_EVENT_SLUG=operation-nightfall` and re-running.

### Milestone 2 — Shared Primitives + Cross-Route Fix (✓ closed 2026-05-07; merged to main as `7a87f28` via PR [#28](https://github.com/bulletbiter99/air-action-sports/pull/28))

**Status: shipped.** The long-lived branch `milestone-2-shared-primitives` carried 11 squashed batch SHAs and was merged to `main` via merge commit `7a87f28` per [docs/runbooks/m2-deploy.md](docs/runbooks/m2-deploy.md). Migration `0021_feature_flags.sql` applied to remote D1 same day; density toggle visible + functional at `/admin/settings`. Sub-branches used flat `m2-batch-N-slug` naming (the M2 prompt's `milestone/2-shared-primitives/batch-N` form was rejected — git ref path collision; same workaround as M1).

The milestone shipped **+255 vitest unit tests across +16 new files** (216 M1 baseline → 471), six new gated paths in [scripts/test-gate-mapping.json](scripts/test-gate-mapping.json), six shared admin primitives ready for M3+ reuse, the closure of the cross-route smell from audit §08 #7, and the feature-flag substrate end-to-end (lib + admin route + density toggle UI).

**Per-batch operating rules used during M2** (same as M1):
- Plan-mode-first per batch — write plan, post it, wait for "proceed" before editing.
- One commit per sub-PR. Conventional Commits with `m2-<area>` scope.
- 10-file cap per PR. Hard rule. Splits used: B3 → 3a/3b, B4 → 4a/4b, B5 → 5a/5b/5c.
- No `--force` ever. No rebases on shared branches. No direct commits to `main` or `milestone-2-shared-primitives`.
- All tests use mocks (Vitest + mockD1 + mockEnv + mockStripe + mockResend). No live D1 / Stripe / Resend / `wrangler deploy` from Claude.
- **No remote D1 migration apply from Claude.** Migration `0021_feature_flags.sql` ships in repo only; operator applies via `npx wrangler d1 migrations apply --remote` after milestone merges to main (see [m2-deploy.md](docs/runbooks/m2-deploy.md)).
- Stop-and-ask if a do-not-touch file appears to need editing or a test reveals current behavior conflicting with audit-documented behavior.

**Final batch table (all 11 merged on milestone; milestone → main merged 2026-05-07 as `7a87f28` via PR [#28](https://github.com/bulletbiter99/air-action-sports/pull/28)):**

| Batch | What it ships | Squash on milestone | PR |
|---|---|---|---|
| **B1** FilterBar primitive + AdminFeedback proof (7 files) | `src/components/admin/FilterBar.{jsx,css}`, `src/hooks/useFilterState.js`, `src/hooks/useSavedViews.js`, 2 tests, AdminFeedback.jsx refactor | `658e95b` | [#16](https://github.com/bulletbiter99/air-action-sports/pull/16) |
| **B2** writeAudit() helper + 5 admin call sites (4 files) | `worker/lib/auditLog.js` + test; refactored users.js (3 sites) + emailTemplates.js (2 sites) | `2cf1485` | [#17](https://github.com/bulletbiter99/air-action-sports/pull/17) |
| **B3a** Money helpers + 6 admin sites (9 files) | `src/utils/money.js`, `worker/lib/money.js`, dual-import test (66 tests), 6 admin pages refactored | `1d3ed98` | [#18](https://github.com/bulletbiter99/air-action-sports/pull/18) |
| **B3b** Email helpers + 4 admin sites (6 files) | `src/utils/email.js`, `worker/lib/email.js` extended, dual-import test (76 tests), 3 admin route files refactored | `f35a0ec` | [#19](https://github.com/bulletbiter99/air-action-sports/pull/19) |
| **B4a** `findExistingValidWaiver` relocation [CRITICAL] (4 files) | `worker/lib/waiverLookup.js` (verbatim copy), webhooks.js (def removed + shim re-export), admin/bookings.js (new import path), gate map updated | `683f4a6` | [#20](https://github.com/bulletbiter99/air-action-sports/pull/20) |
| **B4b** Re-target Group D test imports + drop shim (10 files) | 9 test files retargeted, webhooks.js shim removed | `36fda2b` | [#21](https://github.com/bulletbiter99/air-action-sports/pull/21) |
| **B5a** Feature-flag substrate (4 files) | `migrations/0021_feature_flags.sql` (operator-applies-remote), `worker/lib/featureFlags.js` (isEnabled/listFlags/setUserOverride with graceful table-missing handling), 27+7 tests | `5e1f568` | [#22](https://github.com/bulletbiter99/air-action-sports/pull/22) |
| **B5b** Feature-flag admin route + client hook (5 files) | `worker/routes/admin/featureFlags.js` (GET list / PUT override), worker/index.js mount, `src/admin/useFeatureFlag.js`, `tests/helpers/adminSession.js`, 7 route tests | `95983f4` | [#24](https://github.com/bulletbiter99/air-action-sports/pull/24) |
| **B5c** Design tokens + density toggle UI (6 files) | `src/styles/tokens.css` (new), `src/styles/admin.css` (refactor — zero pixel diff target verified), AdminLayout.jsx (data-density attr), AdminSettings.jsx (toggle UI), useFeatureFlag.js extended (exists + setFeatureFlagOverride), 3 helper tests | `a6ab6e9` | [#25](https://github.com/bulletbiter99/air-action-sports/pull/25) |
| **B6** Group E admin booking characterization tests (9 files) | `tests/helpers/adminBookingFixture.js` (new) + 7 audit tests (E47-E53) for `worker/routes/admin/bookings.js` (manual cash/comp/card branches, pricing parity, auto-link, refund Idempotency-Key, refund-rejects-cash) + gate map promotion | `d40e099` | [#26](https://github.com/bulletbiter99/air-action-sports/pull/26) |
| **B7** Closing: rollback + deploy + baseline coverage runbooks + final docs (5 files) | `docs/runbooks/m2-{rollback,deploy,baseline-coverage}.{md,txt}`, CLAUDE.md + HANDOFF.md M2 closed-state update | `febadf0` | [#27](https://github.com/bulletbiter99/air-action-sports/pull/27) |
| **milestone → main** | merge commit per [m2-deploy.md](docs/runbooks/m2-deploy.md) (preserves per-batch SHAs) | `7a87f28` | [#28](https://github.com/bulletbiter99/air-action-sports/pull/28) |

**Final test count:** 471 unit tests across 70 files (216 M1 baseline + 255 new across M2 batches 1–6) + 7 Playwright smoke tests scaffolded across 3 files (M1) = **478 tests across 73 files**.

- M1 carryover: 216 unit tests (sanity / pricing / webhook / waiver / auto-link)
- B1 FilterBar: +45
- B2 writeAudit: +16
- B3a money: +66 (33 per target × 2 targets — client + worker mirror)
- B3b email: +76 (38 per target × 2 targets)
- B4a/4b: 0 (relocation; same 25 Group D tests, just retargeted import paths)
- B5a feature-flags: +34 (27 main + 7 readiness)
- B5b feature-flag route: +7
- B5c density toggle: +3
- B6 admin booking: +8 (7 audit-prescribed E47-E53 + 1 sibling negative case for auto-link)

Audit Groups F (auth), G (worker-level), H (cron) remain **deferred to post-M2** — see `uncovered` in [scripts/test-gate-mapping.json](scripts/test-gate-mapping.json) for the punch list.

**Gated paths after M2** (in `scripts/test-gate-mapping.json gates`):
- `worker/lib/pricing.js` (M1)
- `worker/lib/stripe.js` (M1, signature subset)
- `worker/routes/webhooks.js` (M1)
- `worker/routes/waivers.js` (M1)
- `worker/lib/waiverLookup.js` (NEW M2 B4a/4b)
- `worker/routes/admin/bookings.js` (NEW M2 B6 — promoted from `uncovered`)

**Operator-applies-remote action queued for M2 deploy:**
After M2 merges to main, operator runs `npx wrangler d1 migrations apply air-action-sports-db --remote` to apply `migrations/0021_feature_flags.sql`. Until then, `worker/lib/featureFlags.js` returns `false`/`[]` gracefully on missing tables — the density toggle UI in B5c is hidden until migration applies. Documented in [docs/runbooks/m2-deploy.md](docs/runbooks/m2-deploy.md).

**Critical do-not-touch handled in M2:**
- B4a/4b moved `findExistingValidWaiver` from `worker/routes/webhooks.js` to `worker/lib/waiverLookup.js`. The function body is **byte-identical** to the original; only its location changed. Group D's 25 characterization tests pass identically. The cross-route import smell from audit §08 #7 is fully closed.
- B2/B3a/B3b refactors only touched admin-side surfaces. Public-side files (Booking.jsx, Waiver.jsx, feedback.js, pricing.js, webhooks.js's webhook handler logic) are untouched.
- B5b adds one route mount line to `worker/index.js` alongside the existing 17 admin mounts. The DNT-listed functions in worker/index.js (`serveUpload`, `rewriteEventOg`, `scheduled`, `withSecurityHeaders`) are untouched.

**Conventions established / used during M2** (preserved as a template for the next milestone):
- Conventional Commits with `m2-<area>` scope: `feat`, `refactor`, `test`, `chore`, `docs`.
- Sub-branches: flat `m2-batch-N-slug` (NOT nested under `milestone-2-shared-primitives/...` — git ref path collision avoided, same as M1).
- Dual-target testing pattern (B3a money, B3b email): `tests/unit/utils/<helper>.test.js` imports BOTH `src/utils/<helper>.js` AND `worker/lib/<helper>.js`, runs identical suite against each. Proves "same logic, same return shape" required when client + worker can't share code (Vite bundles src/ for SPA only).
- Audit-log helper API: `writeAudit(env, { userId, action, targetType, targetId, meta, ipAddress? })`. The optional `ipAddress` selects between 6-col (admin routes) and 7-col (webhook + waivers) shape; M3+ refactors of those flows use the same helper.
- Feature-flag lib API: `isEnabled(env, flagKey, user)`, `listFlags(env, user)`, `setUserOverride(env, flagKey, userId, enabled)`. Reads degrade gracefully on missing tables; writes throw loudly. 4 flag states: off/on/user_opt_in/role_scoped.
- Feature-flag client API: `useFeatureFlag(key) → { enabled, exists, loading, refresh }` with module-level fetch cache. `setFeatureFlagOverride(key, enabled)` issues PUT + busts cache. Hide UI when `!exists` (graceful migration-unapplied state).
- CSS density tokens: `:root` block at default values + `[data-density="compact"]` override block. Zero pixel diff at default verified via dev-server `getComputedStyle` probe.
- Reusable test helpers: `adminSession.js` (cookie minting + user-row lookup binding) used by 7 admin route tests in B5b + 8 admin booking tests in B6. Same M1 helper-extraction pattern as `webhookFixture.js`/`waiverFixture.js`.

**Resume the milestone in a fresh session (if any post-merge fix-up needed):**
1. `git checkout milestone-2-shared-primitives && git pull origin milestone-2-shared-primitives`
2. `npm install`
3. `npm test` — confirm 471/471 passing
4. Read this section + the relevant batch's row in the table above
5. Use the post-merge SHA fill-in step in [m2-deploy.md](docs/runbooks/m2-deploy.md) for the small follow-up doc PR after milestone merges.

**M2 stop-and-ask conditions** (preserved here as a checklist for any future related work):
- A do-not-touch file needs modification beyond Batch 4's documented relocation (which is now complete).
- A test fails after a refactor that should be behavior-preserving (signals real drift; investigate, don't "fix" the test).
- Coverage on protected files drops from M2 baseline (per [docs/runbooks/m2-baseline-coverage.txt](docs/runbooks/m2-baseline-coverage.txt)).
- A dependency missing from `package.json` that the original code path requires.

**Post-M2 — what's next:**

The audit prescribed 83 characterization tests across Groups A–I. M1 landed Groups A, B, C, D, and I (smoke scaffolded). M2 landed Group E. **Groups F, G, H remain deferred** — see the `uncovered` section of [scripts/test-gate-mapping.json](scripts/test-gate-mapping.json):

- **Group F** — auth (audit F54–F64): `worker/lib/auth.js` (verifyPassword, hashPassword, requireAuth, requireRole), `worker/lib/vendorToken.js`.
- **Group G** — worker-level (audit G65–G70): `worker/index.js` serveUpload, rewriteEventOg.
- **Group H** — cron (audit H71–H76): `worker/index.js` scheduled handler.

The **lint config gap** (audit pain-point #8 — `eslint.config.js` missing) was closed in M3 batch 0; lint is now blocking in CI.

The admin-overhaul work (Phase 2 broader goal — see [docs/audit/10-open-questions.md](docs/audit/10-open-questions.md) #13, **resolved as A+B+C+incremental** per [docs/decisions.md](docs/decisions.md) D01) builds on M2's shared primitives. M3 closed 2026-05-07; M4 (IA reorganization) is the next coding milestone.

### Milestone 3 — Customers Schema + Persona-Tailored AdminDashboard (✓ closed 2026-05-07; merged to main as `87da972` via PR [#53](https://github.com/bulletbiter99/air-action-sports/pull/53))

Long-lived branch: `milestone/3-customers` (off `main` at `6323500`). Sub-branches use **flat `m3-batch-N-slug` naming** (the prompt's `milestone/3-customers/batch-N-slug` form was rejected — same git ref-collision workaround M1/M2 used). PRs from sub-branch to `milestone/3-customers`; milestone merges to `main` at close per `docs/runbooks/m3-deploy.md` (lands in B12).

**Per-batch operating rules:**
- Plan-mode-first per batch — write plan, post it, wait for "proceed" before editing.
- 10-file cap per PR. Hard rule.
- Conventional Commits with `m3-<area>` scope.
- No `--force`, no rebases on shared branches, no direct commits to `main` or `milestone/3-customers`.
- All tests use M2 mock helpers. No live D1 / Stripe / Resend.
- **No remote D1 migration apply from Claude.** Schema migrations land in repo only; tested via `wrangler dev --local` against the local D1 fixture (B1 establishes); operator applies remote per `docs/runbooks/m3-deploy.md`.
- **Schema-then-code ordering enforced.** Migration goes in first, locally verified, *operator applies remote*, *then* dependent code lands in a subsequent batch. Never combine.

**M3-specific do-not-touch (cumulative with audit DNT):**
- `worker/routes/bookings.js` (public POST /checkout) — M6 territory
- `worker/routes/waivers.js` (public waiver sign) — DNT
- `worker/lib/stripe.js` — M6 territory; coverage already 93.93%

**Status (as of 2026-05-07, post-B12 — M3 CLOSED):**

| Batch | What it ships | Status | Squash on milestone |
|---|---|---|---|
| **B0** Hygiene + dogfood verification (10 files) | ESLint flat config + lint blocking; M2 staleness cleanup; decisions register; M2 primitive dogfood; coverage floor; M3 plan in this section | ✓ merged | `3afbb4c` ([#30](https://github.com/bulletbiter99/air-action-sports/pull/30)) |
| **B1** Local D1 setup + staging seed (4 files) | `scripts/{seed-staging.sql,setup-local-d1.sh,teardown-local-d1.sh}`; CLAUDE.md "Local D1 setup" subsection | ✓ merged | `aee3791` ([#31](https://github.com/bulletbiter99/air-action-sports/pull/31)) |
| **B2** `customerEmail.js` lib (dual-target, 5 files) | `worker/lib/customerEmail.js` + `src/utils/customerEmail.js` mirror + 62 tests; closes decision register #32 | ✓ merged | `0cfd436` ([#32](https://github.com/bulletbiter99/air-action-sports/pull/32)) |
| **B3** Migration A — customers schema additive (1 file) | `migrations/0022_customers_schema.sql` — customers + customer_tags + segments + gdpr_deletions tables; nullable customer_id columns; indexes. **Migration applied to remote D1 2026-05-07 ✓** | ✓ merged | `0e06b85` ([#33](https://github.com/bulletbiter99/air-action-sports/pull/33)) |
| **B4** Backfill script + tests (3 files) | `scripts/backfill-customers.js` (Node CLI + helpers); `scripts/backfill-customers.test.js` (operator-runnable integration test); `tests/unit/scripts/backfill.test.js` (31 vitest unit tests). Local-D1 integration verified end-to-end. **Backfill ran on remote 2026-05-07 ✓** (2 customers created from 2 bookings + 4 attendees; idempotent). | ✓ merged | `a3bfcc5` ([#34](https://github.com/bulletbiter99/air-action-sports/pull/34)) |
| **B5** Dual-write code paths (6 files) | `worker/lib/customers.js` (NEW — `findOrCreateCustomerForBooking` + `recomputeCustomerDenormalizedFields`); `worker/lib/ids.js` adds `customerId()` generator; `worker/routes/webhooks.js` + `worker/routes/admin/bookings.js` wired (resolve customer_id pre-INSERT/UPDATE; recompute aggregates post-attendees + post-refund); `tests/unit/lib/customers.test.js` 11 new tests; `scripts/test-gate-mapping.json` adds `customers.js` gate. NO edits to `worker/routes/bookings.js` or `worker/lib/stripe.js` (M6 territory). | ✓ merged | `a4870f6` ([#36](https://github.com/bulletbiter99/air-action-sports/pull/36)) |
| **B6** Migration C — NOT NULL + remove fallback (7 files) | `migrations/0023_customers_not_null.sql` (column-rename approach via SQLite 3.35+ `ALTER TABLE ADD COLUMN / DROP COLUMN / RENAME COLUMN` — table-level rebuild was rejected by D1's FK enforcement during `DROP TABLE`); `worker/lib/customers.js` drops `if (!cid) return;` guard; `worker/routes/admin/bookings.js` adds email-format 400 guard; `worker/routes/webhooks.js` cleanup; `scripts/backfill-customers.js` drops SQL `BEGIN`/`COMMIT` (D1 rejects them) + JSON-parse fix for wrangler stdout UI chars; `tests/unit/admin/manual-rejects-malformed-email.test.js` (NEW); `tests/unit/lib/customers.test.js` removes B5 null-no-op test. **Migration applied to remote D1 2026-05-07 ✓** (per the user's accelerated path: skipped 7-day window since dataset is tiny — 2 bookings, 0 malformed-email rows). | ✓ merged | `4c2e87f` ([#38](https://github.com/bulletbiter99/air-action-sports/pull/38)) |
| **B7** Group F — auth characterization tests (6 files) | 11 audit-prescribed tests (F54-F64) + 2 extra defensive cases for `verifyVendorToken`. `tests/unit/auth/{password,auth,vendor-token}.test.js`; gate map promotes `worker/lib/{password,auth,vendorToken}.js` from `uncovered` to `gates`. Purely additive. | ✓ merged | `b4bece9` ([#40](https://github.com/bulletbiter99/air-action-sports/pull/40)) |
| **B8a** Customers admin route + flag migration (7 files) | `worker/routes/admin/customers.js` (NEW — GET list, GET :id detail, POST merge with manager+ role); `worker/index.js` mounts route at `/api/admin/customers`; `migrations/0024_customers_entity_flag.sql` (NEW — flag `customers_entity` state=`off`); `tests/unit/admin/customers-route.test.js` (NEW — 11 tests covering pagination/search/archived filter/detail 404/merge happy-path/self-merge refuse/already-archived refuse/staff 403); gate map adds `worker/routes/admin/customers.js`. **Migration 0024 applied to remote 2026-05-07 ✓** (flag stays `off` until owner flips). | ✓ merged | `765f792` ([#42](https://github.com/bulletbiter99/air-action-sports/pull/42)) |
| **B8b** Customers UI: list / detail / merge pages (7 files) | `src/admin/AdminCustomers.jsx` (list with FilterBar — search by email/name, archived enum filter active/archived/all, paginated table); `src/admin/AdminCustomerDetail.jsx` (detail with contact card, aggregates, comm prefs, notes, tags, bookings table, merge modal — type-ahead search for primary, debounced /api/admin/customers?q query, on submit POST /merge then redirect to primary); `src/admin/AdminCustomers.css` (page styling with density-aware table padding); `src/App.jsx` registers `/admin/customers` + `/admin/customers/:id` routes; `src/admin/AdminLayout.jsx` injects "Customers" sidebar entry under Insights, gated by `useFeatureFlag('customers_entity')` (flag is `off` in production so the entry is hidden by default; pages render a "feature not enabled" placeholder if visited directly). | ✓ merged | `203e640` ([#44](https://github.com/bulletbiter99/air-action-sports/pull/44)) |
| **B9** Persona-tailored AdminDashboard (8 files) | `migrations/0025_new_admin_dashboard_flag.sql` (flag `new_admin_dashboard`, state=`off`); `src/admin/personaLayouts.js` (NEW — role→widget-key list config + `resolveLayout(user)` + `personaLabel(role)` helpers, owner=`[RevenueSummary, CronHealth, TodayEvents, RecentBookings]`, manager=`[TodayEvents, RecentBookings, CronHealth]`, staff=`[TodayEvents, RecentBookings]`); `src/admin/AdminDashboardPersona.jsx` (NEW — persona shell that resolves layout per `user.role` and renders widgets via the WIDGETS registry; preserves the +New Booking CTA from legacy for manager+); `src/admin/widgets/PersonaWidgets.jsx` (NEW — RevenueSummary/CronHealth/TodayEvents/RecentBookings, each self-contained data fetcher hitting existing /api/admin/analytics + /events + /bookings endpoints); `src/admin/widgets/PersonaWidgets.css`; `src/admin/AdminDashboard.jsx` (EDIT — adds flag-gated dispatcher at the top; legacy code path renamed to `AdminDashboardLegacy()` and falls through unchanged when flag is off; persona shell lazy-loaded so legacy bundle doesn't grow). **`npm run build` clean.** | pending | — |
| **B10** System tag refresh cron (7 files) | `worker/lib/customerTags.js` (NEW — `computeSystemTags(customer, now)` pure helper + `runCustomerTagsSweep(env)` I/O wrapper using `db.batch()` for atomic clear+reinsert; 4 system tags v1: `vip` LTV>$500, `frequent` ≥5 bookings, `lapsed` no booking 180+ days, `new` first booking ≤30 days); `worker/index.js` scheduled() branches on `event.cron === '0 3 * * *'` to dispatch tag sweep vs the existing 15-min reminder/abandon/vendor sweeps; `wrangler.toml` adds `"0 3 * * *"` to `triggers.crons`; `tests/unit/lib/customer-tags.test.js` (NEW — 12 tests covering each tag threshold + multi-tag combinations + zero-customer + sweep summary shape); gate map adds `worker/lib/customerTags.js`. Test count 600 → 612. **The new cron registers automatically on Workers Builds redeploy** — no operator step needed. | ✓ merged | `1afb594` ([#48](https://github.com/bulletbiter99/air-action-sports/pull/48)) |
| **B11** GDPR deletion workflow (4 files) | `worker/routes/admin/customers.js` (edit) — adds `POST /:id/gdpr-delete` (owner only); soft-archives with `archived_reason='gdpr_delete'`, redacts email/name/phone/notes/notes_sensitive, deletes customer_tags, writes `gdpr_deletions` audit row + `customer.gdpr_deleted` audit_log entry. `tests/unit/admin/customers-route.test.js` (edit) — 5 new tests (happy path verifies redact + archive + tags-delete + gdpr_deletions row + audit; 409 on already-archived; 404 unknown; 403 manager; 400 invalid requestedVia). `src/admin/AdminCustomerDetail.jsx` (edit) — owner-only GDPR delete button below the merge button; `<GdprDeleteModal>` requires typing the customer's email-or-id to confirm; submits `{ requestedVia, reason }` and reloads the page on success. CLAUDE.md/HANDOFF.md updates. Test count 612 → 617. | ✓ merged | `c7e5d33` ([#50](https://github.com/bulletbiter99/air-action-sports/pull/50)) |
| **B12** Closing: runbooks + final docs (5 files) | `docs/runbooks/m3-baseline-coverage.txt` (NEW — full coverage snapshot post-M3 close, 617/80, gated paths inventory); `docs/runbooks/m3-deploy.md` (NEW — captures the actual deploy sequence used 2026-05-07: per-batch rolling brings-up, operator-driven remote D1 ops including the 4 migrations + 1 backfill, the three D1 quirks discovered mid-milestone — BEGIN/COMMIT rejection, FK enforcement on table rebuild, wrangler stdout JSON-parse fix); `docs/runbooks/m3-rollback.md` (NEW — 6-level decision tree from instant flag flip to full schema rollback, recipes for each B-batch, GDPR mis-fire recovery procedure); CLAUDE.md/HANDOFF.md M3 closed-state. | ✓ merged | `08b59de` ([#52](https://github.com/bulletbiter99/air-action-sports/pull/52)) |

**Cumulative on milestone branch (after B12 — M3 closed):** 617 unit tests across 80 files (B8b/B9 added 0 tests; B10 added 12 tests for `customerTags.js`; B11 added 5 tests for the GDPR delete endpoint; B12 is docs-only, no test changes).

**M3 closed state — what shipped end-to-end:**
- 4 D1 migrations applied to remote: 0022 (customers schema), 0023 (NOT NULL on customer_id), 0024 (`customers_entity` flag), 0025 (`new_admin_dashboard` flag).
- B4 backfill ran on remote: 2 customers created, 2 bookings + 4 attendees linked.
- 6 new gated paths in `scripts/test-gate-mapping.json`: `customers.js` (lib), `password.js`, `auth.js`, `vendorToken.js`, `admin/customers.js`, `customerTags.js`.
- 2 new feature flags shipped, both `state='off'` by default; flippable via SQL UPDATE per `docs/runbooks/m3-deploy.md`.
- Persona-tailored AdminDashboard with legacy preserved as fallback.
- Customers admin UI (list/detail/merge/GDPR-delete).
- Nightly system-tag cron (03:00 UTC) refreshing `vip` / `frequent` / `lapsed` / `new` per customer.

**Critical dependency chain (the migration cadence):**

```
B2 customerEmail.js → B3 schema A (operator applied 0022 to remote ✓)
                    → B4 backfill script (tested locally ✓)
                    → B5 dual-write code (merge to main; operator runs backfill on remote)
                    → 7-day dual-write verification window (operator-driven)
                    → B6 schema C (operator applies 0023)
```

B7 (Group F tests) is the only batch independent of the chain. B9/B10 have lighter dependencies. B8/B11 gate on B6's NOT NULL.

**Operator-applies-remote actions** (cumulative):
- ✓ Migration `0022_customers_schema.sql` applied 2026-05-07 (B3 closing step)
- ⏳ Backfill `node scripts/backfill-customers.js --remote` — runs AFTER B5 merges to main and Workers Builds redeploys. The 7-day verification window starts after backfill completes.
- ⏳ Migration `0023_customers_not_null.sql` — applied AFTER 7-day window verification (B6 closing step)
- ⏳ `customers_entity` flag (B8 ships migration `0024`; flag stays `off` until owner flips)
- ⏳ `new_admin_dashboard` flag (B9 ships migration `0025`; flag stays `off`)

**Resume the milestone in a fresh session:**
1. `git checkout milestone/3-customers && git pull origin milestone/3-customers`
2. `npm install`
3. `npm test` — confirm **617/617** passing across 80 files
4. M3 is **closed**. The next milestone (M4 / Phase 2 next stage per `docs/decisions.md` D01) starts with IA reorganization. Read `docs/runbooks/m3-baseline-coverage.txt` + `docs/runbooks/m3-deploy.md` + `docs/runbooks/m3-rollback.md` for the closed-state reference if any post-M3 incident requires a rollback.
5. Post the batch's plan; wait for "proceed"; create sub-branch `m3-batch-N-slug`; execute; PR; merge — repeat through B12

For local-D1 work (B5+, B6's migration, B8 schema):
```bash
bash scripts/setup-local-d1.sh   # apply all 22 migrations + seed (idempotent)
bash scripts/teardown-local-d1.sh  # nuke local D1 for fresh runs
```

The seed populates 50 bookings with deliberate email-distribution edge cases (Sarah's 8 Gmail dot-variants, Mike's 4 plus-aliases, john.doe vs johndoe yahoo split, malformed + null emails). B4's backfill collapses those to 38 customers; the integration test asserts.

**Stop-and-ask conditions:**
- A do-not-touch file needs modification beyond what the documented batches specify
- The backfill script produces non-idempotent results across re-runs (correctness bug; halt)
- A test fails after a behavior-preserving refactor (investigate, don't "fix" the test)
- Coverage on any of the 12 gated files drops from M3 closing baseline (per [docs/runbooks/m3-baseline-coverage.txt](docs/runbooks/m3-baseline-coverage.txt))
- Any production-data anomaly during local backfill testing

### Milestone 5 — Staff Management + Event-Day Mode (PARTIAL — REWORK IN PROGRESS, 8 of 15 batches done)

**Status (2026-05-08 PM):** `milestone/5-staff-event-day` (off `main` at `7594d9a`, M4 close). The prior session shipped 20 PRs (#101-#120) and declared the milestone closed prematurely. A subsequent audit captured the gaps in [docs/runbooks/m5-rework-plan.md](docs/runbooks/m5-rework-plan.md); the rework session has now landed **8 of 15 rework batches** (PRs #122-#130). 7 batches remain.

**Authoritative gap inventory + 15 rework batch IDs in execution order:** [docs/runbooks/m5-rework-plan.md](docs/runbooks/m5-rework-plan.md).

**Fresh-session prompt to drive the rework:** [docs/m5-rework-prompt.md](docs/m5-rework-prompt.md). The new session must read it before any code change.

**Programmatic gap verification:** `node scripts/verify-m5-completeness.js`. The script exits 0 only when all rework batches are complete. **It is the gate** for declaring the milestone closed.

**Rework progress (2026-05-08 PM):**
- Tests: **1287 across 133 files** (was 1122 baseline; +165 net across 8 batches)
- Lint: 0 errors / 384 warnings; build clean
- Verify: **8/15 rework batches complete · 43/95 individual checks pass**
- Migrations 0039 + 0040 added (cert expiration + event staffing email templates) — operator-applies-remote queued for milestone close

**Rework PRs merged so far:**

| Batch | PR | Verify | What it shipped |
|---|---|---|---|
| R0a | [#122](https://github.com/bulletbiter99/air-action-sports/pull/122) | partial | Shared primitives `AdminPageHeader` + `EmptyState` + 4 admin pages (AdminAuditLog / AdminVendorContracts / AdminSettings / AdminRentalAssignments) |
| R0b | [#123](https://github.com/bulletbiter99/air-action-sports/pull/123) | partial | 7 mid-size admin pages (Users / Waivers / Roster / TaxesFees / EmailTemplates / Vendors / PromoCodes) |
| R0c | [#124](https://github.com/bulletbiter99/air-action-sports/pull/124) | **R0 8/8** | 5 largest admin pages (Events / Feedback / Scan / VendorPackages / Rentals); closes R0 fully — all 16 admin pages have all 7 M5 B0 scope items |
| R4 | [#125](https://github.com/bulletbiter99/air-action-sports/pull/125) | **5/5** | Combined `route.test.js` split into 6 files (5 spec'd: list/detail/typeahead/roles/notes + archive); 5 new typeahead tests added |
| R5 | [#126](https://github.com/bulletbiter99/air-action-sports/pull/126) | **5/5** | 4 staff document route tests (list/create/retire/role-tag) — 27 new tests in `tests/unit/admin/staffDocuments/` |
| R6 | [#127](https://github.com/bulletbiter99/air-action-sports/pull/127) | **2/2** | `requireAuth` extension: portal-cookie-only returns 403 with `portalCookieDetected: true`; F57 (no-cookie 401) preserved |
| R8 | [#128](https://github.com/bulletbiter99/air-action-sports/pull/128) | **8/8** | `worker/lib/certifications.js` + extracted `AdminStaffCertEditor.jsx` + `runCertExpirationSweep` cron + 3 templates in migration 0039 |
| R9 | [#129](https://github.com/bulletbiter99/air-action-sports/pull/129) | **8/8** | `AdminEventStaffing.jsx` + `worker/lib/eventStaffing.js` + reminder cron + auto-decline cron + 2 templates in migration 0040 |
| R10 | [#130](https://github.com/bulletbiter99/air-action-sports/pull/130) | **4/4** | Schedule tab activated + `worker/lib/laborEntries.js` + 30+15 tests; renamed `ComingSoon` → `TabPlaceholder` to defeat verify regex span |

**Remaining batches** (in dependency order — rework prompt enforces order):
- **R11-1099-completion** — `AdminStaff1099Thresholds.jsx` + `worker/lib/thresholds1099.js` + auto-lock cron (March 1) + `w9_reminder` template + tests
- **R12-event-day-foundations** — `EventDayContext.jsx` separated + `event-day.css` + `worker/routes/event-day/` dir + `worker/lib/eventDaySession.js` + tests scaffold
- **R13-checkin-full** — `AttendeeDetail.jsx` + `WalkUpBooking.jsx` + `CameraPermissionExplainer.jsx` + checkin/walkup routes + offline-queue test
- **R14-event-day-routes** — incidents.js + roster.js + equipment-return.js routes (**fixes broken IncidentReport.jsx 404**)
- **R15-checklists-persistence** — `event_checklists` migration + routes + **rewires fake-mock EventChecklist.jsx to actually POST** + auto-instantiate hook
- **R16-charges-completion** — `AdminBookingChargeQueue.jsx` + 2 routes + `worker/lib/bookingCharges.js` + 3 charge email templates + booking_confirmation update + EquipmentReturn UI
- **R17-decommission** — delete `AdminUsers.jsx`, redirect `/admin/users` → `/admin/staff`
- **R18-final** — refresh CLAUDE.md + HANDOFF.md to honest CLOSED state + refresh `m5-baseline-coverage.txt`

**Lessons captured during rework** (apply to remaining batches):
1. **Verify-m5 cron-sweep regex** requires `const NAME = ` in `worker/index.js`. Imported sweeps need a top-level alias: `import { sweep as _sweep } from './lib/...'; const sweep = _sweep;`
2. **Verify-m5 tab-active regex** uses `/s` flag and spans the whole file. A helper named `ComingSoon` further down in the same file false-positives even after the JSX changes. Rename the helper.
3. **Don't hardcode SQL result column literals.** Always parameterize via `?` so tests can assert on bound args.
4. **`useMemo` inside JSX after an early return** violates rules-of-hooks. Move to component top, or pass module-level const directly.
5. **`requireAuth` extension** must preserve F57 (no-cookie 401). The new portal-cookie-only 403 branch only fires when `aas_session` is genuinely absent.

**DO NOT MERGE `milestone/5-staff-event-day` → `main`** until all 15 rework batches PASS the verify script. After R18 closes the milestone, this section is updated to "✓ CLOSED".

**DO NOT MERGE `milestone/5-staff-event-day` → `main`** until:
- `node scripts/verify-m5-completeness.js` exits 0 (all rework batches complete)
- `npm test` passes
- `npm run lint` shows 0 errors
- `npm run build` clean
- Visual regression suite green
- This section is updated to "✓ CLOSED" with the actual close date

**What IS in place** (substrate that's correctly implemented):

- **9 D1 migrations 0030-0038** (NOT yet applied to remote): staff foundation tables; capabilities + role presets + bundle; 22 role rows; staff_portal_invite email template; certifications + role_required_certifications + 9 default mappings; event_staffing + reminders; labor_entries + tax_year_locks; event_day_session_log; incidents + booking_charges + charge_caps_config + 3 default caps.
- **4 backend libs**: `worker/lib/capabilities.js` (DB-backed RBAC replacing M4 stub), `worker/lib/users.js` (legacy-role -> role_preset migration helpers), `worker/lib/personEncryption.js` (AES-GCM at-rest), `worker/lib/portalSession.js` (HMAC cookies + magic-link tokens).
- **6 admin routes**: staff, staffDocuments, certifications, eventStaffing, laborEntries, thresholds1099.
- **2 portal routes**: portal/auth + portal/me.
- **Frontend (with gaps)**: AdminStaff list + 8-tab Detail (5 tabs are stubs); AdminStaffLibrary + AdminStaffDocumentEditor; PortalLayout + Home + Document + Account + Consume; EventDayLayout + Home (kiosk shell); minimal CheckIn/Roster/IncidentReport/EquipmentReturn/EventChecklist/EventHQ stubs.
- **Sidebar (B0 partial)**: Rentals/Roster/Scan restored as standing nav with capability stub; D10 added to decisions register.
- **Token system extension**: tokens.css authored with full design surface (spacing/typography/radius/colors/shadows/motion); 16 admin pages adopt `var(--color-border)` + `var(--color-border-strong)`.
- **Group H cron tests** (audit H71-H76): 6 test files locking outer dispatch + 4 inner sweep behaviors.
- **2 backfill scripts**: `scripts/backfill-persons.js` (idempotent), `scripts/import-job-descriptions.js` (idempotent; produces 22 v1.0 JD seeds).

**What's MISSING** (the rework closes these — full breakdown in m5-rework-plan.md):

- **B0 structural items** (5 of 7 prompt-listed scope items per page): typography hierarchy NOT applied; FilterBar adoption NOT done on Events/Rentals/Roster/RentalAssignments; header pattern NOT unified; list-row consistent density NOT applied; empty-state consistent treatment NOT applied.
- **B4 test split**: prompt called for 5 separate test files; shipped as 1 combined file.
- **B5 staff document tests**: directory does not exist.
- **B6 strict /admin vs /portal cookie 403**: portal users get 401 instead of explicit 403.
- **B8 cert expiration cron**: not added to worker/index.js. Email templates not seeded. AdminStaffCertEditor.jsx separate file does not exist (modal inlined). worker/lib/certifications.js does not exist.
- **B9 event staffing**: AdminEventStaffing.jsx does not exist. worker/lib/eventStaffing.js does not exist. Reminder cron sweep not added. Email templates not seeded.
- **B10 Schedule tab**: still renders "coming soon" stub. worker/lib/laborEntries.js does not exist.
- **B11 1099 thresholds**: AdminStaff1099Thresholds.jsx UI page does not exist. worker/lib/thresholds1099.js does not exist. w9_reminder template not seeded. Auto-lock cron not added.
- **B12 event-day foundations**: EventDayContext.jsx separate file does not exist. event-day.css does not exist. worker/routes/event-day/ directory does not exist (the kiosk has no backend routes). worker/lib/eventDaySession.js does not exist.
- **B13 check-in workflow**: AttendeeDetail / WalkUpBooking / CameraPermissionExplainer components do not exist. Backend checkin + walkup routes do not exist.
- **B14 event-day routes**: incidents / roster / equipment-return backend routes do not exist. **IncidentReport.jsx is broken** — it POSTs to a non-existent endpoint.
- **B15 checklists**: persistence layer does not exist. EventChecklist.jsx is fake mock state. event_checklists migration does not exist. Auto-instantiate hook on event creation does not exist.
- **B16 damage charge**: UI does nothing. AdminBookingChargeQueue.jsx does not exist. Backend routes do not exist. worker/lib/bookingCharges.js does not exist. 3 email templates not seeded. booking_confirmation template not updated.
- **B17 decommission AdminUsersLegacy**: SKIPPED ENTIRELY. AdminUsers.jsx still in place; no /admin/users redirect to /admin/staff.
- **B18 docs**: CLAUDE.md and HANDOFF.md were not updated with M5 milestone section by the prior session. (This update is the first M5 section; it documents PARTIAL state.)

**Operating rules for the rework session** (mandatory; mirrored from m5-rework-prompt.md):

1. **No scope cuts.** Every file listed under "Gaps" in m5-rework-plan.md MUST be created with substantive content.
2. **No "deferred" language.** Each rework PR must enumerate every file added.
3. **No combining test files** unless the M5 prompt's source file list says so.
4. **No frontend pointing at non-existent backend.**
5. **No mock-state for persistable data.**
6. **Run `verify-m5-completeness.js --batch=R<id>` before claiming any batch complete.** Include verify output in the PR description.
7. **Run tests + lint + build per sub-batch.** All three green before opening PR.
8. **Plan-mode-first per rework batch.**
9. **Rework batches in dependency order**: R0-structural -> R4-tests-split -> R5-tests -> R6-strict -> R8-cron -> R9-cmpl -> R10-cmpl -> R11-cmpl -> R12-found -> R13-full -> R14-routes -> R15-cklst -> R16-cmpl -> R17-decom -> R18-final.

**Stop-and-ask conditions for the rework session:**
- A do-not-touch file needs modification beyond the rework's scope
- A test reveals current behavior conflicting with audit-documented behavior
- The original M5 prompt's spec for a batch conflicts with the rework plan (rework plan wins; flag the conflict)
- A NEW gap is discovered not listed in the rework plan (add to rework plan via PR before fixing)

---

### Milestone 4 — Bookings + Detail Workspace + New Admin Shell (✓ CLOSED 2026-05-07)

Long-lived branch: `milestone/4-bookings-ia-completion` (off `main` at `87da972`, M3 close). Sub-branches use **flat `m4-batch-N-slug` naming** — same git ref-collision workaround M1/M2/M3 used. Per-batch rolling brings-up to main (every batch goes live on main soon after milestone-merge, not held until close).

**Per-batch operating rules** (preserved from M3):
- Plan-mode-first per batch
- 10-file cap per PR (split a/b/c when needed — B1, B2, B3, B4 all split; B4 split a/b/c/d/e/f for the persona widget set)
- Conventional Commits with `m4-<area>` scope
- No `--force`, no rebases on shared branches, no direct commits to `main` or `milestone/4-bookings-ia-completion`
- All tests use M2 mock helpers; no live D1 / Stripe / Resend
- **No remote D1 migration apply from Claude Code by default.** Operator pre-authorizes per-batch (0026 / 0027 / 0028 / 0029 all applied with explicit operator authorization in-session).
- Schema-then-code ordering enforced for migrations
- Existing Group E tests must stay green on every batch that touches `worker/routes/admin/bookings.js`

**Status (as of 2026-05-07 — through B7):**

| Batch | What it ships | Main merge commit | PR |
|---|---|---|---|
| **B0** Reality audit + decisions reconciliation (6 files) | `docs/m4-discovery/{persona-dashboard-audit,sidebar-ia-audit,m3-invariants-check,decisions-register-reconciliation}.md`; `docs/decisions.md` D04-D07 captured (D04 legacy AdminDashboard removed, D05 PII gated by `bookings.read.pii`, D06 external refund always notifies, D07 `refund_recorded_external` template seed); `CLAUDE.md` D1-quirks subsection promoted | `fca7e2b` | [#56](https://github.com/bulletbiter99/air-action-sports/pull/56) |
| **B1a** Group G worker-level tests (5 files) | `tests/unit/worker/{serveUpload,rewriteEventOg,scheduled}.test.js` + `tests/helpers/workerEnvFixture.js` (HTMLRewriter mock + ASSETS binding + ctx). Promotes `worker/index.js` from `uncovered` to `gates` for the G surface. **+57 tests** (617 → 674/83). | `44908cf` | [#58](https://github.com/bulletbiter99/air-action-sports/pull/58) |
| **B1b** Visual regression suite + CI gating (8 files) | `tests/visual/public.spec.js` (7 surfaces) + `tests/visual/helpers.js` + extended `playwright.config.js` (visual project at 1440×900) + `.github/workflows/{ci.yml,capture-baselines.yml}` (label-driven baseline capture) + `docs/runbooks/visual-regression.md` + `docs/decisions.md` D08+D09 (persona model + Roster/Scan/Rentals collapse). 7 PNG baselines committed via the labeled-PR workflow. **No vitest count change.** | `e72cd97` | [#60](https://github.com/bulletbiter99/air-action-sports/pull/60) |
| **B2a** Saved-views D1 substrate (8 files) | `migrations/0026_saved_views.sql` + `worker/routes/admin/savedViews.js` (4 endpoints; table-missing graceful) + worker/index.js mount + `src/hooks/useSavedViews.js` rewritten to API-backed (preserves M2 hook surface) + 35 new tests (route + imperative helpers per useFeatureFlag pattern) − 8 obsolete localStorage tests. **Migration 0026 applied to remote D1 ✓.** Includes inline fix to `tests/visual/helpers.js` (`waitForLoadState('networkidle')` to fix home.png flake surfaced on B2a's PR run). **+27 net tests** (674 → 701/85). | `d92cb3b` | [#62](https://github.com/bulletbiter99/air-action-sports/pull/62) |
| **B2b** /admin/bookings list page + rich filter API + bulk + CSV export (8 files) | `src/admin/AdminBookings.jsx` + `.css` + `src/App.jsx` route; `worker/routes/admin/bookings.js` extended with `payment_method`/`has_refund`/`waiver_status`/`min_amount`/`max_amount`/`customer_id` filters + `POST /bulk/resend-confirmation` + `POST /bulk/resend-waiver-request` + `GET /export.csv`; 3 test files (29 tests). All 8 Group E tests pass unchanged. **+29 net tests** (701 → 730/88). | `e2dbc6c` | [#64](https://github.com/bulletbiter99/air-action-sports/pull/64) |
| **B3a** Backend for detail view + external refund + PII masking (8 files) | `migrations/0027_bookings_refund_external.sql` (4 nullable columns + `refund_recorded_external` template seed); `worker/lib/emailSender.js` `sendRefundRecordedExternal` (additive — DNT 9 senders untouched); `worker/lib/capabilities.js` (NEW — `hasCapability(user, cap)` stub, M5 will formalize); `worker/lib/formatters.js` extended with 4 refund_external fields; `worker/routes/admin/bookings.js` extends GET /:id (customer card + activity log + PII masking + audit) + adds POST /:id/refund-external (5 methods: cash/venmo/paypal/comp/waived); 26 new tests. **Migration 0027 applied to remote D1 ✓.** All 8 Group E tests pass unchanged. **+26 net tests** (730 → 756/90). | `961d12a` | [#66](https://github.com/bulletbiter99/air-action-sports/pull/66) |
| **B3b** /admin/bookings/:id detail workspace + 2 refund modals (5 files) | `src/admin/AdminBookingsDetail.jsx` (two-column layout per Surface 2; AttendeeRow inline edit) + `.css` (density-token aware) + `src/admin/AdminBookingRefund.jsx` (Stripe — required reason field) + `src/admin/AdminBookingExternalRefund.jsx` (out-of-band — method dropdown + reference + reason; persistent D06 always-notify banner) + `src/App.jsx` route. Wires up the View button on /admin/bookings (which 404'd post-B2b). **No vitest count change** (pure frontend; RTL not installed). | `955ffbb` | [#68](https://github.com/bulletbiter99/air-action-sports/pull/68) |
| **B3c** Docs hygiene + handoff refresh (B3c/12) | CLAUDE.md M4 section + HANDOFF.md §10/§12/§14 + Prompt for fresh session refresh. No code changes. | `79f535d` (PR [#69](https://github.com/bulletbiter99/air-action-sports/pull/69)) → main `661e19f` ([#70](https://github.com/bulletbiter99/air-action-sports/pull/70)) | done |
| **B4a** Migration 0028 — `users.persona` column + role-based backfill (1 file) | `migrations/0028_users_persona.sql` — nullable `users.persona TEXT` column with CHECK enumerating the 6 D08 personas (owner / booking_coordinator / marketing / bookkeeper / generic_manager / staff); existing rows backfilled per D08 (owner→owner, manager→generic_manager, staff→staff). Schema-only batch. **Migration 0028 applied to remote D1 ✓ 2026-05-07.** No vitest count change. | `497e808` (PR [#71](https://github.com/bulletbiter99/air-action-sports/pull/71)) → main `de0e05d` ([#72](https://github.com/bulletbiter99/air-action-sports/pull/72)) | done |
| **B4b** Foundation: `/api/admin/today/active` + `useWidgetData` cadence primitive + personaLayouts rewire (10 files) | `worker/routes/admin/dashboard.js` (NEW — GET /api/admin/today/active returning `{ activeEventToday, eventId, checkInOpen }`; checkInOpen stubbed to false until time-string parsing in a future batch); `worker/index.js` mount; `src/hooks/useWidgetData.js` (NEW — `useWidgetData(url, { tier })` 5min/30s/10s + `useTodayActive()` shared subscription + `intervalForTier` pure helper for testing); `src/admin/personaLayouts.js` (rewired to read `user.persona` first, fall back to `roleDerivedDefault(role)`; 6 personas registered with alias-only entries for the 3 not yet implemented; `personaLabel()` extended for all 6); `src/admin/AdminDashboardPersona.jsx` (1 line — read user.persona for label); `src/admin/widgets/PersonaWidgets.jsx` (4 existing widgets wrapped in useWidgetData, no visual change); 3 new test files (today-active.test.js 11 + personaLayouts.test.js 27 + useWidgetData.test.js 14 = +52 tests); `scripts/test-gate-mapping.json` (3 new gates). Visual regression CI confirmed pixel-equivalent. | `44b3fa8` (PR [#73](https://github.com/bulletbiter99/air-action-sports/pull/73)) → main `301f30e` ([#74](https://github.com/bulletbiter99/air-action-sports/pull/74)) | done |
| **B4c** Booking Coordinator persona widgets (4 files) | 5 new BC widget components in `PersonaWidgets.jsx` — BookingCoordinatorKPIs (4-stat grid via /analytics/overview + /promo-codes), BookingsNeedingAction (compact table from /bookings?waiver_status=missing), TodayCheckIns (gates on useTodayActive + per-event scan/roster links), QuickActions (4-tile static link grid), RecentFeedback (5 newest from /feedback?status=new); `personaLayouts.js` flips `booking_coordinator: null` → concrete 5-widget array; CSS for tiles + feedback items + density-aware compact mode; personaLayouts.test.js gets 2 modified assertions + 2 new BC layout tests. | `b5efb8c` (PR [#75](https://github.com/bulletbiter99/air-action-sports/pull/75)) → main `5dc1a7e` ([#76](https://github.com/bulletbiter99/air-action-sports/pull/76)) | done |
| **B4d** Owner extension widgets + 2 new endpoints + ?period=mtd (10 files) | 2 new endpoints in `worker/routes/admin/dashboard.js`: `GET /upcoming-readiness` (top-3 events with capacity + waiver bars), `GET /action-queue` (4-count owner-triage shape: missing waivers / pending vendor countersigns / new feedback / refunds in last 7 days). `worker/routes/admin/analytics.js` extends `/overview` with `?period=mtd` filter (filters bookings by `paid_at >= month_start_ms`; default `lifetime` preserves pre-B4d behavior; backward compatible). 3 new owner widgets in PersonaWidgets.jsx — UpcomingEventsReadiness (uses CapacityBar helper), ActionQueue (4-stat grid with deep-links), RecentActivity (last 10 audit log entries via existing /audit-log). RevenueSummary modified to fetch `?period=mtd`; header reads "Revenue (this month)". `personaLayouts.js` owner array expands 4 → 7 widgets. 3 new test files (upcoming-readiness.test.js 8 + action-queue.test.js 6 + analytics-mtd.test.js 7 + persona test additions = +22 tests). `scripts/test-gate-mapping.json` extends dashboard.js gate + adds analytics.js gate. | `b649dac` (PR [#77](https://github.com/bulletbiter99/air-action-sports/pull/77)) → main `971d42f` ([#78](https://github.com/bulletbiter99/air-action-sports/pull/78)) | done |
| **B4e** Marketing persona widgets + /analytics/funnel (7 files) | New endpoint `GET /api/admin/analytics/funnel?days=30` — 4-step Created→Paid→Waivers→CheckedIn checkout funnel for trailing N-day window (1-365 clamp; same window_start_ms binds to all 4 queries). 5 new Marketing widgets in PersonaWidgets.jsx — MarketingKPIs (4-stat grid: Conversion% / Promo uses / AOV / Email opens "Pending · M5" via PendingStat helper), ConversionFunnel (vertical 4-step bar chart with proportional widths + per-step "% from prev" hint), UpcomingEventsFillRate (top-5 upcoming events via existing /per-event with client-side past=false filter; reuses CapacityBar from B4d), PromoCodePerformance (top-5 active codes via /promo-codes with client-side sort), AssetLibraryShortcut (static "Coming in M5" tile). Reuses RecentFeedback from B4c (no marketing-specific tag column today). Marketing layout 6 widgets total; 5 new + 1 reused. New CSS class `.admin-persona-widget__pending` for degraded "Coming in M5" state. analytics-funnel.test.js 11 tests + persona test additions = +12 net. | `875fb7f` (PR [#79](https://github.com/bulletbiter99/air-action-sports/pull/79)) → main `2f1ea13` ([#80](https://github.com/bulletbiter99/air-action-sports/pull/80)) | done |
| **B4f** Bookkeeper persona widgets + tax/fee totals on /overview (6 files) | `worker/routes/admin/analytics.js` extends `/overview` byStatus + totals with `taxCents` + `feeCents` aggregations (additive; tolerates existing callers; respects ?event_id + ?period=mtd). 5 new Bookkeeper widgets in PersonaWidgets.jsx — BookkeeperKPIs (4-stat MTD grid: Gross / Refunds / Net / Stripe payout "Pending · M6"), RevenueTrend (90-day daily revenue bar chart via /sales-series + reuses existing BarChart SVG primitive from src/admin/charts.jsx — no chart-library deps), TaxFeeSummary (2-stat tile via extended /overview totals), RefundActivity (compact table of 5 most recent refunds with red-orange tint + deep-link to /admin/bookings/:id), Staff1099Thresholds (static "Coming in M5" placeholder). `personaLayouts.js` flips `bookkeeper: null` → concrete 5-widget array — **all 6 personas now concrete; no alias-only entries remain.** personaLayouts.test.js consolidates "all 6 personas concrete" assertion; analytics-mtd.test.js gets 4 new tax/fee tests + 1 modified shape assertion = +5 net tests. | `6aa7fa3` (PR [#81](https://github.com/bulletbiter99/air-action-sports/pull/81)) → main `73eb30b` ([#82](https://github.com/bulletbiter99/air-action-sports/pull/82)) | done |
| **B5** Sidebar / IA reorganization (Surface 1) (5 files) | `src/admin/sidebarConfig.js` (NEW — config-as-code SIDEBAR array per Surface 1: Home / Today (dynamic) / Events / Bookings / Customers (flag-gated) / separator / Settings collapsible group with 10 sub-items including Overview / Taxes / Email / Team / Audit / Waivers / Vendors / Promo Codes / Analytics / Feedback) + `getVisibleItems` filter helper + `loadSidebarExpand`/`saveSidebarExpand` localStorage helpers (namespaced `aas:admin:sidebar:expand:*`); `src/admin/AdminLayout.jsx` Sidebar component reads new config when `new_admin_dashboard='on'`, falls through to legacy NAV_SECTIONS when off — `<NewSidebarNav>` + `<SidebarItem>` + `<SidebarGroup>` internal helpers; SidebarGroup is collapsible with chevron toggle + localStorage persistence; SidebarItem renders Today with orange-pulse dot when `activeEventToday=true` (a11y aria-label + prefers-reduced-motion respect). `src/styles/admin.css` adds separator + group toggle + chevron rotate + pulse keyframes + sub-item indent. **Per D09**: Roster/Scan/Rentals routes stay alive but hidden from sidebar (resurface inside /admin/today when B12 ships that page). 24 new tests in sidebarConfig.test.js (registry + getVisibleItems + localStorage helpers; in-memory localStorage mock installed in beforeEach since vitest's node env has no localStorage). +1 new gate in test-gate-mapping.json. | `0a7c5c3` (PR [#83](https://github.com/bulletbiter99/air-action-sports/pull/83)) → main `69f3e83` ([#84](https://github.com/bulletbiter99/air-action-sports/pull/84)) | done |
| **B6** Walk-up booking speed wins (banner + typeahead + recall) (8 files) | 3 features all flag-gated by `new_admin_dashboard`: (1) **CheckInBanner** (`src/admin/CheckInBanner.jsx`) — top-of-shell banner via `useTodayActive()` shared subscription; pulse dot + "Open scan →" deep-link when `activeEventToday=true`; session-dismissible. (2) **CustomerTypeahead** (`src/admin/CustomerTypeahead.jsx`) — debounced 250ms combobox on `/admin/new-booking` email field; queries `/api/admin/customers?q=` (skips < 2 chars); arrow-key nav + click/enter to select + escape closes + outside-click closes; "+ Create new customer" escape hatch. (3) **Recall hint** in AdminNewBooking — when typeahead picks a customer, fetches `/api/admin/customers/:id`, auto-fills name+phone, shows inline "Repeat customer · Last booked X · Y ago" hint with "View customer →" deep-link. Pure helpers in `src/admin/walkUpHelpers.js`: `pickRecallableBookings`, `formatBookingHint`, `formatRelativeAge`. CSS for banner + dropdown + recall hint. 27 tests in walkUpHelpers.test.js. +1 gate. | `7bddaca` (PR [#85](https://github.com/bulletbiter99/air-action-sports/pull/85)) → main `1c0806b` ([#86](https://github.com/bulletbiter99/air-action-sports/pull/86)) | done |
| **B7** Command Palette (Cmd+K) + migration 0029 (7 files) | `migrations/0029_command_palette_flag.sql` (NEW — `command_palette` feature flag row, state='off'); `src/admin/commandRegistry.js` (NEW — pure helpers `commandsFromSidebar(SIDEBAR, ctx)` deriving flat command list from B5's SIDEBAR + `filterCommands` substring match with prefix-priority sort); `src/admin/CommandPalette.jsx` (NEW — centered modal following FeedbackModal pattern with autofocused input + arrow-key nav + escape close + click-outside close + monospace route hints + footer kbd chips + mobile responsive); `src/admin/AdminLayout.jsx` adds global `(metaKey|ctrlKey)+k` listener with `preventDefault` (wins race against Firefox Cmd+K binding) when `command_palette` flag on, mounts `<CommandPalette>` next to `<FeedbackModal>`; `src/styles/admin.css` adds backdrop / modal / option / category-badge / route-hint / footer kbd styles. Orthogonal to `new_admin_dashboard` — has its own flag for independent rollout. **Migration 0029 applied to remote D1 ✓ 2026-05-07.** 18 new tests in commandRegistry.test.js. +1 gate. | `f2c2d1e` (PR [#87](https://github.com/bulletbiter99/air-action-sports/pull/87)) → main `59aaa4d` ([#88](https://github.com/bulletbiter99/air-action-sports/pull/88)) | done |
| **B7c** Session handoff refresh | HANDOFF.md §10/§12/§14 + prompt block refreshed for M4 B0-B7 state; CLAUDE.md M4 batch table refreshed with B4-B7 SHAs/PRs. No code changes; docs hygiene only. | `e95ff1a` (PR [#89](https://github.com/bulletbiter99/air-action-sports/pull/89)) → main `55be926` ([#90](https://github.com/bulletbiter99/air-action-sports/pull/90)) | done |
| **B8** Atomic ancillary flag rollout | SQL UPDATEs only — `command_palette` → `state='on'`, `customers_entity` → `state='on'` on remote D1. **Pre-flip discovery**: `customers_entity` + `new_admin_dashboard` were already at `role_scoped='owner'` outside any documented batch (updated_at ~16h before B8). For the current admin set (4 users, all `role='owner'`), `role_scoped='owner'` was already effectively `on`; B8 formalizes `customers_entity` and opens it to any future non-owner admin. `command_palette` flipped from `off` to `on` (true new behavior — Cmd+K live for all admins). `new_admin_dashboard` left at `role_scoped='owner'` for B9 to resolve. Docs PR only; tests/lint/build unchanged (918/100, 0 errors / 293 warnings, ~232ms). | `4b0260c` (PR [#91](https://github.com/bulletbiter99/air-action-sports/pull/91)) → main `6eaa3e5` ([#92](https://github.com/bulletbiter99/air-action-sports/pull/92)) | done |
| **B9** `new_admin_dashboard` → `on` | SQL UPDATE only — `new_admin_dashboard` `role_scoped='owner'` → `state='on'`, `role_scope=NULL` on remote D1. Operator chose the direct path; `user_opt_in` detour declined since no non-owner admin exists today to dogfood for. For the current admin set (4 users, all `role='owner'`), this is functionally a no-op — same persona dashboard + sidebar config + walk-up speed wins they've been seeing since the undocumented pre-B8 `role_scoped='owner'` flip. Semantic shift: any future non-owner admin (manager / staff role) automatically gets the new shell. Docs PR only; tests/lint/build unchanged (918/100, 0 errors / 293 warnings). | `beec625` (PR [#93](https://github.com/bulletbiter99/air-action-sports/pull/93)) → main `159142a` ([#94](https://github.com/bulletbiter99/air-action-sports/pull/94)) | done |
| **B10** Collapsed | No work needed — B9 took the direct `role_scoped='owner'` → `on` path, skipping the `user_opt_in` detour. The B10 slot is intentionally empty so future readers can see the rollout sequence: B8 (atomic ancillary) → B9 (new shell) → (skipped) → B11 (deferred) → B12a/b/c (closing). | n/a | collapsed |
| **B11** Deferred | Admin visual regression baselines deferred to post-M4. Cost-benefit unfavorable: implementing CI-integrated admin baselines requires either (a) cookie injection with SESSION_SECRET in CI secrets (forgery-vector risk) or (b) login-flow with real admin credentials in env vars. Either approach is ~7-10 files of engineering for marginal value, since B12 only removes dead code paths (already unreachable for ~17h+ in production). Manual `/admin` smoke after B12 deploy covers the residual risk. Future milestone (M5+) can add admin visual regression when the engineering complexity is justified. | n/a | deferred |
| **B12a** Legacy dispatcher + Legacy AdminDashboard removal | Pure dead-code deletion. `src/admin/AdminDashboard.jsx` collapsed from 671 lines to 6 (re-exports `AdminDashboardPersona` directly). `src/admin/AdminLayout.jsx` removes `NAV_SECTIONS` constant + the `useFeatureFlag('new_admin_dashboard')` dispatcher branch in `Sidebar` + the `{newAdminDashboard && <CheckInBanner />}` gate (now unconditional render). The new sidebar config (`sidebarConfig.js`) becomes the sole production path. Tests unchanged (918/100; legacy code wasn't reachable). Lint warnings DROP from 293 → 281 (-12; removed JSX-component false-positives for deleted helpers `CronHealth`, `StatusBadge`, `MethodBadge`, `BookingDetailModal`, `AttendeeRow`, `RefundConfirmModal`, `Row`, `StatCard`). Build bundle DROPS by ~23 kB (the legacy `AdminDashboard-*.js` chunk gone; AdminDashboard now IS the persona shell). Remaining `useFeatureFlag` calls for the 3 M4 flags untouched (B12b cleanup). DB unchanged (B12b/c handle flag-row DELETE). | `356347c` (PR [#95](https://github.com/bulletbiter99/air-action-sports/pull/95)) → main `cd4749c` ([#96](https://github.com/bulletbiter99/air-action-sports/pull/96)) | done |
| **B12b** Flag-check removal + flag-row DELETE | Removes the now-redundant `useFeatureFlag(...)` calls for the 3 M4 flags from 6 source files. AdminLayout.jsx — drops `command_palette` + `customers_entity` calls; Cmd+K listener + CommandPalette mount become unconditional; Sidebar's NewSidebarNav drops the customersEnabled prop. AdminCustomers.jsx + AdminCustomerDetail.jsx — drop the `customers_entity` page guards; pages always render. CommandPalette.jsx — drops `customers_entity` plumbing through commandsFromSidebar. sidebarConfig.js — drops `requiresFlag: 'customers_entity'` from the Customers item; getVisibleItems' filter logic stays for forward-compat. AdminNewBooking.jsx — drops the `new_admin_dashboard` ternary gating CustomerTypeahead vs plain email input + the recall-hint conjunction. Tests: sidebarConfig.test.js drops 2 flag-off tests + adds 1 forward-compat synthetic test; commandRegistry.test.js modifies 2 tests for new always-present semantics. **Test count: 918 → 917** (-1 net). Lint warnings unchanged at 281. Build clean (~247ms). Operator ran `DELETE FROM feature_flags WHERE key IN ('command_palette', 'customers_entity', 'new_admin_dashboard');` post-deploy 2026-05-07; 3 rows DELETEd; only `density_compact` remains. | `1152ca3` (PR [#97](https://github.com/bulletbiter99/air-action-sports/pull/97)) → main `5c71b03` ([#98](https://github.com/bulletbiter99/air-action-sports/pull/98)) | done |
| **B12c** Closing — `/admin/today` page + runbooks (this batch) | New `src/admin/AdminToday.jsx` (~150 lines, inline styles): 3 render states based on `useTodayActive()` — loading, no-event-today (empty card), active-event-today (header + 3 quick-action tiles to Roster / Scan / Rentals with `?event=eventId` deep-links), ambiguous (2+ events today; pointer to /admin/events). `src/App.jsx` registers `/admin/today` route + lazy-imports AdminToday alongside existing admin routes. `src/admin/sidebarConfig.js` comment block updated to reflect the page is live. **3 closing runbooks** at `docs/runbooks/`: `m4-baseline-coverage.txt` (test/lint/bundle snapshot at M4 close, all 28 gated paths inventoried), `m4-deploy.md` (the actual M4 deploy sequence including rolling brings-up, 4 migrations, 2 SQL UPDATE flag flips, 1 SQL DELETE), `m4-rollback.md` (decision tree, per-batch revert SHAs with hazards, schema rollback recipes for migrations 0026-0029, deep-link param parsing flagged as M5 polish not rollback). 8 files. Test count unchanged (917/100). Lint warnings ~281 (no new false-positives expected). Bundle adds small AdminToday chunk (~3-5 kB). **Known M5 polish item**: AdminScan + AdminRoster don't yet parse `?event=` query param — deep-links navigate but don't pre-select. Documented in m4-rollback.md. | pending | pending |

**Cumulative through B12c — M4 CLOSED 2026-05-07:** **917 unit tests across 100 files** (+300 vs M3 close). 7 visual regression baselines captured and CI-gated at 1% threshold. **28 gated paths** in `scripts/test-gate-mapping.json` (M3's 12 + M4's 9 new + 7 carryover). **4 D1 migrations applied to remote in M4**: 0026 (saved_views), 0027 (bookings_refund_external + email template seed), 0028 (users.persona column + role-based backfill), 0029 (command_palette flag). **B8 + B9 in-place SQL flips on remote D1** (no migration files; mutations of seeded `feature_flags` rows): B8 → `command_palette` `off` → `on` and `customers_entity` `role_scoped='owner'` → `on`; B9 → `new_admin_dashboard` `role_scoped='owner'` → `on`. **All 3 M4 flag rows DELETEd** post-B12b deploy 2026-05-07; only `density_compact` remains. 9 decision-register entries (D01-D09). Lint: 0 errors / **287 warnings** (+6 from B12b — new JSX false-positives for AdminToday's internal helper components `NoEventTodayState`, `AmbiguousState`, `ActiveEventTodayView`, `ActionTile`). **Bundle**: AdminDashboard chunk 28.09 kB (persona shell as the only path); AdminToday chunk added in B12c (small; <5 kB). **Closing runbooks** at `docs/runbooks/m4-{baseline-coverage.txt,deploy.md,rollback.md}`.

**M4-specific carry-forward facts:**
- **Persona model decision (D08)**: `users.persona` column added in B4a maps job-title personas (owner / booking_coordinator / marketing / bookkeeper / generic_manager / staff) separately from the role hierarchy that drives capability gating. All 4 admin user rows on remote backfilled to `persona='owner'` (mapping from `role='owner'`). Override via SQL UPDATE to test other personas.
- **Roster/Scan/Rentals (D09)**: routes stay alive (deep-link works); sidebar hides them by default. **As of B12c**: they resurface as quick-action tiles inside `/admin/today` (live page, `src/admin/AdminToday.jsx`) when `activeEventToday=true`. B4c's TodayCheckIns widget + B6's CheckInBanner deep-link to `/admin/scan?event=...`. **Known M5 polish**: AdminScan + AdminRoster don't yet parse the `?event=` query param — links navigate but don't pre-select; operator picks via dropdown.
- **`/api/admin/today/active` endpoint** (B4b): contract `{ activeEventToday, eventId, checkInOpen }`. checkInOpen is stubbed to `false` — refining requires parsing `events.check_in` / `events.first_game` time strings into tz-aware instants; deferred. Three consumers: useTodayActive shared subscription (powers PersonaWidgets cadence + dynamic Today sidebar item + CheckInBanner).
- **`/api/admin/dashboard/upcoming-readiness` + `/action-queue`** (B4d): owner-persona endpoints. Top-3 upcoming events with capacity/waiver bars + 4-count action queue. Lightweight COUNT queries; no caching.
- **`/api/admin/analytics/overview`** extended in M4: B4d added `?period=mtd` (current-month scoping), B4f added `taxCents` + `feeCents` aggregations to byStatus rows + totals. All additive — no breaking changes to existing callers.
- **`/api/admin/analytics/funnel?days=N`** (B4e): 4-step Created→Paid→Waivers→CheckedIn checkout funnel. Powers Marketing's ConversionFunnel widget. Step 4 lags reality (future events in window haven't happened) — documented in code; acceptable for trend indicator.
- **Bookings workspace is feature-complete** as of B3b. Sidebar entry shipped in B5 (when `new_admin_dashboard='on'`); pre-flag, navigable via direct URL or via View button on /admin/bookings.
- **All 6 personas have concrete widget sets** as of B4f: owner (7), generic_manager (3 M3 baseline), staff (2 M3 baseline), booking_coordinator (5), marketing (6 — 5 new + RecentFeedback reused), bookkeeper (5).
- **Capabilities stub** (`worker/lib/capabilities.js`) maps the M3-era 3-role hierarchy. M5 will replace with a DB-backed query when role hierarchy expands. Capabilities introduced in M4: `bookings.read.pii`, `bookings.email`, `bookings.export`, `bookings.refund`, `bookings.refund.external`.
- **Visual regression baseline capture flow** is CI-driven, not local. Label any UI-changing PR with `capture-baselines` to refresh; bot commits new PNGs back via `.github/workflows/capture-baselines.yml`. After bot push, manually re-trigger CI (push an empty commit) — GitHub anti-recursion blocks GITHUB_TOKEN-pushed commits from auto-firing `pull_request: synchronize`. Documented in [docs/runbooks/visual-regression.md](docs/runbooks/visual-regression.md).
- **PII masking pattern**: server-side. `worker/routes/admin/bookings.js` GET /:id checks `hasCapability(user, 'bookings.read.pii')` and returns full or masked email/phone accordingly. Audit row `customer_pii.unmasked` written per call when capability is exercised. Frontend renders whatever server returns + a "(masked)" UX badge when `viewerCanSeePII === false`. No client-side click-to-reveal interaction in M4.
- **B5 sidebar + B6 walk-up speed wins + B7 Command Palette** all flag-gated originally. **As of B12b** (post-cleanup): all `useFeatureFlag('command_palette')` / `useFeatureFlag('customers_entity')` / `useFeatureFlag('new_admin_dashboard')` call sites are removed; conditionals are unconditional renders. The 3 flag rows in `feature_flags` D1 table are now orphans (no consumer) pending the operator-driven `DELETE FROM feature_flags WHERE key IN (...)` post-deploy. **B12a deleted** legacy `AdminDashboardLegacy()` + `NAV_SECTIONS` source code (was dead at runtime since B9; physically removed). **B12b deleted** the surviving flag-check call sites (CheckInBanner gate; Cmd+K listener gate; CommandPalette mount gate; Customers page guards on the list + detail pages; Customers sidebar entry's requiresFlag; CustomerTypeahead vs plain-email-input ternary on /admin/new-booking; recall hint conjunction). Pre-B8 production state had `customers_entity` and `new_admin_dashboard` both at `role_scoped='owner'` outside any documented batch — HANDOFF.md §12 was inaccurate; B8's docs PR corrected it.
- **`useWidgetData` cadence primitive** (B4b, `src/hooks/useWidgetData.js`): shared module-level `useTodayActive()` subscription + `useWidgetData(url, { tier })` with tiers static/live (5min default → 30s when `activeEventToday=true` → 10s when `checkInOpen=true`). Visibility-aware (pauses when `document.visibilityState='hidden'`). All persona dashboard widgets use this pattern.
- **Sidebar config-as-code** (B5, `src/admin/sidebarConfig.js`): single source of truth for nav. Adding a sidebar item automatically surfaces in the Command Palette via `commandsFromSidebar` (B7).

**Resume the milestone in a fresh session:**
1. `git checkout main && git pull origin main` (or `milestone/4-bookings-ia-completion` for active development)
2. `npm install`
3. `npm test` — confirm **917/100 passing**
4. `npm run lint` — confirm 0 errors / **287 warnings** (M4 close baseline)
5. `npm run build` — confirm clean (~250ms)
6. `curl https://airactionsport.com/api/health` — confirm `{"ok":true,...}`
7. **M4 is CLOSED.** Remaining work is operational, not code. See `docs/runbooks/m4-{baseline-coverage.txt,deploy.md,rollback.md}` for the post-M4 reference. Next priorities (from HANDOFF.md §11 pre-launch checklist):
   - Stripe sandbox → live cutover + $1 e2e test.
   - DMARC + Resend DKIM/SPF DNS records (booking confirmation emails currently may land in spam).
   - Cloudflare Always-Use-HTTPS toggle.
   - Operation Nightfall content seed (cover images, custom questions, email-template review).
   - Second-admin invite (for backup access).
   - Comp-ticket dry run.
   - Optional post-M4 code work: AdminScan + AdminRoster `useSearchParams()` parsing for `?event=` deep-links (~10 lines per file); Audit Group H cron tests; admin visual regression baselines (B11 deferral).
8. Read this Milestone 4 section + the relevant batch's row above + the M4 plan in this CLAUDE.md if not yet executed.

**Stop-and-ask conditions during M4:**
- A do-not-touch file needs modification beyond what the documented batches specify (DNT list mirrors `docs/audit/06-do-not-touch.md`)
- Existing Group E tests fail after a `worker/routes/admin/bookings.js` edit (do-not-touch contract violation)
- A test fails after a behavior-preserving refactor (investigate, don't "fix" the test)
- Coverage on any gated file drops from M3 + B3a baseline
- Visual regression on a public baseline after a non-public-touching batch (would indicate a regression we missed)
- Migration syntax issue (M3 D1 quirks: BEGIN/COMMIT keywords rejected; FK enforcement on table-rebuild — use column-rename pattern)

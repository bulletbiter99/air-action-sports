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

### Milestone 2 — Shared Primitives + Cross-Route Fix (in progress 2026-05-07)

Long-lived branch: `milestone-2-shared-primitives` (NOT merged to `main` yet — milestone is incomplete; B5b, B5c, B6, B7 pending). 7 conceptual batches; B3 split into 3a/3b, B4 split into 4a/4b, B5 split into 5a/5b/5c due to the 10-file cap. Sub-branches use **flat `m2-batch-N-slug` naming** (per Option-A decision; the M2 prompt's `milestone/2-shared-primitives/batch-N-slug` form was rejected because `milestone-2-shared-primitives` exists as a branch ref leaf and can't simultaneously be a directory in `.git/refs/heads/`).

**Per-batch operating rules** (per the M2 prompt — same as M1):
- Plan-mode-first per batch — write plan, post it, wait for "proceed" before editing.
- 10-file cap per PR. **Hard rule.** Split if needed (B3, B4, B5 all split).
- Conventional Commits with `m2-<area>` scope.
- No `--force`, no rebases on shared branches, no direct commits to `main` or `milestone-2-shared-primitives`.
- All tests use mocks (Vitest + mockD1 + mockEnv + mockStripe + mockResend). No live D1 / Stripe / Resend / `wrangler deploy`.
- **No remote D1 migration apply from Claude.** Migration `0021_feature_flags.sql` ships in repo only; operator applies via `npx wrangler d1 migrations apply --remote` after M2 merges to main.
- Stop-and-ask if a do-not-touch file appears to need editing or a test reveals current behavior conflicting with audit-documented behavior.

**Status (as of 2026-05-07, mid-batch session checkpoint):**

| Batch | What it ships | Status | Squash on milestone | PR |
|---|---|---|---|---|
| **B1** FilterBar primitive + AdminFeedback proof (7 files) | `src/components/admin/FilterBar.{jsx,css}`, `src/hooks/useFilterState.js`, `src/hooks/useSavedViews.js`, 2 tests, AdminFeedback.jsx refactor | ✓ merged | `658e95b` | #16 |
| **B2** writeAudit() helper + 5 admin call sites (4 files) | `worker/lib/auditLog.js` + test; refactored users.js (3 sites) + emailTemplates.js (2 sites) | ✓ merged | `2cf1485` | #17 |
| **B3a** Money helpers + 6 admin sites (9 files) | `src/utils/money.js`, `worker/lib/money.js`, dual-import test (66 tests), 6 admin pages refactored | ✓ merged | `1d3ed98` | #18 |
| **B3b** Email helpers + 4 admin sites (6 files) | `src/utils/email.js`, `worker/lib/email.js` extended, dual-import test (76 tests), 3 admin route files refactored | ✓ merged | `f35a0ec` | #19 |
| **B4a** `findExistingValidWaiver` relocation [CRITICAL] (4 files) | `worker/lib/waiverLookup.js` (verbatim copy), webhooks.js (def removed + shim re-export), admin/bookings.js (new import path), gate map updated | ✓ merged | `683f4a6` | #20 |
| **B4b** Re-target Group D test imports + drop shim (10 files) | 9 test files retargeted, webhooks.js shim removed | ✓ merged | `36fda2b` | #21 |
| **B5a** Feature-flag substrate (4 files) | `migrations/0021_feature_flags.sql` (operator-applies-remote), `worker/lib/featureFlags.js` (isEnabled/listFlags/setUserOverride with graceful table-missing handling), 28+7 tests | ✓ merged | `5e1f568` | #22 |
| **B5b** Feature-flag admin route + client hook (~4 files) | `worker/routes/admin/featureFlags.js` (GET list / PUT override), worker/index.js mount, `src/admin/useFeatureFlag.js`, route handler tests | **pending** | — | — |
| **B5c** Design tokens + density toggle UI (~5 files) | `src/styles/tokens.css` (new), `src/styles/admin.css` (refactor — zero pixel diff target), AdminLayout.jsx (data-density attr), AdminSettings.jsx (toggle UI), density-toggle test | **pending** | — | — |
| **B6** Group E admin booking characterization tests (8 files) | 7 tests for `worker/routes/admin/bookings.js` (manual card/cash/comp branches, pricing parity, attendee creation, auto-link, refund) + gate map update | **pending** | — | — |
| **B7** Closing: rollback runbook + deploy runbook + baseline coverage + CLAUDE.md/HANDOFF (~4 files) | `docs/runbooks/m2-rollback.md`, `docs/runbooks/m2-deploy.md` (with operator-applies-remote step for migration 0021), `docs/runbooks/m2-baseline-coverage.md`, CLAUDE.md/HANDOFF final update | **pending** | — | — |

**Cumulative test count on milestone branch (after B5a):** 453 unit tests across 63 files (from M1's 216 baseline + 237 new across M2 batches 1–5a). Target by M2 close: ≥460 (B6 adds 7 Group E tests).

**Test gains per M2 batch:**
- B1 FilterBar: +45
- B2 writeAudit: +16
- B3a money: +66 (33 per target × 2 targets — client + worker mirror)
- B3b email: +76 (38 per target × 2 targets)
- B4a/4b: 0 (relocation; same 25 Group D tests, just retargeted import paths)
- B5a feature-flags: +34 (28 main + 6 readiness)

**Operator-applies-remote action queued for M2 deploy:**
After M2 merges to main, operator runs `npx wrangler d1 migrations apply air-action-sports-db --remote` to apply `migrations/0021_feature_flags.sql`. Until then, `worker/lib/featureFlags.js` returns `false`/`[]` gracefully on missing tables — the density toggle UI in B5c is hidden until migration applies. Documented in B7's `docs/runbooks/m2-deploy.md`.

**Critical do-not-touch handled in M2:**
- B4a/4b moved `findExistingValidWaiver` from `worker/routes/webhooks.js` to `worker/lib/waiverLookup.js`. The function body is **byte-identical** to the original; only its location changed. Group D's 25 characterization tests pass identically. The cross-route import smell from audit §08 #7 is fully closed. **Operator review eyeballed the combined 4a+4b diff before B5a started.**
- B2/B3a/B3b refactors only touched admin-side surfaces. Public-side files (Booking.jsx, Waiver.jsx, feedback.js, pricing.js, webhooks.js's webhook handler logic) are untouched.

**Resume the milestone in a fresh session:**
1. `git checkout milestone-2-shared-primitives && git pull origin milestone-2-shared-primitives`
2. `npm install`
3. `npm test` — confirm 453/453 passing
4. Read this section + the next pending batch's row in the table above (B5b is next)
5. Post B5b plan; wait for "proceed"; create sub-branch `m2-batch-5b-feature-flags-route`; execute; PR; merge — repeat through B7

**Key conventions established / used during M2:**
- Conventional Commits with `m2-<area>` scope: `feat`, `refactor`, `test`, `chore`, `docs`.
- Sub-branches: flat `m2-batch-N-slug` (NOT nested under `milestone-2-shared-primitives/...` — git ref path collision avoided, same as M1).
- Dual-target testing pattern (B3a money, B3b email): `tests/unit/utils/<helper>.test.js` imports BOTH `src/utils/<helper>.js` AND `worker/lib/<helper>.js`, runs identical suite against each. Proves "same logic, same return shape" required when client + worker can't share code (Vite bundles src/ for SPA only).
- Audit-log helper API: `writeAudit(env, { userId, action, targetType, targetId, meta, ipAddress? })`. The optional `ipAddress` selects between 6-col (admin routes) and 7-col (webhook + waivers) shape; M3+ refactors of those flows use the same helper.
- Feature-flag lib API: `isEnabled(env, flagKey, user)`, `listFlags(env, user)`, `setUserOverride(env, flagKey, userId, enabled)`. Reads degrade gracefully on missing tables; writes throw loudly. 4 flag states: off/on/user_opt_in/role_scoped.

**M2 prompt's stop-and-ask conditions** (preserved here as a checklist for resuming sessions):
- A do-not-touch file needs modification beyond Batch 4's documented relocation (which is now complete).
- A test fails after a refactor that should be behavior-preserving (signals real drift; investigate, don't "fix" the test).
- Coverage on protected files (pricing 95.95% / stripe 56.06% / webhooks 91.08% / waivers 93.61%) drops from M1 baseline.
- A dependency missing from `package.json` that the original code path requires.

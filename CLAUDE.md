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

The admin-overhaul work (Phase 2 broader goal — see [docs/audit/10-open-questions.md](docs/audit/10-open-questions.md) #13, **resolved as A+B+C+incremental** per [docs/decisions.md](docs/decisions.md) D01) builds on M2's shared primitives. M3 is in flight on `milestone/3-customers`.

### Milestone 3 — Customers Schema + Persona-Tailored AdminDashboard (in flight 2026-05-07)

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

**Status (as of 2026-05-07, post-B4):**

| Batch | What it ships | Status | Squash on milestone |
|---|---|---|---|
| **B0** Hygiene + dogfood verification (10 files) | ESLint flat config + lint blocking; M2 staleness cleanup; decisions register; M2 primitive dogfood; coverage floor; M3 plan in this section | ✓ merged | `3afbb4c` ([#30](https://github.com/bulletbiter99/air-action-sports/pull/30)) |
| **B1** Local D1 setup + staging seed (4 files) | `scripts/{seed-staging.sql,setup-local-d1.sh,teardown-local-d1.sh}`; CLAUDE.md "Local D1 setup" subsection | ✓ merged | `aee3791` ([#31](https://github.com/bulletbiter99/air-action-sports/pull/31)) |
| **B2** `customerEmail.js` lib (dual-target, 5 files) | `worker/lib/customerEmail.js` + `src/utils/customerEmail.js` mirror + 62 tests; closes decision register #32 | ✓ merged | `0cfd436` ([#32](https://github.com/bulletbiter99/air-action-sports/pull/32)) |
| **B3** Migration A — customers schema additive (1 file) | `migrations/0022_customers_schema.sql` — customers + customer_tags + segments + gdpr_deletions tables; nullable customer_id columns; indexes. **Migration applied to remote D1 2026-05-07 ✓** | ✓ merged | `0e06b85` ([#33](https://github.com/bulletbiter99/air-action-sports/pull/33)) |
| **B4** Backfill script + tests (3 files) | `scripts/backfill-customers.js` (Node CLI + helpers); `scripts/backfill-customers.test.js` (operator-runnable integration test); `tests/unit/scripts/backfill.test.js` (31 vitest unit tests). Local-D1 integration verified end-to-end (38 customers from 50 bookings; idempotent). **Backfill script ready but NOT YET RUN on remote D1** — runs after B5 dual-write code lands. | ✓ merged | `a3bfcc5` ([#34](https://github.com/bulletbiter99/air-action-sports/pull/34)) |
| **B5** Dual-write code paths (~4 files) | `worker/lib/customers.js` + tests; webhook + admin/bookings.js wired to call `findOrCreateCustomerForBooking`; ~10 new tests | pending | — |
| **B6** Migration C — NOT NULL + remove fallback (~5 files) | `migrations/0023_customers_not_null.sql` (12-step rebuild). **Pre-condition: 7-day dual-write verification window post-B5 deploy.** | pending | — |
| **B7** Group F — auth characterization tests (~12 files) | 11 audit-prescribed tests (F54-F64); gate map updated for `worker/lib/{auth,session,password}.js` | pending | — |
| **B8** Customers UI: list / detail / merge (~8 files) | `AdminCustomers*` + route + `customers_entity` flag (state `off`). Reuses `<FilterBar>` + `useFeatureFlag` from M2 | pending | — |
| **B9** Persona-tailored AdminDashboard (~10 files) | New `AdminDashboard.jsx` (persona shell) + widgets + `personaLayouts.js` + `new_admin_dashboard` flag | pending | — |
| **B10** System tag refresh cron (2 files) | `worker/index.js` scheduled() addition for nightly tag-refresh sweep at 03:00 UTC | pending | — |
| **B11** GDPR deletion workflow (~4 files) | `POST /api/admin/customers/:id/gdpr-delete` + UI modal + tests | pending | — |
| **B12** Closing: rollback + deploy + baseline coverage runbooks + final docs (~5 files) | `docs/runbooks/m3-{rollback,deploy,baseline-coverage}.{md,txt}`; CLAUDE.md/HANDOFF.md M3 closed-state | pending | — |

**Cumulative on milestone branch (after B4):** 564 unit tests across 73 files (471 M2 baseline + 93 new across B0-B4 — 0 from B0/B1/B3, 62 from B2 customerEmail, 31 from B4 backfill helpers).

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
3. `npm test` — confirm **564/564** passing across 73 files
4. Read this section + the next pending batch's row in the table above (B5 is next)
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
- Coverage on any of the six gated files drops from M2 baseline (per [docs/runbooks/m3-pre-flight-coverage.txt](docs/runbooks/m3-pre-flight-coverage.txt))
- Any production-data anomaly during local backfill testing

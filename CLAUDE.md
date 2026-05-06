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

# Tests — Vitest infrastructure + characterization tests being added on
# the milestone-1-test-infrastructure branch. NOT yet on main.
# Run `npm test` from that branch (after `npm install` to get vitest).
# As of 2026-05-06: 141 tests pass across 30 files (Group A pricing
# + Group B webhook complete). Group C (waiver) + D (auto-link) pending.
# Track progress in this CLAUDE.md's "Milestone 1" section below.
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

### Milestone 1 — Test Infrastructure (in progress 2026-05-06)

Long-lived branch: `milestone-1-test-infrastructure` (NOT merged to `main` yet — milestone is incomplete). 9 batches total; 5 merged into the milestone branch so far. Sub-branches use `m1-batch-N-slug` naming (flat — sub-branch hierarchy under `milestone/...` was avoided due to git ref path collision).

**Per-batch operating rules** (per the M1 prompt):
- Plan-mode-first per batch — write plan, post it, wait for "proceed" before editing.
- One commit per sub-PR. Conventional Commits with `test`/`chore`/`docs` types and `m1-<area>` scope.
- 10-file cap per PR. Hard rule.
- No `--force` ever. No rebases on shared branches. No direct commits to `main` or to `milestone-1-test-infrastructure`.
- All tests use mocks (Vitest + Web Crypto). No live Stripe / Resend / D1 / `wrangler deploy` from Claude.
- Stop-and-ask if a do-not-touch file appears to need editing or a test reveals current behavior conflicting with audit-documented behavior.

**Status (as of 2026-05-06):**

| Batch | What it ships | Status | Squash commit on milestone branch |
|---|---|---|---|
| **B1** Vitest setup + sanity test | vitest.config.js, tests/setup.js, 4 mock helpers, tests/unit/health.test.js, devDeps + scripts | ✓ merged | `aa0cfb9` |
| **B2a** Group A pricing core (8 files) | empty-cart, single-ticket, multi-ticket-with-addon, percent-tax-fixed-fee, percent-fee-on-percent-tax, applies-to-tickets, applies-to-all, line-items-shape | ✓ merged | `456d12e` |
| **B2b** Group A pricing edges (7 files) | promo-percent, promo-fixed, per-unit-multipliers, capacity-errors, min-max-per-order, inactive-fee-excluded, cents-precision | ✓ merged | `20dd620` |
| **B3a** Group B webhook signature (6 files) | tests/helpers/stripeSignature.js, signature-verify-{valid,invalid,stale,multi-v1}, signature-constant-time | ✓ merged | `95ac8ce` |
| **B3b** Group B webhook handler (10 files) | tests/helpers/webhookFixture.js + 9 handler tests (idempotency, unknown-event-type, attendee-creation, ticket-types-sold-increment, promo-uses-increment, audit-log-emission, email-send-confirmation, email-send-admin-notify, waiver-auto-link-on-paid) | ✓ merged | `8cf37a8` |
| **B4** Group C waiver sign — 2 sub-PRs | 4a `m1-batch-4a-waiver-validation` (8 files: ESIGN/sig/age-tier/jury) → 4b `m1-batch-4b-waiver-effects` (8 files: snapshot/claim/audit/integrity/already-signed) — covers audit C25-38 + 2 audit-only adds (#34 attendees.waiver_id set, #36 409 if already signed) | pending | — |
| **B5** Group D auto-link (`m1-batch-5-lookup`, 9 files) | match-by-email-and-name, case-insensitive-email, whitespace-tolerant, claim-period-required, expired-claim-period-no-match, null-inputs-return-null, latest-by-signed-at, sibling-different-name-no-match, cross-flow-consistency — covers audit D39-46 | pending | — |
| **B6** Playwright smoke (`m1-batch-6-playwright`, 4 files) | playwright.config.js, tests/e2e/setup.js, tests/e2e/smoke.test.js, package.json devDep `@playwright/test@^1.48.0` + `test:e2e` script | pending | — |
| **B7** CI workflow (`m1-batch-7-ci`, 2-3 files) | `.github/workflows/ci.yml` (PR to main + milestone/* triggers; lint+test+coverage), CONTRIBUTING.md | pending | — |
| **B8** Test gate map + CLAUDE.md update (`m1-batch-8-gate-and-docs`, 2 files) | scripts/test-gate-mapping.json (do-not-touch path → required test path), CLAUDE.md gate-enforcement section + tests/ link | pending | — |
| **B9** Closing checks (`m1-batch-9-closing`, ~3 files) | docs/runbooks/m1-baseline-coverage.txt, docs/runbooks/m1-rollback.md, docs/runbooks/m1-deploy.md | pending | — |

**Cumulative test count on milestone branch as of B3b:** 141 tests across 30 files.
- Group A (pricing): 79 tests, 15 files — ✓ complete
- Group B (webhook): 59 tests, 14 files — ✓ complete
- Group C (waiver): pending B4
- Group D (auto-link): pending B5
- Health/sanity: 3 tests, 1 file

**Test runner:** Vitest 2.1.9, Node 20 env. Coverage via @vitest/coverage-v8. Playwright reserved for B6 (smoke only — no visual regression in M1; that's M4 Group I).

**Important conventions established in B1:**
- All tests under `tests/unit/<group>/*.test.js`. E2E under `tests/e2e/`.
- Helpers in `tests/helpers/` (mockEnv, mockD1, mockStripe, mockResend, stripeSignature, webhookFixture).
- `globalThis.fetch` defaults to throw-on-unmocked in `tests/setup.js`. Tests opt in via `mockStripeFetch()` or `mockResendFetch()`.
- `mockD1.__on(pattern, response, kind)` registers a handler. `pattern` is string-includes or regex. `response` can be value or `(sql, args, kind) => value`.
- Coverage-folder `coverage/` is gitignored (added in B1).
- Web Crypto (`crypto.subtle`, `crypto.getRandomValues`) is used directly — no polyfill needed in Node 20.

**Resume the milestone:**
1. `git checkout milestone-1-test-infrastructure && git pull origin milestone-1-test-infrastructure`
2. `npm install` (gets vitest + @vitest/coverage-v8 if not already installed)
3. `npm test` — confirm 141/141 passing
4. Read this section + the M1 prompt the operator gave (preserved in HANDOFF.md §10's milestone-1 row)
5. Post Batch 4 plan; wait for "proceed"; create sub-branch `m1-batch-4a-waiver-validation`; etc.

**Drift to flag for any session resuming M1:**
- The audit doc `docs/audit/09-test-coverage.md` lists 83 prescribed tests; the milestone has expanded that to 54 in Groups A-D (audit-derived + milestone-only) + 7 in B6 = 61 minimum. Smoke tests are deliberately not full visual regression (per the M1 prompt's "M4 Group I" reference).

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

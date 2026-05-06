# 09 — Test Coverage Assessment

## Top-line finding

**There is no automated test suite in this repository.** Zero unit tests, zero integration tests, zero end-to-end tests, zero snapshot tests, zero visual-regression tests. No CI workflow runs anything against the code on push.

This is the audit's most consequential finding for the Phase 2 admin overhaul: every critical and high-coupling asset listed in [05-coupling-analysis.md](05-coupling-analysis.md) and [06-do-not-touch.md](06-do-not-touch.md) is presently uncovered. Any non-trivial change to the do-not-touch surface area requires a paired sandbox dry-run today; characterization tests would replace the dry-run with something repeatable.

## Confirming "zero"

Verified by:

- **No testing libraries** in [package.json](package.json) dependencies or devDependencies. Specifically absent: `vitest`, `jest`, `mocha`, `ava`, `playwright`, `cypress`, `puppeteer`, `@testing-library/*`, `c8`, `nyc`, `msw`, `sinon`, `chai`, `jasmine`. (Confirmed via `grep -E "vitest|jest|playwright|cypress|@testing-library|msw|c8|nyc|mocha|chai|jasmine" package.json` → no matches.)
- **No test scripts** in [package.json:6-11](package.json). The four scripts are `dev`, `build`, `lint`, `preview` — none reference test, spec, or coverage.
- **No test files** anywhere outside `node_modules/`. (Confirmed via Glob `**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs}` — every match is inside `node_modules/`.)
- **No `__tests__/`, `tests/`, `test/`, `e2e/`, `cypress/`, `playwright/` directory** exists at any depth (excluding `node_modules/`).
- **No CI workflow**. There is no `.github/workflows/` directory and no `.gitlab-ci.yml` or other pipeline file.
- **No coverage tooling**, no `coverage/` artifact directory.
- **No mocking strategy**, no fixtures directory, no seed files for testing (the `scripts/seed_*.sql` files are for live D1, not tests).

## Critical-path coverage today

Every critical path is **0% covered**:

| Critical path | Code location | Coverage |
|---|---|---|
| Public booking flow end-to-end (browse → quote → checkout → Stripe → webhook → paid → email + waiver request) | [src/pages/Events.jsx](src/pages/Events.jsx) → [src/pages/EventDetail.jsx](src/pages/EventDetail.jsx) → [src/pages/Booking.jsx](src/pages/Booking.jsx) → [worker/routes/bookings.js](worker/routes/bookings.js) → Stripe → [worker/routes/webhooks.js](worker/routes/webhooks.js) → [worker/lib/emailSender.js](worker/lib/emailSender.js) | **None.** Verified manually per HANDOFF §11 dry-run checklist. |
| Payment success | [worker/routes/webhooks.js:58-66,104-228](worker/routes/webhooks.js) | **None.** Webhook signature verify, idempotency check, attendee creation, ticket sold counter, audit-log emission — all uncovered. |
| Payment failure | n/a (Stripe handles failure UX in their hosted checkout) | n/a |
| Refund | [worker/routes/admin/bookings.js:390](worker/routes/admin/bookings.js) | **None.** |
| Waiver sign | [worker/routes/waivers.js:127-327](worker/routes/waivers.js) | **None.** ESIGN consent, signature-must-match-name, age tier branching, jury-trial initials, body_html_snapshot — all uncovered. |
| Waiver auto-link via `findExistingValidWaiver` | [worker/routes/webhooks.js:18-34](worker/routes/webhooks.js) | **None.** Used by both Stripe webhook and admin manual booking. |
| Waiver integrity check failure | [worker/routes/waivers.js:54-58, 89-96, 232-236](worker/routes/waivers.js) | **None.** |
| Admin auth (login, session, role guard) | [worker/lib/auth.js](worker/lib/auth.js), [worker/lib/session.js](worker/lib/session.js), [worker/lib/password.js](worker/lib/password.js) | **None.** |
| Admin write operations | every `worker/routes/admin/*.js` POST/PUT/DELETE handler | **None.** |
| Audit-log emission | every `INSERT INTO audit_log` site (19 files per Area 8 #15) | **None.** |
| Vendor magic-link verify + sign | [worker/routes/vendor.js](worker/routes/vendor.js), [worker/lib/vendorToken.js](worker/lib/vendorToken.js) | **None.** |
| Cron sweeps (24hr / 1hr / abandon-pending / vendor) | [worker/index.js:554-595](worker/index.js) | **None.** Sentinel-stamping idempotency uncovered. |
| Pricing math (`calculateQuote`) | [worker/lib/pricing.js:14-178](worker/lib/pricing.js) | **None.** Three production bugs in the recent past (HANDOFF §10 row "Tax/fee bug fixes") landed here without test coverage. |

## Snapshot / visual-regression coverage of the public site

**None.** No Percy, no Chromatic, no Playwright snapshot configuration, no Storybook, no static visual-regression script. Every public-side change today is verified by eyeballing the deployed Worker URL.

## Manual verification regimen (current)

Today's "test plan" is informal and lives in HANDOFF.md:

- **HANDOFF §11 row "Dry run"** — recommended owner-side end-to-end dry-run before each event: book a comp ticket, confirmation email, waiver, scanner check-in, rental assignment, return.
- **HANDOFF §13 known issues** — list of gotchas to spot-check after deploy (browser cache, run_worker_first, PBKDF2 cap, scanner HTTPS requirement).
- **`/api/health` curl** — only continuous health signal.
- **AdminDashboard CronHealth widget** — flags reminder-cron staleness >60min (per HANDOFF §10 row "Reminder-cron monitoring").

These are operational checks, not test artifacts. They do not run in CI.

---

## Characterization tests required before any related admin code is touched

The Phase 2 admin overhaul cannot safely modify any of the do-not-touch entries below without first writing the test that locks current behavior. This is a list of concrete test names with the exact behavior each test must assert. Test runner is unspecified — Vitest is the natural choice for a Vite-based repo and would integrate without changes to Vite config.

### Group A — Pricing / billing (Critical)

These guard `worker/lib/pricing.js calculateQuote()` and the public/admin parity that depends on it. Recommended test file: `worker/lib/__tests__/pricing.test.js`.

1. `calculateQuote returns all-zero totals on empty cart` — asserts the empty-cart short-circuit at [pricing.js:88-100](worker/lib/pricing.js); fix from HANDOFF commit 5555426.
2. `calculateQuote charges fixed fee per booking when per_unit='booking'`
3. `calculateQuote multiplies fixed fee by attendee count when per_unit='ticket' or 'attendee'` — line items count, not order count.
4. `calculateQuote applies percent tax to subtotal-after-discount when applies_to='all'`
5. `calculateQuote applies percent fee to (subtotal - discount + tax) when applies_to='all'` — fee base includes tax.
6. `calculateQuote applies tax to ticketsSubtotal only when applies_to='tickets'` — and similarly addons.
7. `calculateQuote distributes promo discount proportionally between tickets and addons when computing applies_to-bounded percent base`
8. `calculateQuote rejects ticket selection that exceeds remaining capacity` — `errors[]` populated.
9. `calculateQuote rejects ticket qty < minPerOrder or > maxPerOrder` — separate error per case.
10. `calculateQuote with promo type='percent' caps discount at subtotal`
11. `calculateQuote with promo type='fixed' caps discount at subtotal`
12. `calculateQuote with no taxes or fees configured returns subtotal as total` — (after discount).
13. `calculateQuote line_items array contains tax + fee rows with line_total_cents but no qty/unit_price_cents` — guards the Stripe Checkout shaping fix from HANDOFF commit 5e7d833.

### Group B — Stripe webhook (Critical)

Recommended file: `worker/routes/__tests__/webhooks.test.js`.

14. `verifyWebhookSignature accepts a fresh signature` (single v1, current timestamp).
15. `verifyWebhookSignature accepts during rotation` (multiple v1 values, only the second matches).
16. `verifyWebhookSignature rejects expired timestamp` (>5 min old).
17. `verifyWebhookSignature rejects malformed Stripe-Signature header`.
18. `verifyWebhookSignature uses constant-time compare` (basic shape check; full timing-attack invariance not testable in unit suite).
19. `handleCheckoutCompleted is idempotent on duplicate delivery` — second call with `status='paid'` is a no-op.
20. `handleCheckoutCompleted creates one attendee row per pending_attendees_json entry`
21. `handleCheckoutCompleted increments ticket_types.sold by ticket qty per ticket type`
22. `handleCheckoutCompleted increments promo_codes.uses_count by 1 when promo_code_id set`
23. `handleCheckoutCompleted writes audit row 'booking.paid'`
24. `handleCheckoutCompleted writes audit row 'waiver.auto_linked' for each pre-linked attendee`

### Group C — Waiver sign (Critical, legally load-bearing)

Recommended file: `worker/routes/__tests__/waivers.test.js`.

25. `POST /api/waivers/:qrToken rejects missing erecordsConsent` (HTTP 400, ESIGN §7001(c) gate)
26. `POST /api/waivers/:qrToken rejects signature that doesn't match attendee name` (case/whitespace insensitive)
27. `POST /api/waivers/:qrToken rejects under-12 dob` (hard block)
28. `POST /api/waivers/:qrToken at age 12-15 requires parent fields AND supervising-adult fields`
29. `POST /api/waivers/:qrToken at age 16-17 requires parent fields but NOT supervising-adult fields`
30. `POST /api/waivers/:qrToken at age 18+ accepts independent signer`
31. `POST /api/waivers/:qrToken at every tier requires juryTrialInitials` (§22 gate)
32. `POST /api/waivers/:qrToken stamps body_html_snapshot + body_sha256 + waiver_document_version on the waivers row`
33. `POST /api/waivers/:qrToken stamps claim_period_expires_at = signed_at + 365d`
34. `POST /api/waivers/:qrToken sets attendees.waiver_id`
35. `POST /api/waivers/:qrToken writes audit row 'waiver.signed'`
36. `POST /api/waivers/:qrToken returns 409 if attendee.waiver_id already set`
37. `getLiveWaiverDocument flags 'mismatch' when body_html SHA-256 ≠ stored body_sha256`
38. `GET /api/waivers/:qrToken refuses to serve when integrity check fails AND writes audit row 'waiver_document.integrity_failure'`

### Group D — `findExistingValidWaiver` auto-link (Critical, cross-flow)

Recommended file: `worker/routes/__tests__/findExistingValidWaiver.test.js`.

39. `findExistingValidWaiver returns null on empty email`
40. `findExistingValidWaiver returns null on empty fullName`
41. `findExistingValidWaiver returns null when claim_period_expires_at is null`
42. `findExistingValidWaiver returns null when claim_period_expires_at <= asOfMs`
43. `findExistingValidWaiver matches case-insensitively on email`
44. `findExistingValidWaiver matches case-and-whitespace-insensitively on player_name`
45. `findExistingValidWaiver returns latest by signed_at when multiple match`
46. `findExistingValidWaiver does NOT match a sibling with same email but different name`

### Group E — Admin manual booking (Critical, public/admin parity)

Recommended file: `worker/routes/admin/__tests__/bookings.test.js`.

47. `POST /api/admin/bookings/manual with paymentMethod=cash creates a paid booking with no Stripe call`
48. `POST /api/admin/bookings/manual with paymentMethod=comp creates a status='comp' booking with no charge`
49. `POST /api/admin/bookings/manual with paymentMethod=card mints Stripe Checkout Session and returns paymentUrl + sessionId`
50. `POST /api/admin/bookings/manual computes tax + fee identically to /api/bookings/quote for the same cart` — public/admin parity guard, fix from HANDOFF commit 2dd831f.
51. `POST /api/admin/bookings/manual auto-links existing waivers via findExistingValidWaiver` — same as webhook path.
52. `POST /api/admin/bookings/:id/refund passes Idempotency-Key to Stripe` — guards against double-refund on retry (Area 4 follow-up).
53. `POST /api/admin/bookings/:id/refund refuses cash bookings`

### Group F — Auth (High)

Recommended file: `worker/lib/__tests__/auth.test.js`.

54. `verifyPassword returns true for matching hash`
55. `verifyPassword returns false for non-matching hash`
56. `hashPassword is non-deterministic` (different salt each call)
57. `requireAuth returns 401 with no cookie`
58. `requireAuth returns 401 when session_version mismatch on user row` (post-logout-everywhere)
59. `requireAuth sets c.get('user') with id, email, role`
60. `requireRole('owner') refuses manager` (returns 403)
61. `requireRole('owner', 'manager') accepts both` and refuses staff
62. `verifyVendorToken accepts fresh token`
63. `verifyVendorToken refuses expired token`
64. `verifyVendorToken refuses token from a previous token_version` (post-revoke)

### Group G — `/uploads/:key` and `/events/:slug` (Critical worker-level)

Recommended file: `worker/__tests__/index.test.js`.

65. `serveUpload rejects keys not matching the allowlist regex` (e.g. `feedback/foo.svg`, `events/foo.exe`, `random.jpg` without prefix)
66. `serveUpload sets Content-Type from file extension, not from R2 metadata`
67. `serveUpload sets Cache-Control: public, max-age=31536000, immutable`
68. `rewriteEventOg falls through to plain SPA shell when slug doesn't match`
69. `rewriteEventOg injects per-event title, og:url, og:image, twitter:image when slug matches a published event`
70. `rewriteEventOg prefers og_image_url over cover_image_url over site default` — three-level fallback chain.

### Group H — Cron (High)

Recommended file: `worker/__tests__/scheduled.test.js`.

71. `runReminderSweep stamps reminder_sent_at before send` (sentinel-first)
72. `runReminderSweep rolls back reminder_sent_at to NULL on send failure`
73. `runReminderSweep does NOT process bookings with reminder_sent_at already set` (idempotency)
74. `runReminderSweep window is 20-28 hrs before event_iso for 24hr; 45-75 min for 1hr`
75. `runAbandonPendingSweep flips status='pending' to status='abandoned' after 30 min`
76. `scheduled writes 'cron.swept' audit row even when no work was done`

### Group I — Visual / smoke (Public-site protection during admin overhaul)

Recommended approach: Playwright with a small set of smoke tests that hit the deployed Worker (or a wrangler-dev local instance) and assert HTTP 200 + presence of expected text on every public route.

77. `GET / returns 200 + contains "Air Action Sports"`
78. `GET /events returns 200 + lists at least one event card`
79. `GET /events/:slug returns 200 + injects per-event title via OG rewriter`
80. `GET /booking returns 200`
81. `GET /waiver?token=invalid returns 200 with appropriate error UX`
82. `GET /v/<bad-token> returns 200 with appropriate error UX`
83. `GET /admin redirects to /admin/login when no cookie`

These are not characterization tests in the strict sense, but they are the public-site safety net for any phase that touches shared assets. Recommended to ship them BEFORE any modification to the do-not-touch list.

---

## Summary by section

| Section | Action |
|---|---|
| Test runner | Add Vitest + minimal config in Phase 2 |
| Pricing characterization | 13 tests (Group A) |
| Webhook characterization | 11 tests (Group B) |
| Waiver characterization | 14 tests (Group C) |
| Auto-link characterization | 8 tests (Group D) |
| Admin booking characterization | 7 tests (Group E) |
| Auth characterization | 11 tests (Group F) |
| Worker-level characterization | 6 tests (Group G) |
| Cron characterization | 6 tests (Group H) |
| Public smoke tests | 7 tests (Group I) |
| **Total recommended Phase-2-prep test count** | **83** |

Phase 2 should not begin work on the do-not-touch list without Groups A-D landing first; Groups E-I should land before broader admin changes.

## Cross-area follow-ups

- **Area 10**: confirm with operator whether Vitest + Playwright is acceptable, or whether a different runner is preferred.
- **Area 10**: confirm whether the Phase 2 plan includes adding CI (GitHub Actions or Cloudflare Workers Builds-side checks) to run these tests on push.

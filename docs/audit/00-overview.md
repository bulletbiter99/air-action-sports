# Phase 1 Audit — Overview

Branch: `audit/phase-1` (off `main`, audit-start commit `a0478a7`).
Date: 2026-05-06.
Scope: read-only inventory of the Air Action Sports codebase ahead of a redesigned admin surface in Phase 2.

## Stack one-liner

React 19 + Vite 8 client-only SPA served from a Cloudflare Worker (Hono router for `/api/*`); raw SQL on Cloudflare D1; R2 blob storage for event covers, feedback screenshots, and vendor docs; bespoke HMAC-cookie auth (PBKDF2 100k); Stripe for payments (sandbox keys still in use); Resend for transactional email (DKIM/DMARC pending); in-house waiver service with versioned `waiver_documents` + per-signer SHA-256 snapshot for ESIGN compliance. **No TypeScript, no test suite, no in-repo CI.**

## Top 5 things to know immediately

1. **Pricing math is duplicated client-side and was the source of three production bugs in the recent past.** [src/pages/Booking.jsx:90-148](../../src/pages/Booking.jsx) re-implements `calculateQuote()` from [worker/lib/pricing.js](../../worker/lib/pricing.js) for the live preview. HANDOFF §10 records bugs in commits 5e7d833, 2dd831f, 5555426. Phase 2 should call `/api/bookings/quote` (debounced) and rip out the client mirror. Detail in [§08 #11](08-pain-points.md).
2. **`/api/bookings/quote` is the only public booking endpoint without a rate limit.** Read-only, but does DB reads on every call. One-line fix; high abuse-vector reduction. Detail in [§02](02-route-inventory.md), [§08 #1](08-pain-points.md).
3. **Six JD operational concepts have no schema today**: sites/venues, customers (as join entity), payments/transactions (as separate entity), refunds, certifications, sponsors, weapon classes. Whether Phase 2 needs to add any of these is the primary scope question for the schema side of the overhaul. Detail in [§03](03-data-model.md).
4. **Zero automated tests exist.** Every critical path (booking → Stripe → webhook → email, waiver sign + integrity check, auto-link auto-renewal, admin auth) is verified manually today. Phase 2 prep prescribes **83 characterization tests** that should land before any do-not-touch code is modified. Detail in [§09](09-test-coverage.md).
5. **Stripe is still in sandbox mode and DMARC/DKIM DNS are missing.** Both are HANDOFF §11 pre-launch blockers; not introduced by this audit, but the first event ([Operation Nightfall, 2026-05-09](https://airactionsport.com/events/operation-nightfall)) is **3 days away**. Detail in HANDOFF.md §11; mirrored at [§04](04-integrations.md).

## Counts

| Metric | Number |
|---|---|
| Source / config files examined | ~150 (full reads on 60+ key files; greps and globs across the rest) |
| Migrations reviewed | 20 (incl. anomaly: two files share `0010_*` prefix) |
| API endpoints catalogued | 103 (12 public + 4 vendor token + 5 vendor cookie + 1 webhook + 1 health + 80 admin) |
| SPA routes catalogued | 50 (public + vendor portal + admin) |
| Admin SPA pages found in code | 24 user-facing + 3 framework files |
| Admin routes promised by JDs but missing as SPA pages | 0 (3 entries the JDs list as UI routes are actually API paths — documented in [§02](02-route-inventory.md)) |
| Cross-boundary shared assets identified | 28 |
| Do-not-touch entries | 23 Critical, 28 High, 9 Medium |
| Code-observable pain points logged | 7 Critical, 15 High, 13 Medium, 7 Low (42 total) |
| Open questions logged | **50** (12 runtime, 21 operator, 11 external, 6 access) |
| Characterization tests prescribed for Phase 2 prep | 83 |
| Audit doc files produced | 11 (this file + 10 area files) |
| Total audit doc line count | 1696 |
| Committed credentials found in repo | 0 |

## Where to find each section

- [01 — Stack Inventory](01-stack-inventory.md)
- [02 — Route Inventory](02-route-inventory.md)
- [03 — Data Model](03-data-model.md)
- [04 — Integrations](04-integrations.md)
- [05 — Coupling Analysis](05-coupling-analysis.md) ← single most important file for Phase 2 safety
- [06 — Do-Not-Touch List](06-do-not-touch.md) ← mirrored into [CLAUDE.md](../../CLAUDE.md)
- [07 — Admin Surface Map](07-admin-surface-map.md)
- [08 — Pain Points](08-pain-points.md) ← Section 1 awaits operator input
- [09 — Test Coverage](09-test-coverage.md)
- [10 — Open Questions](10-open-questions.md)

## Single most important question

**What is the actual goal of the Phase 2 admin overhaul?** ([§10 #13](10-open-questions.md))

The audit has mapped the present surface and the danger zones, but the Phase 2 brief itself isn't fixed. Concretely: is Phase 2 a dashboard-first redesign, an information-architecture reorganization, persona-tailored landing screens, or incremental polish on the existing 24 admin pages? The answer affects which characterization tests must land first, which schema gaps need filling, and which UI patterns to standardize.

## Recommended next step

1. **Paul reviews this overview and the 10 area docs.**
2. **Paul fills in [§08 Section 1](08-pain-points.md) — operator-stated pain points.** That table is the single biggest unknown the audit can't fill on its own.
3. **Paul answers the [§10 operator-decision questions](10-open-questions.md)**, especially #13 (Phase 2 goal), #15 (which missing entities ship in Phase 2), #28 (test runner approval), #29 (test-tier sequencing).
4. **Hand the answers back as input to a Phase 2 prompt.** That phase will produce a plan; it should explicitly cite this audit's do-not-touch list and characterization-test prerequisites.

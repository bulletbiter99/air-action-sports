# 08 — Pain Points

Two clearly-separated sections per the prompt: **operator-stated** (placeholder for Paul to fill) and **code-observable** (everything visible from this audit's reading).

---

## Section 1 — Operator-stated pain points

*To be filled in by Paul during review of this audit. Add one row per pain point with a short description, how often it bites you (frequency), how much it hurts when it does (severity), and which future phase you'd want it tackled in. Use the rest of the audit docs as a reference: e.g. "see §05 row N" or "the do-not-touch list section X".*

| # | Pain point | Frequency (low / med / high) | Severity (low / med / high) | Recommended phase |
|---|---|---|---|---|
| 1 | _to be filled in by operator_ |   |   |   |
| 2 | _to be filled in by operator_ |   |   |   |
| 3 | _to be filled in by operator_ |   |   |   |
| 4 | _to be filled in by operator_ |   |   |   |
| 5 | _to be filled in by operator_ |   |   |   |

Add more rows as needed. Common categories worth thinking through (not exhaustive):

- Things that are slow on event-day (scanner, roster, reminder cron)
- Pages where you wish you had a different summary or filter
- Email templates customers complain about (deliverability, copy, layout)
- Admin tasks that take too many clicks
- Reports you can't get without dropping into the D1 console
- Anything you find yourself fixing manually with SQL because the UI doesn't support it
- Any time a customer caught a bug before you did

---

## Section 2 — Code-observable pain points

Synthesized from the seven preceding audit areas plus a targeted sweep for TODOs, duplicated logic, and security smells. Each entry: brief description, location, frequency × severity rating, and recommended phase.

### Critical (block or shadow Phase 2 admin overhaul)

| # | Issue | Location(s) | Freq × Severity | Recommended phase |
|---|---|---|---|---|
| 1 | **`/api/bookings/quote` is not rate-limited.** Every other public endpoint in `worker/routes/bookings.js` uses `rateLimit(...)`. `quote` is read-only but does DB reads on every call (events, ticket types, taxes_fees) — abuse vector. | [worker/routes/bookings.js:98](worker/routes/bookings.js) | low × high | Phase 2 (one-line fix) |
| 2 | **Two migrations both numbered `0010`** — `0010_session_version.sql` and `0010_vendors.sql`. Wrangler resolves alphabetically (so order is deterministic) but the numbering collision is fragile and confusing for any new contributor. | [migrations/0010_session_version.sql](migrations/0010_session_version.sql), [migrations/0010_vendors.sql](migrations/0010_vendors.sql) | low (one-time discovery) × med | Phase 2 — rename one to `0010a_`/`0010b_` if compatible, OR document the rationale in a `migrations/README.md` |
| 3 | **`audit_log` has no retention policy.** ~35K rows/year just from cron heartbeats; admin mutations on top. D1 supports 10 GB per DB so this is years away from breaking, but schema changes at that scale are painful. | [migrations/0002_expanded_schema.sql:129-141](migrations/0002_expanded_schema.sql); no DELETE in any handler | low (slow burn) × high (eventually) | Phase 3 — add a `DELETE FROM audit_log WHERE action = 'cron.swept' AND created_at < ?` to a separate cron sweep, or a TTL job in a future Worker |
| 4 | **Stripe API version is not pinned.** No `Stripe-Version` header. If Stripe rotates the account's locked version, response shapes change without a code change. | [worker/lib/stripe.js:6-19](worker/lib/stripe.js) | low (Stripe rarely auto-rotates) × high (surprise breakage) | Phase 2 — add `Stripe-Version` to `stripeFetch` headers; freeze on the current account version |
| 5 | **Stripe webhook only handles `checkout.session.completed`.** Chargebacks (`charge.dispute.*`) and post-completion refunds (`charge.refunded`) are invisible to admin. A chargeback today shows up only in the Stripe dashboard. | [worker/routes/webhooks.js:58-66](worker/routes/webhooks.js) | low × high (financial blindspot) | Phase 3 |
| 6 | **6 JD operational entities have no schema:** sites/venues, customers (as join entity), payments/transactions, refunds (as join), certifications, sponsors, weapon classes. Whether any block Phase 2 depends on what the new admin needs. | [migrations/](migrations/) | varies × varies | Phase 2 prioritization input |
| 7 | **Cross-route import**: `worker/routes/admin/bookings.js:7` imports `findExistingValidWaiver` from `worker/routes/webhooks.js`. Admin reaches into public route file — wrong direction architecturally. The function should live in `worker/lib/waiverLookup.js` or similar. | [worker/routes/webhooks.js:18-34](worker/routes/webhooks.js); [worker/routes/admin/bookings.js:7](worker/routes/admin/bookings.js) | low × med (hard to see) | Phase 2 — relocate without changing behavior; characterization test required (do-not-touch §05) |

### High

| # | Issue | Location(s) | Freq × Severity | Recommended phase |
|---|---|---|---|---|
| 8 | **`npm run lint` is broken.** ESLint 9 + plugin deps installed but no `eslint.config.js` in repo. Running the script errors. | [package.json:9](package.json); no `eslint.config.*` exists | low (no one runs it) × med (silent decay) | Phase 2 — add minimal flat config matching React 19 + hooks plugin |
| 9 | **`docx` is in `dependencies` but is never imported by `src/` or `worker/`** — only `scripts/build_waiver_v2.cjs` uses it. Runtime bundle size impact and deploy footprint. | [package.json:14](package.json); confirmed by absence of `import 'docx'` outside `scripts/` | one-time × low (small lib) | Phase 2 — move to devDependencies |
| 10 | **Stale comment**: [worker/index.js:510-515](worker/index.js) says CSP is omitted "until the Peek widget is removed from index.html". Peek was removed already (HANDOFF §10 row "Booking flow cutover"). The comment is wrong; CSP is still absent. | as above | one-time × med | Phase 2 — remove comment AND add a CSP (unblocked now) |
| 11 | **Pricing math duplicated in `src/pages/Booking.jsx`.** Client recalculates `ticketsSubtotal`, `addonsSubtotal`, taxes, fees locally for the live preview total — mirrors `worker/lib/pricing.js calculateQuote()`. Drift risk: HANDOFF §10 already records 3 production bugs in this region (commits 5e7d833, 2dd831f, 5555426) where server and client diverged. The fix used `/api/bookings/quote` everywhere except Booking.jsx, which still does its own math for the typing-time preview. | [src/pages/Booking.jsx:90-148](src/pages/Booking.jsx); [worker/lib/pricing.js](worker/lib/pricing.js) | high (every render) × high (revenue) | Phase 2 — debounced `/api/bookings/quote` call; rip out the client mirror entirely |
| 12 | **`ageTier()` divergence.** Server returns `null` for under-12 hard block ([worker/routes/waivers.js:22-28](worker/routes/waivers.js)); client returns `'BLOCKED'` ([src/pages/Waiver.jsx:71-77](src/pages/Waiver.jsx)). Both work today because the call sites tolerate either, but the values are different — minor inconsistency, future-bug-bait. | as above | low × med | Phase 2 — pick one |
| 13 | **6+ money-formatter implementations** scattered across the codebase. Variations: `(cents/100).toFixed(2)`, `centsToDollars()`, named `fmt`/`$()`/`money()` helpers, in-place template literals. No single canonical client-side helper. | [worker/lib/pricing.js:187](worker/lib/pricing.js), [worker/lib/emailSender.js:8](worker/lib/emailSender.js), [worker/lib/formatters.js:20,46](worker/lib/formatters.js), [src/pages/Booking.jsx:6](src/pages/Booking.jsx), [src/admin/AdminNewBooking.jsx:6](src/admin/AdminNewBooking.jsx), [src/admin/AdminDashboard.jsx:5](src/admin/AdminDashboard.jsx), [src/admin/AdminAnalytics.jsx:6](src/admin/AdminAnalytics.jsx), [src/admin/AdminEvents.jsx:36](src/admin/AdminEvents.jsx), [src/admin/AdminPromoCodes.jsx:5](src/admin/AdminPromoCodes.jsx), [src/admin/AdminRentals.jsx:9](src/admin/AdminRentals.jsx) | high × low | Phase 2 — extract to `src/utils/money.js` (and `worker/lib/money.js` if needed); 30-line PR |
| 14 | **5+ email-regex implementations.** Two slightly different regexes (bracket-order variation) shared between client and server. | [worker/routes/feedback.js:118](worker/routes/feedback.js), [worker/routes/admin/emailTemplates.js:127](worker/routes/admin/emailTemplates.js), [worker/routes/admin/users.js:69](worker/routes/admin/users.js), [worker/routes/admin/vendors.js:218,264](worker/routes/admin/vendors.js), [src/pages/Booking.jsx:178](src/pages/Booking.jsx), [src/pages/Waiver.jsx:147](src/pages/Waiver.jsx), [src/pages/Contact.jsx:24](src/pages/Contact.jsx) | high × low | Phase 2 — single helper |
| 15 | **No `writeAudit()` helper.** 19 files write `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?)` directly. Risk: any future schema change to `audit_log` (e.g. adding `ip_address` or `request_id`) requires touching 19 files. | grep `INSERT INTO audit_log` across `worker/` | one-time refactor × med | Phase 2 — extract to `worker/lib/auditLog.js`; mechanical edit |
| 16 | **`/static-backup/` directory** is gitignored but present locally — pre-SPA HTML backups (404.html, about.html, booking.html). Serves no purpose; confusing for new contributors. | repo root | one-time × low | Phase 2 — `git rm` the directory, drop it from `.gitignore` |
| 17 | **Two `robots.txt` and two `sitemap.xml`** files. The repo-root copies are dead — only `public/*` versions ship via Vite. | repo root vs `public/` | one-time × low | Phase 2 — `rm` repo-root copies |
| 18 | **HTML rewriter on `/events/:slug` runs a D1 query on every request.** Cheap today (1 event), but linear with traffic. No cache. | [worker/index.js:443-507](worker/index.js) | high (every event-page view) × low (today) → med (at scale) | Phase 3 — wrap with Cache API or KV |
| 19 | **Missing index on `events.slug`**, **`audit_log.action`**, **`bookings.stripe_payment_intent`**. Hot lookups today are PK-only or full-scan. Today the tables are tiny so this is invisible; will surface at scale. | [worker/index.js:453-457](worker/index.js), [worker/routes/admin/auditLog.js:75](worker/routes/admin/auditLog.js), [worker/routes/webhooks.js:107-108](worker/routes/webhooks.js) | low × med | Phase 3 |
| 20 | **`admin_sessions` table is dead** but not dropped. HANDOFF §6 documents that sessions live in HMAC cookies now. The table sits there unused. | [migrations/0001_initial.sql:96-103](migrations/0001_initial.sql) | one-time × low | Phase 2 — migration to drop, or document and leave |
| 21 | **No bounce / complaint handling on Resend.** Undeliverable customer emails are invisible. With DMARC + DKIM still pending, this is a near-term spam-folder risk. | [worker/lib/email.js](worker/lib/email.js) | unknown × med | Phase 3 — Resend webhook + suppression-list table |
| 22 | **Cash bookings have no refund button** by design — refunded out-of-band. Acceptable, but admin has no way to mark a cash booking as refunded for analytics. | [worker/routes/admin/bookings.js:390](worker/routes/admin/bookings.js); HANDOFF §13 | low × low | Phase 3 |

### Medium

| # | Issue | Location(s) | Freq × Severity | Recommended phase |
|---|---|---|---|---|
| 23 | **GA4 measurement ID is a placeholder.** `siteConfig.js` says `// TODO: Replace with real GA4 ID`; Home.jsx hard-codes `G-XXXXXXXXXX`. Today there is no GA4 instrumentation. | [src/data/siteConfig.js:16](src/data/siteConfig.js), [src/pages/Home.jsx:88](src/pages/Home.jsx) | one-time × low | Phase 3 — owner decides if GA4 is needed |
| 24 | **AdminScan camera-permission UX is implicit.** No explicit "Allow camera access" prompt before opening the stream; failure mode lands the user on a black screen. | [src/admin/AdminScan.jsx](src/admin/AdminScan.jsx) | low (per-shift × per-staff) × med | Phase 2 |
| 25 | **AdminAuditLog has no `meta_json` full-text search.** Filter is by action / user / target type / date, but searching for a specific booking ID inside `meta_json` requires SQL. | [src/admin/AdminAuditLog.jsx](src/admin/AdminAuditLog.jsx); [worker/routes/admin/auditLog.js:10](worker/routes/admin/auditLog.js) | low × low | Phase 3 |
| 26 | **Filter UX is hand-built per page.** AdminBookings, AdminFeedback, AdminAuditLog, AdminVendors each have their own filter row. No shared `<FilterBar>`. The new admin overhaul should standardize. | various | one-time refactor × med | Phase 2 |
| 27 | **Stat-card pattern only in AdminFeedback.** New pattern, not yet repeated. Phase 2 should decide whether to spread it (AdminBookings, AdminAnalytics, AdminRoster) or replace it. | [src/admin/AdminFeedback.jsx](src/admin/AdminFeedback.jsx) | one-time × low | Phase 2 |
| 28 | **Vendor package templates admin UI deferred** (HANDOFF §11). Schema and seed exist; UI does not. Affects Vendor Coordinator workflow at scale. | [migrations/0012_vendor_v1.sql:18-30](migrations/0012_vendor_v1.sql); no `src/admin/AdminVendorTemplates.jsx` exists | low × low | Phase 3 |
| 29 | **`vendor_documents.kind` lacks DB-level CHECK constraint after 0012.** SQLite can't ALTER to add CHECK; route layer must enforce. Single source of truth is route validators ([worker/routes/admin/uploads.js:149-200](worker/routes/admin/uploads.js)). | [migrations/0012_vendor_v1.sql:91](migrations/0012_vendor_v1.sql) | low × med | Phase 3 — rebuild table via 12-step SQLite procedure (low-priority) |
| 30 | **Cron sentinel rollback only on `try/catch` — Worker eviction mid-flight leaves the column stamped.** Documented at [worker/index.js:144-148](worker/index.js); the design tradeoff is "at most one skipped delivery per booking, never duplicate." Acceptable. Mention here so future sessions don't re-discover. | as above | low × low | None (working as designed) |
| 31 | **Repo-root `.docx` files** (FAQ_Review_Draft, Release_of_Liability_v1.0, Owner-Review-Checklist, AAS_Owner_Review.docx) are out-of-date — waiver text is now `wd_v4` in D1. Treat as legacy ops artifacts. | repo root | one-time × low | Phase 2 — move to a `legacy/` folder or remove |
| 32 | **`scripts/*.sql` clutter.** 15+ one-off SQL files including `cleanup_smoke_test_bookings.sql`, `triage_fb_screenshot_in_progress.sql`, `bump_nightfall_slug.sql`. Each was a one-time run; clutters the directory. | [scripts/](scripts/) | one-time × low | Phase 2 — archive after-run scripts to `scripts/archive/` |
| 33 | **`generate_waiver.py` + `scripts/build_waiver_v2.cjs`** generate the waiver `.docx` in two languages (Python and CJS Node). Either can be removed if the live waiver is now versioned in D1 and the only consumers are HR / Legal viewing the source-of-truth doc — which it is. | repo root + `scripts/` | one-time × low | Phase 3 — owner decides |
| 34 | **Unused field**: `bookings.referral` exists in 0001 schema but no code reads or writes it. Was likely planned for a future referral attribution feature. | [migrations/0001_initial.sql:47](migrations/0001_initial.sql); grep "referral" → only the column appears | low × low | Phase 3 |
| 35 | **`inventory_adjustments` table is unused.** Created in migration 0001; no admin UI, no API path. Equipment Manager would need this for drift / loss tracking. | [migrations/0001_initial.sql:108-118](migrations/0001_initial.sql); no admin route | low × med | Phase 3 |

### Low (cosmetic / informational)

| # | Issue | Location(s) | Freq × Severity | Recommended phase |
|---|---|---|---|---|
| 36 | **`package.json` `name: "temp-react"`** — placeholder from project bootstrap. | [package.json:2](package.json) | one-time × low | Phase 2 — rename to `air-action-sports` |
| 37 | **`placeholder_guide.txt` and `readme_md.txt`** at repo root predate HANDOFF.md and are stale. | repo root | one-time × low | Phase 2 — remove |
| 38 | **`tools/cover-banner-builder.html`** is a standalone offline tool — fine, but not documented in any in-repo README. | [tools/cover-banner-builder.html](tools/cover-banner-builder.html) | low × low | Phase 2 — `tools/README.md` one-liner |
| 39 | **CRLF line ending warnings on every commit** (`warning: in the working copy of ... LF will be replaced by CRLF`). Indicates `.gitattributes` is absent and Windows working tree is converting. | repo root (no `.gitattributes`) | high (every commit) × low | Phase 2 — add `.gitattributes` with `* text=auto eol=lf` |
| 40 | **Frontend `BookingCancelled` page is small but lazy-loaded as its own chunk** — minor bundle bloat. | [src/App.jsx:16](src/App.jsx) | n/a × low | None |
| 41 | **`src/admin/charts.jsx`** uses zero-dep SVG — fine, but limits what new chart types can be added quickly. If Phase 2 adds many dashboards, consider Recharts or similar. | as above | one-time × low | Phase 2 architectural decision |
| 42 | **`siteConfig.bookingLink`** previously pointed to Peek; now points to `/booking`. Most call sites converted to `<Link to>` per HANDOFF §10 row "Booking flow cutover". Verify zero stragglers in Phase 2. | [src/data/siteConfig.js](src/data/siteConfig.js) | one-time × low | Phase 2 — verification only |

## Cross-area follow-ups

- **Area 9** will list the characterization tests required for items #5 (webhook), #11 (pricing), #1 (quote), #7 (findExistingValidWaiver) before any of those are touched.
- **Area 10** will log the runtime / operator / external questions implied by these pain points (e.g. "is GA4 actually wanted?", "should we drop `admin_sessions`?").

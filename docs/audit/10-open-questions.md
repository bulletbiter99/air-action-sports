# 10 — Open Questions

Everything this audit could not answer from the codebase, categorized per the prompt:

- **Needs runtime investigation** — could be answered by running the app locally / hitting deployed endpoints; commands provided.
- **Needs operator decision** — product / scope / priority questions only Paul can answer.
- **Needs external information** — third-party dashboards (Cloudflare, Stripe, Resend), account-level state.
- **Needs follow-up audit access** — would require permissions or credentials not currently available to this audit.

Each entry references the originating audit area for context.

---

## Needs runtime investigation

These can be answered by running a single read-only command against the deployed system (D1 query, dashboard fetch, curl). None require code changes. Commands are not run as part of this Phase-1 read-only audit.

| # | Question | How to answer | Origin |
|---|---|---|---|
| 1 | What is the actual row count per D1 table today? | `wrangler d1 execute air-action-sports-db --remote --command="SELECT name, (SELECT COUNT(*) FROM ...) FROM sqlite_master WHERE type='table'"` — or one query per table. Useful to validate Area 3 row-count estimates against HANDOFF §12. | §03 |
| 2 | Is `bookings.payment_method` populated for every paid row, or are some still NULL after the 0016 backfill? | `wrangler d1 execute air-action-sports-db --remote --command="SELECT payment_method, COUNT(*) FROM bookings GROUP BY payment_method"` | §03 |
| 3 | How many `audit_log` rows exist today and what proportion are `cron.swept` heartbeats? | `... GROUP BY action ORDER BY 2 DESC` — confirms the unbounded-growth concern in §08. | §03 / §08 |
| 4 | How many waiver rows exist? HANDOFF §12 conflicts: §6 / §11 / §12 say "no signed waivers"; migration 0018 comment says "4 smoke/dogfood rows on wd_v1". | `SELECT COUNT(*) FROM waivers` | §03 |
| 5 | Is `inventory_adjustments` actually empty today? It exists in schema but there's no admin route that writes to it. | `SELECT COUNT(*) FROM inventory_adjustments` | §03 / §08 |
| 6 | Is the `admin_sessions` table empty? HANDOFF §6 says "legacy". | `SELECT COUNT(*) FROM admin_sessions` | §03 |
| 7 | Does `src/styles/global.css` actually apply to admin pages, or does AdminLayout supply enough overrides to neutralize it? | Open `/admin/login` in browser, inspect computed styles vs `src/styles/global.css`. | §05 |
| 8 | Does `npm run lint` actually fail or fall back to ESLint defaults? | `npm run lint` once, capture stderr. | §01 / §08 |
| 9 | Are there any `wrangler.toml` `[vars]` overrides set per-environment that the repo doesn't show? | `wrangler whoami` + `wrangler deployments list` + dashboard inspection. | §04 |
| 10 | What R2 lifecycle rules exist on `air-action-sports-uploads`? | `wrangler r2 bucket lifecycle get air-action-sports-uploads` (or dashboard inspection). | §04 |
| 11 | What is the actual booking flow latency end-to-end (browse → quote → checkout → success)? | Use Cloudflare Worker analytics (or dashboard "Worker traffic" tab) to spot p50/p95 latency for `/api/bookings/quote` and `/api/bookings/checkout`. | §08 |
| 12 | Does `/api/bookings/quote` currently get scraped or abused? | `wrangler tail` for a few minutes; or look at Cloudflare Analytics request rate. | §02 / §08 |

## Needs operator decision

Product, scope, priority, or aesthetic questions that only Paul can answer.

| # | Question | Origin |
|---|---|---|
| 13 | **What is the actual goal of the Phase 2 admin overhaul?** Dashboard-first redesign, IA reorganization, persona-tailored landing screens, or incremental polish of existing pages? The audit lays out the present surface; it does not propose direction. | (overarching) |
| 14 | Which JD personas feel most under-served today? Would help prioritize per-persona landing pages in Phase 2 (e.g. Booking Coordinator's `/admin` vs Lead Marshal's `/admin/roster` vs Bookkeeper's `/admin/analytics`). | §07 |
| 15 | Should the missing operational entities from §03 be added to schema in Phase 2 or later? Specifically: **sites/venues** (today: free-text), **customers** (today: implicit on bookings), **payments/transactions** (today: stripe IDs on bookings), **refunds** (today: refunded_at column), **certifications** (today: nothing), **sponsors** (today: conflated with vendors), **weapon classes** (today: static markdown). | §03 |
| 16 | Should the **vendor package templates** admin UI ship in Phase 2? Schema and seed exist (migration 0012); operator has been creating rows via SQL. | §07 / §08 |
| 17 | Should admin overhaul include AdminAuditLog full-text search on `meta_json`? Compliance Reviewer / Read-only Auditor JDs imply yes; today it's filter-only. | §07 / §08 |
| 18 | Should we add a `writeAudit()` helper to deduplicate the 19 `INSERT INTO audit_log` sites? Pure mechanical refactor; touches do-not-touch territory; needs sign-off because the audit emitter is part of the legal posture. | §08 |
| 19 | Should we replace the bespoke `src/admin/charts.jsx` SVG charts with a library (Recharts, Chart.js, etc.) if Phase 2 adds many dashboards? | §07 |
| 20 | Should we standardize a shared `<FilterBar>` component across admin filter rows, or leave each page bespoke? | §07 |
| 21 | Should the `/admin/feedback` clickable-stat-card pattern propagate to other admin landing pages, or be removed in favor of something else? | §07 |
| 22 | Should `bookings.referral` column be removed (unused everywhere) or wired up to a future referral attribution feature? | §08 |
| 23 | Is GA4 actually wanted? If yes, the placeholder `G-XXXXXXXXXX` in `src/data/siteConfig.js` needs the real measurement ID. If no, remove the TODO and the loader code. | §08 |
| 24 | Should the dead `admin_sessions` table be dropped via migration 0020? It's still in schema but unused since the 0010_session_version + cookie migration. | §03 / §08 |
| 25 | Should we drop `events.tax_rate_bps` and `events.pass_fees_to_customer` from any backups / external reports that may have copied them? They were dropped in migration 0015. | §03 |
| 26 | Is the `static-backup/` directory and the root-level `.docx` / `.txt` archive material safe to remove from the working tree (it's gitignored already)? | §08 |
| 27 | Should the `0010_session_version.sql` and `0010_vendors.sql` filenames be renamed to `0010a_` / `0010b_` to clarify ordering, or left as-is with a `migrations/README.md` explaining the convention? | §03 / §08 |
| 28 | What test runner is acceptable for Phase 2 prep? Vitest is the natural pick (Vite-native); Playwright for smoke tests. Approval needed before adding the dependencies. | §09 |
| 29 | Should Phase 2 prep require all 83 characterization tests (§09) to land before any do-not-touch code is touched, or a tiered subset (e.g. Groups A-D first, E-I in parallel with development)? | §09 |
| 30 | Should we add a CI workflow (GitHub Actions running lint + tests on push), or rely on the existing Cloudflare Workers Builds for deploy gating? Workers Builds doesn't run tests today. | §09 |
| 31 | Is the deferred `vendor_package_templates` UI worth shipping in Phase 2, or stay as SQL-only? | §07 / §08 |
| 32 | Should we add a `weapon_classes` table now, or keep them as static markdown? Affects waiver text, ROE page, ticket-type linking (a future "DMR ticket" might want a weapon-class FK). | §03 |
| 33 | Should the AdminScan permission UX be improved (explicit "Allow camera access" prompt) before Phase 2, given how often staff will use it on event day? | §07 / §08 |

## Needs external information

Answers live in third-party dashboards or accounts the audit doesn't access from the repo.

| # | Question | Where to look |
|---|---|---|
| 34 | What Stripe API version is locked on the account? (We don't pin a `Stripe-Version` header, so this version determines response shape.) | Stripe Dashboard → Developers → API version |
| 35 | Are there any active Stripe webhook endpoints other than `/api/webhooks/stripe`? (Confirms there's no orphan endpoint listening to test-mode events.) | Stripe Dashboard → Developers → Webhooks |
| 36 | What is the current state of Resend DKIM CNAMEs and SPF / DMARC TXT records for `airactionsport.com`? HANDOFF §11 marks these as pre-launch blockers but the audit can't see DNS state. | Cloudflare DNS → airactionsport.com; Resend → Domains; or `dig _dmarc.airactionsport.com TXT` |
| 37 | What is the actual setting of "Always Use HTTPS" toggle? HANDOFF §11 says it's OFF; audit can't verify without dashboard access. | Cloudflare Dashboard → SSL/TLS → Edge Certificates |
| 38 | What is the Min TLS setting? HANDOFF says 1.2 desired. | Cloudflare Dashboard → SSL/TLS → Edge Certificates |
| 39 | Are there any active Cloudflare WAF rules or custom rate-limit rules outside the `[[unsafe.bindings]]` in `wrangler.toml`? | Cloudflare Dashboard → Security |
| 40 | Are there any custom DNS records pointing to other services (Mailchimp, intercom, etc.) the audit doesn't see? | Cloudflare DNS list |
| 41 | Are there any R2 lifecycle rules or CORS settings on `air-action-sports-uploads` set via dashboard? | Cloudflare Dashboard → R2 → bucket settings |
| 42 | What is the current Cloudflare Workers Builds deploy command? HANDOFF §13 says `npm run build && npx wrangler deploy`; audit can't verify the dashboard config. | Cloudflare Dashboard → Workers & Pages → air-action-sports → Settings → Builds |
| 43 | Are any Cloudflare bot-management rules active that might be silently filtering traffic to `/api/bookings/checkout`? | Cloudflare Dashboard → Security → Bots |
| 44 | What does the live Resend dashboard show for delivery rate / bounce rate over the past 30 days? Useful for Area 8 #21 (no bounce handling). | Resend Dashboard → Activity |

## Needs follow-up audit access

These are out of scope for Phase 1 but might be asked in a future audit.

| # | Question | What's needed |
|---|---|---|
| 45 | Are there any committed credentials in branches other than `main`? This audit checked `audit/phase-1` and `main` only. | git branch -a to list all branches; spot-check each |
| 46 | Are there any pre-prod / staging Workers we don't see? | Cloudflare account list |
| 47 | Has any production data ever been loaded into a non-prod environment? | Owner / dev environment audit |
| 48 | What does the Stripe Radar fraud rules / dispute history look like? | Stripe Dashboard → Radar (separate access tier) |
| 49 | Is there a documented incident response runbook? | Owner / Compliance Reviewer |
| 50 | Have any third-party auditors (legal, insurance, SOC) reviewed the system? | Owner |

## Cross-area follow-ups

- **§00 overview**: The "single most important question" surfaced from this list is **#13 — what is the actual goal of the Phase 2 admin overhaul?** Without it, the Phase 2 prompt has no shape.
- **§00 overview**: The pre-launch DNS items (#36, #37) are operational blockers per HANDOFF §11. They don't block this audit but they will block first real sale and should be raised in the closing summary.
- **§00 overview**: The Stripe API-version pin (#34) is a small fix with high leverage — recommended Phase 2 first-day item.

## Counts

- Needs runtime investigation: **12**
- Needs operator decision: **21**
- Needs external information: **11**
- Needs follow-up audit access: **6**
- **Total open questions logged: 50**

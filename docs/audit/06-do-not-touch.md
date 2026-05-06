# 06 — Do-Not-Touch List

Consolidated, ordered list of files, functions, endpoints, tables, and components that are off-limits during the admin overhaul without an explicit follow-up conversation. Sorted by risk, highest first. Reasons drawn from the prompt's allowed taxonomy: **shared with public site / handles payments / handles waivers / handles auth / external webhook / customer-facing email / cron-handler / audit-log emitter / other**.

This list is the source of truth that gets mirrored into [CLAUDE.md](../../CLAUDE.md) — keep in sync when items are added or removed.

## Critical

| Path | Reason | Modification protocol |
|---|---|---|
| `worker/routes/webhooks.js` (entire file, especially `webhooks.post('/stripe', …)` and `handleCheckoutCompleted`) | external webhook + handles payments + audit-log emitter | Stripe sandbox dry-run on every change; verify signature pass + signature fail behavior; require a paired delivery-test in Stripe test mode before merge. |
| `worker/routes/webhooks.js` `findExistingValidWaiver` (exported function) | shared with public site + handles waivers | Characterization test asserting: matches by `LOWER(TRIM(email))` + `LOWER(TRIM(player_name))`, requires `claim_period_expires_at > now`, returns null on missing inputs, returns latest by `signed_at` on multi-match. Required before any change because it ships from one file but is called from two flows (webhook + admin manual). |
| `worker/routes/waivers.js` `POST /api/waivers/:qrToken` | handles waivers + audit-log emitter | Legally load-bearing. Requires Compliance / Waiver Reviewer + Owner sign-off (per JD). Characterization test must lock: ESIGN consent gate, signature-must-match-name normalization, age-tier 4-tier branching (under 12 hard block; 12-15 supervising adult required; 16-17 parent only; 18+ independent), jury-trial initials mandatory all tiers, `body_html_snapshot` + `body_sha256` written, `claim_period_expires_at` = `signed_at + 365d`, `audit_log` row `waiver.signed`. |
| `worker/routes/waivers.js` `getLiveWaiverDocument(env)` (lines 45-59) | handles waivers + audit-log emitter | Integrity check is what makes the system legally defensible — recompute SHA-256 on every fetch and on every submit. Don't cache the doc in memory; don't trust the stored hash without recomputing. |
| `worker/lib/stripe.js` `verifyWebhookSignature` | external webhook + handles payments | Constant-time compare; multi-`v1` rotation support; 5-minute tolerance. Don't loosen tolerance, don't drop the multi-v1 loop, don't switch to fast-path equality. |
| `worker/lib/stripe.js` `createCheckoutSession`, `issueRefund` | handles payments | Caller compliance: refunds MUST pass an `Idempotency-Key` (verify in Area 8). Don't change the line-items shape — the public bookings flow and admin manual booking both depend on `lineItems[i].name|qty|unit_price_cents`. |
| `worker/lib/pricing.js` (`calculateQuote`, `loadActiveTaxesFees`, `centsToDollars`) | shared with public site + handles payments | Used by both public POST /checkout and admin manual booking. Three live bugs in this region in HANDOFF history (5e7d833, 2dd831f, 5555426). Characterization tests on: empty cart, single ticket no addon, multi-ticket + addon, percent tax + fixed fee, fee on top of tax, promo percent vs fixed, applies_to=tickets vs all, `per_unit=ticket\|attendee` multipliers. |
| `worker/routes/bookings.js` `POST /api/bookings/checkout` | handles payments + customer-facing | Public checkout entry — every dollar enters here. Don't change the `pending_attendees_json` write shape (the Stripe webhook reads it back). Don't change the response shape; the SPA depends on `{ url, sessionId }`. |
| `worker/routes/admin/bookings.js` `POST /api/admin/bookings/manual` | handles payments + audit-log emitter | Admin manual booking — same money math as public, plus the comp branch. Three branches: `card` (Stripe Checkout), `cash`/`venmo`/`paypal` (immediate paid), `comp` (immediate comp). Each writes a different shape to `audit_log`. |
| `worker/routes/admin/bookings.js` `POST /api/admin/bookings/:id/refund` | handles payments + audit-log emitter | Stripe refund. Verify `Idempotency-Key` is passed (Area 8 follow-up). Cash refunds are deliberately blocked here. |
| `bookings` D1 table | shared with public site + handles payments | Schema change requires a migration + read-old-write-new compatibility window. Status-machine changes ripple to the `abandoned` cron sweep, the webhook idempotency check, admin filters, and `formatBooking()`. |
| `attendees` D1 table | shared with public site + handles waivers | Webhook writes new rows. Admin edits, scanner reads. `qr_token` UNIQUE is what every printed ticket relies on — don't regenerate. |
| `events` D1 table | shared with public site | Storefront's only data source. Add columns freely (frontend only consumes via `formatEvent`). Renaming or removing columns breaks public + admin + OG rewriter together. |
| `waivers` D1 table | handles waivers | Schema additions must be nullable. Don't add CASCADE deletes from `attendees` without a paired retention conversation. |
| `waiver_documents` D1 table | handles waivers | Never edit `body_html` in place — always `INSERT` a new version, then stamp the previous row's `retired_at`. The integrity check at [worker/routes/waivers.js:54-58](../../worker/routes/waivers.js) blocks tampered live rows from minting new signatures. |
| `vendor_contract_documents` D1 table | handles waivers | Same legal posture as `waiver_documents`. Same in-place edit prohibition. Same versioning pattern. |
| `vendor_signatures` D1 table | handles waivers | Immutable at-sign record with `UNIQUE(event_vendor_id)`. Don't add columns that affect uniqueness. Don't modify the snapshot semantics. |
| `worker/lib/formatters.js` (`formatEvent`, `formatTicketType`, `formatBooking`, `safeJson`) | shared with public site | Defines the public API JSON shape for events, ticket types, bookings. Renaming a key breaks the React SPA (`Events.jsx`, `EventDetail.jsx`, `Booking.jsx`, `BookingSuccess.jsx`) AND admin equivalents. **Add new keys; never rename or remove.** |
| `worker/lib/emailSender.js` (the 9 named senders) | customer-facing email | Every customer email passes through here. Modifying an existing sender's variable name, template slug, or tag shape ripples to webhook + admin + cron. New senders are safe. |
| `worker/index.js` `serveUpload(...)` (R2 stream handler at lines 415-440) | shared with public site + other (security) | Allowlist regex + ext-derived MIME together prevent a hypothetical malicious writer from smuggling `text/html` through the public `/uploads/*` path. Don't widen the regex without re-deriving the MIME mapping. |
| `worker/index.js` `rewriteEventOg(...)` (HTMLRewriter at lines 443-507) | shared with public site | Per-event social unfurls. Falls through to plain SPA shell on miss, which is correct behavior. Adding D1 queries here makes every `/events/:slug` page slower — keep the lookup tight. |
| `worker/index.js` `scheduled(...)` (cron handler at 554-595) | cron-handler + audit-log emitter + customer-facing email | Sentinel-first idempotency must be preserved. Any new sweep must follow the same pattern (stamp before send, roll back on fail). Always-on `cron.swept` audit row backs the AdminDashboard CronHealth widget. |

## High

| Path | Reason | Modification protocol |
|---|---|---|
| `worker/lib/auth.js` (`requireAuth`, `requireRole`, `publicUser`) | handles auth | Used by every admin route. Don't change the `c.set('user', ...)` shape; downstream handlers read `c.get('user').id`/`role`. |
| `worker/lib/session.js` (admin HMAC-signed cookie helpers) | handles auth | `aas_session` cookie format. Don't bump format without a paired logout-everyone migration. |
| `worker/lib/vendorSession.js` | handles auth | `aas_vendor` cookie. Same as above for vendor portal. |
| `worker/lib/vendorToken.js` (`createVendorToken`, `verifyVendorToken`) | handles auth | Vendor magic-link HMAC. Used by admin (mint), vendor public (verify), vendor auth (verify on set-password). Algorithm changes invalidate all live tokens. |
| `worker/lib/password.js` (`hashPassword`, `verifyPassword`) | handles auth | PBKDF2 100k iterations capped by Workers runtime. Don't modify parameters without a pre-staged re-hash migration for live rows. |
| `worker/lib/ids.js` | shared with public site | ID format and length contract. `qrToken` length = 24 from a 62-char alphabet — anything different breaks every printed ticket in flight. |
| `worker/lib/rateLimit.js` (`rateLimit`, `clientIp`) | shared with public site + handles auth | Wrong gating either locks legit users out or opens flood vectors. Test login lockout end-to-end after any change. |
| `worker/lib/email.js` `sendEmail` | customer-facing email | Low-level Resend wrapper. Body shape (tags, reply_to, etc.) ripples to every sender. |
| `worker/lib/templates.js` (`loadTemplate`, `renderTemplate`) | customer-facing email | Variable interpolation rules. Breaking `{{var}}` syntax breaks the 16 seeded templates. |
| `worker/lib/bodyGuard.js` (`readJson`, `BODY_LIMITS`) | other (security) | Request size guard. Limits change requires checking every caller's expected body size. |
| `worker/lib/magicBytes.js` (`sniffImageExt`, `sniffDocExt`, `IMAGE_MIME`, `DOC_MIME`) | other (security) | Used by both the public feedback upload and admin uploads. Stored-XSS primitive guard. New format support must add bytes-level signatures, never trust extension or MIME-header. |
| `worker/routes/admin/waiverDocuments.js` (`POST /` and `POST /:id/retire`) | handles waivers | Versioning workflow — auto-retires previous, emits `waiver_document.created` audit. Don't allow in-place body edits. |
| `worker/routes/admin/vendorContracts.js` (same shape) | handles waivers | Same versioning pattern as waiver documents. |
| `worker/routes/vendor.js` `vendor/:token/sign` | handles waivers + audit-log emitter | Vendor contract sign action. Snapshots body + sha256 + IP + UA + token_version. `UNIQUE(event_vendor_id)` enforces single signing — don't change. |
| `worker/routes/feedback.js` `POST /api/feedback` | shared with public site + audit-log emitter | Public submission. Honeypot + rate-limit + IP-hash. Don't store raw IP. Don't drop the honeypot field; bots will find it. |
| `worker/routes/admin/feedback.js` `PUT /:id` | shared with public site + other (R2 cascade) | Terminal status flip cascades to R2 attachment delete + `attachment_deleted_at` stamp. Don't decouple — the cascade is the privacy guarantee. |
| `taxes_fees` D1 table | shared with public site + handles payments | Every quote depends on this. Toggling `active` changes customer totals immediately. |
| `email_templates` D1 table | customer-facing email | Admin edits go directly to live; no draft state. Risk of accidental publication via UI. |
| `event_vendors` D1 table | other (vendor portal coupling) | Token state machine: `draft / sent / viewed / revoked / complete`. Bumping `token_version` is the only revoke mechanism. |
| `vendor_contacts` D1 table | handles auth | Both vendor portal session and password set/verify live here. |
| `vendor_documents` D1 table | other (R2 + tokenized download) | Magic-byte sniff is the only line of defense; vendor docs deliberately served via tokenized route, not `/uploads/*`. |
| `audit_log` D1 table | audit-log emitter | Append-only by convention. Renaming `action` strings retroactively breaks the `/admin/audit-log` filter dropdown which builds from distinct existing actions. No retention policy → growing forever (Area 8). |
| `src/components/FeedbackModal.jsx` | shared with public site | One modal serving four call sites (public footer, public Feedback page, admin layout dropdown, admin feedback +button). Test all four after any prop change. |
| `src/styles/global.css` | shared with public site | Loaded once via `src/main.jsx`; applies to admin shell too. Class-name collisions or specificity changes affect both. |
| `worker/index.js` `withSecurityHeaders(...)` (lines 516-529) | shared with public site + other (security) | HSTS / X-CTO / X-Frame-Options DENY / Referrer-Policy / Permissions-Policy applied to every response. Don't relax. CSP is intentionally absent (stale comment at lines 510-515 — Area 8 cleanup, but leave the headers as-is). |
| `worker/lib/auth.js` `requireRole(...)` (role hierarchy: owner > manager > staff) | handles auth | Hierarchy is hard-coded throughout admin routes. Adding a new role tier requires touching every `requireRole(...)` call site. |
| `wrangler.toml` `[assets] run_worker_first = true` | other (correctness) | Without this, Cloudflare's SPA fallback intercepts `/api/*` from browsers and returns 404 HTML. Documented in HANDOFF §13. |
| `migrations/*` | other (DB integrity) | Forward-only by convention. Never rename or delete a previously-applied migration; insert a new one. The two `0010_*` files are an existing red flag — flag for Area 8 but don't fix without owner approval. |

## Medium

| Path | Reason | Modification protocol |
|---|---|---|
| `worker/lib/formatters.js` `safeJson` | shared with public site | Returns fallback on parse error — used widely. Don't throw on parse error; downstream callers don't try/catch. |
| `worker/routes/admin/uploads.js` `POST /image` | other (R2 + magic-bytes) | The only admin path that writes to `events/<key>` keys. Don't change key shape — `/uploads/:key` regex (Area 6 Critical) only allows `<prefix>/<random>.<ext>`. |
| `worker/routes/admin/attendees.js` `POST /:id/send-waiver` | customer-facing email | 409 if already signed; respect that. |
| `worker/routes/admin/users.js` `POST /invite` | customer-facing email + handles auth | Invitation pipeline — owner-only. Token TTL 7 days. |
| `worker/routes/admin/auth.js` `POST /forgot-password`, `POST /reset-password` | handles auth + customer-facing email | Always return 200 from `/forgot-password` to avoid email enumeration. Reset TTL 1 hour. |
| `password_resets` D1 table | handles auth | Single-use, 1hr TTL. Token hashing intentional (raw token never stored). |
| `invitations` D1 table | handles auth | Token TTL 7d. `consumed_at` and `revoked_at` are separate states. |
| `worker/routes/admin/feedback.js` `POST /:id/notify-submitter` | customer-facing email | Sends `feedback_resolution_notice` template. Manual trigger only — never automatic from status flip. |
| `vendor_documents` `kind` column | other (security) | CHECK constraint can't be ALTERed in SQLite, so migration 0012 documents the new valid values in code only. The route layer enforces. Don't add a new kind without updating BOTH the route validators and the migration comment. |

## Lower-risk but worth flagging

These aren't on the do-not-touch list per se, but they have non-obvious behavior:

- `worker/index.js` `parseEventSlug(...)` regex anchoring — `/events/:slug/` and `/events/:slug` both match; `/events` alone does not. If you change this, the OG rewriter coverage shifts.
- `worker/index.js` cron `runReminderSweep` `LIMIT 100` — keeps the sweep inside Workers' CPU budget. If a single event fires 100+ bookings into the same window, the next 15-min tick picks up the leftovers. Documented at line 127.
- `worker/index.js` cron `PENDING_ABANDON_MS = 30 * 60 * 1000` — 30 min cutoff for marking abandoned bookings. The `checkTicketInventory` capacity check already excludes pending rows older than `PENDING_HOLD_MS` (10 min), so this is a UI clean-up, not seat-release.
- `worker/routes/bookings.js` (will read in Area 7) — `PENDING_HOLD_MS` constant inside; coupling with the cron sweep above.

## Items NOT on this list (non-issues)

To prevent future sessions from over-extending the do-not-touch boundary:

- `src/admin/AdminDashboard.jsx`, `src/admin/AdminEvents.jsx`, `src/admin/AdminFeedback.jsx`, etc. — admin-only pages, free to refactor.
- `src/admin/AdminLayout.jsx` — admin chrome, free to refactor (its only cross-boundary import is `FeedbackModal`).
- `src/components/SEO.jsx`, `src/data/siteConfig.js`, `src/components/Layout.jsx` — public-only, but freely modifiable on the public side.
- `worker/lib/auth.js` is High because it powers every admin route, but admin-internal — refactoring allowed if the cookie format and `c.set('user', ...)` shape stay stable.
- `scripts/*.sql` and `tools/cover-banner-builder.html` — one-off operator tools, not part of the deployed Worker.

## Appendix — quick decision rule

Before touching any file or table, ask: **does the change cross the Stripe webhook → bookings → attendees → audit_log path, the waiver POST → waivers → waiver_documents path, or the customer-email path?** If yes, treat as Critical and require a paired test or sandbox dry-run. If unsure, ask the owner.

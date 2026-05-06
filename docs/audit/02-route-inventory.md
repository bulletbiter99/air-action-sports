# 02 — Route Inventory

Complete enumeration of every route the deployed Worker serves. Three layers stack on a single Cloudflare Worker:

1. **Hono router** for `/api/*` (mounted in [worker/index.js:88-113](worker/index.js))
2. **Worker-level handlers** for `/uploads/:key` and `/events/:slug` (the latter rewrites OG meta tags before falling through to the SPA shell)
3. **`env.ASSETS.fetch`** falls through to the static SPA shell for everything else; React Router takes over in the browser via [src/App.jsx](src/App.jsx).

All routes use the auth helpers in [worker/lib/auth.js](worker/lib/auth.js) (`requireAuth` checks the `aas_session` cookie; `requireRole(...roles)` is layered on top). Vendor portal uses [worker/lib/vendorSession.js](worker/lib/vendorSession.js) for the `aas_vendor` cookie. Rate limits live in [worker/lib/rateLimit.js](worker/lib/rateLimit.js).

## Summary counts

| Category | Count |
|---|---|
| Public API endpoints | 12 |
| Customer auth endpoints (waiver / booking lookup) | 3 |
| Vendor public API (token-gated magic link) | 4 |
| Vendor portal auth (cookie session) | 5 |
| Stripe webhook | 1 |
| Health check | 1 |
| Admin API (cookie session, role-gated) | 80 |
| Worker-level handlers | 2 (`/uploads/:key`, `/events/:slug` rewrite) |
| SPA frontend routes (incl. admin sub-routes) | 50 |

## Worker-level handlers

| Path | Handler | Purpose | Code |
|---|---|---|---|
| `/api/*` | Hono `app.fetch` | Routes to sub-routers below | [worker/index.js:533-535](worker/index.js) |
| `/uploads/:key` | `serveUpload` | Streams R2 object with allowlist regex (`^[a-z0-9_-]+/[a-zA-Z0-9_-]+\.(jpg\|jpeg\|png\|webp\|gif)$`); ext-derived MIME (ignores `obj.httpMetadata.contentType`); `Cache-Control: immutable` | [worker/index.js:415-440](worker/index.js) |
| `/events/:slug` | `rewriteEventOg` + `HTMLRewriter` | Looks up event by id-or-slug, injects per-event `<title>`, `og:*`, `twitter:*` tags into the SPA shell. Falls through to plain shell on miss. | [worker/index.js:443-507](worker/index.js) |
| (everything else) | `env.ASSETS.fetch(request)` | SPA shell from `dist/` | [worker/index.js:545](worker/index.js) |
| (all responses) | `withSecurityHeaders` | HSTS, X-CTO, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy. **No CSP** (stale comment at line 510). | [worker/index.js:516-529](worker/index.js) |

## Public API

`/api/*` is served by Hono. CORS is non-wildcarded — origin must equal `env.SITE_URL` ([worker/index.js:43-46](worker/index.js)). Webhook route deliberately has no CORS middleware ([worker/index.js:77](worker/index.js)).

| Method | Path | Auth | Rate limit | Handler | Description |
|---|---|---|---|---|---|
| GET | `/api/health` | none | none | [worker/index.js:86](worker/index.js) | `{ok:true, ts}` |
| GET | `/api/events` | none | none | [worker/routes/events.js:6](worker/routes/events.js) | List published events; `featured DESC, date_iso ASC`; `?include_past=1` includes past |
| GET | `/api/events/:id` | none | none | [worker/routes/events.js:54](worker/routes/events.js) | Resolves by id OR slug; returns event + active ticket types + `seatsSold` |
| GET | `/api/events/:id/ticket-types` | none | none | [worker/routes/events.js:83](worker/routes/events.js) | Active ticket types only |
| GET | `/api/taxes-fees` | none | none | [worker/routes/taxesFees.js:7](worker/routes/taxesFees.js) | Active global tax/fee rows for checkout total preview |
| POST | `/api/bookings/quote` | none | **none** ⚠️ | [worker/routes/bookings.js:98](worker/routes/bookings.js) | Validates cart + previews totals (no booking row written) |
| POST | `/api/bookings/checkout` | none | `RL_CHECKOUT` (10/min) | [worker/routes/bookings.js:155](worker/routes/bookings.js) | Creates pending booking row + Stripe Checkout Session |
| GET | `/api/bookings/:token` | unguessable token | `RL_TOKEN_LOOKUP` (30/min) | [worker/routes/bookings.js:341](worker/routes/bookings.js) | Customer lookup of own booking + attendees + waiver status |
| GET | `/api/waivers/:qrToken` | unguessable QR token | `RL_TOKEN_LOOKUP` | [worker/routes/waivers.js:65](worker/routes/waivers.js) | Loads attendee + live `waiver_documents` row + integrity check |
| POST | `/api/waivers/:qrToken` | unguessable QR token | `RL_TOKEN_LOOKUP` | [worker/routes/waivers.js:127](worker/routes/waivers.js) | Submits signed waiver, snapshots `body_html` + sha256 + `erecordsConsent` |
| POST | `/api/feedback/attachment` | none (honeypot) | `RL_FEEDBACK_UPLOAD` (3/min) | [worker/routes/feedback.js:40](worker/routes/feedback.js) | Multipart screenshot upload; magic-byte sniff for image-only |
| POST | `/api/feedback` | none (honeypot, IP-hashed) | `RL_FEEDBACK` (3/min) | [worker/routes/feedback.js:91](worker/routes/feedback.js) | Public feedback submission |
| POST | `/api/webhooks/stripe` | Stripe webhook signature | none (signature gate) | [worker/routes/webhooks.js:36](worker/routes/webhooks.js) | Stripe Checkout completion → flip booking to paid + create attendees + send confirmation |

⚠️ `/api/bookings/quote` is **not** rate-limited. The endpoint is read-only and does no DB writes, but it does call `env.DB.prepare()` and is reachable by any origin matching `SITE_URL`. Flagged for Area 8.

## Vendor portal API

Vendor magic-link is token-gated by HMAC ([worker/lib/vendorToken.js](worker/lib/vendorToken.js)) signed with `SESSION_SECRET`; bumping `event_vendors.token_version` invalidates outstanding tokens. The optional vendor password portal uses a separate `aas_vendor` cookie session ([worker/lib/vendorSession.js](worker/lib/vendorSession.js)).

### Token-gated (mounted at `/api/vendor`)

| Method | Path | Auth | Rate limit | Handler | Description |
|---|---|---|---|---|---|
| GET | `/api/vendor/:token` | HMAC token | `RL_TOKEN_LOOKUP` | [worker/routes/vendor.js:112](worker/routes/vendor.js) | Vendor package payload (sections + docs + contract status); stamps view timestamps; logs to `vendor_access_log` |
| POST | `/api/vendor/:token/sign` | HMAC token | `RL_TOKEN_LOOKUP` | [worker/routes/vendor.js:216](worker/routes/vendor.js) | Sign live contract document; snapshots body + sha256 + typed_name + IP + UA |
| POST | `/api/vendor/:token/upload` | HMAC token | `RL_TOKEN_LOOKUP` | [worker/routes/vendor.js:290](worker/routes/vendor.js) | Vendor-side upload (kind: coi/w9/vendor_return); 10MB cap; magic-byte sniff inc. PDF |
| GET | `/api/vendor/:token/doc/:id` | HMAC token | `RL_TOKEN_LOOKUP` | [worker/routes/vendor.js:374](worker/routes/vendor.js) | Tokenized download; logs to `vendor_access_log`; `Content-Disposition: attachment` |

### Vendor cookie auth (mounted at `/api/vendor/auth`)

| Method | Path | Auth | Rate limit | Handler | Description |
|---|---|---|---|---|---|
| POST | `/api/vendor/auth/set-password` | valid magic-link token | `RL_RESET_PWD` (5/min) | [worker/routes/vendorAuth.js:57](worker/routes/vendorAuth.js) | Sets password on primary contact (no email verification — fresh magic link suffices) |
| POST | `/api/vendor/auth/login` | none (issues cookie) | `RL_LOGIN` (5/min) | [worker/routes/vendorAuth.js:97](worker/routes/vendorAuth.js) | Email + password → `aas_vendor` cookie (30d) |
| POST | `/api/vendor/auth/logout` | `aas_vendor` cookie | none | [worker/routes/vendorAuth.js:135](worker/routes/vendorAuth.js) | Bumps `session_version`, clears cookie |
| GET | `/api/vendor/auth/me` | `aas_vendor` cookie (optional) | none | [worker/routes/vendorAuth.js:148](worker/routes/vendorAuth.js) | Returns current contact or `{contact: null}` |
| GET | `/api/vendor/auth/my-packages` | `aas_vendor` cookie | none | [worker/routes/vendorAuth.js:166](worker/routes/vendorAuth.js) | Lists every non-revoked event_vendor for this email; mints fresh 24h tokens per row |

> **JD/HANDOFF mismatch**: HANDOFF.md §7 lists this as `/api/vendor/auth/my-packages`. The route is correctly mounted at `/api/vendor/auth/my-packages` (auth router under `/api/vendor/auth`). Some written notes elsewhere may say `/api/vendor/my-packages` — that is **not** what the code serves.

## Admin API

All routes mounted under `/api/admin/*`. Each sub-router applies `requireAuth` middleware globally (`use('*', requireAuth)`) — except `/api/admin/auth` which exposes specific endpoints publicly (setup-needed, login, forgot-password, etc.) and gates `/me` individually.

Role hierarchy: **owner > manager > staff** ([worker/lib/auth.js](worker/lib/auth.js)). `requireRole('owner', 'manager')` allows either.

### Admin auth (mounted at `/api/admin/auth`)

| Method | Path | Auth | Rate limit | Handler | Description |
|---|---|---|---|---|---|
| GET | `/api/admin/auth/setup-needed` | public | none | [worker/routes/admin/auth.js:19](worker/routes/admin/auth.js) | True iff zero users exist |
| POST | `/api/admin/auth/setup` | public-when-empty | none | [worker/routes/admin/auth.js:28](worker/routes/admin/auth.js) | Bootstrap first owner (race-safe insert) |
| POST | `/api/admin/auth/login` | public | `RL_LOGIN` | [worker/routes/admin/auth.js:63](worker/routes/admin/auth.js) | Email + password → `aas_session` cookie |
| POST | `/api/admin/auth/logout` | `aas_session` | none | [worker/routes/admin/auth.js:91](worker/routes/admin/auth.js) | Bumps session version |
| GET | `/api/admin/auth/me` | `requireAuth` (explicit) | none | [worker/routes/admin/auth.js:109](worker/routes/admin/auth.js) | Current user |
| POST | `/api/admin/auth/forgot-password` | public (always 200) | `RL_FORGOT` (3/min) | [worker/routes/admin/auth.js:118](worker/routes/admin/auth.js) | Issues reset token; emails it; 1hr TTL |
| GET | `/api/admin/auth/verify-reset-token/:token` | public | `RL_VERIFY_TOKEN` (10/min) | [worker/routes/admin/auth.js:277](worker/routes/admin/auth.js) | Validates without consuming |
| POST | `/api/admin/auth/reset-password` | reset token | `RL_RESET_PWD` | [worker/routes/admin/auth.js:163](worker/routes/admin/auth.js) | Consumes token, sets password, auto-login |
| GET | `/api/admin/auth/verify-invite/:token` | public | `RL_VERIFY_TOKEN` | [worker/routes/admin/auth.js:215](worker/routes/admin/auth.js) | Validates invite without consuming |
| POST | `/api/admin/auth/accept-invite` | invite token | `RL_RESET_PWD` | [worker/routes/admin/auth.js:227](worker/routes/admin/auth.js) | Consumes token, creates user, auto-login |

### Bookings (mounted at `/api/admin/bookings`)

All `requireAuth`. `/manual`, `/refund`, `/resend-confirmation` further gated by `requireRole('owner','manager')`.

| Method | Path | Role | Handler | Description |
|---|---|---|---|---|
| GET | `/api/admin/bookings` | staff+ | [admin/bookings.js:25](worker/routes/admin/bookings.js) | List w/ filters: q, status, event_id, from, to |
| GET | `/api/admin/bookings/:id` | staff+ | [admin/bookings.js:61](worker/routes/admin/bookings.js) | Single booking + event + attendees + customAnswers |
| GET | `/api/admin/bookings/stats/summary` | staff+ | [admin/bookings.js:479](worker/routes/admin/bookings.js) | Top-line stats |
| POST | `/api/admin/bookings/manual` | manager+ | [admin/bookings.js:98](worker/routes/admin/bookings.js) | Walk-in / comp / venmo / paypal / cash (card branch mints Stripe Session) |
| POST | `/api/admin/bookings/:id/refund` | manager+ | [admin/bookings.js:390](worker/routes/admin/bookings.js) | Stripe refund (if not cash) |
| POST | `/api/admin/bookings/:id/resend-confirmation` | manager+ | [admin/bookings.js:445](worker/routes/admin/bookings.js) | Re-send `booking_confirmation` template |

### Attendees (mounted at `/api/admin/attendees`)

All `requireAuth` only — staff sufficient.

| Method | Path | Role | Handler | Description |
|---|---|---|---|---|
| GET | `/api/admin/attendees/by-qr/:qrToken` | staff+ | [admin/attendees.js:12](worker/routes/admin/attendees.js) | Scanner snapshot for /admin/scan |
| POST | `/api/admin/attendees/:id/check-in` | staff+ | [admin/attendees.js:81](worker/routes/admin/attendees.js) | Idempotent check-in |
| POST | `/api/admin/attendees/:id/check-out` | staff+ | [admin/attendees.js:103](worker/routes/admin/attendees.js) | Reverse |
| PUT | `/api/admin/attendees/:id` | staff+ | [admin/attendees.js:131](worker/routes/admin/attendees.js) | Edit name/email/phone (waiver signature untouched) |
| POST | `/api/admin/attendees/:id/send-waiver` | staff+ | [admin/attendees.js:205](worker/routes/admin/attendees.js) | Re-email waiver link; 409 if already signed |

### Events (mounted at `/api/admin/events`) + ticket types (separate mount `/api/admin/ticket-types`)

| Method | Path | Role | Handler | Description |
|---|---|---|---|---|
| GET | `/api/admin/events` | staff+ | [admin/events.js:108](worker/routes/admin/events.js) | All events incl unpublished |
| GET | `/api/admin/events/:id/detail` | staff+ | [admin/events.js:250](worker/routes/admin/events.js) | All ticket types incl inactive |
| GET | `/api/admin/events/:id/roster` | staff+ | [admin/events.js:142](worker/routes/admin/events.js) | Roster JSON |
| GET | `/api/admin/events/:id/roster.csv` | staff+ | [admin/events.js:191](worker/routes/admin/events.js) | CSV with `q_<key>` columns for custom questions |
| POST | `/api/admin/events` | manager+ | [admin/events.js:294](worker/routes/admin/events.js) | Create (draft by default; auto-creates default ticket type; preflights image URLs) |
| PUT | `/api/admin/events/:id` | manager+ | [admin/events.js:393](worker/routes/admin/events.js) | Update (publish guard rejects without active ticket types) |
| DELETE | `/api/admin/events/:id` | owner | [admin/events.js:443](worker/routes/admin/events.js) | Archive if bookings exist, else delete |
| POST | `/api/admin/events/:id/duplicate` | manager+ | [admin/events.js:477](worker/routes/admin/events.js) | Clone as draft, sold=0, copies all image columns |
| POST | `/api/admin/events/:id/ticket-types` | manager+ | [admin/events.js:579](worker/routes/admin/events.js) | Add ticket type to event |
| PUT | `/api/admin/ticket-types/:id` | manager+ | [admin/events.js:622](worker/routes/admin/events.js) (separate `ticketTypes` router) | Capacity ≥ sold guard |
| DELETE | `/api/admin/ticket-types/:id` | manager+ | [admin/events.js:656](worker/routes/admin/events.js) | Deactivate if sold, else delete |

### Analytics (mounted at `/api/admin/analytics`)

All `requireAuth` only — staff sufficient.

| Method | Path | Role | Handler | Description |
|---|---|---|---|---|
| GET | `/api/admin/analytics/overview` | staff+ | [admin/analytics.js:9](worker/routes/admin/analytics.js) | Net/gross/refunded + attendee rollups; optional `?event_id=` |
| GET | `/api/admin/analytics/sales-series` | staff+ | [admin/analytics.js:65](worker/routes/admin/analytics.js) | `?days=7\|30\|90\|365`, fills gaps with zeros |
| GET | `/api/admin/analytics/per-event` | staff+ | [admin/analytics.js:113](worker/routes/admin/analytics.js) | Fill rate, net revenue, waiver %, check-in % |
| GET | `/api/admin/analytics/attendance/:eventId` | staff+ | [admin/analytics.js:197](worker/routes/admin/analytics.js) | Hourly check-in buckets |
| GET | `/api/admin/analytics/cron-status` | staff+ | [admin/analytics.js:233](worker/routes/admin/analytics.js) | Last `cron.swept` audit row + 24h reminder counts |

### Audit log (mounted at `/api/admin/audit-log`)

| Method | Path | Role | Handler |
|---|---|---|---|
| GET | `/api/admin/audit-log` | manager+ | [admin/auditLog.js:10](worker/routes/admin/auditLog.js) |
| GET | `/api/admin/audit-log/actions` | manager+ | [admin/auditLog.js:75](worker/routes/admin/auditLog.js) |

### Email templates (mounted at `/api/admin/email-templates`)

| Method | Path | Role | Handler |
|---|---|---|---|
| GET | `/api/admin/email-templates` | manager+ | [admin/emailTemplates.js:50](worker/routes/admin/emailTemplates.js) |
| GET | `/api/admin/email-templates/:slug` | manager+ | [admin/emailTemplates.js:58](worker/routes/admin/emailTemplates.js) |
| GET | `/api/admin/email-templates/:slug/preview` | manager+ | [admin/emailTemplates.js:67](worker/routes/admin/emailTemplates.js) |
| PUT | `/api/admin/email-templates/:slug` | owner | [admin/emailTemplates.js:75](worker/routes/admin/emailTemplates.js) |
| POST | `/api/admin/email-templates/:slug/send-test` | owner | [admin/emailTemplates.js:122](worker/routes/admin/emailTemplates.js) |

### Promo codes, taxes/fees, uploads, rentals, users, vendors, event-vendors, vendor-contracts, waiver-documents, feedback (admin)

| Method | Path | Role | Handler |
|---|---|---|---|
| GET | `/api/admin/promo-codes` | staff+ | [admin/promoCodes.js:79](worker/routes/admin/promoCodes.js) |
| GET | `/api/admin/promo-codes/:id` | staff+ | [admin/promoCodes.js:100](worker/routes/admin/promoCodes.js) |
| POST | `/api/admin/promo-codes` | manager+ | [admin/promoCodes.js:107](worker/routes/admin/promoCodes.js) |
| PUT | `/api/admin/promo-codes/:id` | manager+ | [admin/promoCodes.js:143](worker/routes/admin/promoCodes.js) |
| DELETE | `/api/admin/promo-codes/:id` | owner | [admin/promoCodes.js:178](worker/routes/admin/promoCodes.js) |
| GET | `/api/admin/taxes-fees` | staff+ | [admin/taxesFees.js:28](worker/routes/admin/taxesFees.js) |
| POST | `/api/admin/taxes-fees` | manager+ | [admin/taxesFees.js:35](worker/routes/admin/taxesFees.js) |
| PUT | `/api/admin/taxes-fees/:id` | manager+ | [admin/taxesFees.js:65](worker/routes/admin/taxesFees.js) |
| DELETE | `/api/admin/taxes-fees/:id` | owner | [admin/taxesFees.js:101](worker/routes/admin/taxesFees.js) |
| POST | `/api/admin/uploads/image` | manager+ | [admin/uploads.js:78](worker/routes/admin/uploads.js) |
| POST | `/api/admin/uploads/vendor-doc` | manager+ | [admin/uploads.js:149](worker/routes/admin/uploads.js) |
| DELETE | `/api/admin/uploads/vendor-doc/:id` | manager+ | [admin/uploads.js:255](worker/routes/admin/uploads.js) |
| GET | `/api/admin/rentals/items` | staff+ | [admin/rentals.js:57](worker/routes/admin/rentals.js) |
| GET | `/api/admin/rentals/items/:id` | staff+ | [admin/rentals.js:111](worker/routes/admin/rentals.js) |
| POST | `/api/admin/rentals/items` | manager+ | [admin/rentals.js:139](worker/routes/admin/rentals.js) |
| PUT | `/api/admin/rentals/items/:id` | manager+ | [admin/rentals.js:177](worker/routes/admin/rentals.js) |
| DELETE | `/api/admin/rentals/items/:id` | owner | [admin/rentals.js:230](worker/routes/admin/rentals.js) |
| GET | `/api/admin/rentals/assignments` | staff+ | [admin/rentals.js:258](worker/routes/admin/rentals.js) |
| POST | `/api/admin/rentals/assignments` | staff+ | [admin/rentals.js:291](worker/routes/admin/rentals.js) |
| POST | `/api/admin/rentals/assignments/:id/return` | staff+ | [admin/rentals.js:326](worker/routes/admin/rentals.js) |
| GET | `/api/admin/rentals/lookup/:token` | staff+ | [admin/rentals.js:368](worker/routes/admin/rentals.js) |
| GET | `/api/admin/users` | manager+ | [admin/users.js:25](worker/routes/admin/users.js) |
| GET | `/api/admin/users/invitations` | manager+ | [admin/users.js:34](worker/routes/admin/users.js) |
| POST | `/api/admin/users/invite` | owner | [admin/users.js:62](worker/routes/admin/users.js) |
| DELETE | `/api/admin/users/invitations/:token` | owner | [admin/users.js:113](worker/routes/admin/users.js) |
| PUT | `/api/admin/users/:id` | owner | [admin/users.js:132](worker/routes/admin/users.js) |
| GET | `/api/admin/vendors` | staff+ | [admin/vendors.js:56](worker/routes/admin/vendors.js) |
| POST | `/api/admin/vendors` | manager+ | [admin/vendors.js:78](worker/routes/admin/vendors.js) |
| GET | `/api/admin/vendors/:id` | staff+ | [admin/vendors.js:108](worker/routes/admin/vendors.js) |
| PUT | `/api/admin/vendors/:id` | manager+ | [admin/vendors.js:146](worker/routes/admin/vendors.js) |
| DELETE | `/api/admin/vendors/:id` | owner | [admin/vendors.js:179](worker/routes/admin/vendors.js) |
| POST | `/api/admin/vendors/:id/contacts` | manager+ | [admin/vendors.js:210](worker/routes/admin/vendors.js) |
| PUT | `/api/admin/vendors/contacts/:id` | manager+ | [admin/vendors.js:255](worker/routes/admin/vendors.js) |
| DELETE | `/api/admin/vendors/contacts/:id` | manager+ | [admin/vendors.js:291](worker/routes/admin/vendors.js) |
| GET | `/api/admin/event-vendors` | staff+ | [admin/eventVendors.js:87](worker/routes/admin/eventVendors.js) |
| POST | `/api/admin/event-vendors` | manager+ | [admin/eventVendors.js:125](worker/routes/admin/eventVendors.js) |
| GET | `/api/admin/event-vendors/:id` | staff+ | [admin/eventVendors.js:173](worker/routes/admin/eventVendors.js) |
| PUT | `/api/admin/event-vendors/:id` | manager+ | [admin/eventVendors.js:234](worker/routes/admin/eventVendors.js) |
| DELETE | `/api/admin/event-vendors/:id` | owner | [admin/eventVendors.js:283](worker/routes/admin/eventVendors.js) |
| POST | `/api/admin/event-vendors/:id/sections` | manager+ | [admin/eventVendors.js:300](worker/routes/admin/eventVendors.js) |
| PUT | `/api/admin/event-vendors/:id/sections/:sid` | manager+ | [admin/eventVendors.js:336](worker/routes/admin/eventVendors.js) |
| DELETE | `/api/admin/event-vendors/:id/sections/:sid` | manager+ | [admin/eventVendors.js:370](worker/routes/admin/eventVendors.js) |
| POST | `/api/admin/event-vendors/:id/send` | manager+ | [admin/eventVendors.js:387](worker/routes/admin/eventVendors.js) |
| POST | `/api/admin/event-vendors/:id/revoke` | manager+ | [admin/eventVendors.js:470](worker/routes/admin/eventVendors.js) |
| PUT | `/api/admin/event-vendors/:id/contract` | manager+ | [admin/eventVendors.js:490](worker/routes/admin/eventVendors.js) |
| POST | `/api/admin/event-vendors/:id/countersign` | owner | [admin/eventVendors.js:520](worker/routes/admin/eventVendors.js) |
| GET | `/api/admin/event-vendors/:id/signature` | staff+ | [admin/eventVendors.js:587](worker/routes/admin/eventVendors.js) |
| GET | `/api/admin/vendor-contracts` | staff+ | [admin/vendorContracts.js:45](worker/routes/admin/vendorContracts.js) |
| POST | `/api/admin/vendor-contracts` | owner | [admin/vendorContracts.js:54](worker/routes/admin/vendorContracts.js) |
| GET | `/api/admin/vendor-contracts/current` | staff+ | [admin/vendorContracts.js:89](worker/routes/admin/vendorContracts.js) |
| POST | `/api/admin/vendor-contracts/:id/retire` | owner | [admin/vendorContracts.js:99](worker/routes/admin/vendorContracts.js) |
| GET | `/api/admin/waiver-documents` | staff+ | [admin/waiverDocuments.js:45](worker/routes/admin/waiverDocuments.js) |
| POST | `/api/admin/waiver-documents` | owner | [admin/waiverDocuments.js:56](worker/routes/admin/waiverDocuments.js) |
| GET | `/api/admin/waiver-documents/current` | staff+ | [admin/waiverDocuments.js:90](worker/routes/admin/waiverDocuments.js) |
| POST | `/api/admin/waiver-documents/:id/retire` | owner | [admin/waiverDocuments.js:101](worker/routes/admin/waiverDocuments.js) |
| GET | `/api/admin/feedback` | staff+ | [admin/feedback.js:56](worker/routes/admin/feedback.js) |
| GET | `/api/admin/feedback/summary` | staff+ | [admin/feedback.js:115](worker/routes/admin/feedback.js) |
| GET | `/api/admin/feedback/:id` | staff+ | [admin/feedback.js:123](worker/routes/admin/feedback.js) |
| PUT | `/api/admin/feedback/:id` | staff+ (note-only) / manager+ (status, priority) | [admin/feedback.js:133](worker/routes/admin/feedback.js) |
| GET | `/api/admin/feedback/:id/notify-preview` | manager+ | [admin/feedback.js:221](worker/routes/admin/feedback.js) |
| POST | `/api/admin/feedback/:id/notify-submitter` | manager+ | [admin/feedback.js:236](worker/routes/admin/feedback.js) |
| DELETE | `/api/admin/feedback/:id` | owner | [admin/feedback.js:257](worker/routes/admin/feedback.js) |

## SPA frontend routes

Defined in [src/App.jsx:58-119](src/App.jsx). All lazy-loaded via dynamic `import()`.

### Public (Layout-wrapped)

| Path | Component | Notes |
|---|---|---|
| `/` | `pages/Home.jsx` | Reads earliest upcoming event from D1 via `useEvents` for hero countdown |
| `/events` | `pages/Events.jsx` | Card grid; uses `cardImageUrl ?? coverImageUrl` |
| `/events/:slug` | `pages/EventDetail.jsx` | Server-side OG rewriter ([worker/index.js:443](worker/index.js)) injects per-event meta before SPA renders |
| `/locations` | `pages/Locations.jsx` | Static `src/data/locations.js` |
| `/gallery` | `pages/Gallery.jsx` | Static |
| `/pricing` | `pages/Pricing.jsx` | Static |
| `/faq` | `pages/FAQ.jsx` | Static |
| `/booking` | `pages/Booking.jsx` | 3-step flow |
| `/booking/success` | `pages/BookingSuccess.jsx` | `?token=<bookingToken>` |
| `/booking/cancelled` | `pages/BookingCancelled.jsx` | Customer aborted Stripe |
| `/booking/ticket` | `pages/Ticket.jsx` | `?token=<qrToken>`; auto `window.print()` |
| `/waiver` | `pages/Waiver.jsx` | `?token=<qrToken>` |
| `/contact` | `pages/Contact.jsx` | Static |
| `/about` | `pages/About.jsx` | Static |
| `/new-players` | `pages/NewPlayers.jsx` | Static |
| `/rules-of-engagement` | `pages/RulesOfEngagement.jsx` | 15-section ROE |
| `/privacy` | `pages/Privacy.jsx` | Static |
| `/feedback` | `pages/Feedback.jsx` | Standalone Share Feedback page |
| `*` | `pages/NotFound.jsx` | Catch-all |

### Vendor portal (no public Layout)

| Path | Component |
|---|---|
| `/v/:token` | `pages/VendorPackage.jsx` (standalone — no public chrome) |
| `/vendor/login` | `pages/VendorLogin.jsx` |
| `/vendor/dashboard` | `pages/VendorDashboard.jsx` |

### Admin (AdminLayout-wrapped)

| Path | Component | Notes |
|---|---|---|
| `/admin` | `admin/AdminDashboard.jsx` | Stats + bookings table inline (no separate `/admin/bookings` route) |
| `/admin/login` | `admin/AdminLogin.jsx` | |
| `/admin/setup` | `admin/AdminSetup.jsx` | First-owner bootstrap |
| `/admin/forgot-password` | `admin/AdminForgotPassword.jsx` | |
| `/admin/reset-password` | `admin/AdminResetPassword.jsx` | `?token=<reset>` |
| `/admin/accept-invite` | `admin/AdminAcceptInvite.jsx` | `?token=<invite>` |
| `/admin/roster` | `admin/AdminRoster.jsx` | Auto-selects next upcoming event |
| `/admin/new-booking` | `admin/AdminNewBooking.jsx` | Manual / walk-in flow |
| `/admin/scan` | `admin/AdminScan.jsx` | Camera QR scanner |
| `/admin/rentals` | `admin/AdminRentals.jsx` | |
| `/admin/rentals/qr-sheet` | `admin/AdminRentals.jsx` (named export `AdminRentalQrSheet`) | Printable QR sheet |
| `/admin/rentals/assignments` | `admin/AdminRentalAssignments.jsx` | |
| `/admin/events` | `admin/AdminEvents.jsx` | CRUD with 5 image pickers |
| `/admin/promo-codes` | `admin/AdminPromoCodes.jsx` | |
| `/admin/analytics` | `admin/AdminAnalytics.jsx` | Custom SVG charts (`admin/charts.jsx`) |
| `/admin/users` | `admin/AdminUsers.jsx` | |
| `/admin/audit-log` | `admin/AdminAuditLog.jsx` | |
| `/admin/settings` | `admin/AdminSettings.jsx` | Hub |
| `/admin/settings/taxes-fees` | `admin/AdminTaxesFees.jsx` | |
| `/admin/settings/email-templates` | `admin/AdminEmailTemplates.jsx` | Live iframe preview, send test |
| `/admin/vendors` | `admin/AdminVendors.jsx` | Directory + contacts |
| `/admin/vendor-packages` | `admin/AdminVendorPackages.jsx` | List |
| `/admin/vendor-packages/:id` | `admin/AdminVendorPackages.jsx` (same component) | Composer |
| `/admin/vendor-contracts` | `admin/AdminVendorContracts.jsx` | Versioned contract docs |
| `/admin/waivers` | `admin/AdminWaivers.jsx` | Versioned waiver docs |
| `/admin/feedback` | `admin/AdminFeedback.jsx` | Triage queue |

## Cross-reference: JD-promised admin routes

The job-description doc names these admin routes; reconciling against `src/App.jsx` and `worker/routes/admin/*`:

### JD-promised routes that exist as frontend pages

| JD path | Frontend route | API backing |
|---|---|---|
| `/admin` | ✓ [src/App.jsx:89](src/App.jsx) → `AdminDashboard` | `/api/admin/auth/me`, `/api/admin/bookings`, `/api/admin/analytics/cron-status` |
| `/admin/feedback` | ✓ [src/App.jsx:114](src/App.jsx) → `AdminFeedback` | `/api/admin/feedback*` |
| `/admin/new-booking` | ✓ [src/App.jsx:93](src/App.jsx) → `AdminNewBooking` | `/api/admin/bookings/manual` |
| `/admin/roster` | ✓ [src/App.jsx:92](src/App.jsx) → `AdminRoster` | `/api/admin/events/:id/roster` |
| `/admin/scan` | ✓ [src/App.jsx:99](src/App.jsx) → `AdminScan` | `/api/admin/attendees/by-qr/:qrToken`, `/api/admin/rentals/lookup/:token` |
| `/admin/rentals` | ✓ [src/App.jsx:100](src/App.jsx) → `AdminRentals` | `/api/admin/rentals/*` |
| `/admin/rentals/qr-sheet` | ✓ [src/App.jsx:101](src/App.jsx) → named export `AdminRentalQrSheet` | (read-only, prints from local data) |
| `/admin/events` | ✓ [src/App.jsx:103](src/App.jsx) → `AdminEvents` | `/api/admin/events/*` |
| `/admin/analytics` | ✓ [src/App.jsx:105](src/App.jsx) → `AdminAnalytics` | `/api/admin/analytics/*` |
| `/admin/users` | ✓ [src/App.jsx:106](src/App.jsx) → `AdminUsers` | `/api/admin/users/*` |
| `/admin/audit-log` | ✓ [src/App.jsx:108](src/App.jsx) → `AdminAuditLog` | `/api/admin/audit-log` |
| `/admin/waivers` | ✓ [src/App.jsx:113](src/App.jsx) → `AdminWaivers` | `/api/admin/waiver-documents/*` |
| `/admin/vendors` | ✓ [src/App.jsx:109](src/App.jsx) → `AdminVendors` | `/api/admin/vendors/*` |

### JD-promised routes that do NOT exist (gap list)

These are paths the prompt asked us to specifically check for. The interpretation depends on whether they are SPA routes or API paths:

| JD path | Status | Notes |
|---|---|---|
| `/admin/bookings` | ✗ no SPA route | Bookings table is rendered inline within `/admin` (AdminDashboard). The API path `/api/admin/bookings` exists and is the data source. If a dedicated `/admin/bookings` page is desired in Phase 2+, the API is ready. |
| `/admin/bookings/:id/refund` | ✗ no SPA route | Refund is a modal in AdminDashboard, not a route. The API path `POST /api/admin/bookings/:id/refund` exists. |
| `/admin/analytics/overview` | ✗ no SPA route | This is an **API** path (`GET /api/admin/analytics/overview`); the SPA route is `/admin/analytics`. The JD's mention of "Dashboard Home" pointing here likely meant the API as a "view" — flag for Area 8 / Area 10 as a JD-vs-code naming drift. |

**Conclusion**: every meaningful JD admin path has a frontend page or a documented API path. The "missing" rows are JDs naming API paths as if they were UI pages — a JD documentation issue, not a code gap.

## Notable middleware observations

- **All `/api/*` responses** get `Cache-Control: no-store` ([worker/index.js:80-84](worker/index.js))
- **Webhook route deliberately omits CORS** ([worker/index.js:77](worker/index.js)) — server-to-server only
- **Admin sub-router pattern**: every admin sub-router does `xxx.use('*', requireAuth)` at file top, so ANY new handler added to that file automatically gets auth — pattern is hard to bypass accidentally. Confirmed in 17 admin route files.
- **Public + admin both use the same `/api/admin/auth/setup` endpoint as a public-when-empty bootstrap** — race-safe via `INSERT WHERE NOT EXISTS` ([admin/auth.js:28](worker/routes/admin/auth.js)), but anyone can hit it before the first owner exists. Acceptable in current threat model; flag for Area 8.
- **Body-size guard** is at `worker/lib/bodyGuard.js` — confirm coverage in Area 8.

## Cross-area follow-ups

- `/api/bookings/quote` is unlimited-rate and does DB reads — Area 8 should call this out. (Backed by HANDOFF §10 row "Tax/fee bug fixes (post-audit)" finding #3, which fixed totals math but did not add a rate limit.)
- The OG-rewrite handler at `/events/:slug` runs a D1 lookup on **every** request. Cheap but uncached. Mentioned in HANDOFF §13 as a known constraint; verify in Area 8.
- The static `robots.txt` and `sitemap.xml` at repo root are dead files — `public/` versions are what Vite ships. Flag for Area 8.
- `AdminLayout` catches anything under `/admin/*` that isn't matched by a sub-route → React Router falls back to its own 404 inside the AdminLayout (the index `*` only fires inside the public Layout). Confirm in Area 7.

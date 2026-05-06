# 04 — Integration Map

External services, where they're called from, what they handle, secret-name inventory, retry/idempotency posture, and the in-house "waiver service" (which is not external — it lives in this repo).

## Stripe

| Concern | Value | Evidence |
|---|---|---|
| SDK | **None** — bespoke `fetch()` wrapper | [worker/lib/stripe.js](worker/lib/stripe.js) |
| API version | **Not pinned** — no `Stripe-Version` header sent. Stripe defaults the request to the account's locked API version. Risk: if the account version is bumped, response shapes can change without a code change. | [worker/lib/stripe.js:6-19](worker/lib/stripe.js) |
| Endpoints called | `POST /v1/checkout/sessions`, `GET /v1/checkout/sessions/:id`, `POST /v1/refunds` | [worker/lib/stripe.js:31-79](worker/lib/stripe.js) |
| Payment methods enabled | **`card` only** | [worker/lib/stripe.js:44](worker/lib/stripe.js) (`payment_method_types[]: 'card'`) |
| Mode | **Sandbox / test keys** today (per HANDOFF §11 row 1 — flip to live is the pre-launch blocker) | HANDOFF.md |
| Idempotency | `Idempotency-Key` header supported on every call when caller passes one. Refunds in [admin/bookings.js:390](worker/routes/admin/bookings.js) — verify caller passes a key in Area 8. | [worker/lib/stripe.js:13](worker/lib/stripe.js) |
| Webhook secret | `STRIPE_WEBHOOK_SECRET` | [worker/routes/webhooks.js:37-41](worker/routes/webhooks.js) |
| Webhook signature verification | Manual HMAC-SHA256 implementation. Accepts multiple `v1=` values for rotation; 5-minute timestamp tolerance; constant-time compare. | [worker/lib/stripe.js:88-130](worker/lib/stripe.js) |
| Webhook events consumed | **`checkout.session.completed` only**. All other events accepted with `200 {received: true}` and silently ignored. | [worker/routes/webhooks.js:58-66](worker/routes/webhooks.js) |
| Idempotency on receipt | If the matching booking row's `status === 'paid'` already, handler returns early with no DB writes. | [worker/routes/webhooks.js:115-116](worker/routes/webhooks.js) |
| Metadata pattern | Booking ID and a `source` discriminator (`'admin_manual'` vs default for public flow) carried as Stripe `metadata`. | (will verify caller pattern in Area 5) |

### What's NOT consumed from Stripe

These webhook event types are not handled — failures will not surface in admin:

- `charge.refunded` (refund completion outside admin UI)
- `charge.dispute.created` / `.updated` / `.closed` (chargeback lifecycle)
- `payment_intent.payment_failed`
- `customer.subscription.*` (irrelevant — no subscriptions)
- `radar.*` (fraud notifications)

For a one-time-events business this is mostly fine, but **chargebacks will surprise the operator** because nothing in-app records them. Flag for Area 8.

## Resend

| Concern | Value | Evidence |
|---|---|---|
| SDK | **None** — bespoke `fetch()` wrapper | [worker/lib/email.js](worker/lib/email.js) |
| Endpoint | `POST https://api.resend.com/emails` | [worker/lib/email.js:3](worker/lib/email.js) |
| Domain | `airactionsport.com` (verified per HANDOFF §12) | wrangler.toml `FROM_EMAIL` |
| From | `Air Action Sports <noreply@airactionsport.com>` | [wrangler.toml:31](wrangler.toml) |
| Reply-To | `actionairsport@gmail.com` | [wrangler.toml:32](wrangler.toml) |
| DKIM / SPF / DMARC | DKIM CNAMEs **not yet configured** for outbound; SPF set for Cloudflare Email Routing only; DMARC TXT **missing** (per HANDOFF §11). All three are pre-launch DNS items, owner-side. | HANDOFF.md §11 |
| Bounce / complaint handling | **None.** No webhook from Resend, no bounced-email tracking, no suppression list. | confirmed by absence of any Resend webhook route in [worker/index.js](worker/index.js) |
| Tag pattern | Every send carries 1–2 tags: `type=<template_slug>` plus an ID tag (`booking_id`, `attendee_id`, `feedback_id`). | [worker/lib/emailSender.js:58-62](worker/lib/emailSender.js) etc. |
| Templates | Stored in D1 `email_templates` table (slug + subject + body_html + body_text + variables_json). Edit at `/admin/settings/email-templates`. | [worker/lib/templates.js](worker/lib/templates.js) (variable interpolation) |
| Sender library | [worker/lib/emailSender.js](worker/lib/emailSender.js) — one function per template |
| Templates currently seeded | 16 — `booking_confirmation`, `admin_notify`, `waiver_request`, `event_reminder_24h`, `event_reminder_1hr`, `user_invite`, `password_reset`, `vendor_package_sent`, `vendor_package_reminder`, `vendor_signature_requested`, `vendor_countersigned`, `vendor_coi_expiring`, `vendor_package_updated`, `admin_vendor_return`, `admin_feedback_received`, `feedback_resolution_notice` (per HANDOFF §12) |

### Resend call sites

| Caller | Templates | Trigger |
|---|---|---|
| `worker/routes/webhooks.js` | `booking_confirmation`, `admin_notify`, `waiver_request` (skip if attendee.waiver_id set by auto-link) | Stripe webhook completion |
| `worker/routes/admin/bookings.js` | Same three; plus `booking_confirmation` resend on demand | Manual booking + resend-confirmation button |
| `worker/index.js` (cron) | `event_reminder_24h`, `event_reminder_1hr`, `vendor_package_reminder`, `vendor_signature_requested`, `vendor_coi_expiring` | Scheduled sweeps every 15 min |
| `worker/routes/admin/users.js` | `user_invite` | Owner invites new admin |
| `worker/routes/admin/auth.js` | `password_reset` | `/api/admin/auth/forgot-password` |
| `worker/routes/admin/attendees.js` | `waiver_request` | Resend waiver button (`/api/admin/attendees/:id/send-waiver`) |
| `worker/routes/admin/eventVendors.js` | `vendor_package_sent`, `vendor_package_updated`, `vendor_countersigned` | Send / update / countersign actions |
| `worker/routes/feedback.js` (public) | `admin_feedback_received` | Public feedback submission via `waitUntil` |
| `worker/routes/admin/feedback.js` | `feedback_resolution_notice` (manual button) | Triage notify-submitter action |
| `worker/routes/vendor.js` | `admin_vendor_return` | Vendor-side upload notifies admin |
| `worker/routes/admin/emailTemplates.js` | Any template — uses `[TEST]` subject prefix | Send-test button |

## In-house waiver service

There is no third-party waiver service. The system is implemented entirely in this repo.

| Concern | Implementation | Evidence |
|---|---|---|
| Source-of-truth document | `waiver_documents` table, live row = `retired_at IS NULL` ordered by `version DESC LIMIT 1`. New version → stamp old `retired_at`. | [migrations/0011_waiver_hardening.sql](migrations/0011_waiver_hardening.sql), [worker/routes/admin/waiverDocuments.js:79-84](worker/routes/admin/waiverDocuments.js) |
| Customer-facing fetch | `GET /api/waivers/:qrToken` returns the live document body + version | [worker/routes/waivers.js:65-120](worker/routes/waivers.js) |
| Customer-facing submit | `POST /api/waivers/:qrToken` snapshots `body_html`, `body_sha256`, `version`, plus 4-tier age fields | [worker/routes/waivers.js:127-327](worker/routes/waivers.js) |
| **`body_html` SHA-256 integrity check** | `getLiveWaiverDocument(env)` recomputes SHA-256 on every fetch ([waivers.js:33-39](worker/routes/waivers.js)). Mismatch → writes audit row `waiver_document.integrity_failure` and returns HTTP 500 ([waivers.js:89-96](worker/routes/waivers.js)). Same check is repeated server-side on submit ([waivers.js:232-236](worker/routes/waivers.js)) so a tampered row cannot mint a new signature even if the GET path was bypassed. | [worker/routes/waivers.js:33-59,89-96,232-236](worker/routes/waivers.js) |
| **`findExistingValidWaiver` auto-link** | Defined in [worker/routes/webhooks.js:18-34](worker/routes/webhooks.js). Matches by `LOWER(TRIM(email))` + `LOWER(TRIM(player_name))` with non-expired `claim_period_expires_at`. Imported by `worker/routes/admin/bookings.js:7` (manual booking) and called inline in `worker/routes/webhooks.js:141` (Stripe success). When a match exists, the new attendee row is inserted with `waiver_id` populated and `audit_log` records `waiver.auto_linked`. The waiver-request email is skipped (`out.waivers.push({skipped: 'already_on_file'})`). | [worker/routes/webhooks.js:131-177](worker/routes/webhooks.js), [worker/routes/admin/bookings.js:344](worker/routes/admin/bookings.js) |
| **365-day Claim Period auto-renewal** | `CLAIM_PERIOD_MS = 365 * 24 * 60 * 60 * 1000` constant in [worker/routes/waivers.js:11](worker/routes/waivers.js). Computed `nowMs + CLAIM_PERIOD_MS` and stamped onto `waivers.claim_period_expires_at` at sign time ([waivers.js:243,296](worker/routes/waivers.js)). Drives the `findExistingValidWaiver` lookup on subsequent bookings. Index `idx_waivers_claim_lookup` covers the lookup. | [worker/routes/waivers.js:11,243](worker/routes/waivers.js) |
| Required ESIGN consent | `body.erecordsConsent !== true` → HTTP 400 hard-fail ([waivers.js:175-177](worker/routes/waivers.js)). Stored as `waivers.erecords_consent` integer flag. | [worker/routes/waivers.js:175-177](worker/routes/waivers.js) |
| Signature must match attendee name | Case/whitespace-insensitive equality check; mismatch → HTTP 400 with message naming the expected name. | [worker/routes/waivers.js:179-188](worker/routes/waivers.js) |
| Age-tier enforcement | Both client and server compute the tier from `dob` using identical `ageTier()` helpers. Server is authoritative — under-12 hard block, 12-15 + 16-17 require parent fields, 12-15 also requires supervising-adult fields, jury-trial initials required for all tiers. | [worker/routes/waivers.js:14-28,196-225](worker/routes/waivers.js); client in [src/pages/Waiver.jsx](src/pages/Waiver.jsx) |
| Waiver doc admin endpoints | `GET /api/admin/waiver-documents` (list incl. retired), `POST /api/admin/waiver-documents` (new version — auto-retires previous), `GET /api/admin/waiver-documents/current`, `POST /api/admin/waiver-documents/:id/retire` | [worker/routes/admin/waiverDocuments.js](worker/routes/admin/waiverDocuments.js) |
| Vendor contracts use the same pattern | `vendor_contract_documents` table + `vendor_signatures` row that snapshots body + sha256 + IP + UA + token_version. Integrity check at [worker/routes/vendor.js:245](worker/routes/vendor.js) writes audit `vendor_contract.integrity_failure`. | [worker/routes/vendor.js:216-279](worker/routes/vendor.js) |

## Cloudflare R2

| Concern | Value | Evidence |
|---|---|---|
| Bucket | `air-action-sports-uploads` (single bucket) | [wrangler.toml:20-22](wrangler.toml) |
| Binding | `env.UPLOADS` | [wrangler.toml:21](wrangler.toml) |
| Key prefixes | `events/<random>.<ext>` (event covers), `feedback/<random>.<ext>` (feedback screenshots), `vendors/...` (vendor docs of multiple kinds) | [worker/routes/admin/uploads.js](worker/routes/admin/uploads.js), [worker/routes/feedback.js:40](worker/routes/feedback.js), [worker/routes/admin/uploads.js:149](worker/routes/admin/uploads.js) |
| Public read | `/uploads/:key` regex-allowlisted to `<prefix>/<random>.<ext>` only with image extensions | [worker/index.js:415-440](worker/index.js) |
| Vendor docs **not** publicly readable | Served only via tokenized `/api/vendor/:token/doc/:id`; admin can also delete via `DELETE /api/admin/uploads/vendor-doc/:id` | [worker/routes/vendor.js:374](worker/routes/vendor.js), [migrations/0010_vendors.sql:80-101](migrations/0010_vendors.sql) (comment) |
| Upload validation | Magic-byte sniff via [worker/lib/magicBytes.js](worker/lib/magicBytes.js). `sniffImageExt` for event covers + feedback (JPEG/PNG/GIF/WebP only). `sniffDocExt` extends with PDF for vendor docs. Content-Type header is **rederived** from sniffed extension, not trusted from the request. | [worker/lib/magicBytes.js:1-54](worker/lib/magicBytes.js) |
| Size caps | Image: 5 MB ([admin/uploads.js:78](worker/routes/admin/uploads.js)); vendor doc: 10 MB ([admin/uploads.js:149](worker/routes/admin/uploads.js)); feedback attachment: 5 MB ([feedback.js:40](worker/routes/feedback.js)). |
| Lifecycle rules at bucket level | **Unknown — not visible from this repo.** Bucket-side lifecycle is configured in the Cloudflare dashboard. Flag for Area 10. |
| `attachment_deleted_at` cascade | When `feedback.status` flips to terminal (resolved / wont-fix / duplicate), [worker/routes/admin/feedback.js:133](worker/routes/admin/feedback.js) issues `env.UPLOADS.delete(key)` and stamps `attachment_deleted_at`, blanking `attachment_url`. The ticket row is preserved; only the screenshot is purged. | [worker/routes/admin/feedback.js:133](worker/routes/admin/feedback.js) |

## Cloudflare DNS / domain

| Concern | Value | Evidence |
|---|---|---|
| Custom domain | `https://airactionsport.com` | [wrangler.toml:30](wrangler.toml), [index.html:17](index.html) |
| Fallback URL | `https://air-action-sports.bulletbiter99.workers.dev` (still resolves) | [vite.config.js:7](vite.config.js) |
| DNS provider | Cloudflare DNS (per HANDOFF §12) | HANDOFF.md |
| GoDaddy | Domain registration only — no GoDaddy DNS or routing | HANDOFF.md (implicit; not directly observable from repo) |
| HTTPS | "Always Use HTTPS" toggle is **OFF** per HANDOFF §11; HTTP returns 200 instead of 301 | HANDOFF.md §11 |
| TLS version | Min TLS 1.2 (per HANDOFF §11 — to confirm in dashboard) | HANDOFF.md |
| HSTS | `max-age=31536000; includeSubDomains` set in Worker response headers | [worker/index.js:518](worker/index.js) |
| Email Routing | Inbound mail to `@airactionsport.com` forwards to Gmail (per HANDOFF §12) | HANDOFF.md |

## Cloudflare Workers Rate Limiting

8 bindings (beta `[[unsafe.bindings]]`), per-IP, period=60s:

| Binding | Limit | Used by |
|---|---|---|
| `RL_LOGIN` | 5/min | admin login, vendor login |
| `RL_FORGOT` | 3/min | admin forgot-password |
| `RL_VERIFY_TOKEN` | 10/min | invite + reset token verification |
| `RL_RESET_PWD` | 5/min | password reset, accept invite, vendor set-password |
| `RL_CHECKOUT` | 10/min | `POST /api/bookings/checkout` |
| `RL_TOKEN_LOOKUP` | 30/min | `GET /api/bookings/:token`, `/api/waivers/:qrToken`, vendor token routes |
| `RL_FEEDBACK` | 3/min | public feedback submit |
| `RL_FEEDBACK_UPLOAD` | 3/min | feedback screenshot upload |

Helper: [worker/lib/rateLimit.js](worker/lib/rateLimit.js) — wraps the binding lookup and returns a Hono middleware. Will read in Area 5/6 to verify whether each handler passes a custom keying function (rate-limit by user IP vs request body).

## Stripe + Resend retry / idempotency posture

| Concern | Mechanism | Risk |
|---|---|---|
| Stripe webhook double-delivery | `if (booking.status === 'paid') return` ([webhooks.js:115-116](worker/routes/webhooks.js)) | None observed; admin retries also short-circuit |
| Stripe refund retry | `Idempotency-Key` parameter optional in `issueRefund(...)` — **caller must pass** | Verify caller in Area 5; refunds without a key risk double-refund on retry |
| Resend send retry | None — failures are caught in handler `try/catch` and logged. Cron sweeps roll back the sentinel column on send failure so next tick retries; non-cron sends do not retry. | Single-send-best-effort; missed sends are silent |
| Cron sentinel-first | Stamp column `Date.now()` BEFORE send; roll back to NULL on failure. Survives Worker eviction at the cost of at most one skipped delivery per booking. | Documented; sentinels never cleared once sent — one-shot per booking, by design |
| Webhook return codes | `200` always (even on signature mismatch the handler returns 400, which Stripe will retry — this is correct posture) | Healthy |

## Environment variables / secrets inventory

Names only; no values are recorded by this audit. Confirmed via grep across [worker/](worker).

### Secrets (set with `wrangler secret put`, not in repo)

| Name | Used in | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | [worker/routes/bookings.js](worker/routes/bookings.js), [worker/routes/admin/bookings.js](worker/routes/admin/bookings.js) | Stripe API auth (`Bearer`) |
| `STRIPE_WEBHOOK_SECRET` | [worker/routes/webhooks.js:37](worker/routes/webhooks.js) | HMAC-SHA256 webhook signature verify |
| `RESEND_API_KEY` | [worker/lib/emailSender.js](worker/lib/emailSender.js), [worker/routes/feedback.js](worker/routes/feedback.js), [worker/routes/admin/emailTemplates.js](worker/routes/admin/emailTemplates.js), [worker/routes/admin/auth.js](worker/routes/admin/auth.js), [worker/index.js](worker/index.js) (cron sweep helper) | Resend API auth (`Bearer`) |
| `SESSION_SECRET` | [worker/lib/auth.js](worker/lib/auth.js), [worker/routes/admin/auth.js](worker/routes/admin/auth.js), [worker/routes/admin/eventVendors.js](worker/routes/admin/eventVendors.js), [worker/routes/vendor.js](worker/routes/vendor.js), [worker/routes/vendorAuth.js](worker/routes/vendorAuth.js), [worker/routes/admin/bookings.js](worker/routes/admin/bookings.js), [worker/routes/feedback.js](worker/routes/feedback.js) | HMAC for admin sessions, vendor sessions, vendor magic-link tokens, IP hash in feedback |

### Public env vars (in `wrangler.toml [vars]`)

| Name | Value at audit time |
|---|---|
| `SITE_URL` | `https://airactionsport.com` |
| `FROM_EMAIL` | `Air Action Sports <noreply@airactionsport.com>` |
| `REPLY_TO_EMAIL` | `actionairsport@gmail.com` |
| `ADMIN_NOTIFY_EMAIL` | `actionairsport@gmail.com` |

### No committed credentials found

I grepped for the obvious shapes (`sk_live_`, `sk_test_`, `re_`, `whsec_`) across the worktree (excluding `node_modules/`). **No matches.** The only `.env` reference in the repo is in `.gitignore` ([line 4-5](`.gitignore`)) listing `.env`, `.env.*`, and `.dev.vars` as ignored.

Skill at [.claude/skills/deploy-air-action-sports/SKILL.md](.claude/skills/deploy-air-action-sports/SKILL.md) references `.claude/.env` as the deploy-token holder; that file is gitignored under `.claude/*` exclusion (line 3 of `.gitignore`).

## Other "integrations" worth noting

| What | Status |
|---|---|
| Maps / geocoding | None |
| Analytics SDK | None |
| Error tracking (Sentry/Rollbar/Bugsnag) | None |
| SMS (Twilio/etc.) | None |
| Calendar integrations (Google/iCal) | None |
| Slack notifications | None |
| Logpush | None configured in `wrangler.toml` |
| Cloudflare Turnstile / CAPTCHA | None |
| Honeypot anti-spam | Yes — used in feedback POST (`name` field flagged via custom check); no library | [worker/routes/feedback.js](worker/routes/feedback.js) |

## Cross-area follow-ups

- **Area 5**: Check that Stripe refund caller (admin/bookings.js:390) actually passes an `Idempotency-Key`. If not, flag.
- **Area 5/6**: Stripe webhook handler is the single most critical integration touchpoint. Coupled to bookings/attendees/audit_log/email pipeline. Goes on the do-not-touch list.
- **Area 6**: Waiver POST handler is legally load-bearing — at-sign snapshot integrity, ESIGN consent, age-tier enforcement, claim-period stamping. Critical entry on do-not-touch.
- **Area 6**: `findExistingValidWaiver` is shared between webhook and admin manual booking. Modifying it changes auto-link semantics for both flows. Critical entry.
- **Area 8**: Stripe API version not pinned via `Stripe-Version` header — audit-grade risk because we'd silently inherit changes if the account is bumped. Recommend setting `Stripe-Version: 2024-XX-XX` on every request and treating it as part of the deploy contract.
- **Area 8**: No bounce/complaint handling on Resend means undeliverable customer emails are invisible to ops.
- **Area 10**: R2 bucket lifecycle rules at the dashboard side are unknown from this repo — runtime check needed.
- **Area 10**: Confirm Stripe API version actually in use on the account.

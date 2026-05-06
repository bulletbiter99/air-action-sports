# Air Action Sports — Handoff

Session handoff doc. Skim top-to-bottom to get oriented; copy the [Prompt for fresh session](#prompt-for-fresh-session) block when starting a new conversation.

---

## 1. What this is

A full booking + waiver + admin system for Air Action Sports (airsoft events), built as a replacement for Peek Pro to avoid the 6% platform fee. Deployed live at **https://air-action-sports.bulletbiter99.workers.dev**.

Business economics:
- Peek charged ~$12.78 in fees on an $80 booking (16%)
- This system charges ~$2.62 in Stripe fees on an $80 booking (~3.3%)
- **Savings: ~$10 per ticket**, ~$60 on a 6-player booking

**Status:** feature-complete. All numbered phases (1–9) and all 5 polish items are shipped. The remaining work before first live event is operational, not code — see §11.

## 2. Stack

| Piece | Tech |
|---|---|
| Frontend | React 19 + Vite 8 + React Router 7 (SPA) |
| Backend | Cloudflare Workers + Hono router |
| Database | Cloudflare D1 (SQLite) |
| Payments | Stripe direct (**test sandbox currently — not yet live**) |
| Email | Resend via `airactionsport.com` domain |
| File storage | Cloudflare R2 bucket `air-action-sports-uploads` (event cover images) |
| Hosting | Cloudflare (Worker + static assets in one deployment) |

Single Worker serves everything — `/api/*` routes through Hono, `/uploads/*` streams from R2, `/events/:slug` is HTML-rewritten for social unfurls, everything else falls through to the Vite build in `dist/`. See `wrangler.toml` — critical settings: `main = "worker/index.js"`, `run_worker_first = true`.

## 3. Project layout

```
action-air-sports/
├── wrangler.toml            ← Worker + D1 + R2 + cron config
├── package.json
├── vite.config.js           ← dev proxy /api → deployed Worker
├── index.html               ← baseline OG/Twitter meta defaults
├── src/                     ← React frontend
│   ├── App.jsx              ← route registry
│   ├── pages/               ← public pages (Home, Events, EventDetail,
│   │                          Booking, BookingSuccess, Waiver, Ticket,
│   │                          RulesOfEngagement, Feedback, etc.)
│   ├── admin/               ← admin pages (18 screens — see §9)
│   ├── components/          ← shared UI (Navbar, Footer, SEO, etc.)
│   ├── hooks/               ← useEvents (D1-backed), useCountdown, useFormValidation
│   └── styles/
├── worker/                  ← Cloudflare Worker backend
│   ├── index.js             ← entry; mounts /api, serves /uploads/*,
│   │                          HTML-rewrites /events/:slug, scheduled() cron
│   ├── lib/                 ← pricing, stripe, email, session, auth,
│   │                          password, ids, formatters, templates, emailSender,
│   │                          magicBytes (shared sniffer: image + pdf)
│   └── routes/
│       ├── events.js        ← public events (list + detail, id-or-slug)
│       ├── bookings.js      ← public booking quote/checkout + lookup
│       ├── waivers.js       ← per-attendee waiver GET/POST
│       ├── webhooks.js      ← Stripe webhook receiver
│       ├── taxesFees.js     ← public: active taxes/fees for checkout
│       ├── feedback.js      ← public POST /api/feedback + /attachment upload
│       └── admin/           ← admin endpoints (cookie-auth)
│           ├── auth.js          ← login, setup, forgot/reset password,
│           │                      verify-invite, accept-invite
│           ├── bookings.js      ← list, detail, stats, refund, manual,
│           │                      resend-confirmation
│           ├── events.js        ← admin event CRUD + roster + CSV + duplicate;
│           │                      ticket-types sub-router exported
│           ├── attendees.js     ← check-in/out, by-qr, edit, send-waiver
│           ├── taxesFees.js     ← CRUD for tax/fee entries
│           ├── rentals.js       ← item CRUD, assignments, lookup (scanner)
│           ├── promoCodes.js    ← promo code CRUD
│           ├── analytics.js     ← overview, sales-series, per-event, attendance
│           ├── users.js         ← team list, invite, revoke, role/active update
│           ├── auditLog.js      ← paginated + filtered log viewer
│           ├── emailTemplates.js← template CRUD + preview + send-test
│           ├── uploads.js       ← multipart image + vendor-doc upload → R2
│           ├── vendors.js       ← vendor + contact CRUD
│           ├── eventVendors.js  ← per-event package compose/send/revoke
│           └── feedback.js      ← list, detail, update (status/priority/note),
│                                  delete (owner) + notify-submitter
│   ├── routes/vendor.js         ← public tokenized /api/vendor/:token
│   └── lib/vendorToken.js       ← HMAC vendor magic-link token
├── migrations/              ← D1 migrations (applied in order)
│   ├── 0001_initial.sql
│   ├── 0002_expanded_schema.sql
│   ├── 0003_pending_attendees.sql
│   ├── 0004_taxes_fees.sql
│   ├── 0005_password_resets.sql
│   ├── 0006_reminders.sql
│   ├── 0007_reminder_1hr.sql
│   ├── 0008_team_invites.sql
│   ├── 0009_custom_questions.sql
│   ├── 0010_vendors.sql         ← vendor MVP (6 tables + seed email template)
│   ├── 0011_waiver_hardening.sql ← waiver_documents + at-sign snapshot/hash
│   ├── 0012_vendor_v1.sql       ← contracts, signatures, password portal, cron idempotency, v1 email templates
│   ├── 0013_feedback.sql        ← feedback table + admin_feedback_received template
│   ├── 0014_feedback_attachment.sql ← attachment cols + feedback_resolution_notice template
│   ├── 0015_drop_event_tax_columns.sql ← drop dead per-event tax_rate_bps + pass_fees_to_customer
│   ├── 0016_booking_payment_method.sql ← bookings.payment_method col + index + backfill
│   ├── 0017_event_featured.sql         ← events.featured (admin-picked headliner sort)
│   ├── 0018_waiver_v4_fields.sql       ← 4-tier age, jury trial initials, supervising adult, claim_period_expires_at + idx_waivers_claim_lookup
│   └── 0019_event_per_surface_images.sql ← card/hero/banner/og image URL columns (per-surface cover images, cover_image_url stays as fallback)
├── scripts/                 ← one-off SQL scripts, not tracked by migration runner
├── .claude/
│   └── commands/feedback.md  ← /feedback slash-command playbook (pull → review → recommend → update → deploy)
└── dist/                    ← Vite build output, uploaded with Worker
```

## 4. Deploy + dev commands

```bash
# Load Cloudflare API token from .claude/.env, then deploy
source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler deploy

# Build first if any frontend changes:
npm run build

# Chain: build + deploy
npm run build && source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler deploy

# Apply new migrations to remote D1
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 migrations apply air-action-sports-db --remote

# Run one-off SQL
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command="SELECT * FROM events"

# Or from a file
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --file=scripts/foo.sql

# Local dev (Vite; /api proxies to deployed Worker)
npm run dev
```

Bindings:
- D1: `air-action-sports-db` — `d72ea71b-f12f-4684-93a2-52fbe9037527`
- R2: `air-action-sports-uploads` — bound as `env.UPLOADS`
- Cron: `*/15 * * * *` (reminder sweep)

## 5. Secrets & env vars

**Secrets** (set via `wrangler secret put`, not in repo):
- `STRIPE_SECRET_KEY` — Stripe sandbox `sk_test_...` (**swap to `sk_live_` when going live**)
- `STRIPE_WEBHOOK_SECRET` — from Stripe dashboard → Webhooks → Reveal (**re-generate when flipping to live**)
- `RESEND_API_KEY` — from Resend dashboard → API Keys
- `SESSION_SECRET` — 32 random bytes, used to sign admin session cookies

**Public vars** (in `wrangler.toml [vars]`):
- `SITE_URL` — `https://air-action-sports.bulletbiter99.workers.dev`
- `FROM_EMAIL` — `Air Action Sports <noreply@airactionsport.com>`
- `REPLY_TO_EMAIL` — `actionairsport@gmail.com`
- `ADMIN_NOTIFY_EMAIL` — `actionairsport@gmail.com`

To rotate: generate new value in the respective dashboard → `echo "new-value" | npx wrangler secret put SECRET_NAME`.

## 6. Database schema snapshot

| Table | Purpose |
|---|---|
| `events` | Airsoft events (custom questions stored in `custom_questions_json`). Image columns: `cover_image_url` (universal fallback) + per-surface `card_image_url` / `hero_image_url` / `banner_image_url` / `og_image_url` (added in 0019; all nullable). Each consumer surface prefers its dedicated column and falls back to `cover_image_url`. |
| `ticket_types` | Per-event ticket tiers (Standard, VIP, etc.) |
| `bookings` | A customer's purchase. Reminder columns: `reminder_sent_at`, `reminder_1hr_sent_at` |
| `attendees` | Individual players under a booking, each with `qr_token` and `custom_answers_json` |
| `waivers` | Signed waiver tied to an attendee |
| `users` | Admin accounts (owner / manager / staff) |
| `admin_sessions` | Legacy — sessions live in HMAC-signed cookies now |
| `password_resets` | Reset tokens, 1hr TTL |
| `invitations` | Team invite tokens, 7-day TTL, single-use |
| `promo_codes` | Discount codes (percent or fixed) |
| `email_templates` | Editable transactional email templates (edit at `/admin/settings/email-templates`) |
| `taxes_fees` | Global tax/fee entries |
| `rental_items` | Physical equipment pool |
| `rental_assignments` | Which item went to which attendee |
| `inventory_adjustments` | Manual stock overrides |
| `audit_log` | Who did what, when (viewable at `/admin/audit-log`) |
| `waiver_documents` | Versioned immutable waiver text; current live row = `retired_at IS NULL` highest `version`. Each signed waiver snapshots `body_html` + `body_sha256` at sign time for legal defensibility (ESIGN integrity). |
| `vendors` | Company-level vendor record (COI expiry, tags, notes, soft-delete) |
| `vendor_contacts` | People at a vendor. One `is_primary` per vendor. Email unique per vendor among active rows. |
| `event_vendors` | Join of (event, vendor). Owns `status` (draft/sent/viewed/revoked/complete), `token_version` (bump = instant revoke), `token_expires_at`, view timestamps |
| `vendor_package_sections` | Ordered content blocks (overview/schedule/map/contact/custom) composed into a package. `ON DELETE CASCADE` from `event_vendors`. |
| `vendor_documents` | Files attached to a package or a vendor (admin_asset / coi / w9). R2 keys under `vendors/…`; served ONLY via `/api/vendor/:token/doc/:id`, never via public `/uploads/`. |
| `vendor_access_log` | Every tokenized view/download — IP, UA, token_version at access time |
| `vendor_contract_documents` | Versioned immutable operating-agreement text; same live-row pattern as waiver_documents (`retired_at IS NULL`). Each new version retires the previous. |
| `vendor_signatures` | Per-package signed contract. Immutable at-sign snapshot of `body_html` + `body_sha256` + typed_name + IP + UA + token_version. `UNIQUE(event_vendor_id)`. Countersigned by owner role. |
| `feedback` | User-submitted tickets (bug / feature / usability / other). `status` ∈ new/triaged/in-progress/resolved/wont-fix/duplicate; `priority` ∈ low/medium/high/critical. Optional screenshot via `attachment_url` → R2 `feedback/<key>.<ext>`. Terminal status transitions auto-delete the R2 object and stamp `attachment_deleted_at`. IP hashed with SESSION_SECRET, never stored raw. |
| `waivers` (v4 fields) | Phase B columns added by 0018: `medical_conditions`, `age_tier` ('12-15'\|'16-17'\|'18+'), `parent_phone_day_of_event`, `parent_initials`, `supervising_adult_name`/`supervising_adult_signature`/`supervising_adult_relationship`/`supervising_adult_phone_day_of_event` (12-15 only), `jury_trial_initials` (§22, all tiers), `claim_period_expires_at` (signed_at + 365d — drives Phase C annual-renewal lookup). All nullable so pre-v4 signers (4 dogfood rows on wd_v1) survive. `idx_waivers_claim_lookup` on (email, player_name, claim_period_expires_at) for the auto-link query. |

Full schema: concat the migration files in order.

## 6.1 Worker-level handlers (not API routes)

- **`scheduled()` cron** — fires every 15 min. Two independent sweeps over paid/comp bookings: **24hr** (event starts in 20–28 hrs, stamps `reminder_sent_at`) and **1hr** (event starts in 45–75 min, stamps `reminder_1hr_sent_at`). Each column is an independent idempotency key. Every send writes to `audit_log`.
- **`/uploads/:key`** — streams R2 objects with `Cache-Control: public, max-age=31536000, immutable`. Keys are random-suffixed → safe to treat as immutable.
- **HTML rewriter on `/events/:slug`** — looks up the published event in D1 and rewrites the SPA shell's `<title>`, `meta[name=description]`, and all `og:*` / `twitter:*` tags to be event-specific. Fixes the SPA problem where Facebook/Slack/iMessage scrapers don't run JS. Unknown slugs fall through to the SPA's in-app 404.

## 7. Public API routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Uptime check |
| GET | `/api/events` | Upcoming events (`?include_past=1` to include past; each event has `seatsSold`) |
| GET | `/api/events/:id` | Single event — matches by `id` OR `slug` |
| GET | `/api/events/:id/ticket-types` | Just ticket types |
| GET | `/api/taxes-fees` | Active taxes/fees for checkout |
| POST | `/api/bookings/quote` | Preview totals without committing |
| POST | `/api/bookings/checkout` | Create pending booking + Stripe Checkout Session |
| GET | `/api/bookings/:token` | Public booking lookup (confirmation page) |
| POST | `/api/webhooks/stripe` | Stripe webhook receiver |
| GET | `/api/waivers/:qrToken` | Load attendee info + **current live waiver document (body + version)** for waiver form |
| POST | `/api/waivers/:qrToken` | Submit signed waiver; server snapshots the live doc's `body_html` + hash + version onto the row, requires explicit `erecordsConsent: true` (ESIGN §7001(c)) |
| GET | `/api/vendor/:token` | **Tokenized** vendor package payload (sections + docs + event info); stamps first/last viewed; rate-limited |
| GET | `/api/vendor/:token/doc/:id` | **Tokenized** document download; validates doc belongs to resolved event_vendor; logs access; Content-Disposition: attachment |
| POST | `/api/vendor/:token/sign` | Vendor signs the live contract document; snapshots body + sha256 + typed_name + IP + UA; `UNIQUE(event_vendor_id)` enforces single signing |
| POST | `/api/vendor/:token/upload` | Vendor-side upload (multipart; kind ∈ coi\|w9\|vendor_return; magic-byte sniff inc. PDF; 10 MB cap); fires `admin_vendor_return` email |
| POST | `/api/vendor/auth/set-password` | Sets password on primary_contact given a valid magic-link token (no separate email verification needed — holding a fresh magic link proves email ownership) |
| POST | `/api/vendor/auth/login` | Email + password → HMAC-signed `aas_vendor` session cookie (30d TTL) |
| POST | `/api/vendor/auth/logout` | Bumps `session_version`, clears cookie |
| GET | `/api/vendor/auth/me` | Returns current logged-in contact, or `{contact: null}` |
| GET | `/api/vendor/auth/my-packages` | Lists every non-revoked event_vendor across all contacts sharing this email; each row includes a freshly-minted 24h-TTL magic-link token |
| POST | `/api/feedback` | Submit feedback ticket. Body: `{type, title, description, email?, attachmentUrl?, pageUrl, userAgent, viewport}`. Rate-limit `RL_FEEDBACK` (3/min/IP), honeypot, IP hashed with `SESSION_SECRET`. Best-effort admin-notify email via `waitUntil`. Returns `{ok, id}`. |
| POST | `/api/feedback/attachment` | Multipart `{file}`. JPEG/PNG/WebP/GIF ≤ 5 MB. Magic-byte sniff rejects relabelled HTML/SVG/PDFs. Rate-limit `RL_FEEDBACK_UPLOAD` (3/min/IP). Stores in R2 `feedback/<random>.<ext>`, returns `{url, bytes, contentType}`. Referenced via `attachmentUrl` in subsequent POST `/api/feedback`. |

## 8. Admin API routes (cookie auth required)

Role hierarchy: `owner > manager > staff`. `requireRole('owner', 'manager')` means either.

**Auth + account**
| Method | Path | Role |
|---|---|---|
| GET | `/api/admin/auth/setup-needed` | public (true if no users exist) |
| POST | `/api/admin/auth/setup` | public-when-empty |
| POST | `/api/admin/auth/login` | public |
| POST | `/api/admin/auth/logout` | public |
| GET | `/api/admin/auth/me` | any auth'd |
| POST | `/api/admin/auth/forgot-password` | public (always 200) |
| GET | `/api/admin/auth/verify-reset-token/:t` | public |
| POST | `/api/admin/auth/reset-password` | public (consumes token) |
| GET | `/api/admin/auth/verify-invite/:t` | public |
| POST | `/api/admin/auth/accept-invite` | public (creates user + auto-login) |

**Bookings + attendees**
| Method | Path | Role |
|---|---|---|
| GET | `/api/admin/bookings` | staff+ (filters: q, status, event_id, from, to) |
| GET | `/api/admin/bookings/:id` | staff+ (attendees include `customAnswers`) |
| GET | `/api/admin/bookings/stats/summary` | staff+ |
| POST | `/api/admin/bookings/manual` | manager+ (`card` → returns Stripe Checkout URL + sessionId, status pending; `cash`/`venmo`/`paypal` → status paid; `comp` → status comp) |
| POST | `/api/admin/bookings/:id/refund` | manager+ (Stripe refund) |
| POST | `/api/admin/bookings/:id/resend-confirmation` | manager+ |
| PUT | `/api/admin/attendees/:id` | staff+ (edit name/email/phone; waiver signature untouched) |
| POST | `/api/admin/attendees/:id/check-in` | staff+ |
| POST | `/api/admin/attendees/:id/check-out` | staff+ |
| POST | `/api/admin/attendees/:id/send-waiver` | staff+ (re-email; 409 if already signed) |
| GET | `/api/admin/attendees/by-qr/:qrToken` | staff+ (scanner full snapshot) |

**Events, ticket types, promo codes**
| Method | Path | Role |
|---|---|---|
| GET | `/api/admin/events` | staff+ (all events incl unpublished) |
| GET | `/api/admin/events/:id/detail` | staff+ (all ticket types incl inactive) |
| GET | `/api/admin/events/:id/roster` | staff+ |
| GET | `/api/admin/events/:id/roster.csv` | staff+ (includes `q_<key>` columns for custom questions) |
| POST | `/api/admin/events` | manager+ |
| PUT | `/api/admin/events/:id` | manager+ |
| DELETE | `/api/admin/events/:id` | owner (archive if bookings exist, else delete) |
| POST | `/api/admin/events/:id/duplicate` | manager+ (clones as draft, `sold=0`) |
| POST | `/api/admin/events/:id/ticket-types` | manager+ |
| PUT | `/api/admin/ticket-types/:id` | manager+ (capacity ≥ sold) |
| DELETE | `/api/admin/ticket-types/:id` | manager+ (deactivate if sold, else delete) |
| GET / POST / PUT / DELETE | `/api/admin/promo-codes[/:id]` | staff+ / manager+ / manager+ / owner |

**Rentals (scanner + pool)**
| Method | Path | Role |
|---|---|---|
| GET | `/api/admin/rentals/items[/:id]` | staff+ |
| POST / PUT | `/api/admin/rentals/items[/:id]` | manager+ |
| DELETE | `/api/admin/rentals/items/:id` | owner (retire; blocked if assigned) |
| GET / POST | `/api/admin/rentals/assignments` | staff+ |
| POST | `/api/admin/rentals/assignments/:id/return` | staff+ |
| GET | `/api/admin/rentals/lookup/:token` | staff+ (generic scanner: attendee \| item \| unknown) |

**Analytics**
| Method | Path | Role |
|---|---|---|
| GET | `/api/admin/analytics/overview` | staff+ (net/gross/refunded + attendee rollups; optional `?event_id=`) |
| GET | `/api/admin/analytics/sales-series` | staff+ (`?days=7\|30\|90\|365`, fills gaps with zeros) |
| GET | `/api/admin/analytics/per-event` | staff+ (fill rate, net revenue, waiver %, check-in %) |
| GET | `/api/admin/analytics/attendance/:event_id` | staff+ (hourly check-in buckets) |
| GET | `/api/admin/analytics/cron-status` | staff+ (last `cron.swept` audit row + 24h reminder counts — used by AdminDashboard CronHealth widget) |

**Team, audit, settings**
| Method | Path | Role |
|---|---|---|
| GET | `/api/admin/users` | manager+ |
| PUT | `/api/admin/users/:id` | owner (guarded against self-lockout / last-owner removal) |
| GET | `/api/admin/users/invitations` | manager+ |
| POST | `/api/admin/users/invite` | owner |
| DELETE | `/api/admin/users/invitations/:token` | owner |
| GET | `/api/admin/audit-log[/actions]` | manager+ |
| GET / PUT | `/api/admin/email-templates[/:slug]` | manager+ view / owner edit |
| GET | `/api/admin/email-templates/:slug/preview` | manager+ |
| POST | `/api/admin/email-templates/:slug/send-test` | owner |
| GET | `/api/admin/taxes-fees` / POST / PUT / DELETE | staff+ / manager+ / manager+ / owner |
| POST | `/api/admin/uploads/image` | manager+ (multipart, JPEG/PNG/WebP/GIF, 5 MB cap → `/uploads/:key` URL) |
| POST | `/api/admin/uploads/vendor-doc` | manager+ (multipart, + PDF, 10 MB cap; magic-byte sniff; requires `event_vendor_id` OR `vendor_id` + `kind`) |
| DELETE | `/api/admin/uploads/vendor-doc/:id` | manager+ (removes R2 object + DB row) |

**Vendors**
| Method | Path | Role |
|---|---|---|
| GET | `/api/admin/vendors[?q=&includeDeleted=1]` | staff+ |
| POST | `/api/admin/vendors` | manager+ |
| GET | `/api/admin/vendors/:id` | staff+ (includes contacts + history of event_vendors) |
| PUT | `/api/admin/vendors/:id` | manager+ |
| DELETE | `/api/admin/vendors/:id[?force=1]` | owner (refuses if active packages; `force=1` revokes them all first) |
| POST | `/api/admin/vendors/:id/contacts` | manager+ |
| PUT/DELETE | `/api/admin/vendors/contacts/:id` | manager+ |

**Event vendors (package composition)**
| Method | Path | Role |
|---|---|---|
| GET | `/api/admin/event-vendors[?event_id=&vendor_id=]` | staff+ |
| POST | `/api/admin/event-vendors` | manager+ (attach vendor to event) |
| GET | `/api/admin/event-vendors/:id` | staff+ (sections + docs + last 100 access-log entries) |
| PUT | `/api/admin/event-vendors/:id` | manager+ (primary_contact, notes, status draft/complete only — revoked via /revoke) |
| DELETE | `/api/admin/event-vendors/:id` | owner (cascades sections + docs; keeps access_log rows) |
| POST | `/api/admin/event-vendors/:id/sections` | manager+ (kinds: overview/schedule/map/contact/custom) |
| PUT/DELETE | `/api/admin/event-vendors/:id/sections/:sid` | manager+ |
| POST | `/api/admin/event-vendors/:id/send` | manager+ (mints HMAC token, renders `vendor_package_sent` template, emails primary contact; default TTL = event start + 60d) |
| POST | `/api/admin/event-vendors/:id/revoke` | manager+ (bumps `token_version` — outstanding magic links dead instantly) |
| PUT | `/api/admin/event-vendors/:id/contract` | manager+ (`{required: true/false}` — flip contract signature requirement; true refuses unless a live contract document exists) |
| GET | `/api/admin/event-vendors/:id/signature` | staff+ (full signature record incl body_html_snapshot + sha256 + IP + UA + countersign state) |
| POST | `/api/admin/event-vendors/:id/countersign` | **owner only** (stamps countersigned_by_user_id + countersigned_at; sends `vendor_countersigned` email) |

**Vendor contract documents** (versioned, immutable)
| Method | Path | Role |
|---|---|---|
| GET | `/api/admin/vendor-contracts` | staff+ (all versions incl retired) |
| POST | `/api/admin/vendor-contracts` | owner (new version auto-retires previous at same instant) |
| GET | `/api/admin/vendor-contracts/current` | staff+ (live doc, or null) |
| POST | `/api/admin/vendor-contracts/:id/retire` | owner (emergency retire without replacement) |

**Feedback**
| Method | Path | Role |
|---|---|---|
| GET | `/api/admin/feedback[?status=&type=&priority=&q=&from=&to=&limit=&offset=]` | staff+ (returns items + `summary: {new, triaged, inProgress, resolved, total}`) |
| GET | `/api/admin/feedback/summary` | staff+ (lightweight `{newCount}` for sidebar badge polling) |
| GET | `/api/admin/feedback/:id` | staff+ (full detail incl attachment + deleted state) |
| PUT | `/api/admin/feedback/:id` | staff+ for `adminNote`, manager+ for `status`/`priority`. Terminal status (resolved/wont-fix/duplicate) auto-deletes R2 attachment + stamps `attachment_deleted_at`. Writes `feedback.updated` audit entry. |
| GET | `/api/admin/feedback/:id/notify-preview` | manager+ — renders `feedback_resolution_notice` with this ticket's actual `status` + `admin_note` (not sample data). Returns `{rendered: {subject, html, text}, recipient}`. Backs the preview-before-send modal. |
| POST | `/api/admin/feedback/:id/notify-submitter` | manager+ — sends `feedback_resolution_notice` template email to submitter's address. Requires ticket has `email`. Writes `feedback.notified_submitter` audit. |
| DELETE | `/api/admin/feedback/:id` | owner — deletes row + R2 attachment. Writes `feedback.deleted` audit. |

## 9. Frontend routes

**Public**
- `/` — home
- `/events`, `/events/:slug` — D1-backed list + detail (hero uses `coverImageUrl` when set)
- `/locations`, `/gallery`, `/pricing`, `/faq`, `/rules-of-engagement`, `/contact`, `/about`, `/new-players`, `/privacy`
- `/booking` — 3-step booking flow (includes per-attendee custom questions)
- `/booking/success?token=...` — post-payment confirmation (per-attendee waiver + ticket PDF links)
- `/booking/cancelled` — user aborted Stripe checkout
- `/booking/ticket?token=<qrToken>` — printable PDF ticket (auto `window.print()`)
- `/waiver?token=<qrToken>` — per-attendee waiver form (renders body from `waiver_documents`, requires explicit e-records consent)
- `/v/:token` — **standalone** vendor package magic-link page (no public site chrome); renders sections + doc download list + inline contract signing + vendor-side upload + "save login" CTA
- `/vendor/login` — standalone vendor password login
- `/vendor/dashboard` — logged-in view of every non-revoked package across all vendor_contact rows sharing this email
- `/feedback` — standalone Share-Feedback page (modal auto-opens). Also reachable via the **Share feedback** button in the public footer (orange, same size as the other footer links).
- `/rules-of-engagement` — full ROE page (15 sections): weapon-class card grid (Rifle 350 / DMR 450 / LMG 450 / Sniper 550 with 0.20g), grenades, training knives, hit calling protocol, ANSI Z87.1+ eye protection, age policy, safe-zone procedures, chronograph policy, drugs & alcohol, sportsmanship/cheating, disputes, physical violence, transport, site conduct. Linked from desktop nav as "ROE", mobile menu as "Rules of Engagement", footer Info column, NewPlayers step 5, and EventDetail Rules & Requirements section.

**Admin** (all require login cookie)

The admin shell uses a **left sidebar** (not a top bar) at ≥900px and converts to a hamburger drawer on mobile. Profile chip at the sidebar bottom opens a dropdown with `← Back to site`, `Share feedback` (opens the same FeedbackModal with admin email prefilled), and `Sign out`. Sidebar displays an unread-count badge next to **Feedback** when there are tickets in `new` status (polls `/api/admin/feedback/summary` every 60 s).

**Sidebar layout (sections):**
1. **Dashboard** (alone)
2. **Event Setup** — Events, Promos, Vendors
3. **Event Day** — Roster, Scan, Rentals
4. **Insights** — Analytics, Feedback (with unread badge)
5. **Settings** (alone) — sub-pages: Taxes & Fees, Email Templates, Team, Audit Log

**Primary action**: `+ New Booking` lives as an orange CTA in the Dashboard header (manager+ only), not in the sidebar. The `/admin/new-booking` route is unchanged.
- `/admin` — dashboard (stats + bookings table with edit-attendee + resend-confirmation)
- `/admin/login`, `/admin/setup`, `/admin/forgot-password`, `/admin/reset-password?token=...`, `/admin/accept-invite?token=...`
- `/admin/analytics` — revenue + sales velocity + per-event metrics
- `/admin/events` — event CRUD, duplicate, archive, ticket-type + custom-question builder, cover-image upload
- `/admin/roster` — per-event roster with check-in, CSV, resend-waiver; custom-question answers inline
- `/admin/scan` — mobile QR scanner (recognizes attendee + rental item QRs)
- `/admin/rentals`, `/admin/rentals/qr-sheet?ids=...`, `/admin/rentals/assignments`
- `/admin/promo-codes`
- `/admin/new-booking` — manual (cash/comp) booking
- `/admin/users` — team roster, invite modal, role/active management
- `/admin/audit-log` — filtered + paginated viewer, expandable metadata
- `/admin/settings` — hub
- `/admin/settings/taxes-fees`
- `/admin/settings/email-templates` — edit subject/HTML/text, live iframe preview, send `[TEST]` email
- `/admin/vendors` — vendor directory (list + inline contact management; owner: delete)
- `/admin/vendor-packages` — per-event package list (filter by event/vendor) + attach-vendor modal
- `/admin/vendor-packages/:id` — composer: sections, documents, access log, send, revoke, contract toggle + signature status + countersign (owner)
- `/admin/vendor-contracts` — versioned contract document manager (owner: create new version, retire)
- `/admin/feedback` — triage queue. Clickable stat cards (New / Triaged / In progress / Resolved / All time), filter row (status / type / priority / q), detail modal with pills, screenshot preview (or "Screenshot retired on X" placeholder), status/priority dropdowns, admin note, Reply via email (mailto), Notify submitter (templated email), Delete (owner). Orange `+` button in top-right opens the FeedbackModal for admin-submitted tickets.

## 10. Completed phases

| Phase | Shipped |
|---|---|
| **1** | D1 + Hono + public events API |
| **1.5** | Full schema (ticket_types, attendees, promo_codes, rentals, email_templates, audit_log) |
| **2** | Stripe Checkout flow: multi-step booking UI → checkout session → webhook marks paid → attendees created with QR tokens |
| **3** | Resend integrated: booking confirmation, admin notify, waiver request emails |
| **4** | Waivers backend + per-attendee UI + **signature must match ticket name** |
| **5** | Real auth: PBKDF2 (100k iters) + HMAC-signed session cookies; bootstrap; bookings dashboard with filters + detail modal |
| **5.5** | Roster view, CSV export, Stripe refunds, manual walk-in bookings, manual check-in, admin top-nav, styled refund modal |
| **5.75** | Global taxes & fees admin — customer sees one "Taxes & Fees" line, admin sees itemized breakdown |
| **5.75b** | Forgot-password + reset flow with emailed single-use token (1hr TTL) |
| **6** | Mobile QR scanner (`/admin/scan`) + rental equipment pool (`/admin/rentals` + printable QR sheet + assignments) — scanner recognizes both attendee and item QRs |
| **6.5** | Event editor (`/admin/events`), inline ticket-type CRUD, promo code admin (`/admin/promo-codes`) |
| **7** | Analytics dashboard (`/admin/analytics`) with custom zero-dep SVG charts |
| **8** | Hourly reminder cron (24hr), resend confirmation, resend waiver, inline edit attendee |
| **8.5** | 1hr reminder (second window, cron → 15 min), baseline OG/Twitter meta + server-side HTMLRewriter for event-specific social unfurls |
| **9** | Team invites + audit log viewer with self-lockout guardrails |
| **Polish #1** | Public pages wired to D1 via `useEvents()` hook; static `src/data/events.js` retired |
| **Polish #2** | Settings hub + editable email templates (preview + send-test) |
| **Polish #3** | Custom questions per event — builder, booking capture, roster + CSV display |
| **Polish #4** | R2 cover-image upload + `/uploads/:key` public serve + EventDetail hero background |
| **Polish #5** | Printable per-attendee PDF tickets at `/booking/ticket?token=...` (auto-print) |
| **Waiver hardening** | Migration 0011: `waiver_documents` (versioned), at-sign snapshot + SHA-256 + distinct e-records consent bit. Integrity check on serve; tampered rows refuse to mint new signatures. Legal posture under ESIGN §7001 significantly improved. |
| **Vendor MVP** | Migration 0010: vendor + per-event package system. Tokenized magic-link delivery (HMAC, revocable via `token_version` bump, default TTL = event start + 60d). Admin: `/admin/vendors`, `/admin/vendor-packages`. Vendor: standalone `/v/:token` page. PDF uploads via magic-byte sniff. Full access log. |
| **Vendor v1** | Migration 0012: in-house e-signature (versioned contract docs + at-sign snapshot + owner-only countersign), vendor-side uploads (COI/W-9/return) with magic-byte sniff + admin-notify email, optional password portal (`/vendor/login` + `/vendor/dashboard`), cron sweeps (COI 30d/7d, package open reminder 7d pre-event, signature reminder 14d pre-event). Six new email templates. Not shipped: package templates (schema exists, admin UI deferred — create rows via SQL if needed). |
| **Admin UI refactor** | Top nav retired; replaced with a left sidebar (flex-stretch links, orange active border, mobile hamburger drawer) + profile chip with dropdown (Back to site / Share feedback / Sign out). Analytics last X-axis label fix (viewBox padding + end-anchor on final label). Modal button dedup (× icon top-right, no duplicate bottom Close/Cancel) in rentals + event editor. Native HTML5 pickers in event editor: `datetime-local` for dateIso, dual `time` pickers for Time Range + Check-in, single `time` picker for First Game + End Time. Helpers parse existing "6:30 AM" seed values round-trip. |
| **Global money + tax unification** | All admin "cents" inputs converted to dollars+cents UI via reusable `MoneyInput` (UI dollars, DB stays cents): base price, ticket-type price, add-on price, rental cost, promo amount-off, promo min-order. Per-event `taxRateBps` + `passFeesToCustomer` fields removed — global `taxes_fees` (from `/admin/settings/taxes-fees`) is now the single source of truth. AdminNewBooking now calls `/api/bookings/quote` so its tax/fee totals match customer checkout exactly. |
| **Feedback / ticket system** | Migrations 0013 + 0014. Public `POST /api/feedback` + `POST /api/feedback/attachment`; honeypot, IP-hashed, rate-limited (`RL_FEEDBACK` 3/min, `RL_FEEDBACK_UPLOAD` 3/min). Reusable `FeedbackModal` wired into the public footer, standalone `/feedback` page, and admin profile menu (email prefilled when admin submits). Admin triage page `/admin/feedback` with filters, detail modal, orange `+` submit button, status/priority/note + audit log. Screenshots in R2 `feedback/<key>` auto-deleted on terminal status (kept ticket rows forever for history). Sidebar badge polls unread count. Two new email templates: `admin_feedback_received` (on submit), `feedback_resolution_notice` (manual button — opt-in submitter notification). `.claude/commands/feedback.md` slash command for the triage → recommend → update → deploy loop. Shared `worker/lib/magicBytes.js` used by both vendor + feedback upload paths. |
| **Locations UX** | From tickets fb_wMupyX7iH3Hb + fb_pu1PXJkfqHTD: FAQ entry about location discovery rewritten to match reality (exact addresses shared post-booking, not on the page). Home "See the Battlefield" gallery tiles for the three real sites (Ghost Town, Echo Urban, Foxtrot Fields) are now `<Link>`s to `/locations#<site-id>`; `scroll-margin-top: 80px` + `id={site.id}` on Locations site-sections. ScrollToTop patched to retry hash query for cross-page lazy-loaded pages. Both tickets resolved with admin notes. |
| **Event-creation hardening + dynamic homepage** | (1) **Phase A — kill the static homepage:** TickerBar and the Home countdown now read the earliest upcoming event from D1 via `useEvents()`. Both are hidden gracefully when there are zero upcoming events. The dead `countdownTarget` / `countdownEventName` / `nextEvent` fields were removed from `siteConfig.js`. Any event create/edit propagates to the public homepage on next reload — no redeploy needed. (2) **Phase B — safer event creation:** new events default `published=0` (must be explicitly published); a publish guard on `PUT /api/admin/events/:id` returns `400 "Cannot publish: event has no active ticket types..."` when `published=1` is set on an event that has none; `sales_close_at` defaults to `dateIso − 2 hours` if not provided; cover image URLs get a HEAD preflight (rejects 404 / non-image types, skipped for `/uploads/*`); a default "General Admission" ticket type (price = base, capacity = total slots) is auto-INSERTed alongside the event row so freshly-created events are immediately bookable; the editor's saveEvent guards against double-click / double-Enter via early-return + try/finally. |
| **Event tax-column cleanup + manual-booking tax fix** | Migration 0015: dropped `events.tax_rate_bps` and `events.pass_fees_to_customer` (dead since the global money/tax unification — DB-only cleanup, zero customer-facing effect; ticket math comes from global `taxes_fees` for everyone). While in there, also fixed a real latent bug in `POST /api/admin/bookings/manual` (the cash/comp manual-booking server handler) which was still reading `events.tax_rate_bps` for its tax math — it always computed tax = 0 since the editor stopped writing to that column. Now uses `loadActiveTaxesFees()` like customer checkout, so the booking row's `tax_cents` + `fee_cents` columns are accurate. |
| **Manual-booking payment methods (walk-in card support)** | Migration 0016: added `bookings.payment_method` (TEXT) + index, backfilled existing rows from notes-prefix tags. `POST /api/admin/bookings/manual` now accepts `paymentMethod ∈ {card, cash, venmo, paypal, comp}`. **Card branch** mints a Stripe Checkout Session (with `metadata.source='admin_manual'`), creates a `pending` booking, returns `{paymentUrl, sessionId}`. The existing webhook flips status to paid + creates attendees + sends confirmation email — same pipeline as the public checkout. **Cash/Venmo/PayPal/Comp** branches insert paid/comp booking immediately with the method recorded. AdminNewBooking UI defaults to "Credit card" via a single dropdown (description shown beneath), renders a QR code (via the existing `qrcode` lib used for tickets) + URL + Copy/Open buttons + a "waiting for payment…" indicator that polls `/api/admin/bookings/:id` every 3s and flips to a green "✓ Payment received" state when the webhook lands. Booking list + detail modal show a `MethodBadge` pill (card/cash/venmo/paypal/comp). PCI scope unchanged — Stripe hosts the card form. |
| **Admin sidebar reorganization** | Sidebar regrouped from a flat list of 13 into 5 operational sections: **Dashboard** alone at top → **Event Setup** (Events, Promos, Vendors) → **Event Day** (Roster, Scan, Rentals) → **Insights** (Analytics, Feedback) → **Settings** alone at bottom. Section labels rendered as small uppercase olive-light text; thin dividers between sections. **New Booking** removed from sidebar entirely — exposed instead as an orange "+ New Booking" CTA in the Dashboard header next to the user identity line (manager+ only). **Team** and **Audit log** moved as sub-pages of the Settings hub (their `/admin/users` and `/admin/audit-log` routes still work as deep-links). **Roster** page now auto-selects the next upcoming event (earliest by date_iso, not past) on mount instead of starting empty — falls back to the most recent event if there are no upcoming. Net: sidebar shrinks from 13 → 10 items, primary CTA gets prominent placement, related concerns cluster. |
| **Workers Builds auto-deploy wiring** | Cloudflare Workers Builds (git integration) was previously failing every build because `npx wrangler deploy` runs without a prior Vite build, so `./dist` doesn't exist when wrangler validates `assets.directory`. Tried adding `[build] command = "npm run build"` to `wrangler.toml` — does not fire in wrangler 4.85 because the assets check short-circuits before the custom build hook. Real fix: in the Cloudflare dashboard (Workers & Pages → air-action-sports → Settings → Builds), changed the **Deploy command** from `npx wrangler deploy` to `npm run build && npx wrangler deploy`. Verified with an empty commit; auto-deploy on `git push origin main` is now reliable. |
| **Rules of Engagement page (fb_Tp9RIpHdKgWw)** | New `/rules-of-engagement` page (15 sections) shipped from Jesse's feedback ticket. Verbatim from ticket: 4 weapon-class card grid (Rifle 350 FPS / DMR 450 / LMG 450 with 20 RPS cap & real-LMG-platform requirement / Sniper 550 bolt-action), grenades (Thunder B 10ft kill radius), training knives (admin-approved, light tap = elim). Added beyond-ticket to close gaps vs MilSim City's published ROE: hit calling protocol (HIT call + dead rag + BLIND MAN cease-fire), ANSI Z87.1+ eye protection + under-18 full-face mask, 12+ age policy with parent/guardian rules, safe-zone procedures (mag out + dry fire + safety on), chronograph policy (.20g BBs, post-chrono adjustment = ban), drugs & alcohol zero-tolerance, sportsmanship/cheating (ghosting/wiping/overshooting), dispute resolution, physical violence permanent ban, transport (bagged in/out), site conduct (no climbing, off-limits, pack out, vandalism). Cross-linked from desktop navbar ("ROE"), mobile menu ("Rules of Engagement"), footer Info column, NewPlayers step 5, and EventDetail Rules & Requirements section (which also got the stale "350 AEG / 500 bolt" line corrected to match the new class system). Owner-decision gaps explicitly deferred — see §11. |
| **Booking flow cutover (Peek → internal)** | Removed the Peek widget `<script>` from `index.html`. `siteConfig.bookingLink` flipped from the Peek URL to `/booking`. 17 `<a target="_blank">` references converted to `<Link to>` across 14 files (Navbar, MobileMenu, EventCard, FloatingBookPill, PricingCard, Home ×2, About, Contact, EventDetail, Gallery, NewPlayers, Locations ×2). Events.jsx "Enquire Now" rerouted to `/contact` (sales conversation, not self-serve checkout). Stripe still in sandbox — real-money cutover is the next pre-launch op step. Plus `Booking` page got a new always-visible event banner at the top of step 1 (orange-bordered, large title, location + time + price; uses `coverImageUrl` as a darkened bg when set) so single-event mode no longer hides the event identity in a section subheading. |
| **Tax/fee bug fixes (post-audit)** | Three correctness bugs caught during a customer-flow audit. (1) `worker/routes/bookings.js` Stripe Checkout was passing every entry of `quote.lineItems` into the `line_items` shape, including tax/fee rows that lack `qty`/`unit_price_cents` — Stripe received `quantity=undefined&unit_amount=undefined` for the City Tax / State Tax / Processing Fees rows alongside duplicate aggregate rows. Fix: filter to `type === 'ticket' \|\| type === 'addon'` (commit 5e7d833). (2) `worker/routes/admin/bookings.js` POST `/manual` was computing **both** taxes and fees against `subtotal` only, while the public flow computes fee against `subtotal + tax`. Admin preview ($88.17 via `/api/bookings/quote`) ≠ saved booking total ($87.92). Refactored to mirror `pricing.js calculateQuote()` exactly (commit 2dd831f). (3) `worker/lib/pricing.js calculateQuote()` was leaking the $0.30 fixed Processing Fee into totals when subtotal was zero (Math.floor on percent base = 0 → 0, but `fixedAmt = 30 * 1 = 30` still applied). Mirror the empty-cart short-circuit already present in `Booking.jsx` totals useMemo (commit 5555426). |
| **Audit polish wave** | Four small UX/correctness items found in the same audit. (a) Capitalize "bunker" → "Bunker" in Operation Nightfall's `short_description` (SQL update, commit 1f68c67). (b) `/waiver` expired-waiver fall-through bug — the `alreadySigned` early-return on `Waiver.jsx` rendered "Waiver Expired" copy but never showed the form for re-signing. Gate the early-return on `!isExpired`; expired waivers now show a red banner explaining the previous waiver expired on `{date}` and that signing renews for another 365 days. Won't trigger before 2027-05 but better to ship correct now (commit 5e7f0d9). (c) `POST /api/bookings/quote` now returns HTTP 400 when `errors[]` is non-empty (was 200 with errors in body — misleading). Response shape unchanged so existing callers reading `errors[]` still work (commit adc315a). |
| **Cloudflare security insights cleanup** | Cloudflare Security Insights flagged 6 items on `airactionsport.com`. Triaged: 2 stale (HSTS + TLS encryption — Worker is already setting `Strict-Transport-Security: max-age=31536000; includeSubDomains` and HTTPS works; the scan ran before the custom domain was attached). 4 actionable — 2 fixed in code, 2 require Cloudflare-dashboard changes by the owner. Code fixes: (1) `public/.well-known/security.txt` static file added (RFC 9116 format with `actionairsport@gmail.com` as contact, 12-month expiry — Vite copies it into `dist/` so the static-asset handler serves it instead of the SPA fallback; commit ff22a01). (2) `wrangler.toml SITE_URL` and `index.html` baseline OG/Twitter tags switched from `https://air-action-sports.bulletbiter99.workers.dev` to `https://airactionsport.com` since the custom domain is now live (per-route SEO components were already on the custom domain; commit 1a19a6b). Side-swipe regression caught immediately: cover-image preflight in `worker/routes/admin/events.js` short-circuited only on relative `/uploads/...` paths, but the upload endpoint embeds `${SITE_URL}/uploads/${key}` so absolute URLs (now `https://airactionsport.com/uploads/...`) fell through to the HEAD-fetch branch — which routed back to the same Worker, ran out of subrequest budget, and returned 522. Fix: parse the URL and skip preflight when `pathname.startsWith('/uploads/')` regardless of host (commit fc21412). Cloudflare dashboard items remaining for the owner — see §11. |
| **Waiver overhaul (Phase A/B/C)** | Three-phase upgrade from the original 6-bullet seed waiver to a corporate-wide release of liability with Utah-specific minor handling, 365-day Claim Period (annual renewal), and full auto-link UX. **Phase A** — published `wd_v4` (current live waiver doc, SHA prefix `525a075a7…`): 22 sections including Release & Indemnity, PPE Compliance, FPS chrono, Weather, Camping, Third-Party Injuries, Sponsor/Vendor zones, Insurance certification, Choice of Law (Davis County, Utah), Photo/Drone Policy, Social Media Release, Medical Emergency Authorization, Data Privacy (7y adult / age-23 minor retention), Jury Trial Waiver §22, Annual Renewal §21, Electronic Signature Acknowledgment per Utah Code §46-4-201, Age Participation Policy table, Exhibit A Site Schedule (Ghost Town active / Foxtrot Fields coming soon). v2 and v3 superseded immediately due to Exhibit A status reconciliation; v4 strips an internal-only Hawkins v. Peart explainer. wd_v1 thru wd_v3 retired; future signers see v4. **Phase B** — migration 0018 + 4-tier age policy enforced both client- and server-side. Under 12 hard-blocks at submit. 12-15: parent fields + parent_initials + ON-SITE supervising adult name/signature/phone (defaults to "same as parent" toggle). 16-17: parent fields + parent_initials only. 18+: independent. Jury Trial Waiver initials field required for all tiers. Medical Conditions optional textarea (page-1 section). All new fields landed on `waivers` (see §6 row). Server `ageTier(age)` helper mirrors client logic exactly to prevent client/server drift. **Phase C** — `findExistingValidWaiver(db, email, firstName, lastName, asOf)` (worker/routes/webhooks.js, exported) matches by (LOWER(TRIM(email)), LOWER(TRIM(player_name))) + claim_period_expires_at > now. Called from both the Stripe webhook and admin manual booking handler — new attendee rows get `waiver_id` pre-populated when a match exists. Auto-linked attendees skip the per-attendee waiver-request email entirely (`out.waivers.push({skipped: 'already_on_file'})`). User-facing notifications: (1) `/booking/success` summary banner branches on per-booking waiver status ("All N already on file" / "M of N on file, rest need to sign" / "each player needs to sign") + per-attendee row shows green "✓ ON FILE — valid through {date}" or "Sign Waiver" link; (2) `/waiver?token=...` shows green-bordered "Waiver On File" card with signed date, expiry, doc version when attendee.waiver_id is set; falls through to the form if expiry has passed; (3) booking confirmation email gets a `{{waiver_summary}}` template variable matching the success page. Annual-renewal lookup is covered by `idx_waivers_claim_lookup`. audit_log entries: `waiver.auto_linked` per linked attendee. |
| **Smaller polish wave** | Five items shipped in one commit: (1) **Notify-submitter preview-before-send modal** — new `GET /api/admin/feedback/:id/notify-preview` renders the resolution-notice template with this ticket's actual status + admin_note (not sample data). AdminFeedback's "Notify submitter…" button now opens a sandboxed-iframe modal showing recipient + subject + rendered body before sending. `renderFeedbackResolutionNotice` helper extracted from `sendFeedbackResolutionNotice` so preview + send share the rendering path. (2) **Featured-event flag** — migration 0017 adds `events.featured INTEGER DEFAULT 0`; `/api/events` ORDER BY now `featured DESC, date_iso ASC|DESC` so admin-picked headliner wins ties; checkbox in AdminEvents Publishing section; orange "Featured" pill on `/events` cards (top-right of cover, or inline in header) + orange ring around featured cards. (3) **Reminder-cron monitoring** — `scheduled()` writes a `cron.swept` audit row on every run regardless of whether work was done, with full results metadata. New `GET /api/admin/analytics/cron-status` returns last sweep age + 24h `reminder.sent`/`reminder_1hr.sent` counts. AdminDashboard renders a CronHealth strip: green when last sweep <60min, red + STALE badge if older. (4) **`/events` cover-image hero** — 160px gradient-overlaid hero on cards with `coverImageUrl`; featured cards get accented styling. (5) **Booking total bug fix** (user-reported): per-order fixed fee (e.g., Stripe's $0.30 processing fee) was leaking into the total before any tickets were selected because the unit multiplier defaults to 1 for non-attendee `per_unit` values. Short-circuit in `totals` returns all zeros when subtotal === 0; once the user adds anything, taxes/fees apply correctly on top. |
| **Per-surface event cover images (Option A — full 4 fields)** | Migration 0019 adds four nullable URL columns to `events`: `card_image_url` (2:1, recommended 1200×600), `hero_image_url` (3.2:1, 1920×600), `banner_image_url` (4:1, 1920×500), `og_image_url` (1.91:1, 1200×630). The original `cover_image_url` stays as the universal fallback so existing events keep working unchanged. Backend: `worker/lib/formatters.js formatEvent()` exposes the four new fields as camelCased; `worker/routes/admin/events.js parseEventBody()` accepts them, INSERT/UPDATE write all five image columns, the duplicate handler clones every column, and the per-URL HEAD preflight (`preflightCoverImage`) now runs against every image URL the admin set, not just the cover — error returns prefix the column name so the editor knows which picker failed. `worker/index.js rewriteEventOg()` prefers `og_image_url` over `cover_image_url` for the OG meta image so social unfurls get the dedicated 1.91:1 asset when uploaded. Frontend consumers each prefer their own column with a fallback chain: `Events.jsx` uses `cardImageUrl ?? coverImageUrl` for the grid card hero, `EventDetail.jsx` uses `heroImageUrl ?? coverImageUrl` for the page hero, `Booking.jsx` uses `bannerImageUrl ?? coverImageUrl` for the step-1 banner. Admin editor: single "Cover image" Field replaced with an **Event Images** section containing 5 ratio-aware pickers (Cover · Card · Event Hero · Booking Banner · Social/OG). Each picker renders a 320px-wide preview cropped to its actual aspect ratio so the admin sees what customers will see; when a picker is empty but the universal cover is set, the cropped fallback shows in muted form (55% opacity + slight grayscale) with a "Showing fallback…" hint so the admin can decide whether the cover crop is acceptable for that surface or warrants a dedicated upload. Reuses the existing `/api/admin/uploads/image` endpoint — no new upload route. All four new fields are optional; events shipped with only `cover_image_url` continue to render correctly everywhere. |

## 11. What's left before go-live

All roadmap work is shipped. The remaining items are **operational**, not code:

1. **Flip Stripe sandbox → live.** Generate live keys in Stripe dashboard, rotate `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` via `wrangler secret put`, update the webhook target URL in Stripe to point at `/api/webhooks/stripe` in **live** mode, do a $1 real-money end-to-end test (buy → paid → email received → waiver link works).
2. **Cut over from Peek.** Remove the Peek widget `<script>` from `index.html`. Home / Events / Pricing "Book Now" buttons already point at the internal `/booking` page, but double-check any remaining external booking links.
3. **Seed content for Operation Nightfall.** Upload a cover image via `/admin/events` → Edit → Cover image picker. Decide any custom questions (team name? rental size? experience level?). Review + customize email copy in `/admin/settings/email-templates`.
4. **Invite a second admin.** Don't be a single point of failure on event day. Use `/admin/users` → Invite User → manager role.
5. **Dry run.** Create a test event a few days out, book a comp ticket through `/admin/new-booking`, and walk through: confirmation email → waiver → check-in via scanner → rental assignment → return. This exercises the full operational chain.

**Deferred / explicitly punted in-session** (not blocking, but worth knowing about):

- **City/region per Location site** — add a `region` field to each entry in `src/data/locations.js` (e.g. "Eagle Mountain, UT"), render under the site name on `/locations` and append to the Home gallery tile captions. Owner has not yet supplied the regions for the three sites. Ticket fb_wMupyX7iH3Hb closed with the FAQ-copy fix as the minimum; this is the follow-up enrichment.
- **In-browser screenshot capture** (`navigator.mediaDevices.getDisplayMedia`) in FeedbackModal — iOS Safari doesn't support it, so file upload is the universal path. Add only if file-upload adoption is low.
- **Lightbox gallery per Location site** — meaningful only once there are multiple photos per site. One image per site today; revisit when that changes.
- **Vendor package templates admin UI** — `vendor_package_templates` table exists (migration 0012). Currently create rows via SQL if needed; admin composer deferred.
- ~~**Drop dead DB columns `events.taxRateBps` + `events.passFeesToCustomer`**~~ — done in migration 0015 alongside the manual-booking tax fix.
- ~~**Notify-submitter UI affordance improvement**~~ — done in the smaller-polish wave (preview-before-send modal with sandboxed iframe).
- ~~**Featured-event flag on events**~~ — done via migration 0017 + AdminEvents checkbox + sort-order tweak. Pill renders on `/events` cards.
- ~~**Branded `/events` redesign**~~ — partial: cover-image hero + featured pill + featured-card accent shipped. Could go further with per-event visuals but the cover-image hero already lifts it significantly when admins upload covers.
- ~~**Reminder-cron monitoring**~~ — done via `cron.swept` audit row + `/api/admin/analytics/cron-status` + AdminDashboard CronHealth widget.
- **ROE page — owner-decision gaps** — six policy questions deferred from the Rules of Engagement page that need owner input before adding sections: (1) surrender / "bang-bang" rules (used or not?), (2) friendly fire (counts as a hit, or no-effect?), (3) respawn / medic mechanics (default rule, or "varies per event"?), (4) weapon-hit / pistol switch (primary hit = body hit, or switch to pistol?), (5) sidearm requirement for DMR / Sniper / LMG classes, (6) photography during games (allowed / restricted / require permission?). Once owner decides, add as new sections to `/rules-of-engagement`.
- ~~**Per-surface event cover images**~~ — done (Option A — full 4 fields). Migration 0019 + backend + frontend consumers + admin multi-picker shipped together. Existing `cover_image_url` retained as the universal fallback so events with only the cover keep rendering correctly. Reference table for the four surfaces is in §12 *(Cover-image surface reference)*. **Optional follow-up still on the table**: extend `tools/cover-banner-builder.html` to export all 4 cropped sizes from a single source design — design once at the widest ratio, get 4 ratio-correct exports for upload. Useful for future events but not blocking.

**Longer-term polish** (not blocking):
- Branded event listing redesign — `/events` still uses the original static template; could get richer per-event visuals now that cover images exist.
- Per-event SEO/OG image upload flow (right now `cover_image_url` doubles as both; fine for now).
- Reminder-cron monitoring (if a sweep fails silently, you only find out when a customer complains).
- Unused \u escapes audit — if future JSX edits get copied through Python-based replacement, watch for `\u2026`/`\u00d7` appearing as literal text in attributes (JSX string attributes don't process escapes; use real characters or `{'\u2026'}`).

## 12. Current live data

- **1 event**: `operation-nightfall` — Operation Nightfall, 2026-05-09, Ghost Town, $80 base (350 slots). Event is ~15 days out as of 2026-04-24.
- **1 ticket type**: `tt_nightfall_standard` — Standard Ticket, $80
- **3 add-ons**: Sword Rifle Package ($35 rental), SRS Sniper Package ($25 rental), 20g BBs 10k ($30 consumable)
- **16 email templates** seeded (original 7 + `vendor_package_sent` from 0010 + 6 from 0012: `vendor_package_reminder`, `vendor_signature_requested`, `vendor_countersigned`, `vendor_coi_expiring`, `vendor_package_updated`, `admin_vendor_return`; + `admin_feedback_received` from 0013; + `feedback_resolution_notice` from 0014)
- **1 waiver document** seeded: `wd_v1` with SHA-256 `0d8ee7e9864a…59d7`. Update procedure: insert `wd_v2`, stamp `retired_at` on v1, deploy — past signers remain pinned to their signed version.
- **0 vendors** seeded — admin must create them at `/admin/vendors`
- **0 vendor contract documents** seeded — owner must create v1 at `/admin/vendor-contracts` before flipping `require contract` on any package
- **3 taxes/fees** seeded (City Tax, State Tax, Processing Fees — configure via `/admin/settings/taxes-fees`)
- **5 resolved feedback tickets** (4 smoke/dogfood from when the system shipped 2026-04-23/24, plus `fb_Tp9RIpHdKgWw` — Jesse's Rules of Engagement page request, shipped 2026-04-29). 0 open tickets.
- **Cloudflare Workers Builds**: deploy command in dashboard is `npm run build && npx wrangler deploy` (must be both — see §13). Auto-deploys on `git push origin main`.
- **Booking flow live**: `/booking` is the canonical Book Now path; Peek widget removed from `index.html`. Stripe still in **sandbox** mode — real-money cutover is the next pre-launch step.
- **Migrations 0001-0019 applied to remote D1**.
- **Waiver document live**: `wd_v4` (corporate-wide release of liability + 4-tier age policy + 365-day Claim Period). wd_v1 thru wd_v3 retired. Edit at `/admin/waivers` (owner only) — creates a new version, retires the previous; past signers stay pinned to whatever they signed.
- **Custom domain live**: `https://airactionsport.com` is attached to the Worker (DNS via Cloudflare). `SITE_URL` env var, OG meta tags, and email links all use the custom domain. The `air-action-sports.bulletbiter99.workers.dev` fallback URL still resolves but is no longer canonical.
- **`/.well-known/security.txt`** served as a static asset per RFC 9116 — disclosure contact `actionairsport@gmail.com`, expires 2027-05-06.
- **Cloudflare DNS / Email config (partial)**: SPF set for Cloudflare Email Routing only (incoming mail forwards from `@airactionsport.com` to Gmail). **DMARC missing — booking confirmation emails may land in spam until added** (see §11 pre-launch checklist). Resend DKIM not yet configured for outbound transactional mail from `noreply@airactionsport.com`.

### Cover-image surface reference

Each surface has its own dedicated image column (added in migration 0019). When a surface column is empty, the rendering code falls back to `cover_image_url`, so events shipped with only the universal cover keep working. Reference for sizing — match these ratios when uploading per-surface assets in `/admin/events`:

| Surface | DB column | Code path | Aspect | Recommended dim | Crop behavior when fallback used |
|---|---|---:|---|---|---|
| `/events` card hero | `card_image_url` | `src/pages/Events.jsx` (`cardImageUrl ?? coverImageUrl`), `.event-cover` 160px tall × ~280-400 wide, `background-size: cover` | ~2:1 | 1200×600 | Cover crops top + bottom on tall sources |
| `/events/:slug` event hero | `hero_image_url` | `src/pages/EventDetail.jsx:70` (`heroImageUrl ?? coverImageUrl`), `linear-gradient + url()` background, ~400-500 tall | ~3.2:1 | 1920×600 | Cover crops top + bottom heavily on tall sources |
| `/booking` step-1 banner | `banner_image_url` | `src/pages/Booking.jsx:396` (`bannerImageUrl ?? coverImageUrl`), dark gradient overlay, ~800×200 effective | ~4:1 | 1920×500 | Cover gets most aggressive crop — only middle ~33% of a 4:3 source visible |
| OG meta (FB / Slack / iMessage unfurls) | `og_image_url` | `worker/index.js rewriteEventOg()` (`ogImageUrl ?? coverImageUrl ?? site default`) | 1.91:1 | 1200×630 | Cover center-cropped if source ratio differs |

**Admin editor**: `/admin/events` → Edit → "Event Images" section shows 5 ratio-aware pickers (Cover · Card · Event Hero · Booking Banner · Social/OG). Each picker renders a 320px-wide preview cropped to its actual ratio so the admin sees exactly what customers will see; when a picker is empty but Cover is set, the cropped fallback shows in muted form (55% opacity + slight grayscale) with a hint, so the admin can decide whether the cover crop is acceptable or warrants a dedicated upload.

**Single-image-only fallback ratio**: 1200×630 (1.91:1). Compose with focal subject in the center 800×500 box; assume top/bottom 65px and left/right 200px may be cropped on at least one surface. Per-surface uploads obviate this when you have time to design 4 ratio-correct images.

**Optional follow-up**: extend `tools/cover-banner-builder.html` to export all 4 cropped sizes from a single source design — design once at the widest ratio, get 4 ratio-correct exports for upload.
- **Rate-limit bindings** (all `[[unsafe.bindings]] type=ratelimit`, namespaces 1001–1008): `RL_LOGIN` 5/min, `RL_FORGOT` 3/min, `RL_VERIFY_TOKEN` 10/min, `RL_RESET_PWD` 5/min, `RL_CHECKOUT` 10/min, `RL_TOKEN_LOOKUP` 30/min, `RL_FEEDBACK` 3/min, `RL_FEEDBACK_UPLOAD` 3/min.
- **Admin owner**: Paul Keddington (bulletbiter99@gmail.com)
- **Stripe**: **still sandbox mode** — flip before first real sale
- **Resend**: `airactionsport.com` verified, sending from `noreply@airactionsport.com`
- **R2**: `air-action-sports-uploads` — events cover images under `events/<key>`, feedback screenshots under `feedback/<key>` (auto-deleted on terminal status), vendor docs under `vendors/<key>`.

## 13. Known issues / gotchas

- **`run_worker_first = true`** is critical in wrangler.toml. Without it Cloudflare's SPA fallback intercepts `/api/*` from browsers (not curl — curl works fine), causing 404 HTML responses to fetch calls.
- **Browser cache** on the HTML bundle can be aggressive. If a page looks wrong in normal browser but works in incognito → hard-refresh or clear site data.
- **PBKDF2 caps at 100,000 iterations** in the Workers runtime. Higher throws `NotSupportedError`.
- **Encoding**: Windows shells can double-encode em/en-dashes in seed SQL. Prefer ASCII `-` in SQL files, use admin UI for typographic dashes.
- **Cash bookings** have `stripe_payment_intent = 'cash_<booking_id>'` and no refund button in the admin UI — by design, cash refunds are handled out-of-band.
- **HTML rewriter on `/events/:slug`** runs on every request. Cheap, but don't add heavy D1 queries to that path without caching.
- **QR scanner** (`getUserMedia`) requires HTTPS — fine on production, may fail on plain-HTTP `localhost` depending on the browser. Test the scanner on the deployed URL from a phone, not via `npm run dev`.
- **Legacy event ID format**: the original seeded `operation-nightfall` event uses its slug as its primary key (`id`). New events created via the admin UI get random `ev_*` IDs with a separate `slug` column. Both are resolved by `/api/events/:id` (matches on either).
- **Vendor magic-link tokens** are HMAC-signed with `SESSION_SECRET`. Rotating that secret invalidates ALL outstanding vendor tokens — same rotation posture as admin sessions. Acceptable on compromise; know about it.
- **Waiver document integrity check**: if someone edits `waiver_documents.body_html` directly via SQL without recomputing `body_sha256`, the next `/api/waivers/:qrToken` GET refuses to serve (500) and writes a `waiver_document.integrity_failure` audit entry. Update the text via migration (new row, new hash), never in-place.
- **Workers Builds deploy command**: `wrangler.toml [build] command` does NOT run reliably on `wrangler deploy` in version 4.85 — the assets-directory existence check short-circuits before the custom build hook fires. Fix lives in the Cloudflare dashboard, not the repo: Workers & Pages → air-action-sports → Settings → Builds → **Deploy command** must be `npm run build && npx wrangler deploy` (not the default `npx wrangler deploy`). If a deploy ever fails with `The directory specified by the "assets.directory" field in your configuration file does not exist: /opt/buildhome/repo/dist`, this is the cause.

## 14. Resume checklist when starting fresh

1. Read this file top-to-bottom.
2. Confirm the Cloudflare deploy credentials memory points to `.claude/.env` (token present).
3. Sanity checks:
   - `curl https://air-action-sports.bulletbiter99.workers.dev/api/health` → `{"ok":true,...}`
   - `curl https://air-action-sports.bulletbiter99.workers.dev/api/events` → returns 1 event
4. Confirm admin login works (use `/admin/forgot-password` if needed).
5. Check `wrangler deployments list` to see what's currently live. Most recent as of 2026-05-05: `d19b9f25-d7cf-4d7c-8d11-a470b7525775` (per-surface event cover images — Option A, migration 0019 + admin multi-picker). Earlier: cover-image preflight 522 fix `03401d3d`, security.txt + custom-domain SITE_URL switch (ff22a01 / 1a19a6b), waiver overhaul A/B/C (790c58d, 2b26a4d), tax/fee bug fixes (5e7d833 / 2dd831f / 5555426), audit polish (1f68c67 / 5e7f0d9 / adc315a). Auto-deploy via Workers Builds is wired correctly (see §13 + the **Workers Builds auto-deploy wiring** row in §10).
6. If picking up feedback triage: run `/feedback` in-session (or pull directly: `npx wrangler d1 execute air-action-sports-db --remote --command="SELECT id, type, priority, status, title FROM feedback WHERE status IN ('new','triaged','in-progress') ORDER BY created_at DESC"`).

---

## Prompt for fresh session

Copy and paste the following into a new Claude Code session:

```
I'm resuming work on the Air Action Sports booking system. Read HANDOFF.md
in the project root first — it has full context on the stack, deployed
state, every shipped phase, every API and frontend route, deferred items
in §11, the pre-launch operational checklist also in §11, the cover-image
surface reference table in §12, and the §10 phase log.

Production: https://airactionsport.com (custom domain, Cloudflare Worker,
auto-deploy on `git push origin main`). The .workers.dev fallback URL
still resolves but is no longer canonical.

Current state — all shipped and live:
  - Phases 1–9, the 5 polish items, vendor MVP + v1, waiver hardening,
    admin UI refactor, global money/tax unification, the feedback/ticket
    system, event-creation hardening + dynamic homepage, Rules of
    Engagement page, the booking-flow cutover (Peek widget removed —
    /booking is canonical), the smaller-polish wave, the waiver overhaul
    (Phase A/B/C — wd_v4 corporate-wide release of liability, 4-tier age
    policy enforced client + server, 365-day Claim Period auto-link),
    tax/fee bug fixes (Stripe line items, admin/public parity, empty-cart
    short-circuit), audit polish, Cloudflare security insights cleanup
    (security.txt, custom-domain SITE_URL switch), per-surface event
    cover images (migration 0019 — card 2:1 / hero 3.2:1 / banner 4:1 /
    og 1.91:1 — admin editor has 5 image pickers, consumer surfaces
    prefer their own column with cover fallback).
  - Tools: tools/cover-banner-builder.html (1200×630 design tool with
    live preview + html2canvas download).
  - Docs: docs/staff-job-descriptions.md (12 full HR-ready job posts
    organized by tier, with admin-system role mappings).

Cloudflare Workers Builds deploy command (in dashboard): `npm run build &&
npx wrangler deploy`. Do NOT change to plain `npx wrangler deploy` (see
§13 gotcha — wrangler 4.x assets-directory check short-circuits before
the [build] hook).

Pre-launch operational items still to be done by owner (NOT code):
  - DMARC TXT record + Resend DKIM CNAMEs in Cloudflare DNS — booking
    confirmation emails will land in spam without it. HIGH priority.
    Do BEFORE Stripe live cutover. Exact records in §11.
  - Enable "Always Use HTTPS" toggle in Cloudflare SSL/TLS Edge
    Certificates (currently OFF — HTTP returns 200 not 301).
  - Stripe sandbox → live cutover + $1 real-money end-to-end test.
  - Per-surface cover image uploads for Operation Nightfall via
    /admin/events → Edit → Event Images section. Recommended sizes:
      Card hero      1200×600  (2:1)
      Event hero     1920×600  (3.2:1)
      Booking banner 1920×500  (4:1)
      Social / OG    1200×630  (1.91:1)
  - Invite a second admin via /admin/users (manager role).
  - Comp-ticket dry run end-to-end (book → confirm → waiver → check-in).

Next-up code work (optional, owner-decision):
  1. Cover-banner builder per-surface export — extend
     tools/cover-banner-builder.html to output all 4 cropped sizes from
     one source design.
  2. ROE owner-decision gaps — six policy questions deferred from
     /rules-of-engagement; needs owner input before adding sections.
     See §11.
  3. City/region per Location site — content-blocked on owner supplying
     regions for Ghost Town / Echo Urban / Foxtrot Fields.

Stripe is still in sandbox mode (BLOCKING for first real sale). Operation
Nightfall (first live event) is 2026-05-09. Today: 2026-05-06.

After you've read the handoff, give me:
  1. A one-paragraph status summary of where things actually stand (verify against
     `curl /api/health` and `curl /api/events` rather than just trusting the doc).
  2. A ranked top-3 of what I should work on next, with rough effort estimates and
     why-now. Use §11's pre-launch checklist + deferred list as the primary
     candidate pool but flag anything low-hanging and high-value you notice.
  3. Any drift between HANDOFF.md and the actual live state (stale counts, removed
     features, new feedback tickets, etc.) — catch that upfront.
  4. The current open feedback queue (pull via the admin API or D1). Summarize
     anything in `new` or `in-progress` status in 1–2 sentences each. As of
     2026-04-30 the queue is empty.

Most likely next pickups (roughly priority order):

  Pre-launch operational (blocking go-live):
  - **DMARC + Resend DKIM/SPF DNS records** — booking confirmation emails
    will land in spam without DMARC. Cloudflare DNS: add TXT at
    `_dmarc.airactionsport.com` with
    `v=DMARC1; p=none; rua=mailto:actionairsport@gmail.com; pct=100; aspf=r; adkim=r;`.
    Then Resend dashboard → Domains → airactionsport.com to get the DKIM
    CNAMEs and add them to Cloudflare DNS. Update existing SPF TXT to
    include both Cloudflare Email Routing AND Resend's sending include.
    Verify deliverability via Mail-Tester before live cutover.
  - **Cloudflare Always Use HTTPS toggle** — currently OFF for
    airactionsport.com (HTTP returns 200, not 301). Dashboard → SSL/TLS →
    Edge Certificates → toggle "Always Use HTTPS" ON. While there,
    confirm Min TLS = 1.2.
  - **Stripe sandbox → live cutover** + $1 real-money end-to-end test
    (~30 min once keys are in hand; includes webhook re-targeting).
  - **Seed Operation Nightfall content**: per-surface cover-image
    uploads in /admin/events → Edit → Event Images. Each picker shows
    the recommended dimension + a cropped preview. Anything left blank
    falls back to the existing universal Cover image.
      Card hero      1200×600 (2:1)   — /events grid card
      Event hero     1920×600 (3.2:1) — event detail page hero
      Booking banner 1920×500 (4:1)   — /booking step-1 banner
      Social / OG    1200×630 (1.91:1) — FB/Slack/iMessage unfurls
  - **Invite a second admin** via /admin/users so you're not a single
    point of failure on event day
  - **Dry-run**: create a test event, book a comp ticket, walk the full
    flow (confirmation → waiver → scanner check-in)
  - (DONE 2026-04-30 / 05-05 / 05-06) Peek widget removal + Book Now →
    /booking cutover; smaller-polish wave; ROE page; auto-deploy wiring;
    waiver overhaul A/B/C; tax/fee bug fixes; audit polish; security.txt
    + custom-domain SITE_URL switch; **per-surface cover images
    (Option A — full 4 fields, migration 0019 + admin multi-picker)**.

  ROE follow-up (owner-decision gaps — needs owner input before coding):
  - Surrender / "bang-bang" rules — used at AAS or not?
  - Friendly fire — counts as a hit, or no-effect?
  - Respawn / medic mechanics — default rule or "varies per event"?
  - Weapon-hit / pistol switch — primary hit = body hit, or switch to pistol?
  - Sidearm requirement for DMR / Sniper / LMG classes
  - Photography during games — allowed / restricted / require permission?

  Deferred / content-blocked:
  - City/region per Location site (Eagle Mountain, UT style) — waiting on owner
    to supply regions for Ghost Town / Echo Urban / Foxtrot Fields

  Triage anything new in the feedback queue before starting the above. Use the
  /feedback slash command or the .claude/commands/feedback.md playbook.

Don't start coding until I pick one. If the task involves destructive ops
(secret rotation, Stripe mode change, DB writes, R2 deletions), confirm the
plan with me first.
```

End of handoff.

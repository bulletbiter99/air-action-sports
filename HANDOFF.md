# Air Action Sports — Handoff

Session handoff doc. Skim top-to-bottom to get oriented; copy the [Prompt for fresh session](#prompt-for-fresh-session) block when starting a new conversation.

---

## 1. What this is

A full booking + waiver + admin system for Air Action Sports (airsoft events), built as a replacement for Peek Pro to avoid the 6% platform fee. Deployed live at **https://airactionsport.com** (custom domain; the `air-action-sports.bulletbiter99.workers.dev` fallback URL still resolves).

Business economics:
- Peek charged ~$12.78 in fees on an $80 booking (16%)
- This system charges ~$2.62 in Stripe fees on an $80 booking (~3.3%)
- **Savings: ~$10 per ticket**, ~$60 on a 6-player booking

**Status:** feature-complete. All numbered phases (1–9), all 5 polish items, the Phase 1 audit, Milestone 1 (test infrastructure: 216 vitest unit tests + 7 Playwright smoke tests + CI workflow), and Milestone 2 (shared primitives + cross-route fix: 471 tests across 70 files, 6 gated paths) merged to `main` 2026-05-07 as `7a87f28` — migration `0021_feature_flags.sql` applied to remote D1, density toggle live at `/admin/settings`. **Milestone 3 (customers schema + persona-tailored AdminDashboard) is in flight on `milestone/3-customers`** as of 2026-05-07: **9 of 13 batches (B0-B8a) merged** with **600/600 tests passing across 79 files**. Migrations 0022 + 0023 + 0024 all applied to remote D1; backfill ran on remote; B5 dual-write code live; B7 Group F auth characterization tests + B8a customers admin route (`GET /api/admin/customers`, `GET /:id`, `POST /merge`) live (UI gated client-side by the `customers_entity` feature flag, currently `off`). See §10 row "Milestone 3" + the CLAUDE.md "Milestone 3" section. The remaining work before first live event is operational, not code — see §11.

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
├── CLAUDE.md                ← entry-point rules: stack summary, do-not-touch list,
│                              stop-and-ask conditions, branch etiquette
├── HANDOFF.md               ← (this file) full session-start context
├── .gitattributes           ← LF normalization (eol=lf default; *.bat eol=crlf)
├── wrangler.toml            ← Worker + D1 + R2 + cron config
├── package.json             ← name: "air-action-sports"
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
│   ├── 0010_session_version.sql ← users.session_version (closes SECURITY_AUDIT MED-9/10)
│   ├── 0010_vendors.sql         ← vendor MVP (6 tables + seed email template)
│   ├── 0011_waiver_hardening.sql ← waiver_documents + at-sign snapshot/hash
│   ├── 0012_vendor_v1.sql       ← contracts, signatures, password portal, cron idempotency, v1 email templates
│   ├── 0013_feedback.sql        ← feedback table + admin_feedback_received template
│   ├── 0014_feedback_attachment.sql ← attachment cols + feedback_resolution_notice template
│   ├── 0015_drop_event_tax_columns.sql ← drop dead per-event tax_rate_bps + pass_fees_to_customer
│   ├── 0016_booking_payment_method.sql ← bookings.payment_method col + index + backfill
│   ├── 0017_event_featured.sql         ← events.featured (admin-picked headliner sort)
│   ├── 0018_waiver_v4_fields.sql       ← 4-tier age, jury trial initials, supervising adult, claim_period_expires_at + idx_waivers_claim_lookup
│   ├── 0019_event_per_surface_images.sql ← card/hero/banner/og image URL columns (per-surface cover images, cover_image_url stays as fallback)
│   ├── 0020_drop_admin_sessions.sql ← drop dead admin_sessions table (NOT YET APPLIED to remote — see §11)
│   └── README.md            ← migration convention + 0010_* collision explanation
├── docs/
│   ├── audit/                ← Phase 1 audit: 00-overview.md + 10 area docs
│   │                            (stack, routes, data model, integrations,
│   │                             public/admin coupling, do-not-touch, admin
│   │                             surface map, pain points, test coverage,
│   │                             open questions)
│   └── staff-job-descriptions.md  ← 22 role descriptions across 4 tiers
├── scripts/                 ← one-off SQL scripts, not tracked by migration runner
├── .claude/
│   ├── commands/feedback.md  ← /feedback slash-command playbook (pull → review → recommend → update → deploy)
│   └── skills/deploy-air-action-sports/SKILL.md ← deploy wrapper (build + wrangler deploy + health check)
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
| `admin_sessions` | Legacy — sessions live in HMAC-signed cookies now. **Migration `0020_drop_admin_sessions.sql` drops this table; pending application to remote D1 (see §11).** |
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
| POST | `/api/bookings/quote` | Preview totals without committing. Rate-limited at **30/min/IP** via `RL_QUOTE` (added in pre-Phase-2 hygiene batch). |
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
| **Phase 1 audit + Pre-Phase-2 hygiene batch (2026-05-06)** | **Phase 1 audit** (read-only inventory ahead of admin overhaul) shipped to `docs/audit/`: 11 markdown files (~1800 lines) covering stack, route inventory (103 API endpoints + 50 SPA routes), data model (27 tables + ERD), integrations (Stripe + Resend + R2 + waiver service + secret-name inventory — zero committed credentials), public/admin coupling (28 cross-boundary assets), 60-entry do-not-touch list, admin surface map (24 screens with git history + JD persona mapping), pain points (42 code-observable issues), test coverage (zero today; 83 characterization tests prescribed), open questions (50 — 12 runtime / 21 operator / 11 external / 6 access). `CLAUDE.md` at repo root mirrors the do-not-touch list and stop-and-ask conditions. **Pre-Phase-2 hygiene batch** (6 zero-risk follow-ups, all merged 2026-05-06): (1) **Stripe API version pinned** to `2026-04-22.dahlia` via `Stripe-Version` header on every outbound call in `worker/lib/stripe.js stripeFetch()` — no more silent drift if the account default rotates. (2) **`RL_QUOTE` rate-limit binding** added (namespace 1009, 30/min/IP) on `POST /api/bookings/quote`. (3) Migration `0020_drop_admin_sessions.sql` drops the dead `admin_sessions` table — **in repo but NOT yet applied to remote D1; operator runs `wrangler d1 migrations apply --remote`**. (4) `migrations/README.md` documenting forward-only convention + the `0010_*` filename collision (`0010_session_version.sql` + `0010_vendors.sql` are independent and order-deterministic via alphabetic sort). (5) `package.json name` renamed `temp-react` → `air-action-sports`. (6) `.gitattributes` for LF normalization (eol=lf default; *.bat eol=crlf). Audit branch (`audit/phase-1`) retained on remote for reference; chore branch deleted. |
| **Milestone 1 — Test infrastructure (✓ closed 2026-05-06; merged to main as `c4d67a6`)** | First repo-wide test suite + CI. Long-lived branch `milestone-1-test-infrastructure` shipped 9 batches (PRs #2–#13) and was merged into `main` via merge commit `c4d67a6` (PR #14) — merge strategy preserved per-batch SHAs for `git bisect` access. **Purely additive** — zero modifications to production code. Lands the audit-prescribed characterization tests for Groups A–D (the 4 critical-tier paths in `scripts/test-gate-mapping.json gates`) plus a Playwright smoke scaffold for Group I. **216 vitest unit tests across 54 files**, locking `worker/lib/pricing.js` 95.95% lines, `worker/routes/webhooks.js` 91.08%, `worker/routes/waivers.js` 93.61%, `worker/lib/stripe.js` signature-verify subset 56.06% (per `docs/runbooks/m1-baseline-coverage.txt`). **7 Playwright smoke tests** in `tests/e2e/` covering audit Group I (#77–#83) — operator-triggered via `npm run test:e2e` against a deployed Worker; **NOT in CI by default**. **CI workflow** at `.github/workflows/ci.yml` runs vitest+coverage on every PR to `main` or `milestone-*`; lint included with `continue-on-error: true` until `eslint.config.js` is added (audit pain-point #8). **CONTRIBUTING.md** + `.github/PULL_REQUEST_TEMPLATE.md` codify the M1 operating rules. **Test-gate map** at `scripts/test-gate-mapping.json` (4 `gates` + 7 `uncovered` entries — the latter is the post-M1 punch list: Groups E/F/G/H + the lint config gap). **Closing runbooks** at `docs/runbooks/`: `m1-baseline-coverage.txt` (captured `npm run test:coverage` table for regression detection), `m1-rollback.md` (full + partial rollback recipes with `git revert -m 1` syntax for the merge commit), `m1-deploy.md` (the milestone → main playbook this row records the result of). **Test runner**: Vitest 2.1.9 + @vitest/coverage-v8 (Node 20 env, Web Crypto used directly), Playwright 1.59.x. Coverage at `coverage/` (gitignored). Per-batch operating rules used during M1: plan-mode-first per batch, 10-file cap per PR, Conventional Commits with `m1-<area>` scope, no `--force`/no rebases on shared branches/no direct commits to main or milestone branch — preserved as a template in CLAUDE.md for future milestones. **Operator one-time post-merge action**: `npx playwright install chromium` (downloads ~150 MB Chrome binary; not part of `npm install`). **Deferred to a future milestone**: audit Groups E (admin manual booking — E47-E53), F (auth — F54-F64), G (worker-level — G65-G70), H (cron — H71-H76); plus the lint config gap. |
| **Milestone 2 — Shared Primitives + Cross-Route Fix (✓ closed 2026-05-07; merged to main as `7a87f28` via PR #28)** | First milestone of Phase 2 — admin overhaul groundwork. Long-lived branch `milestone-2-shared-primitives` shipped **11 batches** (PRs #16–#27; sub-branch naming `m2-batch-N-slug` flat per same git ref-collision workaround M1 used). **Per-batch squash SHAs**: B1 FilterBar `658e95b` (#16); B2 writeAudit `2cf1485` (#17); B3a money helpers `1d3ed98` (#18); B3b email helpers `f35a0ec` (#19); B4a `findExistingValidWaiver` relocation `683f4a6` (#20); B4b drop shim + retarget tests `36fda2b` (#21); B5a feature-flag substrate `5e1f568` (#22); B5b feature-flag admin route `95983f4` (#24); B5c density toggle UI `a6ab6e9` (#25); B6 Group E admin booking tests `d40e099` (#26); B7 closing runbooks + final docs `febadf0` (#27). Plus the docs-checkpoint `8de7541` (PR #23) which captured M2 mid-flight state on main. **Milestone-to-main merged 2026-05-07 as `7a87f28` via PR [#28](https://github.com/bulletbiter99/air-action-sports/pull/28)** (merge-commit strategy preserves per-batch SHAs); migration `0021_feature_flags.sql` applied to remote D1 same day. **Test count: +255 unit tests across +16 new files** (216 M1 baseline → **471 across 70 files**), locking 6 gated paths in `scripts/test-gate-mapping.json`: `pricing.js` 98.84%, `stripe.js` 93.93%, `webhooks.js` 91.17%, `waivers.js` 93.61%, `waiverLookup.js` 100% (NEW gate B4a/4b), `admin/bookings.js` 71.11% (NEW gate B6 — promoted from `uncovered`). **Six new shared admin primitives ready for M3+ reuse**: `src/components/admin/FilterBar.jsx` (B1), `worker/lib/auditLog.js writeAudit()` (B2), dual-target `money.js` + `email.js` helpers (B3a/3b, client + worker mirror with identical test suites), relocated `worker/lib/waiverLookup.js findExistingValidWaiver()` (B4a/4b — closes audit §08 #7 cross-route smell, function body byte-identical), `worker/lib/featureFlags.js` (B5a — 4-state model: off/on/user_opt_in/role_scoped, graceful table-missing handling). **Feature-flag end-to-end** (B5a/5b/5c): migration `0021_feature_flags.sql` + admin route `GET /api/admin/feature-flags` + `PUT /:key/override` + `src/admin/useFeatureFlag.js` hook with module-level cache + density toggle UI in `/admin/settings`. **Audit Group E admin booking characterization tests** (B6, audit IDs E47-E53): manual cash/comp/card branches, public/admin pricing parity (locks the 2dd831f fix — fee on subtotal+tax), waiver auto-link, refund Idempotency-Key header, refund-rejects-cash. **Closing runbooks** at `docs/runbooks/`: `m2-rollback.md` (full + partial rollback recipes including migration 0021 reverse procedure), `m2-deploy.md` (milestone → main playbook with operator-applies-remote step for migration 0021 + post-merge SHA fill-in step), `m2-baseline-coverage.txt` (captured `npm run test:coverage` for regression detection — replaces M1 baseline as the new floor). **Operator-applies-remote action queued post-milestone-merge**: `CLOUDFLARE_API_TOKEN=$TOKEN npx wrangler d1 migrations apply air-action-sports-db --remote` to apply `0021_feature_flags.sql`. Until applied, `featureFlags.js` returns `false`/`[]` gracefully on missing tables; density toggle UI is hidden (gated by `flag.exists` from `listFlags`). **Conventions established**: dual-target test pattern (`tests/unit/utils/<helper>.test.js` imports both client + worker variants of helpers), reusable `tests/helpers/adminSession.js` (cookie minting + user-row binding) used by 7 admin route tests in B5b + 8 admin booking tests in B6, CSS density tokens via `src/styles/tokens.css` (`:root` block at default + `[data-density="compact"]` override; zero pixel diff at default verified via dev-server `getComputedStyle` probe). **Critical do-not-touch handled in M2**: B4a/4b moved `findExistingValidWaiver` from `worker/routes/webhooks.js` to `worker/lib/waiverLookup.js`. The function body is **byte-identical** to the original; only its location changed. Group D's 25 characterization tests pass identically. The cross-route import smell from audit §08 #7 is fully closed. B5b adds one route mount line to `worker/index.js` alongside the existing 17 admin mounts; the DNT-listed functions in worker/index.js (`serveUpload`, `rewriteEventOg`, `scheduled`, `withSecurityHeaders`) are untouched. **Detailed batch-by-batch state in [CLAUDE.md](CLAUDE.md)'s "Milestone 2" section** — read that first when resuming any related work. **Deferred to post-M2 (still in `scripts/test-gate-mapping.json uncovered`)**: audit Groups F (auth — F54-F64), G (worker-level — G65-G70), H (cron — H71-H76). The lint config gap (audit pain-point #8) was closed in M3 batch 0 (`eslint.config.js` flat config landed; lint blocking in CI). |

## 11. What's left before go-live

All roadmap work is shipped. The remaining items are **operational**, not code:

1. **Flip Stripe sandbox → live.** Generate live keys in Stripe dashboard, rotate `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` via `wrangler secret put`, update the webhook target URL in Stripe to point at `/api/webhooks/stripe` in **live** mode, do a $1 real-money end-to-end test (buy → paid → email received → waiver link works). Note: outbound API version is now pinned (`Stripe-Version: 2026-04-22.dahlia` in `worker/lib/stripe.js`) — going live doesn't change that pin; rotate it deliberately if Stripe upgrades the account.
2. **Apply migration `0020_drop_admin_sessions.sql` to remote D1.** Drops the dead `admin_sessions` table (unused since the cookie-auth migration). Run: `CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 migrations apply air-action-sports-db --remote`. Skipping is harmless (table is unread by app code) but leaves the dead table around.
3. **Seed content for Operation Nightfall.** Upload a cover image via `/admin/events` → Edit → Cover image picker. Decide any custom questions (team name? rental size? experience level?). Review + customize email copy in `/admin/settings/email-templates`.
4. **Invite a second admin.** Don't be a single point of failure on event day. Use `/admin/users` → Invite User → manager role.
5. **Dry run.** Create a test event a few days out, book a comp ticket through `/admin/new-booking`, and walk through: confirmation email → waiver → check-in via scanner → rental assignment → return. This exercises the full operational chain.
6. ~~**Cut over from Peek.**~~ — done in HANDOFF §10 row "Booking flow cutover".

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
- **Migrations 0001-0019 applied to remote D1**. Migration `0020_drop_admin_sessions.sql` is **in repo but NOT yet applied to remote** (see §11 #2).
- **Stripe API version pin**: `2026-04-22.dahlia` via `Stripe-Version` header in `worker/lib/stripe.js stripeFetch()`. Applies to every outbound Stripe call. Updates require both a Stripe-dashboard rollover and a code change in lockstep.
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
- **Rate-limit bindings** (all `[[unsafe.bindings]] type=ratelimit`, namespaces 1001–1009): `RL_LOGIN` 5/min, `RL_FORGOT` 3/min, `RL_VERIFY_TOKEN` 10/min, `RL_RESET_PWD` 5/min, `RL_CHECKOUT` 10/min, `RL_TOKEN_LOOKUP` 30/min, `RL_FEEDBACK` 3/min, `RL_FEEDBACK_UPLOAD` 3/min, `RL_QUOTE` 30/min (added pre-Phase-2 on `/api/bookings/quote`).
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

1. Read this file top-to-bottom. **Then read [CLAUDE.md](CLAUDE.md)** — it carries the do-not-touch list, stop-and-ask conditions, and branch etiquette derived from the Phase 1 audit, plus the M1 closing summary and post-M1 punch list. Skim [docs/audit/00-overview.md](docs/audit/00-overview.md) if more context on the present surface area is needed before touching admin code.
2. Confirm the Cloudflare deploy credentials memory points to `.claude/.env` (token present).
3. Sanity checks:
   - `curl https://airactionsport.com/api/health` → `{"ok":true,...}`
   - `curl https://airactionsport.com/api/events` → returns 1 event
   - `npm test` → 216 passing across 54 files (vitest unit suite from M1).
   - `npm run test:coverage` → compare gated paths against `docs/runbooks/m1-baseline-coverage.txt` (any drop > 1% on `pricing.js` / `webhooks.js` / `waivers.js` / `stripe.js` is a signal — investigate before continuing).
4. Confirm admin login works (use `/admin/forgot-password` if needed).
5. Check `wrangler deployments list` to see what's currently live. Most recent as of 2026-05-06 post-M1-merge: the deploy triggered by `c4d67a6` (M1 milestone merge to main; CI green via PR #14). Earlier: `ead41292-a8e5-4d9b-85df-9b05382f2803` (Phase 1 audit + pre-Phase-2 hygiene). Auto-deploy via Workers Builds is wired correctly (see §13 + the **Workers Builds auto-deploy wiring** row in §10).
6. If touching anything in [scripts/test-gate-mapping.json](scripts/test-gate-mapping.json) `gates`: run the listed test paths first to confirm baseline; after editing, re-run them. If a test reveals current behavior conflicting with audit-documented behavior, **stop and ask** — do not adapt the test to match the new code.
7. If picking up feedback triage: run `/feedback` in-session (or pull directly: `npx wrangler d1 execute air-action-sports-db --remote --command="SELECT id, type, priority, status, title FROM feedback WHERE status IN ('new','triaged','in-progress') ORDER BY created_at DESC"`).

---

## Prompt for fresh session

Copy and paste the following into a new Claude Code session:

```
I'm resuming work on the Air Action Sports booking system. Read these
two files in the project root first, in order:

  1. HANDOFF.md — full context on the stack, deployed state, every
     shipped phase (§10 — including Milestone 1 test infrastructure,
     closed 2026-05-06), every API and frontend route, the §11
     pre-launch checklist + deferred list, the cover-image surface
     reference table in §12, and §13 known-issues.
  2. CLAUDE.md — entry-point rules: the do-not-touch list (mirrored
     from docs/audit/06-do-not-touch.md), stop-and-ask conditions,
     branch etiquette, run/build/lint/test/deploy commands, the
     **Test gate enforcement** subsection pointing at
     scripts/test-gate-mapping.json, and the closed-state M1
     summary with the post-M1 punch list (Groups E/F/G/H + lint gap).

If you're touching admin code or anything on the do-not-touch list,
also skim docs/audit/00-overview.md and
docs/audit/05-coupling-analysis.md before editing — and run the test
paths listed in scripts/test-gate-mapping.json `gates` for the file
you're touching.

Production: https://airactionsport.com (custom domain, Cloudflare Worker,
auto-deploy on `git push origin main`). The .workers.dev fallback URL
still resolves but is no longer canonical.

Current state — all shipped and live:
  - Phases 1–9, the 5 polish items, vendor MVP + v1, waiver hardening,
    admin UI refactor, global money/tax unification, the feedback/ticket
    system, event-creation hardening + dynamic homepage, Rules of
    Engagement page, the booking-flow cutover (Peek removed —
    /booking is canonical), the smaller-polish wave, the waiver overhaul
    (Phase A/B/C — wd_v4 corporate-wide release of liability, 4-tier age
    policy enforced client + server, 365-day Claim Period auto-link),
    tax/fee bug fixes, audit polish, Cloudflare security insights cleanup
    (security.txt, custom-domain SITE_URL switch), per-surface event
    cover images (migration 0019 — card / hero / banner / og pickers).
  - **Phase 1 audit (2026-05-06):** read-only inventory ahead of admin
    overhaul, shipped to docs/audit/. 11 markdown files (~1800 lines)
    covering stack, route inventory (103 API endpoints + 50 SPA routes),
    data model (27 tables + ERD), integrations, public/admin coupling
    (28 cross-boundary assets), 60-entry do-not-touch list, admin surface
    map (24 screens), pain points (42 code-observable issues), test
    coverage (zero today; 83 characterization tests prescribed for
    Phase 2 prep), 50 open questions. CLAUDE.md mirrors the do-not-touch
    list at repo root.
  - **Pre-Phase-2 hygiene batch (2026-05-06):** six zero-risk follow-ups
    merged to main:
      (1) Stripe API version pinned to `2026-04-22.dahlia` via
          Stripe-Version header in worker/lib/stripe.js stripeFetch().
      (2) RL_QUOTE rate-limit binding (namespace 1009, 30/min/IP) on
          POST /api/bookings/quote.
      (3) migrations/0020_drop_admin_sessions.sql — IN REPO BUT NOT YET
          APPLIED to remote D1; operator runs `wrangler d1 migrations
          apply --remote` (see §11 #2).
      (4) migrations/README.md documenting forward-only convention +
          0010_* filename collision (intentional, alphabetic order).
      (5) package.json `name` renamed temp-react → air-action-sports.
      (6) .gitattributes for LF normalization.
  - **Milestone 1 — Test Infrastructure (closed 2026-05-06,
    merge commit `c4d67a6`):** First repo-wide test suite + CI.
    216 vitest unit tests across 54 files locking the four
    critical-tier paths: `worker/lib/pricing.js` 95.95% lines,
    `worker/routes/webhooks.js` 91.08%, `worker/routes/waivers.js`
    93.61%, `worker/lib/stripe.js` signature-verify subset 56.06%.
    7 Playwright smoke tests scaffolded in tests/e2e/
    (operator-triggered via `npm run test:e2e` against deployed
    Worker; NOT in CI by default). CI workflow at
    .github/workflows/ci.yml runs vitest+coverage on every PR;
    lint with continue-on-error pending eslint.config.js
    (audit pain-point #8). Test-gate map at
    scripts/test-gate-mapping.json. Closing runbooks at
    docs/runbooks/m1-{baseline-coverage.txt,rollback.md,deploy.md}.
    CONTRIBUTING.md + .github/PULL_REQUEST_TEMPLATE.md codify
    operating rules.
  - **Milestone 2 — Shared Primitives + Cross-Route Fix
    (closed 2026-05-07; merged to main as `7a87f28` via PR #28):**
    First milestone of Phase 2. 11 batches merged on `milestone-2-shared-primitives`
    (B1-B7, with B3/B4/B5 split into a/b sub-batches per the
    10-file cap). Per-batch squash SHAs:
      B1 FilterBar             658e95b (#16)
      B2 writeAudit            2cf1485 (#17)
      B3a money helpers        1d3ed98 (#18)
      B3b email helpers        f35a0ec (#19)
      B4a waiverLookup move    683f4a6 (#20)  [CRITICAL — closes audit §08 #7]
      B4b drop shim + retarget 36fda2b (#21)
      B5a feature-flag lib     5e1f568 (#22)
      B5b feature-flag route   95983f4 (#24)
      B5c density toggle UI    a6ab6e9 (#25)
      B6  Group E admin tests  d40e099 (#26)
      B7  closing runbooks     febadf0 (#27)
    Milestone → main merged 2026-05-07 as `7a87f28` (PR #28).
    Migration `0021_feature_flags.sql` applied to remote D1
    same day.
    Plus PR #23 (8de7541) — docs-checkpoint that captured M2
    mid-flight state on main.
    +255 unit tests (216 → 471 across 70 files), 6 gated paths
    (4 from M1 + waiverLookup.js + admin/bookings.js), six new
    shared admin primitives ready for M3+ reuse, feature-flag
    end-to-end (lib + admin route + density toggle), Group E
    audit characterization tests landed.
    OPERATOR-APPLIES-REMOTE QUEUED post-milestone-merge:
      `CLOUDFLARE_API_TOKEN=$TOKEN npx wrangler d1 migrations
       apply air-action-sports-db --remote`
    to apply 0021_feature_flags.sql. Until then, featureFlags.js
    returns false/[] gracefully on missing tables; density toggle
    UI hidden by `flag.exists` gate. Detailed batch-by-batch
    state in CLAUDE.md "Milestone 2" section — read that first
    when resuming any related work. Closing runbooks at
    docs/runbooks/m2-{rollback,deploy,baseline-coverage}.{md,txt}.
  - **Milestone 3 — Customers Schema + Persona-Tailored AdminDashboard
    (IN FLIGHT 2026-05-07; branch `milestone/3-customers`):**
    Largest schema migration in the engagement. 13 batches; 8 of 13
    merged on milestone branch:
      B0 hygiene + dogfood     3afbb4c (#30) — closes pain-point #8
                                                (lint blocking in CI)
      B1 local D1 setup        aee3791 (#31) — scripts/seed-staging.sql
                                                + setup/teardown shells
      B2 customerEmail.js      0cfd436 (#32) — dual-target normalization
                                                (decision register #32);
                                                +62 tests
      B3 migration A           0e06b85 (#33) — 0022 customers schema
                                                additive. **Migration
                                                applied to remote D1
                                                2026-05-07 ✓**
      B4 backfill script       a3bfcc5 (#34) — Node CLI + 31 unit tests
                                                + operator-runnable
                                                local-D1 integration test.
                                                **Backfill ran on remote
                                                2026-05-07 ✓** (2 customers
                                                created from 2 bookings +
                                                4 attendees).
      B5 dual-write code       a4870f6 (#36) — worker/lib/customers.js
                                                (findOrCreate + recompute);
                                                wired into webhook +
                                                admin/bookings.js (manual
                                                + refund); customerId()
                                                in worker/lib/ids.js;
                                                +11 tests; gate map
                                                updated.
      B6 NOT NULL + cleanup    4c2e87f (#38) — 0023_customers_not_null.sql
                                                (column-rename approach;
                                                table-rebuild rejected
                                                by D1's FK enforcement);
                                                drop null fallback in
                                                customers.js; admin manual
                                                booking 400 on malformed
                                                email; backfill SQL drops
                                                BEGIN/COMMIT (D1 forbids
                                                them) + JSON-parse fix;
                                                +2 tests, -1 obsolete.
                                                **Migration applied to
                                                remote D1 2026-05-07 ✓**
                                                (skipped 7-day window
                                                per user direction —
                                                tiny dataset, 0 malformed
                                                rows, low risk).
      B7 Group F auth tests    pending      — 11 audit-prescribed tests
                                                (F54-F64) + 2 extras for
                                                vendorToken defensive
                                                cases. Purely additive.
                                                Promotes auth.js,
                                                password.js, vendorToken.js
                                                from `uncovered` to
                                                `gates` in test gate map.
    Pending: B8 customers UI; B9 persona AdminDashboard; B10 system tag
    cron; B11 GDPR delete; B12 closing runbooks.
    Cumulative on milestone branch (after B7): **589 unit tests across
    78 files** (471 M2 baseline + 118 new across B0-B7).
    Detailed batch-by-batch state in CLAUDE.md "Milestone 3" section —
    read that first when resuming M3 work. docs/decisions.md captures
    the resolved audit open questions (D01 Phase 2 goal A+B+C+incremental;
    D02 §08 §1 closed; D03 audit pain-point #8 closed in M3 B0).
  - Tools: tools/cover-banner-builder.html (1200×630 design tool).
  - Docs: docs/staff-job-descriptions.md (22 role descriptions across
    4 tiers), docs/audit/* (Phase 1 audit, see above), docs/runbooks/*
    (M1 + M2 closing runbooks; M3 pre-flight coverage in
    m3-pre-flight-coverage.txt; M3 dogfood verification in
    docs/m3-pre-flight-verification.md), docs/decisions.md
    (D01-D03 resolved).

Cloudflare Workers Builds deploy command (in dashboard): `npm run build &&
npx wrangler deploy`. Do NOT change to plain `npx wrangler deploy` (see
§13 gotcha).

Most recent deploy as of 2026-05-06:
  triggered by `c4d67a6` (M1 milestone merge to main; CI green via
  PR #14). Earlier: ead41292-a8e5-4d9b-85df-9b05382f2803 (post-audit
  + hygiene merge).

Post-M1 operator one-time setup (after this merge to main):
  - `npx playwright install chromium` (downloads ~150 MB Chrome
    binary; not part of `npm install`). Then `npm run test:e2e` for
    a smoke pass against production.

Pre-launch operational items still to be done by owner (NOT code):
  - **DMARC TXT record + Resend DKIM CNAMEs** in Cloudflare DNS —
    booking confirmation emails will land in spam without these. HIGH
    priority. Do BEFORE Stripe live cutover. Exact records in §11.
  - **Always Use HTTPS toggle** in Cloudflare SSL/TLS → Edge Certs
    (currently OFF — HTTP returns 200 not 301).
  - **Apply migration 0020_drop_admin_sessions.sql** to remote D1:
    `CLOUDFLARE_API_TOKEN=$TOKEN npx wrangler d1 migrations apply
    air-action-sports-db --remote`. Drops the dead admin_sessions
    table. Skipping is harmless but leaves the table around.
  - **Stripe sandbox → live cutover** + $1 real-money end-to-end test.
    The Stripe-Version header pin stays the same on cutover.
  - **Per-surface cover image uploads for Operation Nightfall** via
    /admin/events → Edit → Event Images section. Recommended sizes:
      Card hero      1200×600  (2:1)
      Event hero     1920×600  (3.2:1)
      Booking banner 1920×500  (4:1)
      Social / OG    1200×630  (1.91:1)
  - **Invite a second admin** via /admin/users (manager role).
  - **Comp-ticket dry run** end-to-end (book → confirm → waiver →
    check-in).

Phase 2 — admin overhaul — is the next coding phase. Phase 1 audit's
top open question (docs/audit/10-open-questions.md #13) is what the
goal of that overhaul actually is (dashboard-first redesign? IA
reorganization? persona-tailored landing screens? incremental
polish?). Do not start Phase 2 until that's answered. The audit's
docs/audit/08-pain-points.md Section 1 is also an empty operator
placeholder that needs filling.

Stripe is still in sandbox mode (BLOCKING for first real sale).
Operation Nightfall (first live event) was 2026-05-09. Today: <update>.

After you've read the docs, give me:
  1. A one-paragraph status summary of where things actually stand
     (verify against `curl https://airactionsport.com/api/health` and
     `/api/events`, plus run `npm test` locally — should be **589
     passing across 78 files on milestone/3-customers** [the
     milestone is in-flight; checkout that branch to resume M3 work],
     or **also 589 across 78 files on main** post-B7 merge.
  2. A ranked top-3 of what I should work on next, with rough effort
     estimates and why-now. Use §11's pre-launch checklist + deferred
     list as the primary candidate pool, plus the audit's open
     questions and pain-point lists. For M3 work: B5/B6/B7 all
     shipped. Migrations 0022 + 0023 applied to remote D1; backfill
     run; auth characterization tests landed. Next batch is **B8
     customers UI** (list + detail + merge + `customers_entity`
     flag, reuses M2 `<FilterBar>` + `useFeatureFlag`). See
     CLAUDE.md "Milestone 3" for the full chain B8-B12. Lint config
     gap is **closed** in B0.
  3. Any drift between HANDOFF.md / CLAUDE.md and the actual live
     state (stale counts, new feedback tickets, undeployed code,
     unapplied migrations, vitest count not 564, coverage diff vs
     docs/runbooks/m2-baseline-coverage.txt or m3-pre-flight-coverage.txt).
  4. Open feedback queue (pull via /api/admin/feedback or D1).
     Summarize anything in `new` or `in-progress` status in 1–2
     sentences each.

Most likely next pickups (roughly priority order):

  Pre-launch operational (blocking go-live):
  - DMARC + Resend DKIM/SPF DNS records — exact records in §11.
  - Cloudflare Always Use HTTPS toggle.
  - Apply migration 0020 to remote D1 (one wrangler command).
  - Stripe sandbox → live cutover + $1 e2e test (~30 min).
  - Seed Operation Nightfall content (cover images, custom questions,
    email-template review).
  - Invite a second admin.
  - Comp-ticket dry run.

  **M3 IS IN FLIGHT — RESUME HERE FIRST IF CONTINUING M3:**
  Branch: `milestone/3-customers`. 8 of 13 batches merged
  (B0 hygiene 3afbb4c, B1 local-D1 aee3791, B2 customerEmail 0cfd436,
  B3 schema 0e06b85 + migration 0022 applied to remote ✓,
  B4 backfill a3bfcc5 + ran on remote ✓, B5 dual-write a4870f6,
  B6 NOT NULL 4c2e87f + migration 0023 applied to remote ✓,
  B7 Group F auth tests pending merge).

  Resume recipe:
    git checkout milestone/3-customers
    git pull origin milestone/3-customers
    npm install
    npm test         # confirm 589/589 across 78 files

  Then read CLAUDE.md "Milestone 3" section for batch-by-batch
  state. Post next batch's plan first (plan-mode-first per batch
  — same convention as M1/M2). Sub-branches use flat
  `m3-batch-N-slug` naming (NOT `milestone/3-customers/batch-N`
  — git ref-collision workaround per M1/M2 precedent).

  Pending batches in order:
    B5 dual-write code paths — worker/lib/customers.js +
       findOrCreateCustomerForBooking wired into webhooks.js +
       admin/bookings.js. ~4 files. Critical: NO edits to
       worker/routes/bookings.js (M6 territory) or worker/lib/stripe.js.
    B6 migration C — bookings.customer_id + attendees.customer_id
       NOT NULL via 12-step rebuild. Pre-condition: 7-day dual-write
       verification window post-B5 deploy.
    B7 Group F auth tests (F54-F64) — independent of the chain.
       11 tests across worker/lib/auth.js + session.js + password.js.
    B8 customers UI — list + detail + merge workflow + 0024 flag
       (state off). Reuses M2 <FilterBar> + useFeatureFlag.
    B9 persona AdminDashboard — new shell + widgets + 0025 flag.
       Old dashboard preserved as AdminDashboardLegacy.
    B10 system tag cron — nightly 03:00 UTC tag refresh.
    B11 GDPR deletion workflow — soft-archive + redaction pattern.
    B12 closing runbooks + final docs update.

  After B5 lands on main:
    OPERATOR runs: node scripts/backfill-customers.js --remote
    The backfill creates customer records, links bookings/attendees,
    emits customer.created audit rows. Idempotent. Spot-check 5-10
    customers post-run; verify total count matches local prediction
    (~38 customers from current 50 fixture bookings, scaled to actual
    production booking count).

    Then 7-day dual-write verification window (operator monitors
    audit log for customer.created errors, checks for orphan bookings
    without customer_id). After window passes: B6 NOT NULL migration.

  Post-M3 test coverage (deferred — Groups G + H still uncovered):
  - Group G — worker-level (G65-G70): worker/index.js serveUpload,
    rewriteEventOg. Lands in M4 batch 1.
  - Group H — cron (H71-H76): worker/index.js scheduled handler.
    Lands in M5.
    (Group F lands in M3 batch 7; Group E landed in M2.)

  Phase 2 — admin overhaul (M3 ↔ M8):
  - Audit open question #13 RESOLVED as A+B+C+incremental,
    sequenced across M2-M8 (see docs/decisions.md D01).
  - M3: customers entity + persona dashboard. M4: IA reorganization.
    M5: staff infrastructure. M6: Stripe setup_future_usage.
    M7: reporting (funnel, LTV, segments). M8: closing.

  ROE follow-up (owner-decision gaps — needs owner input before
  coding):
  - Surrender / "bang-bang" rules — used at AAS or not?
  - Friendly fire — counts as a hit, or no-effect?
  - Respawn / medic mechanics — default or per-event?
  - Weapon-hit / pistol switch — body hit, or switch to pistol?
  - Sidearm requirement for DMR / Sniper / LMG classes.
  - Photography during games — allowed / restricted / permission?

  Deferred / content-blocked:
  - City/region per Location site (Eagle Mountain, UT style) — waiting
    on owner to supply regions for the three sites.

  Triage anything new in the feedback queue before starting the above.
  Use the /feedback slash command or .claude/commands/feedback.md.

Don't start coding until I pick one. CLAUDE.md's stop-and-ask
conditions apply: confirm before any change to the do-not-touch list
(payments, waivers, auth, customer-email, cron, audit-log emitter,
shared public/admin assets). For test-gated paths, run the listed
test paths from scripts/test-gate-mapping.json before AND after the
edit. If a task involves destructive ops (secret rotation, Stripe
mode change, DB writes, R2 deletions), confirm the plan with me
first.
```

End of handoff.

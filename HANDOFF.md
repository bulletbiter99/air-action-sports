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
│   │                          Booking, BookingSuccess, Waiver, Ticket, etc.)
│   ├── admin/               ← admin pages (18 screens — see §9)
│   ├── components/          ← shared UI (Navbar, Footer, SEO, etc.)
│   ├── hooks/               ← useEvents (D1-backed), useCountdown, useFormValidation
│   └── styles/
├── worker/                  ← Cloudflare Worker backend
│   ├── index.js             ← entry; mounts /api, serves /uploads/*,
│   │                          HTML-rewrites /events/:slug, scheduled() cron
│   ├── lib/                 ← pricing, stripe, email, session, auth,
│   │                          password, ids, formatters, templates, emailSender
│   └── routes/
│       ├── events.js        ← public events (list + detail, id-or-slug)
│       ├── bookings.js      ← public booking quote/checkout + lookup
│       ├── waivers.js       ← per-attendee waiver GET/POST
│       ├── webhooks.js      ← Stripe webhook receiver
│       ├── taxesFees.js     ← public: active taxes/fees for checkout
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
│           └── uploads.js       ← multipart image upload → R2
├── migrations/              ← D1 migrations (applied in order)
│   ├── 0001_initial.sql
│   ├── 0002_expanded_schema.sql
│   ├── 0003_pending_attendees.sql
│   ├── 0004_taxes_fees.sql
│   ├── 0005_password_resets.sql
│   ├── 0006_reminders.sql
│   ├── 0007_reminder_1hr.sql
│   ├── 0008_team_invites.sql
│   └── 0009_custom_questions.sql
├── scripts/                 ← one-off SQL scripts, not tracked by migration runner
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
| `events` | Airsoft events (custom questions stored in `custom_questions_json`) |
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
| GET | `/api/waivers/:qrToken` | Load attendee info for waiver form (also used by ticket page) |
| POST | `/api/waivers/:qrToken` | Submit signed waiver (sig must match ticket name) |

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
| POST | `/api/admin/bookings/manual` | manager+ (comp or cash) |
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

## 9. Frontend routes

**Public**
- `/` — home
- `/events`, `/events/:slug` — D1-backed list + detail (hero uses `coverImageUrl` when set)
- `/locations`, `/gallery`, `/pricing`, `/faq`, `/contact`, `/about`, `/new-players`, `/privacy`
- `/booking` — 3-step booking flow (includes per-attendee custom questions)
- `/booking/success?token=...` — post-payment confirmation (per-attendee waiver + ticket PDF links)
- `/booking/cancelled` — user aborted Stripe checkout
- `/booking/ticket?token=<qrToken>` — printable PDF ticket (auto `window.print()`)
- `/waiver?token=<qrToken>` — per-attendee waiver form

**Admin** (all require login cookie)
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

## 11. What's left before go-live

All roadmap work is shipped. The remaining items are **operational**, not code:

1. **Flip Stripe sandbox → live.** Generate live keys in Stripe dashboard, rotate `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` via `wrangler secret put`, update the webhook target URL in Stripe to point at `/api/webhooks/stripe` in **live** mode, do a $1 real-money end-to-end test (buy → paid → email received → waiver link works).
2. **Cut over from Peek.** Remove the Peek widget `<script>` from `index.html`. Home / Events / Pricing "Book Now" buttons already point at the internal `/booking` page, but double-check any remaining external booking links.
3. **Seed content for Operation Nightfall.** Upload a cover image via `/admin/events` → Edit → Cover image picker. Decide any custom questions (team name? rental size? experience level?). Review + customize email copy in `/admin/settings/email-templates`.
4. **Invite a second admin.** Don't be a single point of failure on event day. Use `/admin/users` → Invite User → manager role.
5. **Dry run.** Create a test event a few days out, book a comp ticket through `/admin/new-booking`, and walk through: confirmation email → waiver → check-in via scanner → rental assignment → return. This exercises the full operational chain.

**Longer-term polish** (not blocking):
- Branded event listing redesign — `/events` still uses the original static template; could get richer per-event visuals now that cover images exist.
- Per-event SEO/OG image upload flow (right now `cover_image_url` doubles as both; fine for now).
- Reminder-cron monitoring (if a sweep fails silently, you only find out when a customer complains).

## 12. Current live data

- **1 event**: `operation-nightfall` — Operation Nightfall, 2026-05-09, Ghost Town, $80 base (350 slots)
- **1 ticket type**: `tt_nightfall_standard` — Standard Ticket, $80
- **3 add-ons**: Sword Rifle Package ($35 rental), SRS Sniper Package ($25 rental), 20g BBs 10k ($30 consumable)
- **7 email templates** seeded (booking_confirmation, admin_notify, waiver_request, password_reset, event_reminder_24h, event_reminder_1hr, user_invite)
- **3 taxes/fees** seeded (City Tax, State Tax, Processing Fees — configure via `/admin/settings/taxes-fees`)
- **Admin owner**: Paul Keddington (bulletbiter99@gmail.com)
- **Stripe**: **still sandbox mode** — flip before first real sale
- **Resend**: `airactionsport.com` verified, sending from `noreply@airactionsport.com`
- **R2**: `air-action-sports-uploads` bucket empty until first cover image uploaded

## 13. Known issues / gotchas

- **`run_worker_first = true`** is critical in wrangler.toml. Without it Cloudflare's SPA fallback intercepts `/api/*` from browsers (not curl — curl works fine), causing 404 HTML responses to fetch calls.
- **Browser cache** on the HTML bundle can be aggressive. If a page looks wrong in normal browser but works in incognito → hard-refresh or clear site data.
- **PBKDF2 caps at 100,000 iterations** in the Workers runtime. Higher throws `NotSupportedError`.
- **Encoding**: Windows shells can double-encode em/en-dashes in seed SQL. Prefer ASCII `-` in SQL files, use admin UI for typographic dashes.
- **Cash bookings** have `stripe_payment_intent = 'cash_<booking_id>'` and no refund button in the admin UI — by design, cash refunds are handled out-of-band.
- **HTML rewriter on `/events/:slug`** runs on every request. Cheap, but don't add heavy D1 queries to that path without caching.
- **QR scanner** (`getUserMedia`) requires HTTPS — fine on production, may fail on plain-HTTP `localhost` depending on the browser. Test the scanner on the deployed URL from a phone, not via `npm run dev`.
- **Legacy event ID format**: the original seeded `operation-nightfall` event uses its slug as its primary key (`id`). New events created via the admin UI get random `ev_*` IDs with a separate `slug` column. Both are resolved by `/api/events/:id` (matches on either).

## 14. Resume checklist when starting fresh

1. Read this file top-to-bottom.
2. Confirm the Cloudflare deploy credentials memory points to `.claude/.env` (token present).
3. Sanity checks:
   - `curl https://air-action-sports.bulletbiter99.workers.dev/api/health` → `{"ok":true,...}`
   - `curl https://air-action-sports.bulletbiter99.workers.dev/api/events` → returns 1 event
4. Confirm admin login works (use `/admin/forgot-password` if needed).
5. Check `wrangler deployments list` to see what's currently live.

---

## Prompt for fresh session

Copy and paste the following into a new Claude Code session:

```
I'm resuming work on the Air Action Sports booking system. Read HANDOFF.md in the
project root first — it has full context on the stack, deployed state, all shipped
phases + polish, every API and frontend route, and the pre-launch operational
checklist in §11.

Current state: all planned phases (1–9) and all 5 polish items are shipped. The
site is deployed at https://air-action-sports.bulletbiter99.workers.dev but Stripe
is still in sandbox mode. Operation Nightfall (first live event) is 2026-05-09.

After you've read it, give me:
  1. A one-paragraph status summary of where things actually stand (verify against
     `curl /api/health` and `curl /api/events` rather than just trusting the doc).
  2. A ranked top-3 of what I should work on next, with rough effort estimates and
     why-now. Use §11's pre-launch checklist as the primary candidate pool but
     flag anything low-hanging and high-value you notice.
  3. Any drift between HANDOFF.md and the actual live state (stale counts, removed
     features, etc.) — better to catch that upfront than halfway through a task.

Most likely next pickups, roughly in order:
  - Stripe sandbox → live cutover + $1 real-money end-to-end test (operational,
    ~30 min once keys are in hand; includes webhook re-targeting)
  - Remove the Peek widget from index.html and verify every public "Book Now" goes
    to internal /booking (quick — should be one grep + a redeploy)
  - Seed Operation Nightfall content: cover image upload, custom questions,
    customize email copy via /admin/settings/email-templates
  - Invite a second admin via /admin/users so you're not a single point of failure
  - Anything else you spot — reminder-cron observability, event listing redesign,
    etc.

Don't start coding until I pick one. If the task involves destructive ops (secret
rotation, Stripe mode change, DB writes), confirm the plan with me first.
```

End of handoff.

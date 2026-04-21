# Agent prompts

Five self-contained prompts. Adapt the **Stack Context** paragraph at the top of each before dispatching. Key variables to fill in:

- `{{PROJECT_ROOT}}` — absolute path
- `{{LIVE_URL}}` — deployed URL
- `{{STACK_SUMMARY}}` — e.g. "Cloudflare Workers + D1 + Stripe + Resend + R2, Hono router"
- `{{CUTOVER_CONTEXT}}` — e.g. "Stripe still in sandbox; real money starts 2026-05-09"

---

## Agent 1 — Secrets + git history + dependencies

```
You are conducting one slice of a pre-launch security audit for the {{STACK_SUMMARY}} app at {{PROJECT_ROOT}}. Deployed at {{LIVE_URL}}. {{CUTOVER_CONTEXT}}.

**Your slice: secrets exposure, git history, dependencies.**

Read HANDOFF.md (or equivalent onboarding doc) first. Other agents cover auth, injection, infra, and business logic in parallel — don't duplicate.

**Checks:**

1. **Secrets in the built frontend bundle.** Grep `dist/` for: `sk_live_`, `sk_test_`, `re_` (Resend prefix), `STRIPE_SECRET`, `RESEND_API_KEY`, `SESSION_SECRET`, `CLOUDFLARE_API`, `pk_live_`, long hex strings, hardcoded `Authorization: Bearer`.

2. **Secrets in source.** Same grep on `src/`, `worker/`, `migrations/`, `scripts/`, `wrangler.toml`, `package.json`. Flag anything that's not a public publishable key.

3. **Git history leaks.** `git log --all -p -- .env '*.env' .claude/ wrangler.toml scripts/`. Check: was `.claude/.env` or any `.env` ever committed? Any old `wrangler.toml` with inlined secrets? Any SQL script seeding plaintext test credentials?

4. **`.gitignore` coverage.** Read `.gitignore`. Must cover: `.env`, `.env.*`, `.claude/`, `.dev.vars`, `.wrangler/`, `node_modules/`, `*.sqlite`, `*.sqlite3`. Report gaps.

5. **Dependency vulnerabilities.** Run `npm audit --production --json` and `npm audit --json`. Summarize High/Critical with: package, version, CVE/GHSA, fix version, whether it ships to the Worker (runtime vs devDep).

6. **Package pinning.** Caret-ranged vs pinned. Flag supply-chain risk.

7. **Cloudflare API token scope.** Note in report that user must verify in Cloudflare dashboard that the token is least-privilege (Workers + D1 + R2 on one account, not Global API Key). Never read the token value.

**Rules:**
- Read-only. No commits, no network beyond `curl -I {{LIVE_URL}}/api/health`.
- Never print actual secret values — "sk_live_*** found in dist/assets/foo.js:123".
- Cite file:line.
- Distinguish confirmed vs theoretical (false-positive pattern matches).

**Output format:**
```
## [Secrets + Deps] Findings

### [CRITICAL/HIGH/MEDIUM/LOW/INFO] <title>
- Location: path:line
- Evidence: <grep output or command result>
- Impact: <what attacker can do>
- Fix: <specific remediation>
- Effort: S/M/L

## Clean checks (what was audited and came up clean)
## Notes / out-of-scope
```

Under 800 words. One paragraph per finding.
```

---

## Agent 2 — Authentication + authorization

```
You are conducting one slice of a pre-launch security audit for the {{STACK_SUMMARY}} app at {{PROJECT_ROOT}}. Deployed at {{LIVE_URL}}. {{CUTOVER_CONTEXT}}.

**Your slice: authentication, authorization, session/token flows.**

Read HANDOFF.md first. Other agents cover secrets, injection, infra, business logic — don't duplicate.

**Checks:**

1. **Admin route authorization matrix.** For every route in `worker/routes/admin/*.js`, produce a table: Path | Method | Required role | Actually enforced? | Notes. Flag: unauthenticated endpoints that should be gated; IDOR (can staff fetch manager+ data?); routes reading `user_id`/`role` from body (must come from session only).

2. **Session cookie security.** Audit the session library:
   - HMAC algorithm + key source
   - Constant-time compare on verify (flag `===` / `.indexOf` on secrets)
   - Cookie flags: `HttpOnly`, `Secure`, `SameSite`, `Path`, `Max-Age`
   - Does logout invalidate server-side or just clear cookie?

3. **CSRF protection.** Cookie auth + POST mutations = CSRF risk unless SameSite=Strict or explicit token. Trace 3 state-changing admin endpoints; report mechanism.

4. **Password flow:**
   - PBKDF2 iterations + salt source + per-user uniqueness
   - Min length/complexity enforcement at setup, reset, accept-invite
   - Constant-time compare on hash verify

5. **Password reset:**
   - Token entropy (length, random source)
   - TTL enforcement
   - Single-use enforcement (atomically consumed with password change)
   - Email enumeration on /forgot-password — always 200?

6. **Invite flow:**
   - TTL + single-use
   - Email binding (Alice cannot accept Bob's invite)
   - Auto-login on accept — safe cookie transition?

7. **Owner bootstrap race.** Setup endpoint is public when no users exist. Two concurrent POSTs — does one become an unauthorized owner?

8. **Public bearer tokens** (booking lookup token, waiver qrToken):
   - Entropy + storage format (raw vs hashed)
   - Timing-safe lookup
   - Rate limit (cross-reference infra agent)

9. **Self-lockout guardrails** on user mutation endpoints (can't demote self, can't deactivate last owner, etc.). Verify transactional.

**Rules:** read-only. Cite file:line. Don't actually attempt auth bypass against live. Distinguish confirmed exploitable from theoretical.

**Output format:**
```
## [Auth + AuthZ] Findings

### [SEV] <title>
- Location: path:line
- Evidence: <code excerpt>
- Impact / Fix / Effort

## Authorization matrix (full table)

## Clean checks

## Notes
```

Under 1000 words.
```

---

## Agent 3 — Injection + input validation

```
You are conducting one slice of a pre-launch security audit for the {{STACK_SUMMARY}} app at {{PROJECT_ROOT}}. Deployed at {{LIVE_URL}}. {{CUTOVER_CONTEXT}}.

**Your slice: injection (SQL, XSS, HTML email, header/log), input validation, file upload.**

Read HANDOFF.md first. Other agents cover secrets, auth, infra, business logic — don't duplicate.

**Checks:**

1. **SQL injection.** Every D1 query via `.prepare().bind()`. Grep for template-literal or string-concat SQL. Watch dynamic ORDER BY / column names from user input (bind doesn't cover identifiers). Read every route file, produce a query inventory table: File:line | Query sketch | Parameterized? | Risky input?

2. **XSS in email templates.** The `{{var}}` substitution — is it HTML-escaped in the HTML body path? Text path can be raw. Attacker-controlled sources: customer name, email, phone, event title, custom answers, waiver signature. A booker with `fullName = "<script>..."` or `<img src=x onerror=...>` that lands unescaped in admin-notify is a phishing/exfiltration primitive.

3. **XSS in admin UI.** Grep `src/` for `dangerouslySetInnerHTML`, `innerHTML =`, and rendering of user strings without escaping. React escapes `{expr}` by default — flag HTML-injecting patterns.

4. **XSS in HTMLRewriter.** Any `HTMLRewriter` usage on `/events/:slug` or similar. `setInnerContent(x)` defaults to HTML-interpreted — must pass `{ html: false }` for untrusted text. `setAttribute` is auto-encoded (safe).

5. **File upload endpoint:**
   - MIME + magic-byte check (not extension alone)
   - Size cap server-side
   - Allowed types
   - Filename / R2 key sanitization (no path traversal)
   - Served Content-Type forced to safe value or trusted from upload?
   - SVG/polyglot risk

6. **R2 serving endpoint.** Does it stream arbitrary keys or scope to a prefix? Content-Type from trusted source?

7. **Log/header injection.** User-controlled content with newlines reaching logs or response headers.

8. **JSON body size caps.** `await c.req.json()` without length limit → CPU-exhaustion DoS. Field-level caps on password, signature, notes, attendee count.

9. **Email header injection.** `to`/`from`/`subject`/`reply-to` — CRLF in user input adding extra headers?

**Rules:** read-only. Cite file:line. No test emails, no test uploads against live.

**Output format:**
```
## [Injection + Input Validation] Findings

### [SEV] <title>
- Location / Evidence / Impact / Fix / Effort

## SQL query inventory (table)

## Clean checks

## Notes
```

Under 1000 words.
```

---

## Agent 4 — Infrastructure + CORS + headers + webhooks

```
You are conducting one slice of a pre-launch security audit for the {{STACK_SUMMARY}} app at {{PROJECT_ROOT}}. Deployed at {{LIVE_URL}}. {{CUTOVER_CONTEXT}}.

**Your slice: infra config, CORS, security headers, Stripe webhook verification, rate limiting, R2 access.**

Read HANDOFF.md first. Other agents cover secrets, auth, injection, business logic — don't duplicate.

**Checks:**

1. **CORS policy.** Hono CORS middleware config. Verify:
   - `origin` explicit (not `*`) for cookie-bearing endpoints
   - `credentials: true` only with explicit origin
   - Webhook endpoint rejects CORS entirely
   - Preflight sane
   Test live: `curl -H "Origin: https://evil.example.com" -I {{LIVE_URL}}/api/admin/bookings` and report headers.

2. **Security response headers.** `curl -I {{LIVE_URL}}/` and `curl -I {{LIVE_URL}}/admin/login`. Check presence of: HSTS, CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`. Note: `*.workers.dev` doesn't auto-inject HSTS/CSP — must be set in code.

3. **Stripe webhook signature verification:**
   - Library verifier (not hand-rolled HMAC)
   - `STRIPE_WEBHOOK_SECRET` as signing key
   - 400 on failure BEFORE any DB work
   - Replay protection via `event.id` dedup or state-transition idempotency
   - Timestamp tolerance reasonable
   - **Multiple `v1=` handling** (Stripe sends both during secret rotation)

4. **Rate limiting.** Workers has none by default. Check for Cloudflare Rate Limiting binding, KV-backed limiter, or Hono middleware. Priority endpoints needing limits: login, forgot-password, verify-*, checkout, public token lookups.

5. **wrangler.toml audit:**
   - `[vars]` has no secrets
   - `compatibility_date` fresh (<12 months)
   - Expected bindings (D1, R2, KV, Cron)
   - `run_worker_first` set if route precedence matters
   - No unexpected routes/zones

6. **R2 bucket public access.** User confirms in dashboard — your job: verify the Worker's serving code doesn't allow arbitrary-key access without prefix enforcement.

7. **Global error handler.** Returns generic 500s or leaks stack traces?

8. **Cron HTTP exposure.** Any HTTP endpoint that can trigger scheduled work externally?

**Rules:** read-only. Live curls for headers/CORS OK; no auth attempts, no booking creation, no webhook POSTs. Distinguish "Cloudflare adds this" vs "app sets this" for headers.

**Output format:**
```
## [Infra + Headers + CORS + Webhooks] Findings

### [SEV] <title>
- Location / Evidence / Impact / Fix / Effort

## Headers seen on live site (table)

## CORS response on admin endpoint from evil origin (curl output)

## Clean checks

## Notes
```

Under 1000 words.
```

---

## Agent 5 — Business logic + IDOR

```
You are conducting one slice of a pre-launch security audit for the {{STACK_SUMMARY}} app at {{PROJECT_ROOT}}. Deployed at {{LIVE_URL}}. {{CUTOVER_CONTEXT}}.

**Your slice: business logic flaws, IDOR, token enumeration, info disclosure, audit log integrity, cron abuse.**

Read HANDOFF.md first. Other agents cover secrets, auth mechanics, injection, infra. Focus on LOGIC correctness — where the code does what it says but the *semantics* are exploitable.

**Checks:**

1. **Public bearer token entropy + storage** (booking lookup, waiver qr). Confirm random source + length + stored-as-hash vs raw. Design concern if expanding threat model.

2. **Signature-must-match-name bypass.** If your app has such a check: can an admin rename the signer AFTER signing, breaking the tie? Is the check server-side? Normalization gotchas (whitespace, diacritics, RTL override, zero-width).

3. **IDOR on admin endpoints.** For 5 representative admin GETs + mutations: can a lower-privilege role (staff vs manager) fetch/modify data scoped to a different domain (different event, different tenant)?

4. **Refund authorization:**
   - Role enforced server-side
   - Refund amount capped to original
   - Idempotency: double-click doesn't refund twice — **Stripe `Idempotency-Key` header required**
   - Cash/non-Stripe bookings handled or leak Stripe error?

5. **Manual booking creation:**
   - Capacity check enforced? (Often skipped — admin convenience vs correctness.)
   - Price bounds (negative totals?)
   - Audit trail

6. **Audit log integrity:**
   - Write inside transaction of the audited action
   - Rollback on failure doesn't leave misleading entry
   - Append-only (no UPDATE/DELETE endpoint)
   - Actor from session, not request body

7. **Error message information disclosure:**
   - 404 vs 403 distinguishability
   - "wrong password" vs "no such email"
   - Stack traces / internal IDs / env var names in error responses

8. **Cron amplification:**
   - User-controlled email addresses causing bomb attacks on third parties
   - Send-then-persist race causing duplicate emails
   - Bounded work under CPU budget (~30s for Workers)

9. **Owner bootstrap race** (business impact view; mechanics covered by auth agent).

10. **HTMLRewriter D1 amplification.** Per-request DB lookup with no cache → bill amplification via unknown slug flood.

11. **Payment checkout abuse:**
    - Bot reservation DoS via pending bookings
    - Server-side price computation (never trust client)
    - Promo code scoping

12. **Email enumeration timing.** /forgot-password uniform response time or observable delta?

**Rules:** read-only. No DB writes, no login attempts, no bookings. Distinguish "exploitable today against live" vs "design concern."

**Output format:**
```
## [Business Logic + IDOR] Findings

### [SEV] <title>
- Location / Evidence / Impact / Fix / Effort

## Clean checks

## Notes
```

Under 1000 words.
```

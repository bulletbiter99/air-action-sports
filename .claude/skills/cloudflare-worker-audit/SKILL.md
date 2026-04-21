---
name: cloudflare-worker-audit
description: Run a comprehensive security audit of a Cloudflare Workers + D1 + Stripe + Resend + R2 stack. Orchestrates 5 parallel specialist agents covering secrets/dependencies, authentication/authorization, injection/input-validation, infrastructure (CORS/headers/rate-limiting/webhooks), and business-logic/IDOR. Produces a severity-ranked SECURITY_AUDIT.md with go/no-go recommendation. Trigger proactively whenever the user asks for a security audit, vulnerability check, pre-launch review, security hardening pass, or any phrase like "is this safe to go live" on a Cloudflare Workers project — even if they don't explicitly use the word "audit." Also trigger for quarterly re-audits and post-incident reviews.
---

# Cloudflare Worker Security Audit

## When to use

Invoke this skill whenever the user asks for any variant of a security review on a Cloudflare Workers app. Typical phrases: "security audit", "vulnerability check", "pre-launch review", "is this safe to ship", "harden the worker", "check for security issues", "audit the code". Applies especially when the stack is Workers + D1 + Stripe + Resend + R2 + Hono, but the framework generalizes.

## What it does

Orchestrates **5 parallel subagents** (general-purpose), each covering one slice. They run read-only, report structured findings with `file:line` citations, and you synthesize the results into a single `SECURITY_AUDIT.md` at the repo root plus a one-screen chat summary with severity breakdown and a clear go/no-go recommendation.

The audit is meant to be exploitability-focused: a Critical SQL injection outweighs a Medium missing header. Rank by what an attacker can actually do today, weighted by proximity to money.

## Workflow

### Step 1 — Read project context first
Read `HANDOFF.md` (or equivalent onboarding doc) and `wrangler.toml` to ground yourself in the stack before dispatching agents. If neither exists, spend 2 minutes running `git log --oneline | head -30`, `ls worker/ src/ migrations/`, and `cat wrangler.toml` to build your own.

### Step 2 — Dispatch 5 agents in parallel
Use the `Agent` tool with `subagent_type: general-purpose` and `run_in_background: true` for all 5 at once, in a single message. Each agent gets a self-contained prompt — they don't see this conversation. Prompts are in `references/agent-prompts.md`; adapt the "stack context" paragraph to the actual project.

The 5 slices (non-overlapping by design):
1. **Secrets + git history + dependencies** — `dist/` bundle scan, source secrets, `git log --all -p -- .env .claude/ wrangler.toml`, `.gitignore` coverage, `npm audit`, version pinning, Cloudflare token scope flag.
2. **Authentication + authorization** — full admin-route matrix (path/method/required-role/actually-enforced), session cookie flags, HMAC verification, password/reset/invite flows, owner bootstrap race, token entropy.
3. **Injection + input validation** — SQL parameterization sweep across every D1 query, XSS in email templates (`{{var}}` escaping!), XSS in React + HTMLRewriter, file upload magic-byte checks, JSON body size caps, header/log injection.
4. **Infrastructure + CORS + headers + webhooks** — CORS policy per route (watch wildcard + credentials combo), security response headers (HSTS, CSP, nosniff, XFO, Referrer-Policy), Stripe webhook signature verification (library not hand-rolled; multiple `v1=` entries), rate limiting (Workers has none by default), wrangler.toml review, R2 public access.
5. **Business logic + IDOR** — waiver signature match, refund idempotency (Stripe `Idempotency-Key`), manual-booking capacity bypass, pending-booking seat DoS, cron amplification, audit log integrity, error-message info disclosure, token enumeration.

### Step 3 — Synthesize
As each agent completes (you get notifications), keep the report running. When all 5 are done:

1. **Deduplicate findings** that crossed slices (e.g., "owner bootstrap race" may come from both auth and business-logic agents — merge).
2. **Normalize severity.** Adjust when agents disagree — e.g., CORS wildcard is CRITICAL when combined with webhook exposure, MEDIUM if SameSite + no-credentials already mitigates most browser attacks.
3. **Write `SECURITY_AUDIT.md`** at repo root using the template in `assets/audit-template.md`.
4. **Produce a chat summary** — severity counts, top finding table (first 10 by severity), go/no-go recommendation, biggest surprises, clean-check highlights.

### Step 4 — Pre-launch fix-ordering checklist
End `SECURITY_AUDIT.md` with three buckets:
- **Block launch until done** — Criticals + exploitable Highs
- **Strongly recommended before real customers** — remaining Highs + security-header Mediums
- **Post-launch hardening** — Mediums and Lows

## Why it's structured this way

Five parallel agents instead of one sequential pass because the check categories don't interact — an auth specialist isn't going to spot a supply-chain issue, and a secrets-sweep agent doesn't need to understand business logic. Parallelizing cuts wall-clock ~5×.

Read-only because destructive testing (actual exploitation, live login attempts, test charges) adds risk without proportional value — we have the source code; we can reason about exploitability from it.

Severity-ranked output because the user's question is always "what do I fix first?", not "give me a taxonomy." The report needs to answer that question in the first 30 seconds.

## Non-goals

- **Don't fix anything in this pass.** Even obvious fixes. Mixing audit and remediation destroys the evidence trail; do the audit, let the user pick priorities, then do a separate remediation pass.
- **Don't attempt live exploitation.** No real login attempts, no test bookings, no uploading payloads. Safe reads only (`curl -I`, `curl /api/health`).
- **Don't try to be exhaustive.** A 100-finding report buries the 5 that actually matter.

## Output format

See `assets/audit-template.md` for the full skeleton. Key structural requirements:

- Executive summary with severity counts + go/no-go
- Findings grouped by severity (CRITICAL → HIGH → MEDIUM → LOW → INFO)
- Each finding has: id, title, location (file:line as clickable markdown link), evidence, impact, fix, effort (XS/S/M/L)
- "Clean checks" section — audited and fine — so future re-audits know what was covered
- "Out-of-scope / deferred" — user-verification items (Cloudflare dashboard, npm audit if sandboxed, etc.)
- Pre-launch fix-ordering checklist at the end

## Stack adaptation

The workflow works for any Cloudflare Workers app, but the agent prompts in `references/agent-prompts.md` assume the Hono + D1 + Stripe + Resend + R2 stack. If the project uses different components:

- **No Stripe** — drop webhook signature, refund idempotency, and live-key cutover checks from Agent 4.
- **Supabase instead of D1** — RLS policies replace the authorization matrix; add a "RLS enabled on every table with policies" check to Agent 2.
- **KV/DO instead of D1** — adjust injection check (no SQL) but keep token entropy, rate limiting, and auth checks.
- **No R2** — drop upload audit from Agent 3.

## References

- `references/agent-prompts.md` — the 5 agent prompts (adapt stack-context paragraph per project)
- `assets/audit-template.md` — skeleton for `SECURITY_AUDIT.md`

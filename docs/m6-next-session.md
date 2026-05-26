# M6 next-session prompt

**Status:** M6 is **IN PROGRESS** — 5 batches landed today (B3, B4, B5, B6, B10). Remaining (B7, B8, B9, B11) are gated on operator-only live Stripe cutover items. The fresh session should read this file first, then [HANDOFF.md](../HANDOFF.md) top-of-doc + [CLAUDE.md](../CLAUDE.md) Milestone 6 section + [docs/m6-batch-tracker.md](m6-batch-tracker.md) + [docs/m6-operator-cutover-checklist.md](m6-operator-cutover-checklist.md).

---

## Copy-paste prompt for fresh session

```
I'm resuming M6 on Air Action Sports. Read in order:

  1. docs/m6-next-session.md (this file)
  2. HANDOFF.md top-of-doc
  3. CLAUDE.md Milestone 6 section
  4. docs/m6-batch-tracker.md (live status table)
  5. docs/m6-operator-cutover-checklist.md (5 operator-only items
     gating B5/B6/B7+ live verification)

M6 batches done (10 PRs over two sessions):
  - B0:           cutover runbook + spot-check + staff labeling (#188)
  - B0-followup:  spot-check populated, runbook fix (#191)
  - B1:           vendor package templates list (#189)
  - B2:           vendor templates composer + clone (#190)
  - B3:           email_templates.status column + filter (#193)
  - B4:           admin UI status toggle + preview-with-real-data (#194)
  - B5:           Stripe setup_future_usage on /checkout (#195)
  - B6:           charge.dispute.created webhook consumer (#196)
  - B10:          booking_confirmation template charges notice (#197)

Production worker version: 954964c3-56f3-4f08-9c97-47cd54b85c35
main:                      post-PR #197 merge
Tests:                     2251 / 182
Group A + B regression:    138 / 138 preserved
Migrations on remote:      0001-0058 (M6 added 0056, 0057, 0058)
Email templates in prod:   34
Cron sweeps:               8 at 03:00 UTC

WHAT BLOCKS B7+ FROM LIVE VERIFICATION
Five operator-only items in docs/m6-operator-cutover-checklist.md:
  1. wrangler secret put STRIPE_SECRET_KEY (live)
  2. wrangler secret put STRIPE_WEBHOOK_SECRET (live)
  3. Configure live Stripe webhook endpoint + events
     (must include checkout.session.completed AND
     charge.dispute.created — B6 added the dispute listener)
  4. Verify DMARC + SPF + DKIM DNS records
  5. $1 live e2e: book → confirm saved PM on Customer → refund

Until items 1-5 land, B5 + B6 are CODE-LIVE on sandbox keys; the live
behavior (real saved PMs, real dispute events) doesn't engage. B7/B8/B9
can be coded against sandbox in parallel, but their live verification
also waits on the cutover.

ALTERNATIVE TRACKS IF OPERATOR ISN'T READY
  (a) Native Marketing milestone (parallel, planned, not started)
  (b) Post-M5.5 polish backlog Fork A — 6 small items
      (AES decryption EIN, admin POST customers, monthly recurrence,
       /status lead_stale_at clear, recurrence UNIQUE, deep-link parsing)
  (c) HR coordinator role_preset (3 SQL statements)
  (d) Past-games / event archive page phase 1 (~6 files)

Workflow rules in effect for M6:
  - Plan-mode-first per batch. No edits before ack.
  - 8-file operating target, 10-file hard ceiling.
  - Mandatory 5-bullet closing summary between batches.
  - Claude Code never executes `wrangler d1 execute --remote` for
    MUTATIONS except migrations (operator authorized 2026-05-25).
  - Conventional Commits with m6-<area> scope; flat
    m6-batch-N-slug sub-branches.
  - Browser-verify in production after every deploy via
    Claude_in_Chrome (use javascript_tool — admin pages never go
    network-idle for the screenshot helper).
```

---

## Remaining M6 batches

### B7 — Damage charge Option A activation

**Goal:** Wire up off-session charging against a customer's saved PM (from B5). Used by /admin/booking-charges queue + equipment-return flow.

**Touches:**
- `worker/lib/stripe.js` — new `chargeOffSession({ apiKey, customer, paymentMethod, amountCents, idempotencyKey, metadata })` helper (Critical DNT — additive)
- `worker/lib/bookingCharges.js` (already gated) — extend the existing charge-flow with an "Option A: off-session" branch alongside the existing "Option B: email-link" fallback
- `worker/routes/admin/bookingCharges.js` — POST /:id/approve uses Option A by default when the booking has a saved PM, falls back to Option B otherwise
- Tests: extend `tests/unit/admin/bookingCharges/route.test.js` + new lib tests

**Pre-flight:**
- B7 retrieves session.customer + payment_method via Stripe API to charge. Decision: cache stripe_customer_id on bookings table at first off-session attempt (avoids round-trip), OR retrieveSession on-demand. Both work. Discuss in plan-mode.

**Risk:** **High.** Real money movement. Mitigations: Idempotency-Key required on every charge. Option B fallback preserved.

**Live verification:** sandbox $1 booking → admin marks damage → off-session charge succeeds via sandbox. Real verification = first live damage charge after operator cutover.

### B8 — Damage charge admin UI polish

**Goal:** Polish the /admin/booking-charges queue (M5 R16 ships the basic page). Add:
- Indicator showing whether each charge will use Option A (off-session) vs Option B (email-link)
- "Force Option B" toggle for cases where the operator wants email-link even with a saved PM
- Better empty states + filtering

**Touches:** `src/admin/AdminBookingChargeQueue.jsx` + accompanying CSS. No worker changes if B7 surfaces the right fields on the existing API response.

**Risk:** **Low.** Admin-only UI polish.

### B9 — Admin remove-saved-PM action

**Goal:** Admin can detach a saved PM from a Stripe Customer (privacy compliance — customer asks for removal).

**Touches:**
- `worker/lib/stripe.js` — new `detachPaymentMethod({ apiKey, paymentMethod })` helper
- `worker/routes/admin/customers.js` — new POST /:id/detach-payment-method endpoint, gated on `customers.write` cap
- `src/admin/AdminCustomerDetail.jsx` — new "Remove saved payment method" button + confirm modal
- Audit row `customer.payment_method_detached`

**Risk:** **Medium.** Irreversible (Stripe doesn't allow re-attach). Mitigations: hard confirmation modal, audit log.

### B11 — Closing runbooks + M6 close

**Goal:** Ship the closing docs and flip CLAUDE.md M6 section to CLOSED.

**Files (4-5):**
- `docs/runbooks/m6-deploy.md` — capture the actual deploy sequence used in this milestone (per-batch rolling brings-up, operator-applied migrations 0056-0058, the live cutover sequence)
- `docs/runbooks/m6-rollback.md` — decision tree per batch (data rollback for 0056/0057/0058; code rollback via Workers Builds dashboard; live-Stripe-only-half-rollback)
- `docs/runbooks/m6-baseline-coverage.txt` — coverage snapshot post-M6 close (test count + gated paths)
- CLAUDE.md M6 section + HANDOFF.md top-of-doc → M6 CLOSED status

**Risk:** **None.** Pure docs.

---

## Why this session paused at B6/B10

Two reasons:
1. **Context budget** — at ~80% context after 5 batches in one session. Clean cut at a stable boundary (B10 merged, B7 not started) prevents mid-batch context exhaustion.
2. **Operator cutover gate** — B7's live verification (the most valuable batch to bring live) needs the 5 cutover items. Continuing past B6/B10 in this session without operator presence means burning context on sandbox-only verification of B7/B8/B9 that you can't sign off until live.

The natural next-session pattern: operator works through items 1-5 between sessions → fresh session resumes with cutover complete → B7+B8+B9 + B11 in a coordinated push.

## Carry-forward observations (added this session — durable)

1. **`worker/routes/bookings.js` POST /checkout returns `{ stripeUrl, bookingId }`** (not `{ url }`).
2. **`rateLimit` middleware no-ops without `CF-Connecting-IP` header** — tests must set it.
3. **`worker/lib/templates.js` `loadTemplate(db, slug, { includeDrafts })`** — B3's surgical extension. Drafts return null by default.
4. **`unknown-event-type.test.js` is a milestone-only pin** — remove handled events from `NON_COMPLETION_EVENTS` when a new handler lands.
5. **Idempotency pattern for Stripe webhooks: LIKE on `audit_log.meta_json`** — see B6's `handleDisputeCreated`.
6. **Migration UPDATE on existing seed rows works without code redeploy** — pure content changes are zero-code zero-risk.
7. **Admin pages never go network-idle** — Claude_in_Chrome `screenshot`/`read_page`/`get_page_text` time out. Use `javascript_tool` instead.

# M6 — Stripe Sandbox → Live Cutover Runbook

**Status:** drafted in M6 Batch 0. **Execute before Batch 5 merges to main.**

**Context:** The operator previously cut over to live during the M5.5 cycle (proven successful), then moved back to sandbox for development work. Re-cutover is required before Batch 5 modifies `worker/routes/bookings.js` to add `setup_future_usage: 'off_session'` — that change must be validated against live Stripe end-to-end before merging.

This runbook lives in the repo as the durable cutover playbook. Operator-only execution; Claude Code never runs `wrangler secret put` for Stripe keys or any other live-key operation.

---

## Pre-cutover checklist

Run through this BEFORE swapping any keys. Each item must be ✓ to proceed.

- [ ] All Group A (pricing) tests passing — `npx vitest run tests/unit/pricing` returns 79/79
- [ ] All Group B (webhook) tests passing — `npx vitest run tests/unit/webhook` returns 59/59
- [ ] Stripe coverage on `worker/lib/stripe.js` ≥ 85% (M6 start baseline: 93.93%)
- [ ] `worker/lib/stripe.js` has no uncommitted changes
- [ ] `worker/routes/bookings.js` has no uncommitted changes
- [ ] `worker/routes/webhooks.js` has no uncommitted changes
- [ ] DMARC + Resend DKIM/SPF DNS records verified for `airactionsport.com` (so booking confirmation emails don't land in spam during the $1 test)
- [ ] At least one $1-eligible event published on production (with a $1 ticket type, or temporarily price an existing test event ticket to $1)
- [ ] Stripe dashboard access ready: live + sandbox both authenticated in the operator's browser
- [ ] Rollback path verified: `wrangler rollback` understood and ready
- [ ] Cloudflare Workers logs tail open for real-time webhook observation

---

## Cutover sequence

### Step 1 — Capture current live Stripe credentials from the Stripe dashboard

In Stripe dashboard:

1. Toggle to **Live mode** (top-left of Stripe dashboard)
2. **Developers → API keys** → copy the live **Secret key** (starts with `sk_live_`). Store securely; you'll set it as a Worker secret.
3. **Developers → Webhooks** → existing live endpoint (or create one): URL must be `https://airactionsport.com/api/webhooks/stripe`
   - Events to listen for (existing set, no M6 additions yet — `charge.dispute.created` is added in M6 Batch 6):
     - `checkout.session.completed`
     - `payment_intent.succeeded`
     - `payment_intent.payment_failed`
   - Click into the endpoint → **Signing secret** → reveal + copy. Starts with `whsec_`.

### Step 2 — Swap Worker secrets to live

From the project root with `.claude/.env` available:

```bash
# Set the live Stripe secret key (replace <sk_live_...> with the actual value from Stripe dashboard)
source .claude/.env
echo '<sk_live_...>' | CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler secret put STRIPE_SECRET_KEY

# Set the live webhook signing secret (replace <whsec_...> with the actual value)
echo '<whsec_...>' | CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler secret put STRIPE_WEBHOOK_SIGNING_SECRET
```

If the public Stripe **publishable key** is referenced anywhere client-side (it shouldn't be for a Checkout Session flow, but verify), swap it too via `wrangler secret put STRIPE_PUBLISHABLE_KEY`.

### Step 3 — Deploy to take the new secrets

```bash
npm run build && source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler deploy
```

Verify the deploy completed (capture the new Version ID) and `curl https://airactionsport.com/api/health` returns `{"ok":true,...}`.

### Step 4 — $1 end-to-end live test

1. Open `https://airactionsport.com/events/<event-slug>` (whatever event has the $1 ticket type)
2. Go through the public booking flow as a real customer would
3. Use a **real personal payment card** for the $1 charge — NOT a test card. Stripe live mode rejects test cards (`4242 4242 4242 4242`) with a clear error.
4. Complete checkout. Stripe should redirect to the booking-success page.
5. **Watch the webhook fire in Cloudflare Workers logs** — confirm `checkout.session.completed` arrives and the handler processes it without throwing.
6. **Confirm in production D1**:

   ```bash
   CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command="SELECT id, status, total_cents, stripe_payment_intent_id, created_at FROM bookings ORDER BY created_at DESC LIMIT 1"
   ```

   The most recent booking row should have:
   - `status = 'paid'`
   - `total_cents = 100`
   - A non-null `stripe_payment_intent_id` starting with `pi_` (live PI IDs share the prefix with test ones — the difference is in Stripe's data; check the Stripe dashboard Live mode to confirm the PI exists there, not in test mode)

7. **Confirm the booking confirmation email arrived** at the test purchase email address.
8. **Confirm the admin notification email arrived** at `actionairsport@gmail.com` (or whatever `ADMIN_NOTIFY_EMAIL` is set to).

If all 8 sub-steps pass: **live cutover successful.** Proceed with Batch 5 merge.

### Step 5 — Refund the $1 test charge

In Stripe dashboard → Live mode → Payments → find the $1 charge → **Refund** (full refund). Stripe webhooks for refunds aren't wired in the current M5.5-era code (M6 Batch 6 adds `charge.dispute.created` but not refund webhooks); refund the payment manually in Stripe to keep the books clean. The booking row in D1 will still show `status='paid'` until you optionally also run an external refund via the admin UI (M4 B3 external-refund flow).

---

## Rollback paths

### Path A — Immediate rollback (the live test fails)

If the $1 test fails in any of these ways:
- Webhook never arrives (Cloudflare logs show no `POST /api/webhooks/stripe` hit)
- Webhook arrives but signature verification fails (handler returns 400)
- Booking row not created
- Confirmation email doesn't send (and you've already verified DMARC/SPF/DKIM)

Then:

```bash
# Roll back the Worker to the previous version (pre-cutover deploy)
source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler rollback
```

This reverts the Worker code, but the secrets you set in Step 2 are still live. Decision tree:

- If the failure is **webhook-signing-secret mismatch** (most common): re-check the secret you copied from Stripe dashboard against what's set on the Worker (`wrangler secret list` shows names only, not values — re-`put` it to be safe).
- If the failure is **Stripe SDK / fetch error** in `worker/lib/stripe.js`: revert to sandbox keys via `wrangler secret put STRIPE_SECRET_KEY` with the test `sk_test_...` value; do the same for `STRIPE_WEBHOOK_SIGNING_SECRET` (test webhook endpoint secret). Then `wrangler deploy` again.
- If the failure is **something deeper** (D1 schema mismatch, Hono route 404, etc.): rollback the Worker AND revert secrets to sandbox. The Worker code is the same git ref as before; only the secrets changed. Reverting secrets isolates the bug from key rotation.

### Path B — Mid-batch rollback (Batch 5 is merged but live behavior is broken)

If Batch 5 has merged + deployed AND a real customer hits the bug:

1. **Roll back the Worker version** via `wrangler rollback` — reverts to the M5.5 / Batch 4 worker code which has known-good behavior.
2. **Leave secrets on live** — no point reverting to sandbox if real bookings are mid-flight.
3. **Open a follow-up branch** to fix Batch 5's change. Group A + Group B tests must pass before re-deploying.
4. **Communicate to any in-flight customers** via the admin notification flow if a booking was created but not confirmed.

### Path C — Catastrophic (D1 corruption from a mistakenly-applied migration during live)

M6 doesn't apply migrations between Batch 0 and Batch 5 by design (Batches 1-4 do — but those don't touch booking/webhook tables). If this somehow happens:

1. Halt further deploys
2. Restore D1 from the Cloudflare automated 24h backup (per operator acknowledgment in M3/M5/M6 prompt)
3. Reconstruct any bookings that came in during the corruption window from Stripe dashboard data
4. Rerun the cutover test once D1 is verified clean

---

## Post-cutover verification (recurring)

After Batch 5 deploys, the operator should periodically sample:

- One booking through the live flow per day for the first week, confirming `setup_future_usage` is set on the Checkout Session (visible in Stripe dashboard → Payment → Session details)
- Webhook delivery rate in Stripe dashboard → Webhooks → endpoint → "Recent deliveries"
- Confirmation + admin emails arriving promptly

If the operator's Stripe dashboard shows any `checkout.session.completed` events with **failed delivery** to the Worker endpoint, investigate immediately (likely a Worker error in the handler).

---

## File references

- `worker/routes/bookings.js` — POST /checkout handler (Batch 5 adds `setup_future_usage`)
- `worker/lib/stripe.js` — `createCheckoutSession()`, `verifyWebhookSignature()` (Batch 5 helpers)
- `worker/routes/webhooks.js` — POST /api/webhooks/stripe handler (Batch 6 adds `charge.dispute.created`)
- `docs/audit/06-do-not-touch.md` — full DNT list including the three Critical Stripe surfaces

---

## Sign-off

Operator executes this runbook and signs off in the Batch 5 closing summary with:
- Live Worker Version ID (from `wrangler deploy` output)
- $1 test booking ID (from D1 query)
- Stripe PI ID for the $1 charge
- Confirmation that both confirmation + admin notify emails arrived
- Refund execution timestamp

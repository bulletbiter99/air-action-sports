# M6 operator cutover checklist

This file lists the **operator-only** items that gate M6 progress. Claude Code cannot perform any of these — they require Stripe dashboard access, Cloudflare DNS access, secret material, or real financial transactions.

Treat this file as a worksheet — fill in outcomes as you complete each item; paste any unexpected results into the PR or `docs/m6-discovery/spot-check-log.md`.

---

## ✅ CUTOVER COMPLETE — 2026-06-02

**All 5 operator items are done. Production Stripe is LIVE.** Operator-confirmed 2026-06-02: live `sk_live_` API key, live webhook endpoint + `whsec_` secret, DMARC/SPF/DKIM DNS records, and the $1 live e2e test (charge + saved-PM + refund + refund email all verified). The booking flow now takes real payments. `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` confirmed present in `wrangler secret list`. B5/B6/B7/B9 live behavior (saved-PM on checkout, dispute consumer, damage-charge off-session, remove-saved-PM) is now fully active. The per-item worksheet below is retained as the historical record.

---

## Code-readiness audit — ✅ re-verified 2026-06-01 (first verified 2026-05-31, post-M7 / PR #233)

A post-M7 read-through (PR #233, 2026-05-31) confirmed every code path that activates when these operator items land is **present, wired, and unregressed since M6 close**, and a **2026-06-01 re-verification** (main `ce59ab9`, 2682 tests) re-confirms it. The Stripe surfaces are **byte-identical to M6 close** — the `/api/webhooks/stripe` handler (`worker/routes/webhooks.js`) and `verifyWebhookSignature` (`worker/lib/stripe.js`) are unchanged. The only post-M6 edits to these payment files are **additive and on the separate `/api/webhooks/resend` route** — M7 B8's bounce/complaint consumer + the native Marketing milestone's B4 campaign-event tracking — none of which touch the Stripe handler, the signature verifier, or the B5/B6/B7/B9 paths. **No code work blocks the cutover — only the 5 operator items below remain.**

| Gate | Code path | Verified |
|---|---|---|
| Items 1 + 5 — save PM on checkout (B5) | `worker/routes/bookings.js` passes `setupFutureUsage: 'off_session'` → `worker/lib/stripe.js` emits `payment_intent_data[setup_future_usage]=off_session` | ✅ present |
| Item 3 — Stripe-Version match | `worker/lib/stripe.js` pins `Stripe-Version: 2026-04-22.dahlia` (= the version Item 3 says to set on the endpoint) | ✅ matches |
| Item 3 — dispute consumer (B6) | `worker/routes/webhooks.js` handles `charge.dispute.created`; idempotent via the `dispute.received` audit_log lookup; orphan-safe | ✅ present |
| B7 — damage charge Option A | `worker/lib/stripe.js` off-session charge (`payment_method` + `off_session:'true'`); `chargeOffSessionForCharge` + `POST /:id/charge-card` | ✅ present |
| B9 — remove saved PM | `worker/lib/stripe.js` `detachPaymentMethod` + `POST /:id/detach-saved-pm` | ✅ present |

Group A + B Stripe regression tests remain green (138/138 at M6 close; 149/149 with B6). The B5–B9 characterization tests (`tests/unit/bookings/checkout-setup-future-usage` + `tests/unit/lib/stripe-setup-future-usage` / `stripe-off-session-charge` / `stripe-detach-pm` + `tests/unit/webhook/dispute-created-handler`) are all present + gated. **Run the 5 items below in any order (1–4), then Item 5 ($1 live e2e).**

---

## Item 1 — Live Stripe API key

**Status:** ✅ Done 2026-06-02 — live `sk_live_` key set via `wrangler secret put STRIPE_SECRET_KEY`

```bash
# From Stripe dashboard > Developers > API keys > Reveal live key
# Copy the live `sk_live_...` secret, then:
source .claude/.env
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler secret put STRIPE_SECRET_KEY
# Paste the sk_live_... value when prompted
```

After running, the deployed worker uses the live key on next request. The first cold-start may carry the old (sandbox) cached binding for a few seconds; subsequent requests resolve from the new secret.

**Outcome:**

```
[paste wrangler output here, redacting any secret material]
```

---

## Item 2 — Live Stripe webhook secret

**Status:** ✅ Done 2026-06-02 — live `whsec_` secret set via `wrangler secret put STRIPE_WEBHOOK_SECRET`

```bash
# After configuring the live webhook endpoint (Item 3), Stripe shows the
# signing secret on the endpoint detail page. Copy it, then:
source .claude/.env
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler secret put STRIPE_WEBHOOK_SECRET
# Paste the whsec_... value when prompted
```

**Outcome:**

```
[paste wrangler output here, redacting any secret material]
```

---

## Item 3 — Live Stripe webhook endpoint

**Status:** ✅ Done 2026-06-02 — live endpoint configured at `/api/webhooks/stripe` (checkout.session.completed + charge.dispute.created)

1. Stripe dashboard > Developers > Webhooks > Add endpoint
2. URL: `https://airactionsport.com/api/webhooks/stripe`
3. API version: `2026-04-22.dahlia` (matches `Stripe-Version` pinned in `worker/lib/stripe.js`)
4. Events to listen for (minimum for M5.5 + M6 today):
   - `checkout.session.completed` (existing)
   - **NEW for M6 B6:** `charge.dispute.created`
5. Click "Add endpoint" — copy the signing secret for Item 2

**Outcome:**

```
Endpoint URL:    https://airactionsport.com/api/webhooks/stripe
Endpoint ID:     [paste we_... id]
Stripe-Version:  2026-04-22.dahlia
Events:          checkout.session.completed, charge.dispute.created
```

---

## Item 4 — DMARC + SPF + DKIM DNS records

**Status:** ✅ Done 2026-06-02 — SPF + DKIM + DMARC TXT records present for airactionsport.com

Cloudflare DNS > `airactionsport.com` zone > Records. Verify the three TXT records that authorize Resend to send mail on behalf of this domain.

```
SPF:    [✓ present / ✗ missing — paste record value]
DKIM:   [✓ present / ✗ missing — paste record name + first 20 chars of value]
DMARC:  [✓ present / ✗ missing — paste record value]
```

If any are missing, copy the values from Resend's Domain settings page for `airactionsport.com` and add them as TXT records. SPF + DKIM gate deliverability; DMARC controls the policy when verification fails.

---

## Item 5 — $1 live e2e test

**Status:** ✅ Done 2026-06-02 — $1 live e2e passed: charge succeeded, customer auto-created, payment method saved, refund + refund email verified

After Items 1-4 are complete AND B5 is merged + deployed:

1. Open `https://airactionsport.com` in a private browser window
2. Choose any event, select 1 ticket
3. Use a **real card** at Stripe Checkout (you'll be charged the line-item subtotal)
4. Complete the booking
5. Verify in the Stripe dashboard (`Payments` view):
   - Charge succeeded
   - **Customer auto-created** (visible under `Customers` view)
   - **Payment method saved to the Customer** (look for the saved-PM indicator)
6. Refund the test charge from the Stripe dashboard (`...` menu > Refund)
7. Confirm refund email reached you (validates Resend live deliverability)

**Outcome:**

```
Test booking ID:       [paste bk_...]
Stripe Customer ID:    [paste cus_...]
Saved PM on Customer:  [✓ / ✗]
Refund completed:      [✓ / ✗]
Refund email received: [✓ / ✗]
Notes:                 [any anomalies]
```

---

## Cutover gate map

These items gate specific M6 batches:

| Item | B5 merge | B5 live e2e | B6 dispute live | B7 damage charge live |
|---|---|---|---|---|
| 1 | _Not strictly gating (production is on sandbox today; B5 will deploy and work on sandbox)_ | ✗ blocks | ✗ blocks | ✗ blocks |
| 2 | ☐ | ✗ blocks | ✗ blocks | ✗ blocks |
| 3 | ☐ | ✗ blocks | ✗ blocks (no live disputes without live webhook config) | ✗ blocks |
| 4 | ☐ | _Not strictly gating, but should land before live mail-heavy work_ | ✗ blocks | ✗ blocks |
| 5 | ☐ | ✗ self-blocks | n/a (Item 5 IS the B5 live e2e) | n/a |

In practice: **complete Items 1-4 in any order, then run Item 5 ($1 live e2e).** Once all five are done, B5's live verification is complete and B6+ live verification can proceed batch-by-batch.

## Updating this file

When you complete an item, replace the `☐ Not done` line with `✅ <date> — <one-line summary>` and fill in the **Outcome** section directly below. Claude Code reads this file at the start of any B6+ batch session to confirm the gates are open.

## What happens if you can't complete an item

- **Item 1:** Cannot defer. B5 has merged with sandbox keys still set; live behavior never activates. The setup_future_usage flag is sent on every Session but Stripe sandbox just saves PMs to test Customers. No real customer impact (you're not charging real cards on sandbox), but the feature isn't real until cutover.
- **Item 2:** Without it, the webhook handler will reject any signature from the live webhook endpoint. **DO NOT** complete Item 3 without queueing Item 2 immediately after — production will see signature verification failures on every checkout if Item 3 lands first.
- **Item 3:** Same coupling with Item 2. Sequence: configure endpoint → copy whsec → wrangler secret put. Do both in one short window.
- **Item 4:** Email sends will land in spam more often. Refund notifications, booking confirmations, dispute notifications (B6) etc. all degrade.
- **Item 5:** If skipped or if it fails, your first customer-on-live is your e2e. Strongly NOT recommended.

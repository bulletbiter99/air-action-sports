// Tests for the true-Stripe-fee capture: retrieveChargeFees (additive helper
// in worker/lib/stripe.js) + runStripeFeeSync (the nightly reconciliation cron).

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { mockStripeFetch } from '../../helpers/mockStripe.js';
import { retrieveChargeFees } from '../../../worker/lib/stripe.js';
import { runStripeFeeSync } from '../../../worker/lib/stripeFeeSync.js';

describe('retrieveChargeFees', () => {
    it('reads fee + net from the expanded latest_charge.balance_transaction', async () => {
        mockStripeFetch({
            'GET /v1/payment_intents/pi_1': {
                id: 'pi_1',
                latest_charge: { id: 'ch_1', balance_transaction: { id: 'txn_1', fee: 320, net: 9680, currency: 'usd' } },
            },
        });
        const out = await retrieveChargeFees('pi_1', 'sk_test');
        expect(out).toEqual({ feeCents: 320, netCents: 9680, balanceTransactionId: 'txn_1', chargeId: 'ch_1' });
    });

    it('returns null fee/net when the charge has not settled to a balance_transaction', async () => {
        mockStripeFetch({
            'GET /v1/payment_intents/pi_2': { id: 'pi_2', latest_charge: { id: 'ch_2', balance_transaction: null } },
        });
        const out = await retrieveChargeFees('pi_2', 'sk_test');
        expect(out).toMatchObject({ feeCents: null, netCents: null, balanceTransactionId: null, chargeId: 'ch_2' });
    });

    it('throws without a paymentIntentId', async () => {
        await expect(retrieveChargeFees('', 'sk_test')).rejects.toThrow(/paymentIntentId required/);
    });
});

describe('runStripeFeeSync', () => {
    function envWithKey() {
        const env = createMockEnv();
        env.STRIPE_SECRET_KEY = 'sk_test';
        return env;
    }
    // Candidate query now covers paid AND refunded bookings (a refund keeps the
    // original Stripe fee, so refunded charges are reconciled too).
    const CANDIDATES = /FROM bookings\s+WHERE status IN \('paid','refunded'\)/;

    it('captures fees for paid + refunded bookings missing them + reports the summary', async () => {
        const env = envWithKey();
        env.DB.__on(CANDIDATES, {
            results: [
                { id: 'bk_1', stripe_payment_intent: 'pi_1' },   // paid
                { id: 'bk_2', stripe_payment_intent: 'pi_2' },   // refunded — same capture path
            ],
        }, 'all');
        mockStripeFetch({
            'GET /v1/payment_intents/pi_1': { id: 'pi_1', latest_charge: { id: 'ch_1', balance_transaction: { id: 'txn_1', fee: 320, net: 9680 } } },
            'GET /v1/payment_intents/pi_2': { id: 'pi_2', latest_charge: { id: 'ch_2', balance_transaction: { id: 'txn_2', fee: 150, net: 4850 } } },
        });
        const out = await runStripeFeeSync(env);
        expect(out).toMatchObject({ scanned: 2, updated: 2, failed: 0 });
        const updates = env.DB.__writes().filter((w) => /UPDATE bookings\s+SET stripe_fee_cents/.test(w.sql));
        expect(updates).toHaveLength(2);
        expect(updates[0].args.slice(0, 3)).toEqual([320, 9680, 'txn_1']);
    });

    it('isolates a per-booking failure — one bad PI does not abort the batch', async () => {
        const env = envWithKey();
        env.DB.__on(CANDIDATES, {
            results: [
                { id: 'bk_ok', stripe_payment_intent: 'pi_ok' },
                { id: 'bk_bad', stripe_payment_intent: 'pi_bad' },
            ],
        }, 'all');
        // pi_bad has no mock → mockStripeFetch returns 404 → retrieveChargeFees throws.
        mockStripeFetch({
            'GET /v1/payment_intents/pi_ok': { id: 'pi_ok', latest_charge: { id: 'ch', balance_transaction: { id: 'txn', fee: 100, net: 900 } } },
        });
        const out = await runStripeFeeSync(env);
        expect(out).toMatchObject({ scanned: 2, updated: 1, failed: 1 });
    });

    it('counts an unsettled charge as failed (left NULL to retry), not updated', async () => {
        const env = envWithKey();
        env.DB.__on(CANDIDATES, { results: [{ id: 'bk', stripe_payment_intent: 'pi_u' }] }, 'all');
        mockStripeFetch({ 'GET /v1/payment_intents/pi_u': { id: 'pi_u', latest_charge: { id: 'ch', balance_transaction: null } } });
        const out = await runStripeFeeSync(env);
        expect(out).toMatchObject({ scanned: 1, updated: 0, failed: 1 });
        expect(env.DB.__writes().some((w) => /UPDATE bookings\s+SET stripe_fee_cents/.test(w.sql))).toBe(false);
    });

    it('no-ops gracefully without a Stripe key (does not query D1)', async () => {
        const env = createMockEnv();
        delete env.STRIPE_SECRET_KEY;
        const out = await runStripeFeeSync(env);
        expect(out).toMatchObject({ scanned: 0, updated: 0, skipped: 'no_stripe_key' });
    });
});

// Post-M5.5 — tests for the batch promo-code endpoint + the pure helpers
// that drive the BatchPromoModal in AdminPromoCodes.jsx.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { parseEmailList, formatDiscountDisplay } from '../../../../src/admin/promoCodeBatchHelpers.js';

let env;
let cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner', email: 'paul@aas.com', display_name: 'Paul' });
    cookieHeader = session.cookieHeader;
});

async function postBatch(body) {
    return worker.fetch(
        new Request('https://airactionsport.com/api/admin/promo-codes/batch', {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }),
        env, {},
    );
}

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

describe('parseEmailList', () => {
    it('returns empty result for empty / non-string input', () => {
        expect(parseEmailList('')).toEqual({ valid: [], invalid: [], duplicates: [] });
        expect(parseEmailList(null)).toEqual({ valid: [], invalid: [], duplicates: [] });
        expect(parseEmailList(undefined)).toEqual({ valid: [], invalid: [], duplicates: [] });
    });

    it('parses newline-separated emails + lowercases + trims', () => {
        const r = parseEmailList(' Alice@Example.com \n  BOB@example.com\n');
        expect(r.valid).toEqual(['alice@example.com', 'bob@example.com']);
        expect(r.invalid).toEqual([]);
    });

    it('parses comma / semicolon / whitespace separated tokens', () => {
        const r = parseEmailList('a@b.com, c@d.com; e@f.com\ng@h.com   i@j.com');
        expect(r.valid).toEqual(['a@b.com', 'c@d.com', 'e@f.com', 'g@h.com', 'i@j.com']);
    });

    it('dedupes case-insensitively + reports duplicates', () => {
        const r = parseEmailList('alice@x.com\nALICE@X.COM\nbob@x.com\nbob@x.com');
        expect(r.valid).toEqual(['alice@x.com', 'bob@x.com']);
        expect(r.duplicates).toEqual(['alice@x.com', 'bob@x.com']);
    });

    it('separates malformed tokens into invalid bucket', () => {
        const r = parseEmailList('alice@x.com\nnot-an-email\nbob@y.com\n@oops');
        expect(r.valid).toEqual(['alice@x.com', 'bob@y.com']);
        expect(r.invalid).toEqual(['not-an-email', '@oops']);
    });
});

describe('formatDiscountDisplay', () => {
    it('formats percent', () => {
        expect(formatDiscountDisplay('percent', 25)).toBe('25% off');
        expect(formatDiscountDisplay('percent', 100)).toBe('100% off');
    });

    it('formats fixed (cents to dollars)', () => {
        expect(formatDiscountDisplay('fixed', 1000)).toBe('$10.00 off');
        expect(formatDiscountDisplay('fixed', 500)).toBe('$5.00 off');
    });

    it('returns empty string for unknown type or non-finite values', () => {
        expect(formatDiscountDisplay('unknown', 25)).toBe('');
        expect(formatDiscountDisplay('percent', NaN)).toBe('');
        expect(formatDiscountDisplay('fixed', null)).toBe('');
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/promo-codes/batch
// ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/promo-codes/batch', () => {
    it('rejects when not authenticated as manager+', async () => {
        // Re-create session as staff role
        env = createMockEnv();
        const s = await createAdminSession(env, { id: 'u_staff', role: 'staff', email: 'staff@x.com' });
        cookieHeader = s.cookieHeader;
        const res = await postBatch({ recipients: [{ email: 'a@b.com' }], discountType: 'percent', discountValue: 10 });
        expect(res.status).toBe(403);
    });

    it('returns 400 with empty recipients', async () => {
        const res = await postBatch({ recipients: [], discountType: 'percent', discountValue: 10 });
        expect(res.status).toBe(400);
    });

    it('returns 400 with invalid discountType', async () => {
        const res = await postBatch({ recipients: [{ email: 'a@b.com' }], discountType: 'bogus', discountValue: 10 });
        expect(res.status).toBe(400);
    });

    it('returns 400 with non-positive discountValue', async () => {
        const res = await postBatch({ recipients: [{ email: 'a@b.com' }], discountType: 'percent', discountValue: 0 });
        expect(res.status).toBe(400);
    });

    it('returns 400 with percent > 100', async () => {
        const res = await postBatch({ recipients: [{ email: 'a@b.com' }], discountType: 'percent', discountValue: 150 });
        expect(res.status).toBe(400);
    });

    it('returns 400 with > 500 recipients', async () => {
        const big = Array.from({ length: 501 }, (_, i) => ({ email: `u${i}@x.com` }));
        const res = await postBatch({ recipients: big, discountType: 'percent', discountValue: 10 });
        expect(res.status).toBe(400);
    });

    it('returns 400 with expiresAt in the past', async () => {
        const res = await postBatch({
            recipients: [{ email: 'a@b.com' }],
            discountType: 'percent',
            discountValue: 10,
            expiresAt: Date.now() - 1000,
        });
        expect(res.status).toBe(400);
    });

    it('happy path: dedupes recipients, generates codes, audits — no emails when sendEmails=false', async () => {
        env.DB.__on(/SELECT id FROM promo_codes WHERE code = \?/, null, 'first');
        env.DB.__on(/INSERT INTO promo_codes/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const res = await postBatch({
            recipients: [
                { email: 'alice@x.com', name: 'Alice' },
                { email: 'ALICE@x.com' },           // dupe
                { email: 'bob@y.com' },
                { email: 'not-an-email' },           // skipped
            ],
            discountType: 'percent',
            discountValue: 25,
            sendEmails: false,
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.created).toBe(2);                // alice + bob; dupe + invalid skipped
        expect(data.emailsSent).toBe(0);

        // 2 promo_codes inserts
        const inserts = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO promo_codes'));
        expect(inserts).toHaveLength(2);
        // bind layout: id, code, event_id, type, value, min_order, expires, restricted_to_email, now, user_id
        const restrictedEmails = inserts.map((w) => w.args[7]);
        expect(restrictedEmails).toContain('alice@x.com');
        expect(restrictedEmails).toContain('bob@y.com');

        // audit row emitted (action is hardcoded in the SQL string, not a bind arg)
        const audits = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO audit_log'));
        const batchAudit = audits.find((a) => a.sql.includes("'promo_code.batch_created'"));
        expect(batchAudit).toBeDefined();
    });

    it('prepends admin email when sendToSelfFirst=true', async () => {
        env.DB.__on(/SELECT id FROM promo_codes WHERE code = \?/, null, 'first');
        env.DB.__on(/INSERT INTO promo_codes/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const res = await postBatch({
            recipients: [{ email: 'alice@x.com' }],
            discountType: 'fixed',
            discountValue: 1000,
            sendEmails: false,
            sendToSelfFirst: true,
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.created).toBe(2); // self + alice

        const inserts = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO promo_codes'));
        const restricted = inserts.map((w) => w.args[7]);
        expect(restricted).toContain('paul@aas.com');
        expect(restricted).toContain('alice@x.com');
    });
});

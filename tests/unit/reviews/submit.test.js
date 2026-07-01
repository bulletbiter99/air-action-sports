// Batch 3 — POST /api/reviews (submit or edit; auto-publish; one per booking).
import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';

const TOKEN = 'a'.repeat(40);
const BY_TOKEN = /b\.review_token = \?/;
const EXISTING = /SELECT \* FROM reviews WHERE booking_id/;
const INSERT = /INSERT INTO reviews/;
const UPDATE = /UPDATE reviews SET rating/;
const AUDIT = /INSERT INTO audit_log[\s\S]*'review\.submitted'/;

function post(bodyObj) {
    return new Request('https://airactionsport.com/api/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
        body: JSON.stringify(bodyObj),
    });
}
function paidBooking(over = {}) {
    return {
        booking_id: 'bk_1', full_name: 'Jane Doe', email: 'jane@x.com', status: 'paid',
        event_id: 'ev_1', event_slug: 'op', event_title: 'Op', event_display_date: 'd', ...over,
    };
}

describe('POST /api/reviews — guards', () => {
    it('honeypot (company) → silent 200, nothing written', async () => {
        const env = createMockEnv();
        const res = await worker.fetch(post({ token: TOKEN, rating: 5, company: 'AcmeBot' }), env, {});
        expect(res.status).toBe(200);
        expect((await res.json()).id).toBe('hp');
        expect(env.DB.__writes().some((w) => INSERT.test(w.sql))).toBe(false);
    });

    it('400 on bad token shape', async () => {
        const env = createMockEnv();
        const res = await worker.fetch(post({ token: 'nope', rating: 5 }), env, {});
        expect(res.status).toBe(400);
    });

    it('400 on out-of-range / non-integer / missing rating', async () => {
        const env = createMockEnv();
        for (const rating of [0, 6, 3.5, '5', undefined, null]) {
            const res = await worker.fetch(post({ token: TOKEN, rating }), env, {});
            expect(res.status).toBe(400);
        }
    });

    it('400 on over-long title / comment / author', async () => {
        const env = createMockEnv();
        const cases = [
            { token: TOKEN, rating: 5, title: 'x'.repeat(121) },
            { token: TOKEN, rating: 5, comment: 'x'.repeat(2001) },
            { token: TOKEN, rating: 5, authorName: 'x'.repeat(61) },
        ];
        for (const b of cases) {
            const res = await worker.fetch(post(b), env, {});
            expect(res.status).toBe(400);
        }
    });

    it('404 unknown token', async () => {
        const env = createMockEnv();
        env.DB.__on(BY_TOKEN, null, 'first');
        const res = await worker.fetch(post({ token: TOKEN, rating: 5 }), env, {});
        expect(res.status).toBe(404);
    });

    it('403 for a cancelled/refunded booking (anti-sabotage gate)', async () => {
        for (const status of ['cancelled', 'refunded', 'pending']) {
            const env = createMockEnv();
            env.DB.__on(BY_TOKEN, paidBooking({ status }), 'first');
            const res = await worker.fetch(post({ token: TOKEN, rating: 1 }), env, {});
            expect(res.status).toBe(403);
        }
    });
});

describe('POST /api/reviews — submit + edit', () => {
    it('201 inserts a published review, defaults the author name, hashes IP, audits', async () => {
        const env = createMockEnv();
        env.DB.__on(BY_TOKEN, paidBooking(), 'first');
        env.DB.__on(EXISTING, null, 'first');
        const res = await worker.fetch(post({ token: TOKEN, rating: 5, comment: 'Loved it' }), env, {});
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json).toMatchObject({ ok: true, status: 'published', edited: false });
        expect(json.id).toMatch(/^rv_/);

        const ins = env.DB.__writes().find((w) => INSERT.test(w.sql));
        expect(ins).toBeDefined();
        // bind order: id, event_id, booking_id, rating, title, comment, author_name, email, ipHash, now, now
        expect(ins.args[2]).toBe('bk_1');           // booking_id
        expect(ins.args[3]).toBe(5);                // rating
        expect(ins.args[6]).toBe('Jane D.');        // defaulted author name
        expect(ins.args[7]).toBe('jane@x.com');     // stored email (private)
        expect(typeof ins.args[8]).toBe('string');  // ip_hash present
        expect(env.DB.__writes().some((w) => AUDIT.test(w.sql))).toBe(true);
    });

    it('honors a provided author name', async () => {
        const env = createMockEnv();
        env.DB.__on(BY_TOKEN, paidBooking(), 'first');
        env.DB.__on(EXISTING, null, 'first');
        await worker.fetch(post({ token: TOKEN, rating: 4, authorName: 'GhostRecon' }), env, {});
        const ins = env.DB.__writes().find((w) => INSERT.test(w.sql));
        expect(ins.args[6]).toBe('GhostRecon');
    });

    it('200 edits an editable existing review (no second insert)', async () => {
        const env = createMockEnv();
        env.DB.__on(BY_TOKEN, paidBooking(), 'first');
        env.DB.__on(EXISTING, { id: 'rv_1', booking_id: 'bk_1', status: 'published', edit_count: 0, created_at: Date.now() - 1000 }, 'first');
        const res = await worker.fetch(post({ token: TOKEN, rating: 3, comment: 'fixed typo' }), env, {});
        expect(res.status).toBe(200);
        expect((await res.json())).toMatchObject({ ok: true, id: 'rv_1', edited: true });
        expect(env.DB.__writes().some((w) => UPDATE.test(w.sql))).toBe(true);
        expect(env.DB.__writes().some((w) => INSERT.test(w.sql))).toBe(false);
    });

    it('409 when the edit window/cap is exhausted', async () => {
        const env = createMockEnv();
        env.DB.__on(BY_TOKEN, paidBooking(), 'first');
        env.DB.__on(EXISTING, { id: 'rv_1', booking_id: 'bk_1', status: 'published', edit_count: 3, created_at: Date.now() }, 'first');
        const res = await worker.fetch(post({ token: TOKEN, rating: 1 }), env, {});
        expect(res.status).toBe(409);
        expect(env.DB.__writes().some((w) => UPDATE.test(w.sql))).toBe(false);
    });

    it('409 when the existing review is hidden (admin takedown)', async () => {
        const env = createMockEnv();
        env.DB.__on(BY_TOKEN, paidBooking(), 'first');
        env.DB.__on(EXISTING, { id: 'rv_1', booking_id: 'bk_1', status: 'hidden', edit_count: 0, created_at: Date.now() }, 'first');
        const res = await worker.fetch(post({ token: TOKEN, rating: 5 }), env, {});
        expect(res.status).toBe(409);
    });

    it('treats a UNIQUE(booking_id) double-submit race idempotently (200, existing id)', async () => {
        const env = createMockEnv();
        env.DB.__on(BY_TOKEN, paidBooking(), 'first');
        // First existence check: none. INSERT throws (race). Re-check: now exists.
        let existenceCalls = 0;
        env.DB.__on(EXISTING, () => (existenceCalls++ === 0 ? null : { id: 'rv_race', booking_id: 'bk_1', status: 'published' }), 'first');
        env.DB.__on(INSERT, () => { throw new Error('UNIQUE constraint failed: reviews.booking_id'); }, 'run');
        const res = await worker.fetch(post({ token: TOKEN, rating: 5 }), env, {});
        expect(res.status).toBe(200);
        expect((await res.json())).toMatchObject({ ok: true, id: 'rv_race', edited: false });
    });
});

// Batch 5a — admin review-moderation route tests (attendee-verified reviews, 0077).
// GET /api/admin/reviews (list + filters + summary), PUT /:id (hide/unhide),
// gated by the reviews.moderate capability.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import { bindCapabilities } from '../../helpers/personFixture.js';

let env;
let cookieHeader;

function req(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, { headers: { cookie: cookieHeader }, ...init });
}
function putReq(path, body) {
    return new Request(`https://airactionsport.com${path}`, {
        method: 'PUT',
        headers: { cookie: cookieHeader, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const LIST = /FROM reviews r\s+LEFT JOIN events e/;
const COUNT = /SELECT COUNT\(\*\) AS n FROM reviews r/;
const SUMMARY = /SUM\(CASE WHEN status = 'published'/;
const EXISTING = /SELECT \* FROM reviews WHERE id = \?/;
const HIDE = /UPDATE reviews SET status = 'hidden'/;
const UNHIDE = /UPDATE reviews SET status = 'published'/;
const AUDIT = /INSERT INTO audit_log/;

function reviewRow(over = {}) {
    return {
        id: 'rv_1', event_id: 'ev_1', booking_id: 'bk_1', rating: 5, title: 'Epic', comment: 'Loved it',
        author_name: 'Jane D.', email: 'jane@x.com', verified: 1, status: 'published',
        hidden_at: null, hidden_reason: null, hidden_by: null, edit_count: 0, ip_hash: 'abc',
        created_at: 1000, updated_at: 1000, event_title: 'Op Last Light', event_slug: 'op', booking_status: 'paid', ...over,
    };
}

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
    bindCapabilities(env.DB, 'u_owner', ['reviews.moderate']);
});

describe('capability gating', () => {
    it('403s a user without reviews.moderate', async () => {
        const env2 = createMockEnv();
        const s = await createAdminSession(env2, { id: 'u_nocaps', role: 'staff' });
        // no bindCapabilities → cap absent
        const res = await worker.fetch(new Request('https://airactionsport.com/api/admin/reviews', { headers: { cookie: s.cookieHeader } }), env2, {});
        expect(res.status).toBe(403);
    });
});

describe('GET /api/admin/reviews — list', () => {
    it('returns items (with admin fields) + summary', async () => {
        env.DB.__on(COUNT, { n: 1 }, 'first');
        env.DB.__on(LIST, { results: [reviewRow()] }, 'all');
        env.DB.__on(SUMMARY, { published: 3, hidden: 1, total: 4, average: 4.6 }, 'first');

        const res = await worker.fetch(req('/api/admin/reviews'), env, {});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.total).toBe(1);
        expect(json.summary).toEqual({ published: 3, hidden: 1, total: 4, average: 4.6 });
        const item = json.items[0];
        expect(item).toMatchObject({ id: 'rv_1', rating: 5, authorName: 'Jane D.', status: 'published' });
        // Admin-only fields ARE present here (behind the cap).
        expect(item.email).toBe('jane@x.com');
        expect(item.event).toEqual({ id: 'ev_1', title: 'Op Last Light', slug: 'op' });
        expect(item.bookingFlag).toBeNull();   // booking is paid
    });

    it('flags a review whose booking was later refunded/cancelled', async () => {
        env.DB.__on(COUNT, { n: 1 }, 'first');
        env.DB.__on(LIST, { results: [reviewRow({ booking_status: 'refunded' })] }, 'all');
        env.DB.__on(SUMMARY, { published: 1, hidden: 0, total: 1, average: 5 }, 'first');
        const res = await worker.fetch(req('/api/admin/reviews'), env, {});
        expect((await res.json()).items[0].bookingFlag).toBe('refunded');
    });

    it('applies event_id / status / rating / q filters in the WHERE', async () => {
        let captured = '';
        env.DB.__on(LIST, (sql) => { captured = sql; return { results: [] }; }, 'all');
        env.DB.__on(COUNT, { n: 0 }, 'first');
        env.DB.__on(SUMMARY, { published: 0, hidden: 0, total: 0, average: null }, 'first');
        await worker.fetch(req('/api/admin/reviews?event_id=ev_1&status=hidden&rating=2&q=bad'), env, {});
        expect(captured).toMatch(/r\.event_id = \?/);
        expect(captured).toMatch(/r\.status = \?/);
        expect(captured).toMatch(/r\.rating = \?/);
        expect(captured).toMatch(/r\.title LIKE \?/);
    });

    it('degrades to an empty list if the reviews table is missing', async () => {
        env.DB.__on(COUNT, () => { throw new Error('no such table: reviews'); }, 'first');
        const res = await worker.fetch(req('/api/admin/reviews'), env, {});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.items).toEqual([]);
        expect(json.summary).toMatchObject({ published: 0, hidden: 0, total: 0 });
    });
});

describe('PUT /api/admin/reviews/:id — hide / unhide', () => {
    it('hides a review + writes a review.hidden audit with the reason', async () => {
        env.DB.__on(EXISTING, reviewRow(), 'first');
        env.DB.__on(LIST, reviewRow({ status: 'hidden' }), 'first');   // re-fetch after update
        const res = await worker.fetch(putReq('/api/admin/reviews/rv_1', { action: 'hide', reason: 'off-topic' }), env, {});
        expect(res.status).toBe(200);
        expect(env.DB.__writes().some((w) => HIDE.test(w.sql))).toBe(true);
        const audit = env.DB.__writes().find((w) => AUDIT.test(w.sql) && w.args.includes('review.hidden'));
        expect(audit).toBeDefined();
        expect(audit.args.some((a) => typeof a === 'string' && a.includes('off-topic'))).toBe(true);
    });

    it('unhides a review + writes a review.unhidden audit', async () => {
        env.DB.__on(EXISTING, reviewRow({ status: 'hidden' }), 'first');
        env.DB.__on(LIST, reviewRow(), 'first');
        const res = await worker.fetch(putReq('/api/admin/reviews/rv_1', { action: 'unhide' }), env, {});
        expect(res.status).toBe(200);
        expect(env.DB.__writes().some((w) => UNHIDE.test(w.sql))).toBe(true);
        expect(env.DB.__writes().some((w) => AUDIT.test(w.sql) && w.args.includes('review.unhidden'))).toBe(true);
    });

    it('400 on a bad action', async () => {
        const res = await worker.fetch(putReq('/api/admin/reviews/rv_1', { action: 'delete' }), env, {});
        expect(res.status).toBe(400);
    });

    it('404 on an unknown review', async () => {
        env.DB.__on(EXISTING, null, 'first');
        const res = await worker.fetch(putReq('/api/admin/reviews/rv_missing', { action: 'hide' }), env, {});
        expect(res.status).toBe(404);
    });
});

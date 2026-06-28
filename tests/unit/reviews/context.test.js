// Batch 3 — GET /api/reviews/context?token=… (resolve the emailed link → form state).
import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';

const TOKEN = 'a'.repeat(40);
const BY_TOKEN = /b\.review_token = \?/;
const EXISTING = /SELECT \* FROM reviews WHERE booking_id/;

function req(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}
function paidBooking(over = {}) {
    return {
        booking_id: 'bk_1', full_name: 'Jane Doe', email: 'jane@x.com', status: 'paid',
        event_id: 'ev_1', event_slug: 'operation-last-light', event_title: 'Operation Last Light',
        event_display_date: '25 July 2026', ...over,
    };
}

describe('GET /api/reviews/context', () => {
    it('400 when the token is missing or malformed', async () => {
        const env = createMockEnv();
        for (const t of ['', 'short', 'a'.repeat(39), 'a'.repeat(41), 'bad*char' + 'a'.repeat(32)]) {
            const res = await worker.fetch(req(`/api/reviews/context?token=${t}`), env, {});
            expect(res.status).toBe(400);
        }
    });

    it('404 when the token resolves to no booking', async () => {
        const env = createMockEnv();
        env.DB.__on(BY_TOKEN, null, 'first');
        const res = await worker.fetch(req(`/api/reviews/context?token=${TOKEN}`), env, {});
        expect(res.status).toBe(404);
    });

    it('200 eligible with no prior review — suggests first + last initial', async () => {
        const env = createMockEnv();
        env.DB.__on(BY_TOKEN, paidBooking(), 'first');
        env.DB.__on(EXISTING, null, 'first');
        const res = await worker.fetch(req(`/api/reviews/context?token=${TOKEN}`), env, {});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toMatchObject({
            eligible: true, reason: null, alreadyReviewed: false, editable: false,
            event: { slug: 'operation-last-light', title: 'Operation Last Light', displayDate: '25 July 2026' },
            suggestedAuthorName: 'Jane D.',
            existingReview: null,
        });
        // No raw booking id / email leaks into context.
        expect(JSON.stringify(json)).not.toContain('jane@x.com');
        expect(JSON.stringify(json)).not.toContain('bk_1');
    });

    it('200 ineligible for a refunded booking with a reason', async () => {
        const env = createMockEnv();
        env.DB.__on(BY_TOKEN, paidBooking({ status: 'refunded' }), 'first');
        env.DB.__on(EXISTING, null, 'first');
        const res = await worker.fetch(req(`/api/reviews/context?token=${TOKEN}`), env, {});
        const json = await res.json();
        expect(json.eligible).toBe(false);
        expect(json.reason).toMatch(/refund/i);
    });

    it('marks a recent published review editable and returns it for prefill', async () => {
        const env = createMockEnv();
        env.DB.__on(BY_TOKEN, paidBooking(), 'first');
        env.DB.__on(EXISTING, {
            id: 'rv_1', booking_id: 'bk_1', rating: 4, title: 'Great', comment: 'Fun day',
            author_name: 'Jane D.', status: 'published', edit_count: 0, created_at: Date.now() - 1000,
        }, 'first');
        const res = await worker.fetch(req(`/api/reviews/context?token=${TOKEN}`), env, {});
        const json = await res.json();
        expect(json.alreadyReviewed).toBe(true);
        expect(json.editable).toBe(true);
        expect(json.existingReview).toMatchObject({ rating: 4, title: 'Great', comment: 'Fun day', authorName: 'Jane D.' });
    });

    it('marks an old / max-edited / hidden review NOT editable', async () => {
        const longAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
        for (const ex of [
            { status: 'published', edit_count: 0, created_at: longAgo },     // past 30d window
            { status: 'published', edit_count: 3, created_at: Date.now() },   // hit edit cap
            { status: 'hidden', edit_count: 0, created_at: Date.now() },      // taken down
        ]) {
            const env = createMockEnv();
            env.DB.__on(BY_TOKEN, paidBooking(), 'first');
            env.DB.__on(EXISTING, { id: 'rv_1', booking_id: 'bk_1', rating: 4, author_name: 'Jane D.', ...ex }, 'first');
            const res = await worker.fetch(req(`/api/reviews/context?token=${TOKEN}`), env, {});
            const json = await res.json();
            expect(json.editable).toBe(false);
        }
    });
});

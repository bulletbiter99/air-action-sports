// Batch 2 — post-event review-invite cron (attendee-verified reviews, 0077).
// Locks: window math (COALESCE(end_date_iso,date_iso) anchor, 18-48h window),
// the env launch-cutoff fence, the soft-alarm-not-abort large-batch behavior,
// sentinel-first claim, claim-skip on changes=0, the sender-declined "deferred"
// rollback, roll-BOTH-columns-back on send failure, and that a best-effort audit
// failure does NOT roll back an already-sent email.

import { describe, it, expect, vi } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import {
    runReviewInviteSweep,
    DEFAULT_LAUNCH_CUTOFF_MS,
    REVIEW_INVITE_SOFT_ALARM,
} from '../../../worker/lib/reviewInvites.js';
import { reviewId, reviewToken } from '../../../worker/lib/ids.js';

const SELECT = /FROM bookings b\s+JOIN events e/;
const CLAIM = /UPDATE bookings SET review_invite_sent_at = \?, review_token = \?/;
const ROLLBACK = /UPDATE bookings SET review_invite_sent_at = NULL, review_token = NULL/;
// Action is a hardcoded SQL literal (single-purpose sweep, like 'cron.swept'),
// so assert on the SQL string, not the bound args (M5 lesson #3).
const SENT_AUDIT = /INSERT INTO audit_log[\s\S]*'review_invite\.sent'/;

function candidate(id = 'bk_1') {
    return { id, email: `${id}@example.com`, full_name: 'Jane Player', event_id: 'ev_1', event_title: 'Op Last Light', event_display_date: '25 July 2026' };
}

describe('review id generators', () => {
    it('reviewId is rv_ + 14 base62', () => {
        expect(reviewId()).toMatch(/^rv_[0-9A-Za-z]{14}$/);
    });
    it('reviewToken is 40 base62 chars', () => {
        const t = reviewToken();
        expect(t).toMatch(/^[0-9A-Za-z]{40}$/);
        expect(t.length).toBe(40);
    });
});

describe('runReviewInviteSweep — windowing', () => {
    it('queries the COALESCE(end_date_iso,date_iso) anchor with an 18-48h window past the default cutoff', async () => {
        const env = createMockEnv();
        const now = Date.now();
        await runReviewInviteSweep(env, { now });
        const select = env.DB.__writes().find((w) => SELECT.test(w.sql));
        expect(select).toBeDefined();
        expect(select.sql).toMatch(/COALESCE\(e\.end_date_iso, e\.date_iso\)/);
        const [windowStart, windowEnd, cutoff] = select.args;
        expect((now - windowStart) / 3600000).toBeCloseTo(48, 5);
        expect((now - windowEnd) / 3600000).toBeCloseTo(18, 5);
        expect(cutoff).toBe(DEFAULT_LAUNCH_CUTOFF_MS);
        // Only paid/comp + unsent + has-email candidates.
        expect(select.sql).toMatch(/status IN \('paid', 'comp'\)/);
        expect(select.sql).toMatch(/review_invite_sent_at IS NULL/);
    });

    it('honors REVIEW_LAUNCH_CUTOFF_MS from env as the forward-only fence', async () => {
        const env = createMockEnv({ REVIEW_LAUNCH_CUTOFF_MS: 1700000000000 });
        await runReviewInviteSweep(env, { now: Date.now() });
        const select = env.DB.__writes().find((w) => SELECT.test(w.sql));
        expect(select.args[2]).toBe(1700000000000);
    });

    it('falls back to the default cutoff when the env value is missing / non-numeric / 0', async () => {
        for (const bad of [undefined, '', 'nope', 0, -5]) {
            const env = createMockEnv(bad === undefined ? {} : { REVIEW_LAUNCH_CUTOFF_MS: bad });
            await runReviewInviteSweep(env, { now: Date.now() });
            const select = env.DB.__writes().find((w) => SELECT.test(w.sql));
            expect(select.args[2]).toBe(DEFAULT_LAUNCH_CUTOFF_MS);
        }
    });

    it('returns a zero summary when nothing matches', async () => {
        const env = createMockEnv();
        const out = await runReviewInviteSweep(env, { now: Date.now() });
        expect(out).toMatchObject({ considered: 0, sent: 0, failed: 0, skipped: 0, deferred: 0, alarm: false });
    });
});

describe('runReviewInviteSweep — large-batch soft alarm (no abort)', () => {
    it('flags alarm + STILL sends when candidates exceed the soft threshold', async () => {
        const env = createMockEnv();
        const many = Array.from({ length: REVIEW_INVITE_SOFT_ALARM + 1 }, (_, i) => candidate(`bk_${i}`));
        env.DB.__on(SELECT, { results: many }, 'all');
        env.DB.__on(CLAIM, { meta: { changes: 1 } }, 'run');
        const sender = vi.fn().mockResolvedValue({ id: 'ok' });

        const out = await runReviewInviteSweep(env, { now: Date.now(), sender });

        // A popular event with >threshold bookings must NOT stall — everyone gets invited.
        expect(out.alarm).toBe(true);
        expect(out.sent).toBe(many.length);
        expect(sender).toHaveBeenCalledTimes(many.length);
        expect(out).not.toHaveProperty('aborted');
    });
});

describe('runReviewInviteSweep — claim / send / rollback', () => {
    it('claims sentinel-first, mints a 40-char token into the link, sends, and audits', async () => {
        const env = createMockEnv();
        env.DB.__on(SELECT, { results: [candidate('bk_1')] }, 'all');
        env.DB.__on(CLAIM, { meta: { changes: 1 } }, 'run');
        const sender = vi.fn().mockResolvedValue({ id: 'email_1' });

        const out = await runReviewInviteSweep(env, { now: Date.now(), sender });

        expect(out).toMatchObject({ considered: 1, sent: 1, failed: 0, skipped: 0, deferred: 0 });
        const claim = env.DB.__writes().find((w) => CLAIM.test(w.sql));
        expect(claim).toBeDefined();
        const [, claimedToken, claimedId] = claim.args;
        expect(claimedId).toBe('bk_1');
        expect(claimedToken).toMatch(/^[0-9A-Za-z]{40}$/);
        // The sender got that exact token in the review link.
        expect(sender).toHaveBeenCalledTimes(1);
        const arg = sender.mock.calls[0][1];
        expect(arg.reviewLink).toBe(`https://airactionsport.com/review?token=${claimedToken}`);
        expect(arg.booking).toMatchObject({ id: 'bk_1', email: 'bk_1@example.com' });
        // Success audit written, no rollback.
        expect(env.DB.__writes().some((w) => SENT_AUDIT.test(w.sql))).toBe(true);
        expect(env.DB.__writes().some((w) => ROLLBACK.test(w.sql))).toBe(false);
    });

    it('skips a row when the claim UPDATE changes=0 (already claimed) — no send, no audit', async () => {
        const env = createMockEnv();
        env.DB.__on(SELECT, { results: [candidate('bk_2')] }, 'all');
        env.DB.__on(CLAIM, { meta: { changes: 0 } }, 'run');
        const sender = vi.fn().mockResolvedValue({});

        const out = await runReviewInviteSweep(env, { now: Date.now(), sender });

        expect(out).toMatchObject({ considered: 1, sent: 0, skipped: 1, deferred: 0 });
        expect(sender).not.toHaveBeenCalled();
        expect(env.DB.__writes().some((w) => SENT_AUDIT.test(w.sql))).toBe(false);
    });

    it('DEFERS (rolls back, does not count as sent) when the sender declines, e.g. template missing/draft', async () => {
        const env = createMockEnv();
        env.DB.__on(SELECT, { results: [candidate('bk_skip')] }, 'all');
        env.DB.__on(CLAIM, { meta: { changes: 1 } }, 'run');
        const sender = vi.fn().mockResolvedValue({ skipped: 'template_missing' });

        const out = await runReviewInviteSweep(env, { now: Date.now(), sender });

        expect(out).toMatchObject({ considered: 1, sent: 0, deferred: 1 });
        // Rolled back so a later run retries once the template is live.
        const rollback = env.DB.__writes().find((w) => ROLLBACK.test(w.sql));
        expect(rollback).toBeDefined();
        expect(rollback.args[0]).toBe('bk_skip');
        // No success audit for a non-send.
        expect(env.DB.__writes().some((w) => SENT_AUDIT.test(w.sql))).toBe(false);
    });

    it('rolls BOTH review_invite_sent_at and review_token back to NULL when the send throws', async () => {
        const env = createMockEnv();
        env.DB.__on(SELECT, { results: [candidate('bk_3')] }, 'all');
        env.DB.__on(CLAIM, { meta: { changes: 1 } }, 'run');
        const sender = vi.fn().mockRejectedValue(new Error('resend 500'));

        const out = await runReviewInviteSweep(env, { now: Date.now(), sender });

        expect(out).toMatchObject({ considered: 1, sent: 0, failed: 1 });
        const rollback = env.DB.__writes().find((w) => ROLLBACK.test(w.sql));
        expect(rollback).toBeDefined();
        expect(rollback.args[0]).toBe('bk_3');
        expect(env.DB.__writes().some((w) => SENT_AUDIT.test(w.sql))).toBe(false);
    });

    it('a best-effort audit-insert failure does NOT roll back an already-sent email', async () => {
        const env = createMockEnv();
        env.DB.__on(SELECT, { results: [candidate('bk_aud')] }, 'all');
        env.DB.__on(CLAIM, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, () => { throw new Error('audit down'); }, 'run');
        const sender = vi.fn().mockResolvedValue({ id: 'ok' });

        const out = await runReviewInviteSweep(env, { now: Date.now(), sender });

        // The email went out → counts as sent; the sentinel must NOT be rolled back.
        expect(out).toMatchObject({ considered: 1, sent: 1, failed: 0 });
        expect(env.DB.__writes().some((w) => ROLLBACK.test(w.sql))).toBe(false);
    });

    it('isolates a per-row failure — one bad send does not abort the batch', async () => {
        const env = createMockEnv();
        env.DB.__on(SELECT, { results: [candidate('bk_ok'), candidate('bk_bad')] }, 'all');
        env.DB.__on(CLAIM, { meta: { changes: 1 } }, 'run');
        const sender = vi.fn()
            .mockResolvedValueOnce({ id: 'ok' })
            .mockRejectedValueOnce(new Error('boom'));
        const out = await runReviewInviteSweep(env, { now: Date.now(), sender });
        expect(out).toMatchObject({ considered: 2, sent: 1, failed: 1 });
    });

    it('returns a guarded failure (no throw) when the candidate SELECT errors', async () => {
        const env = createMockEnv();
        env.DB.__on(SELECT, () => { throw new Error('d1 down'); }, 'all');
        const out = await runReviewInviteSweep(env, { now: Date.now() });
        expect(out).toMatchObject({ considered: 0, sent: 0, failed: 0 });
        expect(out.error).toMatch(/d1 down/);
    });
});

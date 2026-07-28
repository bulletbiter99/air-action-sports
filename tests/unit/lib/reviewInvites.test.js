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
import { toDenverWallClock, eventInstantMs } from '../../../worker/lib/eventTime.js';

// The sweep is PINNED to a fixed instant. It re-checks each candidate's real end
// anchor in JS (the SQL wall-clock range can only over-select), so a fixture
// needs an anchor that genuinely sits in the 18-48h post-event window.
//
// ⚠ ALWAYS pass `now: NOW` to runReviewInviteSweep — never `Date.now()`. NOW and
// ANCHOR_MS are locked together, so the anchor sits inside the window forever;
// mixing a real clock against this fixed anchor makes the file rot on a
// specific DATE rather than fail loudly. It already happened once: the original
// Batch-2 tests passed `Date.now()`, and at 2026-07-28T09:00Z the anchor aged
// past the 48h bound and nine tests went red on main with no code change.
// (Same family as #291's sales-series time bomb and #393's clock-flaky fixture:
// a relative window asserted against a fixed date always has an expiry.)
const NOW = Date.parse('2026-07-27T09:00:00Z');            // 03:00 MDT, the cron hour
const ANCHOR_MS = NOW - 24 * 3600000;                       // squarely inside 18-48h
const ANCHOR_ISO = toDenverWallClock(ANCHOR_MS);            // naive Denver, as stored

const SELECT = /FROM bookings b\s+JOIN events e/;
const CLAIM = /UPDATE bookings SET review_invite_sent_at = \?, review_token = \?/;
const ROLLBACK = /UPDATE bookings SET review_invite_sent_at = NULL, review_token = NULL/;
// Action is a hardcoded SQL literal (single-purpose sweep, like 'cron.swept'),
// so assert on the SQL string, not the bound args (M5 lesson #3).
const SENT_AUDIT = /INSERT INTO audit_log[\s\S]*'review_invite\.sent'/;

function candidate(id = 'bk_1', overrides = {}) {
    return {
        id,
        email: `${id}@example.com`,
        full_name: 'Jane Player',
        event_id: 'ev_1',
        event_title: 'Op Last Light',
        event_display_date: '25 July 2026',
        // Anchor columns the JS re-check reads. Without these every send-path
        // test silently filters to zero candidates and asserts nothing.
        event_date_iso: ANCHOR_ISO,
        event_end_date_iso: null,
        ...overrides,
    };
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
        const now = NOW;
        await runReviewInviteSweep(env, { now });
        const select = env.DB.__writes().find((w) => SELECT.test(w.sql));
        expect(select).toBeDefined();
        expect(select.sql).toMatch(/COALESCE\(e\.end_date_iso, e\.date_iso\)/);
        // Bounds are Denver WALL-CLOCK strings now — date_iso is naive local
        // time, so comparing it against epoch-ms read every event 6-7h early and
        // fired Last Light's invites 30 min after ENDEX instead of the next night.
        const [windowStart, windowEnd, cutoff] = select.args;
        expect(windowStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
        expect(windowEnd).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
        // Precision 3 (~1.8s), not 5: a wall-clock string is second-granular, so
        // the round-trip through it drops sub-second precision by design.
        expect((now - eventInstantMs(windowStart)) / 3600000).toBeCloseTo(48, 3);
        expect((now - eventInstantMs(windowEnd)) / 3600000).toBeCloseTo(18, 3);
        expect(cutoff).toBe(toDenverWallClock(DEFAULT_LAUNCH_CUTOFF_MS));
        // Only paid/comp + unsent + has-email candidates.
        expect(select.sql).toMatch(/status IN \('paid', 'comp'\)/);
        expect(select.sql).toMatch(/review_invite_sent_at IS NULL/);
    });

    it('honors REVIEW_LAUNCH_CUTOFF_MS from env as the forward-only fence', async () => {
        const env = createMockEnv({ REVIEW_LAUNCH_CUTOFF_MS: 1700000000000 });
        await runReviewInviteSweep(env, { now: NOW });
        const select = env.DB.__writes().find((w) => SELECT.test(w.sql));
        expect(select.args[2]).toBe(toDenverWallClock(1700000000000));
    });

    it('falls back to the default cutoff when the env value is missing / non-numeric / 0', async () => {
        for (const bad of [undefined, '', 'nope', 0, -5]) {
            const env = createMockEnv(bad === undefined ? {} : { REVIEW_LAUNCH_CUTOFF_MS: bad });
            await runReviewInviteSweep(env, { now: NOW });
            const select = env.DB.__writes().find((w) => SELECT.test(w.sql));
            expect(select.args[2]).toBe(toDenverWallClock(DEFAULT_LAUNCH_CUTOFF_MS));
        }
    });

    it('returns a zero summary when nothing matches', async () => {
        const env = createMockEnv();
        const out = await runReviewInviteSweep(env, { now: NOW });
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

        const out = await runReviewInviteSweep(env, { now: NOW, sender });

        // A popular event with >threshold bookings must NOT stall — everyone gets invited.
        expect(out.alarm).toBe(true);
        expect(out.sent).toBe(many.length);
        expect(sender).toHaveBeenCalledTimes(many.length);
        expect(out).not.toHaveProperty('aborted');
    });
});

describe('runReviewInviteSweep — deliverability suppression (CAN-SPAM option B, 2026-07-01)', () => {
    const SUPPRESS = /SELECT DISTINCT recipient_normalized FROM email_events/;

    it('skips candidates with a recorded hard bounce / complaint; sends to the rest', async () => {
        const env = createMockEnv();
        // Mixed-case address proves matching goes through normalizeEmail.
        const sup = { ...candidate('bk_sup'), email: 'Bounced.Player@Example.com' };
        env.DB.__on(SELECT, { results: [sup, candidate('bk_ok')] }, 'all');
        env.DB.__on(SUPPRESS, { results: [{ recipient_normalized: 'bounced.player@example.com' }] }, 'all');
        env.DB.__on(CLAIM, { meta: { changes: 1 } }, 'run');
        const sender = vi.fn().mockResolvedValue({ id: 'ok' });

        const out = await runReviewInviteSweep(env, { now: NOW, sender });

        expect(out).toMatchObject({ considered: 2, sent: 1, suppressed: 1, failed: 0 });
        // Only the clean address was sent to.
        expect(sender).toHaveBeenCalledTimes(1);
        expect(sender.mock.calls[0][1].booking.id).toBe('bk_ok');
        // The suppressed booking is NOT sentinel-stamped (re-skips until the
        // window ages it out — or the suppression is cleared in time).
        const claims = env.DB.__writes().filter((w) => CLAIM.test(w.sql));
        expect(claims.map((w) => w.args[2])).toEqual(['bk_ok']);
        // The check queried only suppressed rows, bound to the normalized keys.
        const supQuery = env.DB.__writes().find((w) => SUPPRESS.test(w.sql));
        expect(supQuery.sql).toMatch(/suppressed_marketing = 1/);
        expect(supQuery.args).toContain('bounced.player@example.com');
    });

    it('is best-effort: a suppression-query failure does NOT block the invites', async () => {
        const env = createMockEnv();
        env.DB.__on(SELECT, { results: [candidate('bk_1')] }, 'all');
        env.DB.__on(SUPPRESS, () => { throw new Error('email_events missing'); }, 'all');
        env.DB.__on(CLAIM, { meta: { changes: 1 } }, 'run');
        const sender = vi.fn().mockResolvedValue({ id: 'ok' });

        const out = await runReviewInviteSweep(env, { now: NOW, sender });

        expect(out).toMatchObject({ considered: 1, sent: 1, suppressed: 0, failed: 0 });
        expect(sender).toHaveBeenCalledTimes(1);
    });
});

describe('runReviewInviteSweep — claim / send / rollback', () => {
    it('claims sentinel-first, mints a 40-char token into the link, sends, and audits', async () => {
        const env = createMockEnv();
        env.DB.__on(SELECT, { results: [candidate('bk_1')] }, 'all');
        env.DB.__on(CLAIM, { meta: { changes: 1 } }, 'run');
        const sender = vi.fn().mockResolvedValue({ id: 'email_1' });

        const out = await runReviewInviteSweep(env, { now: NOW, sender });

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

        const out = await runReviewInviteSweep(env, { now: NOW, sender });

        expect(out).toMatchObject({ considered: 1, sent: 0, skipped: 1, deferred: 0 });
        expect(sender).not.toHaveBeenCalled();
        expect(env.DB.__writes().some((w) => SENT_AUDIT.test(w.sql))).toBe(false);
    });

    it('DEFERS (rolls back, does not count as sent) when the sender declines, e.g. template missing/draft', async () => {
        const env = createMockEnv();
        env.DB.__on(SELECT, { results: [candidate('bk_skip')] }, 'all');
        env.DB.__on(CLAIM, { meta: { changes: 1 } }, 'run');
        const sender = vi.fn().mockResolvedValue({ skipped: 'template_missing' });

        const out = await runReviewInviteSweep(env, { now: NOW, sender });

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

        const out = await runReviewInviteSweep(env, { now: NOW, sender });

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

        const out = await runReviewInviteSweep(env, { now: NOW, sender });

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
        const out = await runReviewInviteSweep(env, { now: NOW, sender });
        expect(out).toMatchObject({ considered: 2, sent: 1, failed: 1 });
    });

    it('returns a guarded failure (no throw) when the candidate SELECT errors', async () => {
        const env = createMockEnv();
        env.DB.__on(SELECT, () => { throw new Error('d1 down'); }, 'all');
        const out = await runReviewInviteSweep(env, { now: NOW });
        expect(out).toMatchObject({ considered: 0, sent: 0, failed: 0 });
        expect(out.error).toMatch(/d1 down/);
    });
});

// ── The 2026-07-25 misfire + the pacing that must ship with its fix ────────
describe('runReviewInviteSweep — Denver anchor + batch pacing (2026-07-27)', () => {
    // Operation Last Light: date_iso '2026-07-25T08:30:00' (naive Denver), a
    // single-day 12hr op, so the anchor is the START. Reading that as UTC put
    // the anchor 6h early, which pulled the booking into the Jul 26 03:00Z tick
    // — 9:00 PM Denver on the 25th, THIRTY MINUTES after the event ended.
    const LAST_LIGHT = '2026-07-25T08:30:00';

    it('does NOT invite on the tick 30 minutes after the event ended', async () => {
        const env = createMockEnv();
        // Jul 26 03:00Z — the run that actually misfired in production.
        const now = Date.parse('2026-07-26T03:00:00Z');
        env.DB.__on(SELECT, { results: [candidate('bk_ll', { event_date_iso: LAST_LIGHT })] }, 'all');
        const out = await runReviewInviteSweep(env, { now });
        expect(out.considered).toBe(0);
        expect(out.sent).toBe(0);
    });

    it('DOES invite on the following night, inside the real 18-48h window', async () => {
        const env = createMockEnv();
        const now = Date.parse('2026-07-27T03:00:00Z'); // ~24.5h after the true end
        env.DB.__on(SELECT, { results: [candidate('bk_ll', { event_date_iso: LAST_LIGHT })] }, 'all');
        env.DB.__on(CLAIM, { meta: { changes: 1 } }, 'run');
        const out = await runReviewInviteSweep(env, {
            now,
            sender: async () => ({ id: 'em_1' }),
        });
        expect(out.considered).toBe(1);
        expect(out.sent).toBe(1);
    });

    it('prefers end_date_iso over date_iso as the anchor (multi-day op)', async () => {
        const env = createMockEnv();
        // Fire Storm: starts 19:45 Jul 25, ENDS noon Jul 26. At this tick the
        // START is >18h old but the END is not — the end must win, or a
        // multi-day op gets invited while it is still running.
        const now = Date.parse('2026-07-26T21:00:00Z'); // 15:00 MDT Jul 26, 3h after ENDEX
        env.DB.__on(SELECT, {
            results: [candidate('bk_fs', {
                event_date_iso: '2026-07-25T19:45:00',
                event_end_date_iso: '2026-07-26T12:00:00',
            })],
        }, 'all');
        const out = await runReviewInviteSweep(env, { now });
        expect(out.considered).toBe(0); // only 3h past ENDEX — too soon
    });

    it('excludes a candidate whose anchor cannot be parsed', async () => {
        const env = createMockEnv();
        env.DB.__on(SELECT, {
            results: [candidate('bk_bad', { event_date_iso: '', event_end_date_iso: null })],
        }, 'all');
        const out = await runReviewInviteSweep(env, { now: NOW });
        expect(out.considered).toBe(0);
    });

    // Pacing had to ship WITH the timezone fix, not after it. The tz fix narrows
    // most events from two eligible nightly ticks to one, so a 429'd batch goes
    // from "retried tomorrow" to silently never sent. Production logged
    // considered:23 sent:13 failed:10 on 2026-07-26 from exactly this.
    it('paces between batches so a burst does not trip the ~10rps limit', async () => {
        vi.useFakeTimers();
        try {
            const env = createMockEnv();
            const results = Array.from({ length: 25 }, (_, i) => candidate(`bk_${i}`));
            env.DB.__on(SELECT, { results }, 'all');
            env.DB.__on(CLAIM, { meta: { changes: 1 } }, 'run');

            const sendTimes = [];
            const promise = runReviewInviteSweep(env, {
                now: NOW,
                sender: async () => { sendTimes.push(Date.now()); return { id: 'em' }; },
            });
            await vi.runAllTimersAsync();
            const out = await promise;

            expect(out.sent).toBe(25);
            // 25 candidates → 3 groups of 10/10/5, so two inter-batch gaps.
            const distinct = [...new Set(sendTimes)];
            expect(distinct).toHaveLength(3);
            expect(distinct[1] - distinct[0]).toBeGreaterThanOrEqual(1000);
            expect(distinct[2] - distinct[1]).toBeGreaterThanOrEqual(1000);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not pace when everything fits in one batch', async () => {
        const env = createMockEnv();
        env.DB.__on(SELECT, { results: [candidate('bk_1'), candidate('bk_2')] }, 'all');
        env.DB.__on(CLAIM, { meta: { changes: 1 } }, 'run');
        const started = Date.now();
        const out = await runReviewInviteSweep(env, {
            now: NOW,
            sender: async () => ({ id: 'em' }),
        });
        expect(out.sent).toBe(2);
        expect(Date.now() - started).toBeLessThan(1000); // no sleep on a single group
    });
});

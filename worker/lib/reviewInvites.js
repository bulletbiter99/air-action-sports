// Post-event "rate your game" invite sweep (attendee-verified reviews, 0077).
//
// Runs on the 03:00 UTC nightly cron. ~24h after an event ends, each paid/comp
// booking is emailed a unique link carrying an unguessable per-booking
// review_token — possessing the link IS proof of attendance. Submitting the
// review (Batch 3) auto-publishes it.
//
// Modeled on runReminderSweepWindow (worker/index.js): SENTINEL-FIRST claim
// (stamp review_invite_sent_at + mint review_token BEFORE sending; roll BOTH
// back if the send fails OR the sender declines, so the next night retries with
// a fresh token), small parallel batches, LIMIT. Migration 0077 (the columns +
// the review_invite template) must be applied before this does anything useful.
//
// ── BLAST PROTECTION (no historical mass-email on first deploy) ──
//   1. WINDOW (primary): we only ever select events whose end anchor is in
//      [now-48h, now-18h]. Historical events ended long before that, so they are
//      NEVER candidates — this alone bounds every run to just-ended events.
//   2. LAUNCH CUTOFF (env REVIEW_LAUNCH_CUTOFF_MS): a forward-only floor — only
//      events that ended on/after this instant are invited. Changeable without a
//      code deploy (wrangler.toml [vars]).
//   3. PER-RUN HARD CAP = LIMIT (default 100): at most LIMIT invites go out in
//      one run; any remainder rolls to the next night (its sentinel stays NULL).
//      So the maximum possible emails/run is bounded regardless of data.
//   A SOFT ALARM (REVIEW_INVITE_SOFT_ALARM) just LOGS when a run is unusually
//      large so the operator notices a possible misconfig — it does NOT abort.
//      (An earlier design hard-aborted on >25 candidates; that was dropped: a
//      single popular event with >25 bookings all end at once, so an abort would
//      stall that event's invites forever — the opposite of the goal.)
//
// Anchor = COALESCE(end_date_iso, date_iso): multi-day events (0076) anchor on
// span END; single-day events fall back to date_iso (the START — date_iso is
// timezone-naive and unixepoch() reads it as UTC; AAS is Mountain UTC-6/-7).
// The wide 18-48h window comfortably clears late same-day finishes + that skew,
// so the nudge can be up to a day late — fine for a "rate your game" email.

import { sendReviewInvite } from './emailSender.js';
import { reviewToken } from './ids.js';

const H = 60 * 60 * 1000;
const WINDOW_FLOOR_H = 18;   // newest edge: event ended >=18h ago
const WINDOW_CEIL_H = 48;    // oldest edge: event ended <=48h ago
const LIMIT_DEFAULT = 100;   // per-run hard cap on sends; the rest roll to next night

// Forward-only launch fence (default = 2026-06-28, the feature-launch day).
// Verified: 1782604800000 ms = 2026-06-28T00:00:00Z. Overridable via the
// REVIEW_LAUNCH_CUTOFF_MS [vars] entry in wrangler.toml without a code deploy.
export const DEFAULT_LAUNCH_CUTOFF_MS = 1782604800000;

// Purely diagnostic: a run larger than this logs a loud warning (possible
// cutoff misconfig) but still processes normally. NOT an abort.
export const REVIEW_INVITE_SOFT_ALARM = 25;

function launchCutoff(env) {
    const raw = Number(env?.REVIEW_LAUNCH_CUTOFF_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LAUNCH_CUTOFF_MS;
}

function siteUrl(env) {
    return env?.SITE_URL || 'https://airactionsport.com';
}

// opts.now / opts.sender / opts.limit are injectable for deterministic tests;
// production calls runReviewInviteSweep(env) and gets Date.now() + the real sender.
export async function runReviewInviteSweep(env, { now = Date.now(), sender = sendReviewInvite, limit = LIMIT_DEFAULT } = {}) {
    const startedAt = now;
    const windowStart = now - WINDOW_CEIL_H * H;   // oldest event end we still invite
    const windowEnd = now - WINDOW_FLOOR_H * H;     // newest event end we invite
    const cutoff = launchCutoff(env);

    let rows;
    try {
        rows = await env.DB.prepare(
            `SELECT b.id, b.email, b.full_name, b.event_id,
                    e.title AS event_title, e.display_date AS event_display_date
             FROM bookings b
             JOIN events e ON e.id = b.event_id
             WHERE b.status IN ('paid', 'comp')
               AND b.review_invite_sent_at IS NULL
               AND b.email IS NOT NULL AND b.email != ''
               AND (unixepoch(COALESCE(e.end_date_iso, e.date_iso)) * 1000) BETWEEN ? AND ?
               AND (unixepoch(COALESCE(e.end_date_iso, e.date_iso)) * 1000) >= ?
             LIMIT ?`
        ).bind(windowStart, windowEnd, cutoff, limit).all();
    } catch (err) {
        return { considered: 0, sent: 0, failed: 0, skipped: 0, deferred: 0, error: err?.message, durationMs: Date.now() - startedAt };
    }

    const candidates = rows?.results || [];
    const alarm = candidates.length > REVIEW_INVITE_SOFT_ALARM;
    if (alarm) {
        console.warn(
            `review-invite sweep: ${candidates.length} candidates this run (>${REVIEW_INVITE_SOFT_ALARM}). ` +
            `Sending up to LIMIT=${limit}; any remainder rolls to the next night. ` +
            'If unexpected, check REVIEW_LAUNCH_CUTOFF_MS.'
        );
    }

    const result = { considered: candidates.length, sent: 0, failed: 0, skipped: 0, deferred: 0, alarm };

    async function rollback(id, stampedAt) {
        try {
            await env.DB.prepare(
                `UPDATE bookings SET review_invite_sent_at = NULL, review_token = NULL
                 WHERE id = ? AND review_invite_sent_at = ?`
            ).bind(id, stampedAt).run();
        } catch (rollbackErr) {
            console.error('review-invite sentinel rollback failed for', id, rollbackErr);
        }
    }

    async function processOne(r) {
        const stampedAt = Date.now();
        const token = reviewToken();
        try {
            // Sentinel-first: claim (stamp sentinel + mint token) BEFORE sending.
            // A concurrent run that already claimed it gets changes=0 → skip.
            const claimed = await env.DB.prepare(
                `UPDATE bookings SET review_invite_sent_at = ?, review_token = ?
                 WHERE id = ? AND review_invite_sent_at IS NULL`
            ).bind(stampedAt, token, r.id).run();
            if (!claimed.meta?.changes) { result.skipped += 1; return 'skipped'; }

            const outcome = await sender(env, {
                booking: { id: r.id, full_name: r.full_name, email: r.email },
                event: { title: r.event_title, display_date: r.event_display_date },
                reviewLink: `${siteUrl(env)}/review?token=${token}`,
            });

            // The sender DECLINED (template missing/draft, or no email) — no mail
            // went out. Roll the sentinel back so a later run retries once the
            // template is live, instead of silently burning the invite.
            if (outcome && outcome.skipped) {
                await rollback(r.id, stampedAt);
                result.deferred += 1;
                return 'deferred';
            }

            // Success-path audit is BEST-EFFORT in its own try/catch: an audit
            // write failure must NEVER roll back an email that already went out
            // (that would re-send a duplicate next night + break the first link).
            result.sent += 1;
            try {
                await env.DB.prepare(
                    `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
                     VALUES (NULL, 'review_invite.sent', 'booking', ?, ?, ?)`
                ).bind(r.id, JSON.stringify({ to: r.email, event_id: r.event_id }), stampedAt).run();
            } catch (auditErr) {
                console.error('review-invite audit insert failed for', r.id, auditErr);
            }
            return 'sent';
        } catch (err) {
            console.error('review-invite send failed for booking', r.id, err);
            // The send threw — roll BOTH columns back so the next night retries
            // with a fresh token. The old (undelivered) token can no longer
            // resolve: /context looks up by the booking's CURRENT review_token.
            await rollback(r.id, stampedAt);
            result.failed += 1;
            return 'failed';
        }
    }

    // Small parallel batches — Resend rate limits ~10rps; D1 handles the concurrency.
    const BATCH = 10;
    for (let i = 0; i < candidates.length; i += BATCH) {
        await Promise.allSettled(candidates.slice(i, i + BATCH).map(processOne));
    }

    result.durationMs = Date.now() - startedAt;
    return result;
}

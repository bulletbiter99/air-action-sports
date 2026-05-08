// M5 R9 — event staffing helpers + reminder cron sweep.
//
// Pure helpers (windowLabelForReminder, hoursUntilEvent, isPastEvent) are
// exported for testability. I/O wrappers (runEventStaffingReminderSweep,
// runEventStaffingAutoDeclineSweep) consume env.DB + env.RESEND_API_KEY.
//
// Reminder buckets are non-overlapping: a staffer 75 hours out is in the
// 3d bucket, not the 7d. The event_staffing_reminders table acts as the
// idempotency sentinel — UNIQUE(event_staffing_id, window_label) ensures
// each window fires at most once.

import { loadTemplate, renderTemplate } from './templates.js';
import { sendEmail } from './email.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Hours from `now` until the event starts (or negative if started).
 */
export function hoursUntilEvent(eventStartMs, now = Date.now()) {
    if (eventStartMs == null) return null;
    return (eventStartMs - now) / HOUR_MS;
}

/**
 * Whether `now` is past the event's start. Used by the auto-decline sweep
 * to flip lingering 'pending' staff assignments to 'declined' when the
 * event has actually happened.
 */
export function isPastEvent(eventStartMs, now = Date.now()) {
    if (eventStartMs == null) return false;
    return now > eventStartMs;
}

/**
 * Map an "hours until event" value to a reminder window label.
 *
 * Buckets (non-overlapping, biased toward earlier reminders):
 *   - 7d: 96 < hours <= 168 (4-7 days out)
 *   - 3d: 48 < hours <= 96 (2-4 days out)
 *   - 1d: 12 < hours <= 48 (12-48 hours out)
 *   - day_of: 0 < hours <= 12 (within 12 hours)
 *
 * Anything outside these windows or in the past returns null.
 */
export function windowLabelForReminder(hoursUntil) {
    if (hoursUntil == null) return null;
    if (hoursUntil <= 0) return null;
    if (hoursUntil <= 12) return 'day_of';
    if (hoursUntil <= 48) return '1d';
    if (hoursUntil <= 96) return '3d';
    if (hoursUntil <= 168) return '7d';
    return null;
}

/**
 * Map a reminder window label to the audit-action / email-template slug.
 * day_of uses the same template as 1d ('event_staff_reminder') with a
 * different rendered subject/body via the same vars set.
 */
export function templateSlugForWindow(label) {
    if (label === '7d' || label === '3d' || label === '1d' || label === 'day_of') {
        return 'event_staff_reminder';
    }
    return null;
}

// ────────────────────────────────────────────────────────────────────
// I/O — reminder cron sweep
// ────────────────────────────────────────────────────────────────────

/**
 * Send a single staff reminder email. Uses event_staff_reminder
 * template with vars from the event_staffing row + linked event/person.
 *
 * Returns { skipped: 'reason' } on missing template/email, or the
 * Resend response on success.
 */
async function sendStaffReminder(env, { row, label }) {
    if (!row.person_email) return { skipped: 'no_recipient_email' };
    const template = await loadTemplate(env.DB, 'event_staff_reminder');
    if (!template) return { skipped: 'template_missing' };

    const vars = {
        personName: row.person_name || 'there',
        eventTitle: row.event_title,
        eventDate: row.event_display_date || (row.event_date_iso || '').slice(0, 10),
        roleName: row.role_name,
        windowLabel: label === 'day_of' ? 'today' : (label === '1d' ? 'tomorrow' : `in ${label.replace('d', ' days')}`),
        shiftStartTime: row.shift_start_at ? new Date(row.shift_start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
    };
    const rendered = renderTemplate(template, vars);

    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.RESEND_FROM_EMAIL || 'no-reply@airactionsport.com',
        to: row.person_email,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: 'event_staff_reminder' },
            { name: 'window', value: label },
            { name: 'event_staffing_id', value: row.id },
        ],
    });
}

/**
 * Cron sweep: scans confirmed/pending event_staffing rows for events
 * starting within the next 7 days and sends reminders at the 7d/3d/1d/day_of
 * milestones. Idempotency via event_staffing_reminders rows
 * (UNIQUE(event_staffing_id, window_label)).
 */
export async function runEventStaffingReminderSweep(env) {
    const now = Date.now();
    const horizon = now + 7 * DAY_MS;

    // Pull every confirmed/pending assignment whose event is in the next 7d.
    // Per-row, decide which window to fire and check the sentinel.
    const rows = await env.DB.prepare(
        `SELECT es.*,
                p.full_name AS person_name, p.email AS person_email,
                r.name AS role_name,
                e.title AS event_title, e.display_date AS event_display_date,
                e.date_iso AS event_date_iso,
                (CASE
                    WHEN e.date_iso IS NOT NULL THEN unixepoch(e.date_iso) * 1000
                    ELSE NULL
                 END) AS event_start_ms
         FROM event_staffing es
         INNER JOIN persons p ON p.id = es.person_id
         INNER JOIN roles r ON r.id = es.role_id
         INNER JOIN events e ON e.id = es.event_id
         WHERE es.status IN ('pending', 'confirmed')
           AND p.archived_at IS NULL
           AND p.email IS NOT NULL AND p.email != ''
           AND e.date_iso IS NOT NULL
         LIMIT 500`,
    ).bind().all();

    const candidates = rows.results || [];
    const results = { sent7: 0, sent3: 0, sent1: 0, sentDayOf: 0, skipped: 0, failed: 0 };

    for (const row of candidates) {
        const startMs = row.event_start_ms ?? row.shift_start_at;
        const hours = hoursUntilEvent(startMs, now);
        if (hours == null || hours <= 0 || startMs > horizon) {
            results.skipped++;
            continue;
        }
        const label = windowLabelForReminder(hours);
        if (!label) {
            results.skipped++;
            continue;
        }

        // Check sentinel
        const existing = await env.DB.prepare(
            `SELECT 1 FROM event_staffing_reminders
             WHERE event_staffing_id = ? AND window_label = ?`,
        ).bind(row.id, label).first();
        if (existing) {
            results.skipped++;
            continue;
        }

        try {
            const sent = await sendStaffReminder(env, { row, label });
            if (sent?.skipped) {
                // Record as skipped in sentinel so we don't retry every tick.
                await env.DB.prepare(
                    `INSERT INTO event_staffing_reminders (id, event_staffing_id, window_label, sent_at, result)
                     VALUES (?, ?, ?, ?, ?)`,
                ).bind(`esr_${row.id}_${label}`, row.id, label, now, 'skipped').run().catch(() => {});
                results.skipped++;
                continue;
            }
            await env.DB.prepare(
                `INSERT INTO event_staffing_reminders (id, event_staffing_id, window_label, sent_at, result)
                 VALUES (?, ?, ?, ?, ?)`,
            ).bind(`esr_${row.id}_${label}`, row.id, label, now, 'sent').run();

            if (label === '7d') results.sent7++;
            else if (label === '3d') results.sent3++;
            else if (label === '1d') results.sent1++;
            else if (label === 'day_of') results.sentDayOf++;
        } catch (err) {
            console.error('event-staffing reminder failed', row.id, label, err);
            // Best-effort: record failure so we don't retry every tick.
            await env.DB.prepare(
                `INSERT INTO event_staffing_reminders (id, event_staffing_id, window_label, sent_at, result)
                 VALUES (?, ?, ?, ?, ?)`,
            ).bind(`esr_${row.id}_${label}`, row.id, label, now, 'failed').run().catch(() => {});
            results.failed++;
        }
    }

    return results;
}

/**
 * Cron sweep: flip 'pending' assignments to 'declined' once the event
 * has started (a non-response by event time is treated as a decline).
 *
 * Returns the number of rows auto-declined.
 */
export async function runEventStaffingAutoDeclineSweep(env) {
    const now = Date.now();
    const r = await env.DB.prepare(
        `UPDATE event_staffing
         SET status = 'declined', updated_at = ?
         WHERE status = 'pending'
           AND event_id IN (
               SELECT id FROM events WHERE date_iso IS NOT NULL AND unixepoch(date_iso) * 1000 < ?
           )`,
    ).bind(now, now).run();
    return { autoDeclined: r?.meta?.changes ?? 0 };
}

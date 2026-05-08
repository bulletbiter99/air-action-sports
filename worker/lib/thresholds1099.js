// M5 R11 — 1099 thresholds rollup helpers + nightly auto-lock cron sweep.
//
// IRS 1099-NEC threshold: $600 in 1099 payments per recipient per tax
// year. Below threshold: no 1099 needed. At/above: must file 1099-NEC
// by January 31 of the following year.
//
// Pure helpers (requires1099, formatIrs1099Csv, formatGenericCsv,
// previousTaxYear, shouldAutoLockToday) are exported for testability.
// I/O wrappers (aggregate1099TotalsForYear, getYearLock, lockTaxYear)
// consume env.DB. The cron sweep (runTaxYearAutoLockSweep) auto-locks
// the previous tax year on March 1 and dispatches w9_reminder emails
// to threshold-meeting recipients missing EIN/legal_name.
//
// The route worker/routes/admin/thresholds1099.js consumes the helpers.

import { writeAudit } from './auditLog.js';
import { loadTemplate, renderTemplate } from './templates.js';
import { sendEmail } from './email.js';

export const IRS_1099_THRESHOLD_CENTS = 600_00;

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Returns true iff a recipient's 1099 total for the year requires a
 * 1099-NEC filing. Boundary is inclusive: 600.00 USD requires.
 *
 * @param {number} totalCents
 * @returns {boolean}
 */
export function requires1099(totalCents) {
    return Number(totalCents || 0) >= IRS_1099_THRESHOLD_CENTS;
}

/**
 * Returns the previous tax year (filing year) given a moment in time.
 * In May 2026 we are filing for tax year 2025. Always one less than
 * the calendar year of `now` (UTC).
 *
 * @param {number|Date} now - epoch ms or Date
 * @returns {number}
 */
export function previousTaxYear(now = Date.now()) {
    const d = now instanceof Date ? now : new Date(now);
    return d.getUTCFullYear() - 1;
}

/**
 * The auto-lock cron fires on March 1 (UTC) or any day after in March.
 * Locks the previous tax year if not yet locked manually. Idempotent:
 * the cron checks the existing lock before inserting.
 *
 * Returns true for any UTC day in March or later (Jan-Feb returns
 * false). The "or later" accommodates the rare case where the cron
 * misses March 1 — e.g., a Workers outage — and runs March 2-15.
 *
 * Why not strictly March 1? Strict equality risks missing the lock
 * window if the daily 03:00 UTC cron fails to fire that exact day. The
 * lock is idempotent (existing-lock check) so re-running is free.
 *
 * @param {number|Date} now
 * @returns {boolean}
 */
export function shouldAutoLockToday(now = Date.now()) {
    const d = now instanceof Date ? now : new Date(now);
    return d.getUTCMonth() >= 2; // March = 2 (0-indexed)
}

/**
 * Format a rollup row array as IRS-compatible CSV. The IRS 1099-NEC
 * box layout uses these fields per recipient. Empty EIN / legal_name
 * cells are intentional — bookkeeper sees the gap and follows up.
 *
 * @param {Array<{personId, fullName, legalName, ein, email, total1099Cents}>} rollup
 * @returns {string}
 */
export function formatIrs1099Csv(rollup) {
    const headers = ['Person ID', 'Full Name', 'Legal Name', 'EIN', 'Email', '1099 Total (USD)', 'Requires 1099-NEC'];
    const lines = [headers.join(',')];
    for (const r of rollup || []) {
        const totalCents = Number(r.total1099Cents || 0);
        const totalUsd = (totalCents / 100).toFixed(2);
        lines.push([
            csvEscape(r.personId),
            csvEscape(r.fullName),
            csvEscape(r.legalName),
            csvEscape(r.ein),
            csvEscape(r.email),
            totalUsd,
            requires1099(totalCents) ? 'YES' : 'no',
        ].join(','));
    }
    return lines.join('\n');
}

/**
 * Generic CSV format including W-2 totals and entry counts for the
 * bookkeeper's broader review. Differs from IRS export by including
 * non-1099 fields and unpaid-entry counts so the bookkeeper can spot
 * data-quality issues before lock.
 *
 * @param {Array} rollup - same shape as aggregate1099TotalsForYear output
 * @returns {string}
 */
export function formatGenericCsv(rollup) {
    const headers = [
        'Person ID', 'Full Name', 'Legal Name', 'EIN', 'Email',
        '1099 Total (USD)', 'W-2 Total (USD)', 'Entry Count',
        'Unpaid Count', 'Requires 1099-NEC',
    ];
    const lines = [headers.join(',')];
    for (const r of rollup || []) {
        const totalCents = Number(r.total1099Cents || 0);
        lines.push([
            csvEscape(r.personId),
            csvEscape(r.fullName),
            csvEscape(r.legalName),
            csvEscape(r.ein),
            csvEscape(r.email),
            (totalCents / 100).toFixed(2),
            (Number(r.totalW2Cents || 0) / 100).toFixed(2),
            Number(r.entryCount || 0),
            Number(r.unpaidCount || 0),
            requires1099(totalCents) ? 'YES' : 'no',
        ].join(','));
    }
    return lines.join('\n');
}

// CSV-escape: wrap in double-quotes; double-up internal quotes; coerce
// null/undefined to empty.
function csvEscape(s) {
    return `"${String(s ?? '').replace(/"/g, '""')}"`;
}

// ────────────────────────────────────────────────────────────────────
// I/O wrappers
// ────────────────────────────────────────────────────────────────────

/**
 * Aggregate paid 1099 entries per person for a given tax year. Mirrors
 * the SQL the route's GET / endpoint issued before this lib existed.
 *
 * @param {object} env
 * @param {number} taxYear
 * @returns {Promise<Array>}
 */
export async function aggregate1099TotalsForYear(env, taxYear) {
    const rows = await env.DB.prepare(
        `SELECT le.person_id, p.full_name, p.email, p.legal_name, p.ein,
                SUM(CASE WHEN le.pay_kind LIKE '1099%' THEN le.amount_cents ELSE 0 END) AS total_1099_cents,
                SUM(CASE WHEN le.pay_kind = 'w2_hourly' OR le.pay_kind = 'w2_salary' THEN le.amount_cents ELSE 0 END) AS total_w2_cents,
                COUNT(le.id) AS entry_count,
                MIN(le.worked_at) AS first_entry_at,
                MAX(le.worked_at) AS last_entry_at,
                COUNT(CASE WHEN le.paid_at IS NULL THEN 1 END) AS unpaid_count
         FROM labor_entries le
         INNER JOIN persons p ON p.id = le.person_id
         WHERE le.tax_year = ?
           AND p.archived_at IS NULL
         GROUP BY le.person_id, p.full_name, p.email, p.legal_name, p.ein
         ORDER BY total_1099_cents DESC`,
    ).bind(taxYear).all();

    return (rows.results || []).map((r) => ({
        personId: r.person_id,
        fullName: r.full_name,
        email: r.email,
        legalName: r.legal_name,
        ein: r.ein,
        total1099Cents: r.total_1099_cents || 0,
        totalW2Cents: r.total_w2_cents || 0,
        entryCount: r.entry_count,
        firstEntryAt: r.first_entry_at,
        lastEntryAt: r.last_entry_at,
        unpaidCount: r.unpaid_count,
        requires1099: requires1099(r.total_1099_cents),
    }));
}

/**
 * Returns the lock row for a tax year, or null if not locked.
 */
export async function getYearLock(env, taxYear) {
    return env.DB.prepare(
        'SELECT tax_year, locked_at, locked_reason FROM tax_year_locks WHERE tax_year = ?'
    ).bind(taxYear).first();
}

/**
 * Insert a tax_year_locks row + write the audit_log entry. Snapshots
 * year totals at lock time. Caller must handle the 409-already-locked
 * check upstream (via getYearLock).
 *
 * `reason` is bound positionally (lessons-learned #3) — tests assert
 * `expect(args).toContain('auto_march_1')` against the writeLog.
 *
 * `userId` may be null for cron-driven auto-locks; the audit action
 * key flips to `tax_year.auto_locked` in that case.
 *
 * @param {object} env
 * @param {{taxYear, userId, reason, notes?}} opts
 */
export async function lockTaxYear(env, { taxYear, userId, reason, notes }) {
    const totals = await env.DB.prepare(
        `SELECT
           SUM(CASE WHEN pay_kind = 'w2_hourly' OR pay_kind = 'w2_salary' THEN amount_cents ELSE 0 END) AS w2,
           SUM(CASE WHEN pay_kind LIKE '1099%' THEN amount_cents ELSE 0 END) AS k1099
         FROM labor_entries WHERE tax_year = ?`,
    ).bind(taxYear).first();

    const now = Date.now();
    await env.DB.prepare(
        `INSERT INTO tax_year_locks (tax_year, locked_at, locked_by_user_id, locked_reason,
                                      total_w2_cents, total_1099_cents, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
        taxYear, now, userId, reason,
        totals?.w2 || 0, totals?.k1099 || 0,
        notes || null,
    ).run();

    await writeAudit(env, {
        userId,
        action: userId ? 'tax_year.locked' : 'tax_year.auto_locked',
        targetType: 'tax_year',
        targetId: String(taxYear),
        meta: {
            totals_w2_cents: totals?.w2 || 0,
            totals_1099_cents: totals?.k1099 || 0,
            reason,
        },
    });

    return {
        ok: true,
        taxYear,
        totals: { w2: totals?.w2 || 0, k1099: totals?.k1099 || 0 },
    };
}

// ────────────────────────────────────────────────────────────────────
// Cron sweep
// ────────────────────────────────────────────────────────────────────

/**
 * Send a single w9_reminder email. Recipient hit 1099 threshold but
 * lacks legal_name or EIN, so cannot be 1099-NEC'd cleanly.
 *
 * Returns { skipped: 'reason' } if anything is missing, or the Resend
 * response object.
 */
async function sendW9Reminder(env, { recipient, taxYear }) {
    if (!recipient.email) return { skipped: 'no_recipient_email' };

    const template = await loadTemplate(env.DB, 'w9_reminder');
    if (!template) return { skipped: 'template_missing' };

    const totalUsd = (Number(recipient.total_1099_cents || 0) / 100).toFixed(2);
    const vars = {
        personName: recipient.full_name || 'there',
        taxYear: String(taxYear),
        total1099Display: `$${totalUsd}`,
        requiredBy: `January 31, ${taxYear + 1}`,
    };
    const rendered = renderTemplate(template, vars);

    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.RESEND_FROM_EMAIL || env.FROM_EMAIL || 'no-reply@airactionsport.com',
        to: recipient.email,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: 'w9_reminder' },
            { name: 'person_id', value: recipient.person_id },
            { name: 'tax_year', value: String(taxYear) },
        ],
    });
}

/**
 * Cron sweep: scans the previous tax year and (a) sends w9_reminder
 * emails to recipients above the 1099 threshold who still lack
 * legal_name or EIN, and (b) auto-locks the year on March 1+ if not
 * already locked manually.
 *
 * Idempotency:
 *   - w9 reminders: each successful send writes an audit_log row with
 *     action='tax_year.w9_reminder_sent' keyed on `${person_id}:${tax_year}`.
 *     Subsequent sweeps skip recipients whose sentinel exists.
 *   - auto-lock: getYearLock checked before insert; existing lock skips.
 *
 * Runs on the 03:00 UTC nightly cron alongside customer-tag, cert-
 * expiration, and event-staffing-reminder sweeps.
 *
 * @param {object} env
 * @param {number} now - epoch ms (default Date.now()); injected for testability
 * @returns {Promise<{autoLocked: 0|1, w9RemindersSent: number, w9RemindersFailed: number}>}
 */
export async function runTaxYearAutoLockSweep(env, now = Date.now()) {
    const prevYear = previousTaxYear(now);
    const result = { autoLocked: 0, w9RemindersSent: 0, w9RemindersFailed: 0 };

    // ─── W-9 reminders for threshold-meeting recipients missing
    //     legal_name or EIN. Run year-round so reminders go out as
    //     people cross the threshold, not only at lock time.
    const candidates = await env.DB.prepare(
        `SELECT le.person_id, p.full_name, p.email, p.legal_name, p.ein,
                SUM(CASE WHEN le.pay_kind LIKE '1099%' THEN le.amount_cents ELSE 0 END) AS total_1099_cents
         FROM labor_entries le
         INNER JOIN persons p ON p.id = le.person_id
         WHERE le.tax_year = ?
           AND p.archived_at IS NULL
           AND p.email IS NOT NULL AND p.email != ''
           AND (p.legal_name IS NULL OR p.legal_name = '' OR p.ein IS NULL OR p.ein = '')
         GROUP BY le.person_id
         HAVING total_1099_cents >= ?
         LIMIT 100`,
    ).bind(prevYear, IRS_1099_THRESHOLD_CENTS).all();

    for (const recipient of (candidates.results || [])) {
        const sentinelTargetId = `${recipient.person_id}:${prevYear}`;
        const alreadySent = await env.DB.prepare(
            `SELECT 1 FROM audit_log
             WHERE target_type = 'tax_year'
               AND target_id = ?
               AND action = ?`,
        ).bind(sentinelTargetId, 'tax_year.w9_reminder_sent').first();
        if (alreadySent) continue;

        try {
            const sent = await sendW9Reminder(env, { recipient, taxYear: prevYear });
            if (sent?.skipped) {
                result.w9RemindersFailed++;
                continue;
            }
            await env.DB.prepare(
                `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
                 VALUES (NULL, ?, ?, ?, ?, ?)`,
            ).bind(
                'tax_year.w9_reminder_sent',
                'tax_year',
                sentinelTargetId,
                JSON.stringify({
                    to: recipient.email,
                    total1099Cents: recipient.total_1099_cents,
                    taxYear: prevYear,
                }),
                now,
            ).run();
            result.w9RemindersSent++;
        } catch (err) {
            console.error('w9 reminder failed', recipient.person_id, err);
            result.w9RemindersFailed++;
        }
    }

    // ─── Auto-lock previous tax year on March 1+ if not yet locked.
    if (!shouldAutoLockToday(now)) return result;

    const existingLock = await getYearLock(env, prevYear);
    if (existingLock) return result;

    try {
        await lockTaxYear(env, {
            taxYear: prevYear,
            userId: null,
            reason: 'auto_march_1',
            notes: `Auto-locked by tax-year-auto-lock sweep on ${new Date(now).toISOString()}`,
        });
        result.autoLocked = 1;
    } catch (err) {
        console.error('tax-year auto-lock failed', prevYear, err);
    }

    return result;
}

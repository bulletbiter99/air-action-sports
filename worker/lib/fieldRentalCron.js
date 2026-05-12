// M5.5 Batch 10b — COI expiration + lead-stale nightly cron sweeps.
//
// Both sweeps are staff-facing only (operator-confirmed plan-mode #1+#2).
// Recipient resolution: rental's assigned aas_site_coordinator_person_id
// (looked up to their persons.email), falling back to env.ADMIN_NOTIFY_EMAIL.
//
// COI expiration sweep
// ────────────────────────────────────────────────────────────────────
// Uses non-overlapping 60d / 30d / 7d buckets, mirroring the M5 R8
// certifications.js pattern. Sentinels live on the rental row itself
// (coi_alert_60d/30d/7d_sent_at — pre-seeded in migration 0047). Each
// rental gets at most one alert per milestone.
//
// Filter: coi_status='received' AND coi_expires_at is in the bucket
// window AND the corresponding sentinel IS NULL AND archived_at IS NULL
// AND cancelled_at IS NULL.
//
// Lead-stale sweep
// ────────────────────────────────────────────────────────────────────
// Threshold: 14 days idle (status IN ('lead','draft') AND
// updated_at < now - 14*86400000). Re-notify cadence: 7 days
// (lead_stale_at IS NULL OR lead_stale_at < now - 7*86400000).
// After alert, set lead_stale_at = now.
//
// Per plan-mode #5, /status route does NOT clear lead_stale_at on
// transition — a revert-to-draft has 7-day silence before re-alerting.
// Operator can manually clear via SQL if a fresh alert is wanted.

import { sendCoiAlert, sendLeadStaleAlert } from './emailSender.js';
import { writeAudit } from './auditLog.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const LEAD_STALE_THRESHOLD_DAYS = 14;
const LEAD_STALE_RENOTIFY_DAYS = 7;

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Classify a rental's coi_expires_at into a notification bucket.
 * Buckets are non-overlapping: a rental at 25 days out is "30d",
 * not "60d". Returns 60 / 30 / 7 / null.
 */
export function classifyCoiBucket(expiresAt, now = Date.now()) {
    if (expiresAt == null || !Number.isFinite(Number(expiresAt))) return null;
    const diffMs = Number(expiresAt) - now;
    if (diffMs < 0) return null; // already expired — no future alert (B10b scope)
    const days = diffMs / DAY_MS;
    if (days <= 7) return 7;
    if (days <= 30) return 30;
    if (days <= 60) return 60;
    return null;
}

/**
 * Map a bucket integer to the corresponding `coi_alert_{N}d_sent_at`
 * column name. Used by the sweep to check + update the right sentinel.
 */
export function bucketSentinelColumn(bucket) {
    if (bucket === 60) return 'coi_alert_60d_sent_at';
    if (bucket === 30) return 'coi_alert_30d_sent_at';
    if (bucket === 7) return 'coi_alert_7d_sent_at';
    return null;
}

/**
 * Map a bucket to the audit_log action used per alert.
 */
export function bucketAuditAction(bucket) {
    if (bucket === 60) return 'field_rental.coi_alert.60d';
    if (bucket === 30) return 'field_rental.coi_alert.30d';
    if (bucket === 7) return 'field_rental.coi_alert.7d';
    return null;
}

/**
 * Floor div: integer days between now and a past timestamp.
 */
export function daysSince(timestampMs, now = Date.now()) {
    if (timestampMs == null || !Number.isFinite(Number(timestampMs))) return 0;
    return Math.floor((now - Number(timestampMs)) / DAY_MS);
}

/**
 * True if a rental's lead-stale state warrants an alert this run.
 * - status must be 'lead' or 'draft'
 * - updated_at must be older than 14 days ago
 * - lead_stale_at must be NULL OR older than 7 days ago (re-notify cadence)
 */
export function shouldAlertLeadStale(rental, now = Date.now()) {
    if (!rental || typeof rental !== 'object') return false;
    if (!['lead', 'draft'].includes(rental.status)) return false;
    const updatedAt = Number(rental.updated_at);
    if (!Number.isFinite(updatedAt)) return false;
    if (now - updatedAt < LEAD_STALE_THRESHOLD_DAYS * DAY_MS) return false;
    const lastAlerted = rental.lead_stale_at == null ? null : Number(rental.lead_stale_at);
    if (lastAlerted != null && Number.isFinite(lastAlerted)) {
        if (now - lastAlerted < LEAD_STALE_RENOTIFY_DAYS * DAY_MS) return false;
    }
    return true;
}

// ────────────────────────────────────────────────────────────────────
// Recipient resolution
// ────────────────────────────────────────────────────────────────────

/**
 * Resolve the email recipient for a rental alert:
 *   1. If aas_site_coordinator_person_id is set AND persons row exists
 *      AND that row has an email → use it.
 *   2. Else fall back to env.ADMIN_NOTIFY_EMAIL.
 *   3. If neither exists → returns null (caller skips and audits).
 *
 * Exported for testing.
 */
export async function resolveAlertRecipient(env, rental) {
    if (rental?.aas_site_coordinator_person_id) {
        try {
            const person = await env.DB.prepare(
                `SELECT email FROM persons WHERE id = ?`,
            ).bind(rental.aas_site_coordinator_person_id).first();
            if (person?.email) return person.email;
        } catch {
            // persons table missing or query failure → fall through
        }
    }
    return env.ADMIN_NOTIFY_EMAIL || null;
}

// ────────────────────────────────────────────────────────────────────
// COI expiration sweep
// ────────────────────────────────────────────────────────────────────

/**
 * Look up the rental's customer name + site name (small JOIN-style
 * follow-up). Both used only for template substitution.
 */
async function fetchRentalContext(env, rental) {
    let customerName = 'unknown';
    let siteName = 'site';
    try {
        const cus = await env.DB.prepare(
            `SELECT name FROM customers WHERE id = ?`,
        ).bind(rental.customer_id).first();
        if (cus?.name) customerName = cus.name;
    } catch {
        // customers row missing — leave default
    }
    try {
        const site = await env.DB.prepare(
            `SELECT name FROM sites WHERE id = ?`,
        ).bind(rental.site_id).first();
        if (site?.name) siteName = site.name;
    } catch {
        // sites row missing — leave default
    }
    return { customerName, siteName };
}

/**
 * Nightly sweep — see file header for full contract.
 *
 * @param {object} env - Worker env (env.DB + env.RESEND_API_KEY + env.ADMIN_NOTIFY_EMAIL)
 * @returns {Promise<{ sent60: number, sent30: number, sent7: number, failed: number, durationMs: number }>}
 */
export async function runCoiExpirationSweep(env) {
    const t0 = Date.now();
    let sent60 = 0;
    let sent30 = 0;
    let sent7 = 0;
    let failed = 0;

    let rentals;
    try {
        // Pull every candidate row in one query. The bucket WHERE filter
        // is applied in JS so we can use one SQL statement instead of
        // three; the table is small enough today that this is fine.
        const res = await env.DB.prepare(
            `SELECT id, customer_id, site_id, scheduled_starts_at, coi_expires_at,
                    coi_alert_60d_sent_at, coi_alert_30d_sent_at, coi_alert_7d_sent_at,
                    aas_site_coordinator_person_id
             FROM field_rentals
             WHERE coi_status = 'received'
               AND archived_at IS NULL
               AND cancelled_at IS NULL
               AND coi_expires_at IS NOT NULL
               AND coi_expires_at > ?
               AND coi_expires_at < ?`,
        ).bind(t0, t0 + 60 * DAY_MS + DAY_MS).all();
        rentals = res.results || [];
    } catch {
        return { sent60: 0, sent30: 0, sent7: 0, failed: 0, durationMs: Date.now() - t0 };
    }

    for (const rental of rentals) {
        const bucket = classifyCoiBucket(rental.coi_expires_at, t0);
        if (bucket == null) continue;
        const sentinelCol = bucketSentinelColumn(bucket);
        if (!sentinelCol) continue;
        if (rental[sentinelCol] != null) continue; // already alerted

        const recipient = await resolveAlertRecipient(env, rental);
        if (!recipient) {
            await writeAudit(env, {
                userId: null,
                action: 'field_rental.coi_alert_no_recipient',
                targetType: 'field_rental',
                targetId: rental.id,
                meta: { bucket },
            }).catch(() => {});
            failed++;
            continue;
        }

        const { customerName, siteName } = await fetchRentalContext(env, rental);
        const daysUntilExpiry = Math.max(0, Math.ceil((Number(rental.coi_expires_at) - t0) / DAY_MS));

        let result;
        try {
            result = await sendCoiAlert(env, {
                rental, bucket, recipient, customerName, siteName, daysUntilExpiry,
            });
        } catch (err) {
            failed++;
            await writeAudit(env, {
                userId: null,
                action: 'field_rental.coi_alert_failed',
                targetType: 'field_rental',
                targetId: rental.id,
                meta: { bucket, error: String(err?.message || err) },
            }).catch(() => {});
            continue;
        }

        if (result?.skipped === 'template_missing') {
            failed++;
            await writeAudit(env, {
                userId: null,
                action: 'field_rental.coi_alert_template_missing',
                targetType: 'field_rental',
                targetId: rental.id,
                meta: { bucket },
            }).catch(() => {});
            continue;
        }

        // Set the sentinel so we don't re-send for this bucket
        try {
            await env.DB.prepare(
                `UPDATE field_rentals SET ${sentinelCol} = ?, updated_at = ? WHERE id = ?`,
            ).bind(t0, t0, rental.id).run();
        } catch {
            // Sentinel update failure shouldn't unwind the send — next run will
            // try again, which is acceptable for an at-most-once-per-night cron.
        }

        await writeAudit(env, {
            userId: null,
            action: bucketAuditAction(bucket),
            targetType: 'field_rental',
            targetId: rental.id,
            meta: { recipient, daysUntilExpiry, coiExpiresAt: rental.coi_expires_at },
        }).catch(() => {});

        if (bucket === 60) sent60++;
        else if (bucket === 30) sent30++;
        else if (bucket === 7) sent7++;
    }

    return { sent60, sent30, sent7, failed, durationMs: Date.now() - t0 };
}

// ────────────────────────────────────────────────────────────────────
// Lead-stale sweep
// ────────────────────────────────────────────────────────────────────

/**
 * Nightly sweep — alert site coordinator (or ADMIN_NOTIFY_EMAIL) when
 * a rental sits in lead/draft for 14+ days without movement. Re-notify
 * every 7 days while stuck via the lead_stale_at sentinel column
 * (added in B10a's migration 0051).
 */
export async function runLeadStaleSweep(env) {
    const t0 = Date.now();
    let alerted = 0;
    let suppressed = 0;
    let failed = 0;

    const thresholdMs = t0 - LEAD_STALE_THRESHOLD_DAYS * DAY_MS;
    const renotifyCutoffMs = t0 - LEAD_STALE_RENOTIFY_DAYS * DAY_MS;

    let rentals;
    try {
        const res = await env.DB.prepare(
            `SELECT id, customer_id, status, updated_at, lead_stale_at,
                    aas_site_coordinator_person_id
             FROM field_rentals
             WHERE status IN ('lead', 'draft')
               AND archived_at IS NULL
               AND updated_at < ?
               AND (lead_stale_at IS NULL OR lead_stale_at < ?)`,
        ).bind(thresholdMs, renotifyCutoffMs).all();
        rentals = res.results || [];
    } catch {
        return { alerted: 0, suppressed: 0, failed: 0, durationMs: Date.now() - t0 };
    }

    for (const rental of rentals) {
        // Defensive double-check (in case the SQL filter window was loose
        // due to a clock drift / mocked-time test corner)
        if (!shouldAlertLeadStale(rental, t0)) {
            suppressed++;
            continue;
        }

        const recipient = await resolveAlertRecipient(env, rental);
        if (!recipient) {
            await writeAudit(env, {
                userId: null,
                action: 'field_rental.lead_stale_no_recipient',
                targetType: 'field_rental',
                targetId: rental.id,
                meta: { status: rental.status },
            }).catch(() => {});
            failed++;
            continue;
        }

        let customerName = 'unknown';
        try {
            const cus = await env.DB.prepare(
                `SELECT name FROM customers WHERE id = ?`,
            ).bind(rental.customer_id).first();
            if (cus?.name) customerName = cus.name;
        } catch {
            // ignore
        }

        const daysSinceLastUpdate = daysSince(rental.updated_at, t0);

        let result;
        try {
            result = await sendLeadStaleAlert(env, {
                rental, recipient, customerName, daysSinceLastUpdate,
            });
        } catch (err) {
            failed++;
            await writeAudit(env, {
                userId: null,
                action: 'field_rental.lead_stale_alert_failed',
                targetType: 'field_rental',
                targetId: rental.id,
                meta: { error: String(err?.message || err) },
            }).catch(() => {});
            continue;
        }

        if (result?.skipped === 'template_missing') {
            failed++;
            await writeAudit(env, {
                userId: null,
                action: 'field_rental.lead_stale_template_missing',
                targetType: 'field_rental',
                targetId: rental.id,
                meta: {},
            }).catch(() => {});
            continue;
        }

        // Bump the sentinel so we re-notify only after 7 more days
        try {
            await env.DB.prepare(
                `UPDATE field_rentals SET lead_stale_at = ?, updated_at = ? WHERE id = ?`,
            ).bind(t0, t0, rental.id).run();
        } catch {
            // Same as COI: sentinel update failure → at-most-once-per-night re-try OK
        }

        await writeAudit(env, {
            userId: null,
            action: 'field_rental.lead_stale_alert',
            targetType: 'field_rental',
            targetId: rental.id,
            meta: { recipient, status: rental.status, daysSinceLastUpdate },
        }).catch(() => {});

        alerted++;
    }

    return { alerted, suppressed, failed, durationMs: Date.now() - t0 };
}

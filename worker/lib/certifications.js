// M5 R8 — certification helpers + nightly expiration cron sweep.
//
// Pure helpers (classifyExpirationBucket, templateSlugForBucket,
// auditActionForBucket) are exported for testability. I/O wrappers
// (getCertsExpiringWithin, markRenewed, runCertExpirationSweep) consume
// env.DB and env.RESEND_API_KEY.
//
// The cron uses audit_log rows as the idempotency sentinel: a cert that
// has already received its 60d/30d/7d notification is filtered out by
// a NOT EXISTS subquery before sending. This avoids needing per-cert
// "last_notified_at" columns.

import { loadTemplate, renderTemplate } from './templates.js';
import { sendEmail } from './email.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Classify a cert's expiration into a notification bucket. Buckets are
 * non-overlapping (a cert at 25 days out is "30d", not "60d") so a cert
 * receives at most one warning per milestone window.
 *
 * @param {number|null} expiresAt - epoch ms; null/undefined → null bucket
 * @param {number} now - epoch ms current time (for testability)
 * @returns {'expiring_60d'|'expiring_30d'|'expiring_7d'|null}
 */
export function classifyExpirationBucket(expiresAt, now = Date.now()) {
    if (expiresAt == null) return null;
    const diffMs = expiresAt - now;
    if (diffMs < 0) return null; // already expired — no future warning
    const days = diffMs / DAY_MS;
    if (days <= 7) return 'expiring_7d';
    if (days <= 30) return 'expiring_30d';
    if (days <= 60) return 'expiring_60d';
    return null;
}

/**
 * Map a bucket name to the email-template slug seeded in
 * migrations/0039_cert_expiration_email_templates.sql.
 */
export function templateSlugForBucket(bucket) {
    if (bucket === 'expiring_60d') return 'cert_expiration_60d';
    if (bucket === 'expiring_30d') return 'cert_expiration_30d';
    if (bucket === 'expiring_7d') return 'cert_expiration_7d';
    return null;
}

/**
 * Map a bucket name to the audit_log action used as the cron sentinel.
 * If a row exists with this action + targetId, the cert has already
 * been notified for this milestone and the sweep skips it.
 */
export function auditActionForBucket(bucket) {
    if (bucket === 'expiring_60d') return 'certification.expiration_warning.60d';
    if (bucket === 'expiring_30d') return 'certification.expiration_warning.30d';
    if (bucket === 'expiring_7d') return 'certification.expiration_warning.7d';
    return null;
}

/**
 * Compute the time window [windowStart, windowEnd] for a bucket
 * relative to `now`. The cron's SQL filters certs with
 * expires_at BETWEEN windowStart AND windowEnd.
 */
export function bucketWindow(bucket, now = Date.now()) {
    if (bucket === 'expiring_60d') return { start: now + 30 * DAY_MS, end: now + 60 * DAY_MS };
    if (bucket === 'expiring_30d') return { start: now + 7 * DAY_MS, end: now + 30 * DAY_MS };
    if (bucket === 'expiring_7d') return { start: now, end: now + 7 * DAY_MS };
    return null;
}

// ────────────────────────────────────────────────────────────────────
// I/O wrappers
// ────────────────────────────────────────────────────────────────────

/**
 * Returns active, non-archived certifications expiring within `days`
 * along with the linked person's name + email. Mirrors the existing
 * GET /api/admin/certifications/expiring endpoint logic.
 */
export async function getCertsExpiringWithin(env, days = 60) {
    const cutoff = Date.now() + days * DAY_MS;
    const rows = await env.DB.prepare(
        `SELECT c.*, p.full_name AS person_name, p.email AS person_email
         FROM certifications c
         INNER JOIN persons p ON p.id = c.person_id
         WHERE c.status = 'active'
           AND c.expires_at IS NOT NULL
           AND c.expires_at < ?
           AND p.archived_at IS NULL
         ORDER BY c.expires_at`,
    ).bind(cutoff).all();
    return rows.results || [];
}

/**
 * Mark a cert as renewed: insert a new active cert row (chained via
 * previous_cert_id) and flip the old row's status to 'expired'.
 *
 * Pure I/O — caller is responsible for capability checks + audit log.
 *
 * @param {object} env
 * @param {string} prevCertId
 * @param {object} opts - { issuedAt?, expiresAt?, certificateNumber?, notes?, userId, newId }
 * @returns {Promise<{ ok: true, newId: string, previousCertId: string }>}
 */
export async function markRenewed(env, prevCertId, opts) {
    const { issuedAt, expiresAt, certificateNumber, notes, userId, newId } = opts;
    const prev = await env.DB.prepare('SELECT * FROM certifications WHERE id = ?').bind(prevCertId).first();
    if (!prev) throw new Error('previous cert not found');

    const now = Date.now();
    await env.DB.prepare(
        `INSERT INTO certifications (id, person_id, kind, display_name, certificate_number,
                                      issuing_authority, issued_at, expires_at,
                                      notes, status, added_by_user_id, added_at, updated_at,
                                      previous_cert_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    ).bind(
        newId, prev.person_id, prev.kind, prev.display_name,
        certificateNumber || prev.certificate_number, prev.issuing_authority,
        issuedAt || now, expiresAt || null, notes || prev.notes,
        userId, now, now, prevCertId,
    ).run();

    await env.DB.prepare(
        `UPDATE certifications SET status = 'expired', updated_at = ? WHERE id = ?`,
    ).bind(now, prevCertId).run();

    return { ok: true, newId, previousCertId: prevCertId };
}

// ────────────────────────────────────────────────────────────────────
// Cron sweep
// ────────────────────────────────────────────────────────────────────

/**
 * Send a single cert-expiration warning email. Uses the seeded email
 * template (cert_expiration_60d / 30d / 7d) and Resend.
 *
 * Returns { skipped: 'reason' } if anything is missing, or the Resend
 * response object.
 */
async function sendCertExpirationWarning(env, { cert, bucket }) {
    const slug = templateSlugForBucket(bucket);
    if (!slug) return { skipped: 'unknown_bucket' };
    if (!cert.person_email) return { skipped: 'no_recipient_email' };

    const template = await loadTemplate(env.DB, slug);
    if (!template) return { skipped: 'template_missing' };

    const vars = {
        personName: cert.person_name || 'there',
        certName: cert.display_name,
        certKind: cert.kind,
        expiresOn: cert.expires_at ? new Date(cert.expires_at).toLocaleDateString() : 'soon',
        issuingAuthority: cert.issuing_authority || 'the issuing authority',
    };
    const rendered = renderTemplate(template, vars);

    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.RESEND_FROM_EMAIL || 'no-reply@airactionsport.com',
        to: cert.person_email,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: slug },
            { name: 'cert_id', value: cert.id },
        ],
    });
}

/**
 * Cron sweep: scans certifications for upcoming expirations at the 60d,
 * 30d, and 7d milestones and emails each cert holder once per milestone.
 *
 * Idempotency: each successful send writes an audit_log row with action
 * = `certification.expiration_warning.{60d,30d,7d}` keyed on cert.id.
 * On the next sweep, the SQL `NOT EXISTS` filter excludes already-warned
 * certs from the candidate set.
 *
 * Runs on the 03:00 UTC nightly cron alongside customer tag refresh.
 */
export async function runCertExpirationSweep(env) {
    const now = Date.now();
    const buckets = ['expiring_60d', 'expiring_30d', 'expiring_7d'];
    const results = { sent60: 0, sent30: 0, sent7: 0, failed: 0 };

    for (const bucket of buckets) {
        const window = bucketWindow(bucket, now);
        const auditAction = auditActionForBucket(bucket);

        const rows = await env.DB.prepare(
            `SELECT c.*, p.full_name AS person_name, p.email AS person_email
             FROM certifications c
             INNER JOIN persons p ON p.id = c.person_id
             WHERE c.status = 'active'
               AND c.expires_at IS NOT NULL
               AND c.expires_at BETWEEN ? AND ?
               AND p.archived_at IS NULL
               AND p.email IS NOT NULL AND p.email != ''
               AND NOT EXISTS (
                   SELECT 1 FROM audit_log a
                   WHERE a.target_type = 'certification'
                     AND a.target_id = c.id
                     AND a.action = ?
               )
             LIMIT 100`,
        ).bind(window.start, window.end, auditAction).all();

        const candidates = rows.results || [];

        for (const cert of candidates) {
            try {
                const sent = await sendCertExpirationWarning(env, { cert, bucket });
                if (sent?.skipped) {
                    results.failed++;
                    continue;
                }
                // Sentinel: write the audit_log row that the next sweep filters on.
                await env.DB.prepare(
                    `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
                     VALUES (NULL, ?, 'certification', ?, ?, ?)`,
                ).bind(
                    auditAction,
                    cert.id,
                    JSON.stringify({
                        to: cert.person_email,
                        kind: cert.kind,
                        displayName: cert.display_name,
                        expiresAt: cert.expires_at,
                    }),
                    now,
                ).run();

                if (bucket === 'expiring_60d') results.sent60++;
                else if (bucket === 'expiring_30d') results.sent30++;
                else if (bucket === 'expiring_7d') results.sent7++;
            } catch (err) {
                console.error('cert expiration warning failed', cert.id, err);
                results.failed++;
            }
        }
    }

    return results;
}

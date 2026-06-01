// Marketing milestone B5 — automations (standing email rules) + the cron engine.
//
// v1 triggers:
//   recurring  — re-send to the segment (or whole marketing base) every
//                intervalDays. Dedup is per period window, so a customer gets
//                at most one send per window even though the cron runs every 15m.
//   tag_added  — send once (ever) to each customer holding a given tag.
//
// date_relative ("N days before/after an event") is a documented follow-up: it
// needs an events→bookings→customers join that isn't wired yet. Until then it's
// intentionally absent from AUTOMATION_TRIGGERS.
//
// The engine reuses the campaign machinery: resolveCampaignRecipients (which
// enforces email_marketing + archival), buildCampaignEmail (CAN-SPAM footer),
// and the unsubscribe token. email.js (High-DNT) is only called, never modified.
//
// Tests: tests/unit/lib/automations.test.js

import { sendEmail } from './email.js';
import { createUnsubToken } from './unsubToken.js';
import { resolveCampaignRecipients } from './campaigns.js';
import { buildCampaignEmail } from './campaignSender.js';
import { automationSendId } from './ids.js';

export const AUTOMATION_TRIGGERS = ['recurring', 'tag_added'];

const DAY_MS = 24 * 60 * 60 * 1000;
const SEND_CAP_PER_RUN = 100;

/** Validate the trigger_config for a trigger type. Pure. */
export function validateTriggerConfig(type, config) {
    const c = config || {};
    if (type === 'recurring') {
        const n = Number(c.intervalDays);
        if (!Number.isFinite(n) || n < 1) return { valid: false, error: 'recurring trigger requires intervalDays >= 1' };
        return { valid: true, normalized: { intervalDays: Math.floor(n) } };
    }
    if (type === 'tag_added') {
        if (typeof c.tag !== 'string' || !c.tag.trim()) return { valid: false, error: 'tag_added trigger requires a non-empty tag' };
        return { valid: true, normalized: { tag: c.tag.trim() } };
    }
    return { valid: false, error: `unsupported trigger_type: ${type}` };
}

/**
 * Validate + normalize automation input. partial:true (PUT) only checks present
 * keys; if either triggerType or triggerConfig is present, BOTH are revalidated
 * as a pair. Status/counters/last_run are engine-managed, not client-set.
 *
 * @returns {{valid:true, normalized:object} | {valid:false, error:string}}
 */
export function validateAutomationInput(body, { partial = false } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { valid: false, error: 'body must be an object' };
    }
    const out = {};
    const present = (k) => body[k] !== undefined;
    const required = (k) => !partial || present(k);

    if (required('name')) {
        if (typeof body.name !== 'string' || !body.name.trim()) return { valid: false, error: 'name is required' };
        out.name = body.name.trim();
    }
    if (required('subject')) {
        if (typeof body.subject !== 'string' || !body.subject.trim()) return { valid: false, error: 'subject is required' };
        out.subject = body.subject.trim();
    }
    if (required('bodyHtml')) {
        if (typeof body.bodyHtml !== 'string' || !body.bodyHtml.trim()) return { valid: false, error: 'bodyHtml is required' };
        out.bodyHtml = body.bodyHtml;
    }

    const wantTrigger = !partial || present('triggerType') || present('triggerConfig');
    if (wantTrigger) {
        if (typeof body.triggerType !== 'string' || !AUTOMATION_TRIGGERS.includes(body.triggerType)) {
            return { valid: false, error: `triggerType must be one of: ${AUTOMATION_TRIGGERS.join(', ')}` };
        }
        const tc = validateTriggerConfig(body.triggerType, body.triggerConfig);
        if (!tc.valid) return { valid: false, error: tc.error };
        out.triggerType = body.triggerType;
        out.triggerConfig = tc.normalized;
    }

    if (present('bodyText')) {
        if (body.bodyText !== null && typeof body.bodyText !== 'string') return { valid: false, error: 'bodyText must be a string or null' };
        out.bodyText = body.bodyText || null;
    }
    if (present('segmentId')) {
        if (body.segmentId !== null && typeof body.segmentId !== 'string') return { valid: false, error: 'segmentId must be a string or null' };
        const s = typeof body.segmentId === 'string' ? body.segmentId.trim() : '';
        out.segmentId = s || null;
    }
    if (present('fromName')) {
        if (body.fromName !== null && typeof body.fromName !== 'string') return { valid: false, error: 'fromName must be a string or null' };
        out.fromName = body.fromName ? body.fromName.trim() : null;
    }
    return { valid: true, normalized: out };
}

export function formatAutomation(row) {
    let triggerConfig = {};
    try { triggerConfig = JSON.parse(row.trigger_config || '{}'); } catch { triggerConfig = {}; }
    return {
        id: row.id,
        name: row.name,
        triggerType: row.trigger_type,
        triggerConfig,
        segmentId: row.segment_id ?? null,
        subject: row.subject,
        bodyHtml: row.body_html,
        bodyText: row.body_text ?? null,
        fromName: row.from_name ?? null,
        status: row.status,
        lastRunAt: row.last_run_at ?? null,
        sentCount: row.sent_count ?? 0,
        createdBy: row.created_by ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function formatAutomationSummary(row) {
    const { bodyHtml, bodyText, ...rest } = formatAutomation(row);
    void bodyHtml; void bodyText;
    return rest;
}

/** Period bucket index for recurring dedup. Pure. */
export function recurringPeriod(now, intervalDays) {
    const span = Math.max(1, Number(intervalDays) || 1) * DAY_MS;
    return Math.floor(now / span);
}

/** Whether a recurring automation is due to run again (engine optimization). Pure. */
export function dueForRecurring(automation, now) {
    if (!automation.last_run_at) return true;
    let interval = null;
    try { interval = JSON.parse(automation.trigger_config || '{}').intervalDays; } catch { interval = null; }
    if (!interval) return true;
    return (now - automation.last_run_at) >= interval * DAY_MS;
}

/**
 * Resolve the customers an automation should reach right now, each tagged with a
 * dedup_key. recurring → segment members, deduped per period; tag_added →
 * customers holding the tag, deduped once-ever.
 */
export async function resolveAutomationRecipients(db, automation, config, now) {
    if (automation.trigger_type === 'recurring') {
        const list = await resolveCampaignRecipients(db, { segmentId: automation.segment_id });
        const period = recurringPeriod(now, config.intervalDays);
        return list.map((r) => ({ ...r, dedupKey: `${automation.id}:${r.customerId}:${period}` }));
    }
    if (automation.trigger_type === 'tag_added') {
        const res = await db.prepare(
            `SELECT c.id, c.email, c.name FROM customers c
             JOIN customer_tags ct ON ct.customer_id = c.id AND ct.tag = ?
             WHERE c.email_marketing = 1 AND c.archived_at IS NULL`,
        ).bind(config.tag).all();
        return (res?.results || [])
            .filter((r) => r.email)
            .map((r) => ({ customerId: r.id, email: r.email, name: r.name || null, dedupKey: `${automation.id}:${r.id}` }));
    }
    return [];
}

function senderFrom(env, automation) {
    const base = env.FROM_EMAIL || 'Air Action Sports <noreply@airactionsport.com>';
    if (!automation.from_name) return base;
    const m = base.match(/<([^>]+)>/);
    return `${automation.from_name} <${m ? m[1] : base}>`;
}

/**
 * Cron sweep: evaluate active automations, send to not-yet-sent recipients
 * (dedup via automation_sends.dedup_key). Same safety gate as campaigns —
 * no-ops without RESEND_API_KEY + MARKETING_POSTAL_ADDRESS.
 *
 * @param {object} env
 * @param {{ now?: number, cap?: number }} [opts]
 */
export async function runAutomationSweep(env, opts = {}) {
    const startedAt = Date.now();
    const now = opts.now ?? startedAt;
    const cap = opts.cap ?? SEND_CAP_PER_RUN;
    const postalAddress = env.MARKETING_POSTAL_ADDRESS;

    if (!env.RESEND_API_KEY || !postalAddress) {
        return {
            skipped: !env.RESEND_API_KEY ? 'no_resend_key' : 'no_postal_address',
            evaluated: 0, sent: 0, failed: 0, durationMs: Date.now() - startedAt,
        };
    }

    let automations = [];
    try {
        const res = await env.DB.prepare("SELECT * FROM automations WHERE status = 'active'").all();
        automations = res?.results || [];
    } catch (err) {
        console.error('automation lookup failed', err);
        return { evaluated: 0, sent: 0, failed: 0, error: err?.message, durationMs: Date.now() - startedAt };
    }

    const base = env.PUBLIC_BASE_URL || 'https://airactionsport.com';
    let evaluated = 0;
    let sent = 0;
    let failed = 0;
    let budget = cap;

    for (const a of automations) {
        if (budget <= 0) break;
        let config = {};
        try { config = JSON.parse(a.trigger_config || '{}'); } catch { config = {}; }
        if (a.trigger_type === 'recurring' && !dueForRecurring(a, now)) continue;
        evaluated++;

        const recipients = await resolveAutomationRecipients(env.DB, a, config, now);
        let sentThis = 0;
        for (const r of recipients) {
            if (budget <= 0) break;
            const dup = await env.DB.prepare('SELECT id FROM automation_sends WHERE dedup_key = ? LIMIT 1').bind(r.dedupKey).first();
            if (dup) continue;
            budget--;
            const token = await createUnsubToken(r.customerId, env.SESSION_SECRET);
            const unsubUrl = `${base}/api/unsubscribe?c=${encodeURIComponent(r.customerId)}&t=${encodeURIComponent(token)}`;
            const mail = buildCampaignEmail({ subject: a.subject, body_html: a.body_html, body_text: a.body_text }, { unsubUrl, postalAddress });
            try {
                const res = await sendEmail({
                    apiKey: env.RESEND_API_KEY,
                    from: senderFrom(env, a),
                    to: r.email,
                    replyTo: env.REPLY_TO_EMAIL || undefined,
                    subject: mail.subject,
                    html: mail.html,
                    text: mail.text,
                    tags: [{ name: 'type', value: 'automation' }, { name: 'automation_id', value: a.id }],
                });
                await env.DB.prepare(
                    `INSERT OR IGNORE INTO automation_sends (id, automation_id, customer_id, email, dedup_key, status, resend_email_id, created_at)
                     VALUES (?, ?, ?, ?, ?, 'sent', ?, ?)`,
                ).bind(automationSendId(), a.id, r.customerId, r.email, r.dedupKey, res?.id || null, Date.now()).run();
                sent++; sentThis++;
            } catch (err) {
                await env.DB.prepare(
                    `INSERT OR IGNORE INTO automation_sends (id, automation_id, customer_id, email, dedup_key, status, error, created_at)
                     VALUES (?, ?, ?, ?, ?, 'failed', ?, ?)`,
                ).bind(automationSendId(), a.id, r.customerId, r.email, r.dedupKey, String(err?.message || err).slice(0, 500), Date.now()).run();
                failed++;
            }
        }
        await env.DB.prepare(
            'UPDATE automations SET last_run_at = ?, sent_count = sent_count + ?, updated_at = ? WHERE id = ?',
        ).bind(now, sentThis, now, a.id).run();
    }

    return { evaluated, sent, failed, durationMs: Date.now() - startedAt };
}

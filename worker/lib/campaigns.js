// Marketing milestone Batch 2 — campaign domain logic (pure + resolution).
//
// A campaign targets a segment (segments.query_json, B1) or — when segmentId
// is null — the whole marketing-opted customer base. Recipient resolution
// always rides buildSegmentSql / the same WHERE the segments engine enforces
// (email_marketing = 1 AND archived_at IS NULL), so consent + archival are
// respected by construction.
//
// The send pipeline (B2b cron) consumes resolveCampaignRecipients at
// send-trigger time, snapshots one campaign_recipients row per customer, then
// drains them. Status transitions are enforced here, not in the DB.
//
// Tests: tests/unit/lib/campaigns.test.js

import { validateFilterSpec, buildSegmentSql } from './segments.js';

export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'canceled'];

// Allowed status transitions. Enforced by the route + cron; the DB column is
// a plain TEXT default.
const TRANSITIONS = {
    draft: ['scheduled', 'sending', 'canceled'],
    scheduled: ['sending', 'canceled', 'draft'], // unschedule → back to draft
    sending: ['sent'],
    sent: [],
    canceled: [],
};

/** Whether a campaign may move from `from` status to `to`. Pure. */
export function canTransition(from, to) {
    return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

/**
 * Validate + normalize campaign input from the admin UI. `partial:true` (PUT)
 * only validates the keys that are present. Status/counters are never set by
 * the client — they're managed by the send pipeline.
 *
 * @returns {{valid:true, normalized:object} | {valid:false, error:string}}
 */
export function validateCampaignInput(body, { partial = false } = {}) {
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
    if (present('bodyText')) {
        if (body.bodyText !== null && typeof body.bodyText !== 'string') return { valid: false, error: 'bodyText must be a string or null' };
        out.bodyText = body.bodyText || null;
    }
    if (present('segmentId')) {
        if (body.segmentId !== null && typeof body.segmentId !== 'string') {
            return { valid: false, error: 'segmentId must be a string or null' };
        }
        // '' / whitespace / null all mean "whole marketing-opted base".
        const s = typeof body.segmentId === 'string' ? body.segmentId.trim() : '';
        out.segmentId = s || null;
    }
    if (present('fromName')) {
        if (body.fromName !== null && typeof body.fromName !== 'string') return { valid: false, error: 'fromName must be a string or null' };
        out.fromName = body.fromName ? body.fromName.trim() : null;
    }
    if (present('scheduledAt')) {
        if (body.scheduledAt === null) {
            out.scheduledAt = null;
        } else {
            const n = Number(body.scheduledAt);
            if (!Number.isFinite(n) || n <= 0) return { valid: false, error: 'scheduledAt must be a positive epoch-ms timestamp or null' };
            out.scheduledAt = Math.floor(n);
        }
    }
    return { valid: true, normalized: out };
}

/** Detail shape (includes body). */
export function formatCampaign(row) {
    return {
        id: row.id,
        name: row.name,
        subject: row.subject,
        bodyHtml: row.body_html,
        bodyText: row.body_text ?? null,
        segmentId: row.segment_id ?? null,
        status: row.status,
        scheduledAt: row.scheduled_at ?? null,
        fromName: row.from_name ?? null,
        recipientCount: row.recipient_count ?? 0,
        sentCount: row.sent_count ?? 0,
        failedCount: row.failed_count ?? 0,
        createdBy: row.created_by ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        sentAt: row.sent_at ?? null,
    };
}

/** List shape — drops the (potentially large) body fields. */
export function formatCampaignSummary(row) {
    const { bodyHtml, bodyText, ...rest } = formatCampaign(row);
    void bodyHtml; void bodyText;
    return rest;
}

/**
 * Resolve every customer a campaign should reach: the segment's members (or
 * the whole marketing-opted base when segmentId is null). Returns
 * `[{ customerId, email, name }]` with null/empty emails filtered out.
 *
 * Throws if the segment is missing or its stored spec is invalid — the caller
 * (send-trigger) surfaces that as a 4xx rather than enqueuing a broken send.
 *
 * @param {object} db D1 binding
 * @param {{ segmentId?: string|null }} campaign
 */
export async function resolveCampaignRecipients(db, { segmentId } = {}) {
    let sql;
    let binds;
    if (segmentId) {
        const seg = await db.prepare(
            "SELECT query_json FROM segments WHERE id = ? AND type = 'customer_segment'",
        ).bind(segmentId).first();
        if (!seg) throw new Error('segment not found');
        const v = validateFilterSpec(seg.query_json);
        if (!v.valid) throw new Error(`segment spec invalid: ${v.error}`);
        ({ sql, binds } = buildSegmentSql(v.normalized, {
            selectClause: 'customers.id, customers.email, customers.name',
        }));
    } else {
        sql = 'SELECT id, email, name FROM customers WHERE email_marketing = 1 AND archived_at IS NULL';
        binds = [];
    }
    const res = await db.prepare(sql).bind(...binds).all();
    return (res.results || [])
        .filter((r) => r.email)
        .map((r) => ({ customerId: r.id, email: r.email, name: r.name || null }));
}

// Marketing milestone B4 — campaign engagement tracking.
//
// Correlates Resend (Svix) webhook events back to the campaign_recipients row
// that send them (by resend_email_id, stamped by the B2b sender), recording an
// engagement timestamp. Called additively from the /api/webhooks/resend route
// (worker/routes/webhooks.js) — it does NOT replace M7's handleResendEmailEvent
// (which keeps the global email_events log + marketing suppression).
//
// Tests: tests/unit/lib/campaignTracking.test.js

import { classifyResendEvent } from './emailEvents.js';

// Resend event types we project onto a campaign_recipients timestamp column.
export const CAMPAIGN_TRACKED_EVENTS = new Set([
    'email.delivered',
    'email.opened',
    'email.clicked',
    'email.bounced',
    'email.complained',
]);

const EVENT_TO_COLUMN = {
    'email.delivered': 'delivered_at',
    'email.opened': 'opened_at',
    'email.clicked': 'clicked_at',
    'email.bounced': 'bounced_at',
    'email.complained': 'complained_at',
};

/**
 * Project a Resend event onto the matching campaign_recipients row. Idempotent:
 * only sets the column when it's still NULL (Resend redelivers + a single email
 * can fire multiple opens). No-op when the event isn't tracked or carries no
 * resend email id (e.g. a transactional/non-campaign send).
 *
 * @param {object} db D1 binding
 * @param {object} event verified Resend webhook event
 * @param {{ now?: number }} [opts]
 * @returns {Promise<{ matched: boolean, column: string|null }>}
 */
export async function correlateCampaignEvent(db, event, opts = {}) {
    const column = EVENT_TO_COLUMN[event?.type];
    if (!column) return { matched: false, column: null };

    const { resendEmailId } = classifyResendEvent(event);
    if (!resendEmailId) return { matched: false, column };

    const now = opts.now ?? Date.now();
    const res = await db.prepare(
        `UPDATE campaign_recipients SET ${column} = ? WHERE resend_email_id = ? AND ${column} IS NULL`,
    ).bind(now, resendEmailId).run();

    return { matched: (res?.meta?.changes ?? 0) > 0, column };
}

/**
 * Per-campaign engagement counts for the stats endpoint / UI. delivered/opened/
 * clicked/bounced/complained count the timestamp columns; sent/failed come from
 * the recipient status. Returns zeros when the table is missing (unmigrated).
 *
 * @param {object} db D1 binding
 * @param {string} campaignId
 */
export async function getCampaignStats(db, campaignId) {
    const empty = { recipients: 0, sent: 0, failed: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 };
    try {
        const row = await db.prepare(
            `SELECT
                COUNT(*) AS recipients,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
                SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
                SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
                SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) AS bounced,
                SUM(CASE WHEN complained_at IS NOT NULL THEN 1 ELSE 0 END) AS complained
             FROM campaign_recipients WHERE campaign_id = ?`,
        ).bind(campaignId).first();
        if (!row) return empty;
        return {
            recipients: Number(row.recipients || 0),
            sent: Number(row.sent || 0),
            failed: Number(row.failed || 0),
            delivered: Number(row.delivered || 0),
            opened: Number(row.opened || 0),
            clicked: Number(row.clicked || 0),
            bounced: Number(row.bounced || 0),
            complained: Number(row.complained || 0),
        };
    } catch {
        return empty;
    }
}

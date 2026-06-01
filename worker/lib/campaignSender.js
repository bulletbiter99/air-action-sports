// Marketing milestone B2b — campaign send pipeline (cron-drained).
//
// runCampaignSendSweep runs on the 15-min cron. Each tick it:
//   1. Promotes due 'scheduled' campaigns → 'sending'.
//   2. Drains pending campaign_recipients for 'sending' campaigns, bounded by a
//      per-run send cap (Resend rate + cost guard; spreads big sends across ticks).
//   3. Sends each via worker/lib/email.js sendEmail (NEVER modified — High-DNT;
//      this wrapper only calls it) with a CAN-SPAM footer (unsubscribe link +
//      physical postal address).
//   4. Marks a campaign 'sent' once no pending recipients remain.
//
// SAFETY GATE: the sweep no-ops unless RESEND_API_KEY *and*
// MARKETING_POSTAL_ADDRESS are configured — we never send a marketing blast
// without the legally-required postal address in the footer.
//
// Tests: tests/unit/lib/campaignSender.test.js

import { sendEmail } from './email.js';
import { createUnsubToken } from './unsubToken.js';

const SEND_CAP_PER_RUN = 50;   // emails per cron tick across all campaigns
const PER_CAMPAIGN_BATCH = 50; // max pending pulled per campaign per tick

/** Resolve the From header, honoring a campaign's optional from_name override. */
function senderFrom(env, campaign) {
    const base = env.FROM_EMAIL || 'Air Action Sports <noreply@airactionsport.com>';
    if (!campaign.from_name) return base;
    const m = base.match(/<([^>]+)>/);
    const addr = m ? m[1] : base;
    return `${campaign.from_name} <${addr}>`;
}

function unsubBaseUrl(env) {
    return env.PUBLIC_BASE_URL || 'https://airactionsport.com';
}

/** Crude HTML→text fallback when a campaign has no body_text. */
function stripHtml(html) {
    return String(html || '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Build the per-recipient email (subject + html + text) with the CAN-SPAM
 * footer appended. Pure given its inputs. Exported for testing.
 */
export function buildCampaignEmail(campaign, { unsubUrl, postalAddress }) {
    const footerHtml =
        '<hr style="margin-top:32px;border:none;border-top:1px solid #ddd">'
        + '<p style="font-size:12px;color:#888;line-height:1.5;margin-top:12px">'
        + 'You’re receiving this because you opted in to marketing from Air Action Sports.<br>'
        + `<a href="${unsubUrl}" style="color:#888">Unsubscribe</a> · Air Action Sports · ${postalAddress}`
        + '</p>';
    const footerText =
        `\n\n—\nYou're receiving this because you opted in to marketing from Air Action Sports.`
        + `\nUnsubscribe: ${unsubUrl}`
        + `\nAir Action Sports · ${postalAddress}`;
    const html = `${campaign.body_html}${footerHtml}`;
    const text = `${campaign.body_text || stripHtml(campaign.body_html)}${footerText}`;
    return { subject: campaign.subject, html, text };
}

/**
 * Cron sweep: promote due scheduled campaigns, then drain pending recipients
 * (bounded). Returns a summary for the cron audit log.
 *
 * @param {object} env  { DB, RESEND_API_KEY, SESSION_SECRET, MARKETING_POSTAL_ADDRESS, FROM_EMAIL?, REPLY_TO_EMAIL?, PUBLIC_BASE_URL? }
 * @param {{ now?: number, cap?: number }} [opts]
 */
export async function runCampaignSendSweep(env, opts = {}) {
    const startedAt = Date.now();
    const now = opts.now ?? startedAt;
    const cap = opts.cap ?? SEND_CAP_PER_RUN;
    const postalAddress = env.MARKETING_POSTAL_ADDRESS;

    if (!env.RESEND_API_KEY || !postalAddress) {
        return {
            skipped: !env.RESEND_API_KEY ? 'no_resend_key' : 'no_postal_address',
            promoted: 0, campaignsProcessed: 0, sent: 0, failed: 0,
            durationMs: Date.now() - startedAt,
        };
    }

    // 1. Promote due scheduled campaigns.
    let promoted = 0;
    try {
        const res = await env.DB.prepare(
            "UPDATE campaigns SET status = 'sending', updated_at = ? WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?",
        ).bind(now, now).run();
        promoted = res?.meta?.changes ?? 0;
    } catch (err) {
        console.error('campaign promote failed', err);
    }

    // 2. Process sending campaigns oldest-first.
    let sending = [];
    try {
        const res = await env.DB.prepare(
            "SELECT * FROM campaigns WHERE status = 'sending' ORDER BY updated_at ASC",
        ).all();
        sending = res?.results || [];
    } catch (err) {
        console.error('campaign sending lookup failed', err);
        return { promoted, campaignsProcessed: 0, sent: 0, failed: 0, error: err?.message, durationMs: Date.now() - startedAt };
    }

    const base = unsubBaseUrl(env);
    let sent = 0;
    let failed = 0;
    let budget = cap;

    for (const campaign of sending) {
        if (budget <= 0) break;
        const take = Math.min(budget, PER_CAMPAIGN_BATCH);
        const pendRes = await env.DB.prepare(
            "SELECT * FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT ?",
        ).bind(campaign.id, take).all();
        const pending = pendRes?.results || [];

        for (const r of pending) {
            if (budget <= 0) break;
            budget--;
            const token = await createUnsubToken(r.customer_id, env.SESSION_SECRET);
            const unsubUrl = `${base}/api/unsubscribe?c=${encodeURIComponent(r.customer_id)}&t=${encodeURIComponent(token)}`;
            const mail = buildCampaignEmail(campaign, { unsubUrl, postalAddress });
            try {
                const res = await sendEmail({
                    apiKey: env.RESEND_API_KEY,
                    from: senderFrom(env, campaign),
                    to: r.email,
                    replyTo: env.REPLY_TO_EMAIL || undefined,
                    subject: mail.subject,
                    html: mail.html,
                    text: mail.text,
                    tags: [{ name: 'type', value: 'campaign' }, { name: 'campaign_id', value: campaign.id }],
                });
                await env.DB.prepare(
                    "UPDATE campaign_recipients SET status = 'sent', resend_email_id = ?, sent_at = ? WHERE id = ?",
                ).bind(res?.id || null, Date.now(), r.id).run();
                await env.DB.prepare('UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = ?').bind(campaign.id).run();
                sent++;
            } catch (err) {
                await env.DB.prepare(
                    "UPDATE campaign_recipients SET status = 'failed', error = ? WHERE id = ?",
                ).bind(String(err?.message || err).slice(0, 500), r.id).run();
                await env.DB.prepare('UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ?').bind(campaign.id).run();
                failed++;
            }
        }

        // Mark sent once nothing is pending for this campaign.
        const rem = await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending'",
        ).bind(campaign.id).first();
        if (Number(rem?.n ?? 0) === 0) {
            const done = Date.now();
            await env.DB.prepare(
                "UPDATE campaigns SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?",
            ).bind(done, done, campaign.id).run();
        }
    }

    return { promoted, campaignsProcessed: sending.length, sent, failed, durationMs: Date.now() - startedAt };
}

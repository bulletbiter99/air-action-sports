// Marketing milestone Batch 2 — admin campaigns CRUD + send-trigger.
//
// Backs the campaigns + campaign_recipients tables (migration 0067). A campaign
// is created as a draft, edited freely, then SENT — which resolves the segment
// to a recipient snapshot (campaign_recipients) and flips status to 'sending'
// (drained immediately by the B2b cron) or 'scheduled' (drained at scheduledAt).
//
// The recipient audience is locked at send-trigger time: editing/deleting the
// segment afterward doesn't change who already got enqueued.
//
// Endpoints:
//   GET    /api/admin/campaigns                  list (status filter; summary shape)
//   GET    /api/admin/campaigns/:id              detail (with body)
//   POST   /api/admin/campaigns                  create draft
//   PUT    /api/admin/campaigns/:id              edit (draft|scheduled only)
//   DELETE /api/admin/campaigns/:id              delete (draft|canceled only)
//   POST   /api/admin/campaigns/:id/preview-recipients   count + sample
//   POST   /api/admin/campaigns/:id/send         enqueue + status → sending|scheduled
//   POST   /api/admin/campaigns/:id/cancel       → canceled (drops pending recipients)
//
// Gating: requireAuth in B2. The B6 closing batch swaps to
// requireCapability('marketing.campaigns.{read,write,delete}').

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { writeAudit } from '../../lib/auditLog.js';
import { campaignId, campaignRecipientId } from '../../lib/ids.js';
import {
    CAMPAIGN_STATUSES,
    validateCampaignInput,
    canTransition,
    formatCampaign,
    formatCampaignSummary,
    resolveCampaignRecipients,
} from '../../lib/campaigns.js';
import { getCampaignStats } from '../../lib/campaignTracking.js';

const adminCampaigns = new Hono();
adminCampaigns.use('*', requireAuth);

// TODO(B6 closing): wrap handlers in requireCapability('marketing.campaigns.read|write|delete')
// once migration 06xx seeds the marketing.* capability set + role bindings.

const ENQUEUE_CHUNK = 50; // D1 batch size for the recipient snapshot insert

// ── GET / — list ──────────────────────────────────────────────────────
adminCampaigns.get('/', async (c) => {
    const url = new URL(c.req.url);
    const status = url.searchParams.get('status');
    const where = [];
    const binds = [];
    if (status && CAMPAIGN_STATUSES.includes(status)) { where.push('status = ?'); binds.push(status); }
    let rows;
    try {
        const sql = `SELECT * FROM campaigns ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC`;
        const result = await c.env.DB.prepare(sql).bind(...binds).all();
        rows = result.results || [];
    } catch {
        rows = []; // table missing on local/unmigrated — graceful empty
    }
    return c.json({ campaigns: rows.map(formatCampaignSummary) });
});

// ── GET /:id — detail ─────────────────────────────────────────────────
adminCampaigns.get('/:id', async (c) => {
    const row = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(c.req.param('id')).first();
    if (!row) return c.json({ error: 'Campaign not found' }, 404);
    return c.json({ campaign: formatCampaign(row) });
});

// ── GET /:id/stats — per-campaign engagement counts (B4) ──────────────
adminCampaigns.get('/:id/stats', async (c) => {
    const id = c.req.param('id');
    const camp = await c.env.DB.prepare('SELECT id FROM campaigns WHERE id = ?').bind(id).first();
    if (!camp) return c.json({ error: 'Campaign not found' }, 404);
    const stats = await getCampaignStats(c.env.DB, id);
    return c.json({ stats });
});

// ── POST / — create draft ─────────────────────────────────────────────
adminCampaigns.post('/', async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const v = validateCampaignInput(body);
    if (!v.valid) return c.json({ error: v.error }, 400);
    const n = v.normalized;
    const id = campaignId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO campaigns (id, name, subject, body_html, body_text, segment_id, status, scheduled_at, from_name, recipient_count, sent_count, failed_count, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', NULL, ?, 0, 0, 0, ?, ?, ?)`,
    ).bind(id, n.name, n.subject, n.bodyHtml, n.bodyText ?? null, n.segmentId ?? null, n.fromName ?? null, user.id, now, now).run();
    await writeAudit(c.env, { userId: user.id, action: 'campaign.created', targetType: 'campaign', targetId: id, meta: { name: n.name } });
    const created = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
    return c.json({ campaign: formatCampaign(created) }, 201);
});

// ── PUT /:id — edit (draft|scheduled only) ────────────────────────────
adminCampaigns.put('/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ error: 'Campaign not found' }, 404);
    if (!['draft', 'scheduled'].includes(existing.status)) {
        return c.json({ error: `Cannot edit a campaign in '${existing.status}' status` }, 409);
    }
    const body = await c.req.json().catch(() => null);
    const v = validateCampaignInput(body, { partial: true });
    if (!v.valid) return c.json({ error: v.error }, 400);

    const colMap = {
        name: 'name', subject: 'subject', bodyHtml: 'body_html', bodyText: 'body_text',
        segmentId: 'segment_id', fromName: 'from_name', scheduledAt: 'scheduled_at',
    };
    const sets = [];
    const binds = [];
    for (const [key, col] of Object.entries(colMap)) {
        if (v.normalized[key] !== undefined) { sets.push(`${col} = ?`); binds.push(v.normalized[key]); }
    }
    if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
    const now = Date.now();
    sets.push('updated_at = ?'); binds.push(now);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    await writeAudit(c.env, { userId: user.id, action: 'campaign.updated', targetType: 'campaign', targetId: id, meta: { fields: Object.keys(v.normalized) } });
    const updated = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
    return c.json({ campaign: formatCampaign(updated) });
});

// ── DELETE /:id — delete (draft|canceled only) ────────────────────────
adminCampaigns.delete('/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT id, status FROM campaigns WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ error: 'Campaign not found' }, 404);
    if (!['draft', 'canceled'].includes(existing.status)) {
        return c.json({ error: `Cannot delete a campaign in '${existing.status}' status (sent campaigns are kept as history)` }, 409);
    }
    await c.env.DB.prepare('DELETE FROM campaign_recipients WHERE campaign_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM campaigns WHERE id = ?').bind(id).run();
    await writeAudit(c.env, { userId: user.id, action: 'campaign.deleted', targetType: 'campaign', targetId: id, meta: {} });
    return c.json({ ok: true });
});

// ── POST /:id/preview-recipients — count + sample ─────────────────────
adminCampaigns.post('/:id/preview-recipients', async (c) => {
    const id = c.req.param('id');
    const camp = await c.env.DB.prepare('SELECT id, segment_id FROM campaigns WHERE id = ?').bind(id).first();
    if (!camp) return c.json({ error: 'Campaign not found' }, 404);
    let recipients;
    try {
        recipients = await resolveCampaignRecipients(c.env.DB, { segmentId: camp.segment_id });
    } catch (e) {
        return c.json({ error: e.message }, 400);
    }
    return c.json({ count: recipients.length, sample: recipients.slice(0, 10), computedAt: Date.now() });
});

// ── POST /:id/send — enqueue recipient snapshot + flip status ─────────
adminCampaigns.post('/:id/send', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const camp = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
    if (!camp) return c.json({ error: 'Campaign not found' }, 404);
    if (!['draft', 'scheduled'].includes(camp.status)) {
        return c.json({ error: `Cannot send a campaign in '${camp.status}' status` }, 409);
    }

    const body = await c.req.json().catch(() => ({}));
    let scheduledAt = null;
    if (body && body.scheduledAt != null) {
        const n = Number(body.scheduledAt);
        if (!Number.isFinite(n) || n <= 0) return c.json({ error: 'scheduledAt must be a positive epoch-ms timestamp' }, 400);
        scheduledAt = Math.floor(n);
    } else if (camp.scheduled_at) {
        scheduledAt = camp.scheduled_at;
    }
    const now = Date.now();
    const isFuture = scheduledAt != null && scheduledAt > now;
    const nextStatus = isFuture ? 'scheduled' : 'sending';
    if (!canTransition(camp.status, nextStatus)) {
        return c.json({ error: `Cannot transition ${camp.status} → ${nextStatus}` }, 409);
    }

    let recipients;
    try {
        recipients = await resolveCampaignRecipients(c.env.DB, { segmentId: camp.segment_id });
    } catch (e) {
        return c.json({ error: e.message }, 400);
    }
    if (recipients.length === 0) {
        return c.json({ error: 'Campaign has no recipients (segment empty or no marketing-opted customers)' }, 400);
    }

    // Snapshot recipients (INSERT OR IGNORE → re-send is idempotent via the
    // (campaign_id, customer_id) UNIQUE index). db.batch when available;
    // sequential .run() fallback for the mockD1 test path (same guard
    // customerTags.runCustomerTagsSweep uses).
    for (let i = 0; i < recipients.length; i += ENQUEUE_CHUNK) {
        const slice = recipients.slice(i, i + ENQUEUE_CHUNK);
        const stmts = slice.map((r) => c.env.DB.prepare(
            `INSERT OR IGNORE INTO campaign_recipients (id, campaign_id, customer_id, email, name, status, created_at)
             VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        ).bind(campaignRecipientId(), id, r.customerId, r.email, r.name, now));
        if (typeof c.env.DB.batch === 'function') {
            await c.env.DB.batch(stmts);
        } else {
            for (const s of stmts) await s.run();
        }
    }

    await c.env.DB.prepare(
        'UPDATE campaigns SET status = ?, scheduled_at = ?, recipient_count = ?, updated_at = ? WHERE id = ?',
    ).bind(nextStatus, isFuture ? scheduledAt : null, recipients.length, now, id).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: isFuture ? 'campaign.scheduled' : 'campaign.send_started',
        targetType: 'campaign',
        targetId: id,
        meta: { recipientCount: recipients.length, scheduledAt: isFuture ? scheduledAt : null },
    });

    const updated = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
    return c.json({ campaign: formatCampaign(updated), recipientCount: recipients.length });
});

// ── POST /:id/cancel — → canceled ─────────────────────────────────────
adminCampaigns.post('/:id/cancel', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const camp = await c.env.DB.prepare('SELECT id, status FROM campaigns WHERE id = ?').bind(id).first();
    if (!camp) return c.json({ error: 'Campaign not found' }, 404);
    if (!canTransition(camp.status, 'canceled')) {
        return c.json({ error: `Cannot cancel a campaign in '${camp.status}' status` }, 409);
    }
    const now = Date.now();
    await c.env.DB.prepare('UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?').bind('canceled', now, id).run();
    // Drop un-sent recipients; keep already-sent rows as history.
    await c.env.DB.prepare("DELETE FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending'").bind(id).run();
    await writeAudit(c.env, { userId: user.id, action: 'campaign.canceled', targetType: 'campaign', targetId: id, meta: {} });
    const updated = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
    return c.json({ campaign: formatCampaign(updated) });
});

export default adminCampaigns;

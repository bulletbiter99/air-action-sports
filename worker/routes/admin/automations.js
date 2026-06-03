// Marketing milestone B5 — admin automations CRUD + activate/pause.
//
// Backs the automations table (migration 0069). An automation is created paused,
// edited, then activated — the 15-min cron (worker/lib/automations.js
// runAutomationSweep) evaluates active ones and sends (gated on the operator's
// Resend + postal-address config, like campaigns).
//
// Endpoints:
//   GET    /api/admin/automations              list (status filter; summary)
//   GET    /api/admin/automations/:id          detail
//   POST   /api/admin/automations              create (paused)
//   PUT    /api/admin/automations/:id          edit
//   DELETE /api/admin/automations/:id          delete
//   POST   /api/admin/automations/:id/activate → status active
//   POST   /api/admin/automations/:id/pause    → status paused
//
// Gating: requireAuth in B5; B6 closing swaps to
// requireCapability('marketing.automations.{read,write,delete}').

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';
import { automationId } from '../../lib/ids.js';
import {
    validateAutomationInput,
    formatAutomation,
    formatAutomationSummary,
} from '../../lib/automations.js';

const adminAutomations = new Hono();
adminAutomations.use('*', requireAuth);
// Marketing-capability gating (migration 0070). GET → read; DELETE → delete;
// create / update / activate / pause → write.
adminAutomations.use('*', (c, next) => {
    const m = c.req.method;
    const cap = m === 'GET'
        ? 'marketing.automations.read'
        : m === 'DELETE'
            ? 'marketing.automations.delete'
            : 'marketing.automations.write';
    return requireCapability(cap)(c, next);
});

adminAutomations.get('/', async (c) => {
    const url = new URL(c.req.url);
    const status = url.searchParams.get('status');
    const where = [];
    const binds = [];
    if (status === 'active' || status === 'paused') { where.push('status = ?'); binds.push(status); }
    let rows;
    try {
        const sql = `SELECT * FROM automations ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC`;
        rows = (await c.env.DB.prepare(sql).bind(...binds).all())?.results || [];
    } catch {
        rows = [];
    }
    return c.json({ automations: rows.map(formatAutomationSummary) });
});

adminAutomations.get('/:id', async (c) => {
    const row = await c.env.DB.prepare('SELECT * FROM automations WHERE id = ?').bind(c.req.param('id')).first();
    if (!row) return c.json({ error: 'Automation not found' }, 404);
    return c.json({ automation: formatAutomation(row) });
});

adminAutomations.post('/', async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const v = validateAutomationInput(body);
    if (!v.valid) return c.json({ error: v.error }, 400);
    const n = v.normalized;
    const id = automationId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO automations (id, name, trigger_type, trigger_config, segment_id, subject, body_html, body_text, from_name, status, last_run_at, sent_count, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paused', NULL, 0, ?, ?, ?)`,
    ).bind(
        id, n.name, n.triggerType, JSON.stringify(n.triggerConfig), n.segmentId ?? null,
        n.subject, n.bodyHtml, n.bodyText ?? null, n.fromName ?? null, user.id, now, now,
    ).run();
    await writeAudit(c.env, { userId: user.id, action: 'automation.created', targetType: 'automation', targetId: id, meta: { name: n.name, trigger: n.triggerType } });
    const created = await c.env.DB.prepare('SELECT * FROM automations WHERE id = ?').bind(id).first();
    return c.json({ automation: formatAutomation(created) }, 201);
});

adminAutomations.put('/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT id FROM automations WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ error: 'Automation not found' }, 404);
    const body = await c.req.json().catch(() => null);
    const v = validateAutomationInput(body, { partial: true });
    if (!v.valid) return c.json({ error: v.error }, 400);

    const colMap = {
        name: 'name', subject: 'subject', bodyHtml: 'body_html', bodyText: 'body_text',
        segmentId: 'segment_id', fromName: 'from_name', triggerType: 'trigger_type',
    };
    const sets = [];
    const binds = [];
    for (const [key, col] of Object.entries(colMap)) {
        if (v.normalized[key] !== undefined) { sets.push(`${col} = ?`); binds.push(v.normalized[key]); }
    }
    if (v.normalized.triggerConfig !== undefined) { sets.push('trigger_config = ?'); binds.push(JSON.stringify(v.normalized.triggerConfig)); }
    if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
    const now = Date.now();
    sets.push('updated_at = ?'); binds.push(now);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE automations SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    await writeAudit(c.env, { userId: user.id, action: 'automation.updated', targetType: 'automation', targetId: id, meta: { fields: Object.keys(v.normalized) } });
    const updated = await c.env.DB.prepare('SELECT * FROM automations WHERE id = ?').bind(id).first();
    return c.json({ automation: formatAutomation(updated) });
});

adminAutomations.delete('/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT id FROM automations WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ error: 'Automation not found' }, 404);
    await c.env.DB.prepare('DELETE FROM automations WHERE id = ?').bind(id).run();
    await writeAudit(c.env, { userId: user.id, action: 'automation.deleted', targetType: 'automation', targetId: id, meta: {} });
    return c.json({ ok: true });
});

async function setStatus(c, status, action) {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT id, status FROM automations WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ error: 'Automation not found' }, 404);
    const now = Date.now();
    await c.env.DB.prepare('UPDATE automations SET status = ?, updated_at = ? WHERE id = ?').bind(status, now, id).run();
    await writeAudit(c.env, { userId: user.id, action, targetType: 'automation', targetId: id, meta: {} });
    const updated = await c.env.DB.prepare('SELECT * FROM automations WHERE id = ?').bind(id).first();
    return c.json({ automation: formatAutomation(updated) });
}

adminAutomations.post('/:id/activate', (c) => setStatus(c, 'active', 'automation.activated'));
adminAutomations.post('/:id/pause', (c) => setStatus(c, 'paused', 'automation.paused'));

export default adminAutomations;

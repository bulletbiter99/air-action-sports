// M5 Batch 9 — admin event staffing routes (Surface 4b).
//
// Endpoints (capability-gated):
//   GET  /api/admin/event-staffing?event_id=    list assignments per event
//   GET  /api/admin/event-staffing?person_id=   list per person (own schedule)
//   POST /api/admin/event-staffing              assign person to event/role
//   PUT  /api/admin/event-staffing/:id          update RSVP / compensation
//   DELETE /api/admin/event-staffing/:id        remove assignment (only pending)
//   POST /api/admin/event-staffing/:id/no-show  mark no-show post-event
//   POST /api/admin/event-staffing/:id/complete mark completed post-event

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';

const adminEventStaffing = new Hono();
adminEventStaffing.use('*', requireAuth);

function randomEsId() {
    const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let out = '';
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return `es_${out}`;
}

function format(row) {
    if (!row) return null;
    return {
        id: row.id,
        eventId: row.event_id,
        personId: row.person_id,
        roleId: row.role_id,
        status: row.status,
        payKind: row.pay_kind,
        payRateCents: row.pay_rate_cents,
        shiftStartAt: row.shift_start_at,
        shiftEndAt: row.shift_end_at,
        notes: row.notes,
        invitedAt: row.invited_at,
        respondedAt: row.responded_at,
        noShowAt: row.no_show_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

adminEventStaffing.get('/', requireCapability('staff.events.read'), async (c) => {
    const url = new URL(c.req.url);
    const eventId = url.searchParams.get('event_id');
    const personId = url.searchParams.get('person_id');
    if (!eventId && !personId) {
        return c.json({ error: 'event_id or person_id required' }, 400);
    }

    const where = [];
    const binds = [];
    if (eventId) { where.push('es.event_id = ?'); binds.push(eventId); }
    if (personId) { where.push('es.person_id = ?'); binds.push(personId); }

    const rows = await c.env.DB.prepare(
        `SELECT es.*, p.full_name AS person_name, p.email AS person_email,
                r.name AS role_name, r.tier AS role_tier
         FROM event_staffing es
         INNER JOIN persons p ON p.id = es.person_id
         INNER JOIN roles r ON r.id = es.role_id
         WHERE ${where.join(' AND ')}
         ORDER BY es.shift_start_at, p.full_name`,
    ).bind(...binds).all();

    return c.json({
        assignments: (rows.results || []).map((r) => ({
            ...format(r),
            personName: r.person_name,
            personEmail: r.person_email,
            roleName: r.role_name,
            roleTier: r.role_tier,
        })),
    });
});

adminEventStaffing.post('/', requireCapability('staff.events.assign'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { eventId, personId, roleId, shiftStartAt, shiftEndAt,
            payKind, payRateCents, notes } = body || {};
    if (!eventId || !personId || !roleId) {
        return c.json({ error: 'eventId, personId, roleId required' }, 400);
    }

    const id = randomEsId();
    const now = Date.now();
    try {
        await c.env.DB.prepare(
            `INSERT INTO event_staffing (id, event_id, person_id, role_id, status,
                                          pay_kind, pay_rate_cents, shift_start_at, shift_end_at,
                                          notes, invited_at, invited_by_user_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
            id, eventId, personId, roleId,
            payKind || null, payRateCents || null,
            shiftStartAt || null, shiftEndAt || null,
            notes || null, now, user.id, now, now,
        ).run();
    } catch {
        return c.json({ error: 'Already assigned to this role on this event' }, 409);
    }

    await writeAudit(c.env, {
        userId: user.id,
        action: 'event_staffing.assigned',
        targetType: 'event_staffing',
        targetId: id,
        meta: { eventId, personId, roleId },
    });

    return c.json({ ok: true, id }, 201);
});

adminEventStaffing.put('/:id', requireCapability('staff.events.assign'), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const allowed = {
        status: 'status', payKind: 'pay_kind', payRateCents: 'pay_rate_cents',
        shiftStartAt: 'shift_start_at', shiftEndAt: 'shift_end_at', notes: 'notes',
        respondedAt: 'responded_at',
    };
    const sets = [];
    const binds = [];
    for (const [camel, sql] of Object.entries(allowed)) {
        if (camel in body) { sets.push(`${sql} = ?`); binds.push(body[camel]); }
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);

    sets.push('updated_at = ?');
    binds.push(Date.now());
    binds.push(id);

    const r = await c.env.DB.prepare(
        `UPDATE event_staffing SET ${sets.join(', ')} WHERE id = ?`,
    ).bind(...binds).run();
    if (!r?.meta?.changes) return c.json({ error: 'Not found' }, 404);

    const user = c.get('user');
    await writeAudit(c.env, {
        userId: user.id,
        action: 'event_staffing.updated',
        targetType: 'event_staffing',
        targetId: id,
        meta: { fields: Object.keys(body) },
    });

    return c.json({ ok: true });
});

adminEventStaffing.post('/:id/no-show', requireCapability('staff.events.mark_no_show'), async (c) => {
    const id = c.req.param('id');
    const now = Date.now();
    const r = await c.env.DB.prepare(
        `UPDATE event_staffing SET status = 'no_show', no_show_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('pending','confirmed')`,
    ).bind(now, now, id).run();
    if (!r?.meta?.changes) return c.json({ error: 'Not found or not in markable state' }, 404);

    const user = c.get('user');
    await writeAudit(c.env, {
        userId: user.id,
        action: 'event_staffing.no_show',
        targetType: 'event_staffing',
        targetId: id,
    });
    return c.json({ ok: true });
});

adminEventStaffing.post('/:id/complete', requireCapability('staff.events.assign'), async (c) => {
    const id = c.req.param('id');
    const now = Date.now();
    const r = await c.env.DB.prepare(
        `UPDATE event_staffing SET status = 'completed', completed_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('confirmed', 'pending')`,
    ).bind(now, now, id).run();
    if (!r?.meta?.changes) return c.json({ error: 'Not found or not completable' }, 404);

    const user = c.get('user');
    await writeAudit(c.env, {
        userId: user.id,
        action: 'event_staffing.completed',
        targetType: 'event_staffing',
        targetId: id,
    });
    return c.json({ ok: true });
});

adminEventStaffing.delete('/:id', requireCapability('staff.events.assign'), async (c) => {
    const id = c.req.param('id');
    const r = await c.env.DB.prepare(
        `DELETE FROM event_staffing WHERE id = ? AND status = 'pending'`,
    ).bind(id).run();
    if (!r?.meta?.changes) return c.json({ error: 'Not found or not in pending state' }, 404);

    const user = c.get('user');
    await writeAudit(c.env, {
        userId: user.id,
        action: 'event_staffing.removed',
        targetType: 'event_staffing',
        targetId: id,
    });
    return c.json({ ok: true });
});

export default adminEventStaffing;

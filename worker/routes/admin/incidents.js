// C6 (2026-07-27) — admin-side incidents: file, list, resolve.
//
// Before this, an incident could only be FILED through the event-day kiosk
// (/api/event-day/incidents), and could never be RESOLVED at all — the
// incidents table has carried resolved_at / resolved_by_user_id /
// resolution_note since M5 with nothing anywhere writing them.
//
// The kiosk is dead end-to-end (audit A1: event_day_sessions is 0 in
// production, so no session has ever been opened), which means the only path
// to filing an incident does not work. Production has 0 incidents — not
// because none happened, but because there was nowhere to put one.
//
// So this deliberately ships a FILING path too, rather than a resolve-only
// surface for records that cannot exist. The schema anticipated exactly this:
// `filed_by_user_id TEXT REFERENCES users(id) -- when filed by an admin not
// via portal` has been there since migration 0030.
//
// Gating: reads are open per the 2026-07-25 open-reads model; writes use the
// owner/manager role gate that booking mutations use. Deliberately NOT the
// `event_day.incident.*` capabilities — those are scoped to the kiosk surface,
// and reusing them would tie an admin action to a dead one. A dedicated
// `incidents.*` capability set would need a migration and another
// operator-pending item for no gain at four staff, all owners.

import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { requireReadAccess } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';
import { randomId } from '../../lib/ids.js';

const adminIncidents = new Hono();
adminIncidents.use('*', requireAuth);

const INCIDENT_TYPES = new Set(['injury', 'dispute', 'safety', 'equipment', 'weather', 'other']);
const SEVERITY_LEVELS = new Set(['minor', 'moderate', 'serious']);

function formatIncident(row) {
    return {
        id: row.id,
        eventId: row.event_id,
        eventTitle: row.event_title || null,
        type: row.type,
        severity: row.severity,
        location: row.location || null,
        narrative: row.narrative || null,
        filedAt: row.filed_at,
        filedByUserId: row.filed_by_user_id || null,
        filedByPersonId: row.filed_by_person_id || null,
        filedByName: row.filed_by_name || null,
        escalatedAt: row.escalated_at || null,
        resolvedAt: row.resolved_at || null,
        resolvedByUserId: row.resolved_by_user_id || null,
        resolutionNote: row.resolution_note || null,
    };
}

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/incidents — list, newest first
//   ?status=open|resolved  ?event_id=  ?severity=  ?type=
// ────────────────────────────────────────────────────────────────────
adminIncidents.get('/', requireReadAccess, async (c) => {
    const p = new URL(c.req.url).searchParams;
    const where = [];
    const binds = [];

    const status = p.get('status');
    if (status === 'open') where.push('i.resolved_at IS NULL');
    else if (status === 'resolved') where.push('i.resolved_at IS NOT NULL');

    const eventId = p.get('event_id');
    if (eventId) { where.push('i.event_id = ?'); binds.push(eventId); }

    const severity = p.get('severity');
    if (severity && SEVERITY_LEVELS.has(severity)) { where.push('i.severity = ?'); binds.push(severity); }

    const type = p.get('type');
    if (type && INCIDENT_TYPES.has(type)) { where.push('i.type = ?'); binds.push(type); }

    const limit = Math.min(Number(p.get('limit')) || 100, 200);

    let rows = [];
    try {
        const res = await c.env.DB.prepare(
            `SELECT i.*, e.title AS event_title, u.display_name AS filed_by_name
               FROM incidents i
               LEFT JOIN events e ON e.id = i.event_id
               LEFT JOIN users u ON u.id = i.filed_by_user_id
              ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
              ORDER BY i.filed_at DESC
              LIMIT ?`,
        ).bind(...binds, limit).all();
        rows = res?.results || [];
    } catch {
        rows = [];
    }

    // Counts drive the list's own filter chips, and give the operator a reason
    // to look at all: an unresolved-serious count is the thing worth surfacing.
    let openCount = 0;
    let openSerious = 0;
    try {
        const c1 = await c.env.DB.prepare(
            `SELECT COUNT(*) AS n,
                    SUM(CASE WHEN severity = 'serious' THEN 1 ELSE 0 END) AS serious
               FROM incidents WHERE resolved_at IS NULL`,
        ).first();
        openCount = c1?.n || 0;
        openSerious = c1?.serious || 0;
    } catch { /* table missing on an unmigrated local DB */ }

    return c.json({
        incidents: rows.map(formatIncident),
        summary: { open: openCount, openSerious },
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/incidents — file one from the admin side
// ────────────────────────────────────────────────────────────────────
adminIncidents.post('/', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const eventId = body.eventId ? String(body.eventId).trim() : '';
    if (!eventId) return c.json({ error: 'eventId is required' }, 400);

    const type = body.type ? String(body.type).trim() : '';
    if (!INCIDENT_TYPES.has(type)) {
        return c.json({ error: `type must be one of: ${[...INCIDENT_TYPES].join(', ')}` }, 400);
    }

    const severity = body.severity ? String(body.severity).trim() : 'minor';
    if (!SEVERITY_LEVELS.has(severity)) {
        return c.json({ error: `severity must be one of: ${[...SEVERITY_LEVELS].join(', ')}` }, 400);
    }

    const narrative = body.narrative ? String(body.narrative).trim() : '';
    if (!narrative) return c.json({ error: 'narrative is required' }, 400);

    const event = await c.env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(eventId).first();
    if (!event) return c.json({ error: 'Event not found' }, 404);

    const id = `inc_${randomId(12)}`;
    const now = Date.now();
    // Mirrors the kiosk's rule: a serious incident is escalated on filing.
    const escalatedAt = severity === 'serious' ? now : null;

    await c.env.DB.prepare(
        `INSERT INTO incidents (
            id, event_id, filed_by_person_id, filed_by_user_id, type, severity,
            location, narrative, filed_at, escalated_at, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
        id, eventId, user.id, type, severity,
        body.location ? String(body.location).trim() : null,
        narrative, now, escalatedAt, now, now,
    ).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'incident.filed',
        targetType: 'incident',
        targetId: id,
        meta: { eventId, type, severity, escalated: !!escalatedAt },
    });

    return c.json({ incidentId: id, escalated: !!escalatedAt }, 201);
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/incidents/:id/resolve
//
// The resolution columns have existed since M5 with nothing writing them, so
// every filed incident stayed open forever.
// ────────────────────────────────────────────────────────────────────
adminIncidents.post('/:id/resolve', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const note = body?.note ? String(body.note).trim() : '';
    if (!note) return c.json({ error: 'A resolution note is required' }, 400);

    const row = await c.env.DB.prepare('SELECT id, resolved_at FROM incidents WHERE id = ?').bind(id).first();
    if (!row) return c.json({ error: 'Incident not found' }, 404);
    if (row.resolved_at) return c.json({ error: 'Incident is already resolved' }, 409);

    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE incidents
            SET resolved_at = ?, resolved_by_user_id = ?, resolution_note = ?, updated_at = ?
          WHERE id = ?`,
    ).bind(now, user.id, note, now, id).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'incident.resolved',
        targetType: 'incident',
        targetId: id,
        meta: { note },
    });

    return c.json({ incidentId: id, resolvedAt: now });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/incidents/:id/reopen — resolving is not a one-way trip
// ────────────────────────────────────────────────────────────────────
adminIncidents.post('/:id/reopen', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');

    const result = await c.env.DB.prepare(
        `UPDATE incidents
            SET resolved_at = NULL, resolved_by_user_id = NULL, resolution_note = NULL, updated_at = ?
          WHERE id = ? AND resolved_at IS NOT NULL`,
    ).bind(Date.now(), id).run();

    if (!result?.meta?.changes) return c.json({ error: 'Not found or not resolved' }, 404);

    await writeAudit(c.env, {
        userId: user.id,
        action: 'incident.reopened',
        targetType: 'incident',
        targetId: id,
        meta: {},
    });

    return c.json({ incidentId: id, resolvedAt: null });
});

export default adminIncidents;

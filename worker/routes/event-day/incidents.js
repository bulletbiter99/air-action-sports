// M5 R14 — Event-day incident reporting endpoints (Surface 5).
//
// Mounted at /api/event-day/incidents. Routes:
//   POST  /         — file an incident; serious-severity sets
//                     escalated_at = now (M5 prompt: "escalates to
//                     Owner"). All endpoints gated by R12's
//                     requireEventDayAuth.
//   GET   /:id      — read a previously filed incident; filters to
//                     active event_id (security: cannot read other
//                     events' incidents).
//
// Fixes the production bug noted in the rework prompt:
//   IncidentReport.jsx posts to /api/event-day/incidents which did
//   not exist; the form 404'd on submit. R14 ships the route.
//
// Schema reference: migrations/0038_incidents_and_charges_schema.sql
//   - incidents (id, event_id, type, severity, location, narrative,
//     filed_by_person_id, filed_at, escalated_at, ip_address, ...)
//   - incident_persons (incident_id, person_id?, attendee_id?,
//     free_text_name?, involvement)
//   - incident_attachments — schema only; upload flow is post-R14.

import { Hono } from 'hono';
import {
    requireEventDayAuth,
    bumpActivityCounter,
} from '../../lib/eventDaySession.js';
import { writeAudit } from '../../lib/auditLog.js';

const eventDayIncidents = new Hono();
eventDayIncidents.use('*', requireEventDayAuth);

const INCIDENT_TYPES = new Set(['injury', 'dispute', 'safety', 'equipment', 'weather', 'other']);
const SEVERITY_LEVELS = new Set(['minor', 'moderate', 'serious']);
const INVOLVEMENT_DEFAULT = 'witness';

// ────────────────────────────────────────────────────────────────────
// Internal id generator — `inc_<random12>` per migration shape.
// ────────────────────────────────────────────────────────────────────

function randomIncidentId(prefix = 'inc') {
    const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return `${prefix}_${out}`;
}

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/incidents
// ────────────────────────────────────────────────────────────────────

eventDayIncidents.post('/', async (c) => {
    const event = c.get('event');
    const session = c.get('eventDaySession');
    const person = c.get('person');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'invalid_body' }, 400);

    const type = String(body.type || '').trim();
    const severity = String(body.severity || 'minor').trim();
    const narrative = String(body.narrative || '').trim();
    const location = body.location ? String(body.location).trim() : null;
    const personsInvolvedRaw = String(body.personsInvolved || '').trim();

    if (!type || !INCIDENT_TYPES.has(type)) {
        return c.json({ error: 'invalid_type', allowed: [...INCIDENT_TYPES] }, 400);
    }
    if (!SEVERITY_LEVELS.has(severity)) {
        return c.json({ error: 'invalid_severity', allowed: [...SEVERITY_LEVELS] }, 400);
    }
    if (!narrative) {
        return c.json({ error: 'narrative_required' }, 400);
    }

    const id = randomIncidentId('inc');
    const now = Date.now();
    const escalatedAt = severity === 'serious' ? now : null;
    const ipAddress = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
    const userAgent = c.req.header('user-agent') || null;

    await c.env.DB.prepare(
        `INSERT INTO incidents (
            id, event_id, filed_by_person_id, filed_by_user_id,
            type, severity, location, narrative,
            filed_at, escalated_at, resolved_at, resolved_by_user_id, resolution_note,
            ip_address, user_agent, created_at, updated_at
         ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`,
    ).bind(
        id, event.id, person?.id || null,
        type, severity, location, narrative,
        now, escalatedAt,
        ipAddress, userAgent, now, now,
    ).run();

    // Persist persons-involved as a comma-separated list of free-text
    // names. The form is a single text field; structured persons can be
    // added in a future R-batch via a different UI flow.
    if (personsInvolvedRaw) {
        const names = personsInvolvedRaw
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
            .slice(0, 20); // defensive cap

        for (const name of names) {
            await c.env.DB.prepare(
                `INSERT INTO incident_persons (
                    id, incident_id, person_id, attendee_id, free_text_name, involvement, notes, created_at
                 ) VALUES (?, ?, NULL, NULL, ?, ?, NULL, ?)`,
            ).bind(
                randomIncidentId('inp'),
                id,
                name,
                INVOLVEMENT_DEFAULT,
                now,
            ).run();
        }
    }

    // Bump counter on the event_day_session for HQ dashboard visibility.
    await bumpActivityCounter(c.env, session.id, 'incident');

    // Distinct audit actions so investigators can filter on serious
    // incidents specifically. Reason fields are positionally bound
    // (lessons-learned #3) inside meta_json.
    const auditAction = severity === 'serious' ? 'event_day.incident_escalated' : 'event_day.incident_filed';
    await writeAudit(c.env, {
        userId: null,
        action: auditAction,
        targetType: 'incident',
        targetId: id,
        meta: {
            type,
            severity,
            eventId: event.id,
            personId: person?.id || null,
            sessionId: session.id,
            location: location || undefined,
            escalatedAt: escalatedAt || undefined,
        },
    });

    return c.json({
        ok: true,
        incidentId: id,
        escalated: severity === 'serious',
    });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/event-day/incidents/:id
// ────────────────────────────────────────────────────────────────────

eventDayIncidents.get('/:id', async (c) => {
    const event = c.get('event');
    const id = c.req.param('id');

    const row = await c.env.DB.prepare(
        'SELECT * FROM incidents WHERE id = ?',
    ).bind(id).first();

    if (!row) return c.json({ error: 'incident_not_found' }, 404);
    if (row.event_id !== event.id) return c.json({ error: 'wrong_event' }, 404);

    const personsResult = await c.env.DB.prepare(
        `SELECT id, person_id, attendee_id, free_text_name, involvement, notes
         FROM incident_persons WHERE incident_id = ?
         ORDER BY created_at ASC`,
    ).bind(id).all();

    return c.json({
        incident: {
            id: row.id,
            eventId: row.event_id,
            filedByPersonId: row.filed_by_person_id,
            type: row.type,
            severity: row.severity,
            location: row.location,
            narrative: row.narrative,
            filedAt: row.filed_at,
            escalatedAt: row.escalated_at,
            resolvedAt: row.resolved_at,
            resolutionNote: row.resolution_note,
        },
        persons: (personsResult.results || []).map((p) => ({
            id: p.id,
            personId: p.person_id,
            attendeeId: p.attendee_id,
            freeTextName: p.free_text_name,
            involvement: p.involvement,
            notes: p.notes,
        })),
    });
});

export default eventDayIncidents;

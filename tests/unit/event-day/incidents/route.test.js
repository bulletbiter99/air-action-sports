// M5 R14 — event-day incidents route tests.
// Covers POST /api/event-day/incidents and GET /:id with the
// requireEventDayAuth gate, severity escalation, persons-involved
// splitting, and active-event scoping.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createPortalCookie } from '../../../../worker/lib/portalSession.js';

const SECRET = 'test_session_secret_must_be_at_least_32_bytes_long_padding';
const PORTAL_SESSION_ID = 'ps_test_001';
const PERSON_ID = 'prs_test_001';
const EVENT_ID = 'evt_test_001';
const EVENT_DAY_SESSION_ID = 'eds_aBcDeF012345';
const INCIDENT_ID = 'inc_existing12';

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

async function buildPortalCookie() {
    const value = await createPortalCookie(PORTAL_SESSION_ID, 1, SECRET);
    return `aas_portal_session=${value}`;
}

let env;
beforeEach(() => {
    env = createMockEnv();
});

function bindEventDaySession() {
    env.DB.__on(/SELECT \* FROM event_day_sessions WHERE id = \?/, {
        id: EVENT_DAY_SESSION_ID,
        event_id: EVENT_ID,
        person_id: PERSON_ID,
        portal_session_id: PORTAL_SESSION_ID,
        signed_out_at: null,
    }, 'first');
    env.DB.__on(/SELECT id, date_iso, past FROM events WHERE id = \?/, {
        id: EVENT_ID, date_iso: todayIso(), past: 0,
    }, 'first');
    env.DB.__on(/SELECT id, full_name, email FROM persons WHERE id = \?/, {
        id: PERSON_ID, full_name: 'Test Marshal', email: 'm@e.com',
    }, 'first');
}

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/incidents
// ────────────────────────────────────────────────────────────────────

describe('POST /api/event-day/incidents', () => {
    it('returns 401 without portal cookie', async () => {
        const req = new Request('https://airactionsport.com/api/event-day/incidents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'injury', severity: 'minor', narrative: 'twisted ankle' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 401 without event-day session cookie', async () => {
        const cookie = await buildPortalCookie();
        const req = new Request('https://airactionsport.com/api/event-day/incidents', {
            method: 'POST',
            headers: { cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'injury', severity: 'minor', narrative: 'x' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 400 invalid_type when type missing or unknown', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        for (const body of [{}, { type: 'evil_type', severity: 'minor', narrative: 'x' }]) {
            const req = new Request('https://airactionsport.com/api/event-day/incidents', {
                method: 'POST',
                headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const res = await worker.fetch(req, env, {});
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('invalid_type');
        }
    });

    it('returns 400 invalid_severity when severity is unknown', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        const req = new Request('https://airactionsport.com/api/event-day/incidents', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'injury', severity: 'catastrophic', narrative: 'x' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('invalid_severity');
    });

    it('returns 400 narrative_required when narrative empty', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        const req = new Request('https://airactionsport.com/api/event-day/incidents', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'injury', severity: 'minor', narrative: '   ' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('narrative_required');
    });

    it('returns 200 + writes incident row + bumps counter on minor injury', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/INSERT INTO incidents/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE event_day_sessions/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/event-day/incidents', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'injury',
                severity: 'minor',
                narrative: 'Twisted ankle on field 2',
                location: 'Field 2',
            }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.incidentId).toMatch(/^inc_/);
        expect(body.escalated).toBe(false);

        const writes = env.DB.__writes();
        const incidentInsert = writes.find((w) => /INSERT INTO incidents/.test(w.sql));
        expect(incidentInsert).toBeDefined();
        // Args: id, event_id, filed_by_person_id, type, severity, location, narrative, ...
        expect(incidentInsert.args).toContain(EVENT_ID);
        expect(incidentInsert.args).toContain(PERSON_ID);
        expect(incidentInsert.args).toContain('injury');
        expect(incidentInsert.args).toContain('minor');
        expect(incidentInsert.args).toContain('Field 2');
        expect(incidentInsert.args).toContain('Twisted ankle on field 2');
        // escalated_at = null for minor
        expect(incidentInsert.args).toContain(null);

        // Counter bump
        const counterWrite = writes.find((w) =>
            /UPDATE event_day_sessions/.test(w.sql) && /incidents_filed/.test(w.sql)
        );
        expect(counterWrite).toBeDefined();

        // Audit row uses the non-escalated action
        const auditWrite = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'event_day.incident_filed')
        );
        expect(auditWrite).toBeDefined();
    });

    it('escalates serious-severity: sets escalated_at + uses _escalated audit action', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/INSERT INTO incidents/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE event_day_sessions/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/event-day/incidents', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'safety',
                severity: 'serious',
                narrative: 'Player struck eye-protection failed',
            }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.escalated).toBe(true);

        const writes = env.DB.__writes();
        // The 'serious' literal is bound positionally, escalated_at is a non-null number
        const incidentInsert = writes.find((w) => /INSERT INTO incidents/.test(w.sql));
        expect(incidentInsert.args).toContain('serious');
        // Find the escalated_at: it should be a recent timestamp
        const numericArgs = incidentInsert.args.filter((a) => typeof a === 'number');
        expect(numericArgs.length).toBeGreaterThan(0);

        // Audit row has _escalated action
        const auditWrite = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'event_day.incident_escalated')
        );
        expect(auditWrite).toBeDefined();
    });

    it('splits personsInvolved on commas + inserts incident_persons rows with witness involvement', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/INSERT INTO incidents/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO incident_persons/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE event_day_sessions/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/event-day/incidents', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'dispute',
                severity: 'moderate',
                narrative: 'Heated argument',
                personsInvolved: 'Alice, Bob, Charlie',
            }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const personInserts = writes.filter((w) => /INSERT INTO incident_persons/.test(w.sql));
        expect(personInserts).toHaveLength(3);

        const names = personInserts.map((w) => w.args.find((a) => typeof a === 'string' && ['Alice', 'Bob', 'Charlie'].includes(a)));
        expect(names).toEqual(expect.arrayContaining(['Alice', 'Bob', 'Charlie']));

        // All persons have 'witness' involvement
        for (const w of personInserts) {
            expect(w.args).toContain('witness');
        }
    });

    it('does not insert any incident_persons rows when personsInvolved is empty', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/INSERT INTO incidents/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE event_day_sessions/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/event-day/incidents', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'weather',
                severity: 'minor',
                narrative: 'Light rain forced delay',
            }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const personInserts = writes.filter((w) => /INSERT INTO incident_persons/.test(w.sql));
        expect(personInserts).toHaveLength(0);
    });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/event-day/incidents/:id
// ────────────────────────────────────────────────────────────────────

describe('GET /api/event-day/incidents/:id', () => {
    it('returns 404 when incident does not exist', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/SELECT \* FROM incidents WHERE id = \?/, null, 'first');

        const req = new Request(`https://airactionsport.com/api/event-day/incidents/${INCIDENT_ID}`, {
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.error).toBe('incident_not_found');
    });

    it('returns 404 wrong_event when incident belongs to a different event (security)', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/SELECT \* FROM incidents WHERE id = \?/, {
            id: INCIDENT_ID,
            event_id: 'evt_DIFFERENT',
            type: 'injury',
            severity: 'minor',
            narrative: 'x',
        }, 'first');

        const req = new Request(`https://airactionsport.com/api/event-day/incidents/${INCIDENT_ID}`, {
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.error).toBe('wrong_event');
    });

    it('returns 200 with incident + persons array on happy path', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/SELECT \* FROM incidents WHERE id = \?/, {
            id: INCIDENT_ID,
            event_id: EVENT_ID,
            filed_by_person_id: PERSON_ID,
            type: 'injury',
            severity: 'moderate',
            location: 'Field 1',
            narrative: 'Slip + bruise',
            filed_at: 1700000000000,
            escalated_at: null,
            resolved_at: null,
            resolution_note: null,
        }, 'first');
        env.DB.__on(/FROM incident_persons WHERE incident_id = \?/, {
            results: [
                { id: 'inp_1', person_id: null, attendee_id: null, free_text_name: 'Alice', involvement: 'witness', notes: null },
                { id: 'inp_2', person_id: null, attendee_id: null, free_text_name: 'Bob', involvement: 'witness', notes: null },
            ],
        }, 'all');

        const req = new Request(`https://airactionsport.com/api/event-day/incidents/${INCIDENT_ID}`, {
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.incident.id).toBe(INCIDENT_ID);
        expect(body.incident.type).toBe('injury');
        expect(body.incident.severity).toBe('moderate');
        expect(body.incident.location).toBe('Field 1');
        expect(body.persons).toHaveLength(2);
        expect(body.persons[0].freeTextName).toBe('Alice');
        expect(body.persons[1].freeTextName).toBe('Bob');
    });
});

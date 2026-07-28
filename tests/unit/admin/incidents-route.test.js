// C6 (2026-07-27) — admin incidents: file, list, resolve, reopen.
//
// Before this, an incident could only be FILED through the event-day kiosk
// (dead end-to-end — event_day_sessions is 0 in production) and could never be
// RESOLVED at all: incidents.resolved_at / resolved_by_user_id /
// resolution_note have existed since migration 0030 with nothing writing them.
//
// Production has 0 incidents, which is why this ships a filing path rather
// than a resolve-only surface for records that cannot exist.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

const INC = 'inc_1';
let env, cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    ({ cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' }));
});

const req = (path, init = {}) => new Request(`https://airactionsport.com${path}`, init);
const post = (path, body, e = env, cookie = cookieHeader) => worker.fetch(
    req(path, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
    }), e, {},
);
const get = (path) => worker.fetch(req(path, { headers: { cookie: cookieHeader } }), env, {});

function bindEvent() {
    env.DB.__on(/SELECT id FROM events WHERE id = \?/, { id: 'ev_1' }, 'first');
}

describe('POST /api/admin/incidents — filing from the admin side', () => {
    it('files a minor incident, stamping filed_by_user_id rather than a person', async () => {
        bindEvent();
        const inserts = [];
        env.DB.__on(/INSERT INTO incidents/, (sql, args) => { inserts.push({ sql, args }); return {}; }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, {}, 'run');

        const res = await post('/api/admin/incidents', {
            eventId: 'ev_1', type: 'injury', severity: 'minor', narrative: 'Rolled ankle on the north berm.',
        });
        expect(res.status).toBe(201);
        const j = await res.json();
        expect(j.incidentId).toMatch(/^inc_/);
        expect(j.escalated).toBe(false);

        expect(inserts).toHaveLength(1);
        // filed_by_person_id is NULL, filed_by_user_id is the admin — the
        // column the schema added for exactly this ("filed by an admin not
        // via portal").
        expect(inserts[0].sql).toMatch(/filed_by_person_id/);
        expect(inserts[0].args[2]).toBe('u_owner');
    });

    it('escalates a serious incident on filing, matching the kiosk rule', async () => {
        bindEvent();
        const inserts = [];
        env.DB.__on(/INSERT INTO incidents/, (sql, args) => { inserts.push(args); return {}; }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, {}, 'run');

        const res = await post('/api/admin/incidents', {
            eventId: 'ev_1', type: 'injury', severity: 'serious', narrative: 'Ambulance called.',
        });
        expect((await res.json()).escalated).toBe(true);
        // escalated_at is bind 9 (0-indexed 9): id,event,user,type,sev,loc,narrative,filed_at,escalated_at
        expect(inserts[0][8]).toEqual(expect.any(Number));
    });

    it('does not escalate minor or moderate', async () => {
        for (const severity of ['minor', 'moderate']) {
            const e = createMockEnv();
            const s = await createAdminSession(e, { id: 'u_owner', role: 'owner' });
            e.DB.__on(/SELECT id FROM events WHERE id = \?/, { id: 'ev_1' }, 'first');
            e.DB.__on(/INSERT INTO incidents/, {}, 'run');
            e.DB.__on(/INSERT INTO audit_log/, {}, 'run');
            const res = await post('/api/admin/incidents', {
                eventId: 'ev_1', type: 'safety', severity, narrative: 'x',
            }, e, s.cookieHeader);
            expect((await res.json()).escalated, severity).toBe(false);
        }
    });

    it('rejects an unknown type or severity, listing what is allowed', async () => {
        bindEvent();
        const bad = await post('/api/admin/incidents', { eventId: 'ev_1', type: 'meteor', narrative: 'x' });
        expect(bad.status).toBe(400);
        expect((await bad.json()).error).toMatch(/type must be one of/);

        const bad2 = await post('/api/admin/incidents', { eventId: 'ev_1', type: 'safety', severity: 'catastrophic', narrative: 'x' });
        expect(bad2.status).toBe(400);
        expect((await bad2.json()).error).toMatch(/severity must be one of/);
    });

    it('requires a narrative — an incident with no account of it is useless', async () => {
        bindEvent();
        const res = await post('/api/admin/incidents', { eventId: 'ev_1', type: 'safety', narrative: '   ' });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/narrative is required/);
    });

    it('404s for an unknown event rather than orphaning the row', async () => {
        env.DB.__on(/SELECT id FROM events WHERE id = \?/, null, 'first');
        const res = await post('/api/admin/incidents', { eventId: 'nope', type: 'safety', narrative: 'x' });
        expect(res.status).toBe(404);
    });

    it('403s for staff — writes stay gated under the open-reads model', async () => {
        const e = createMockEnv();
        const s = await createAdminSession(e, { id: 'u_staff', role: 'staff' });
        const res = await post('/api/admin/incidents', { eventId: 'ev_1', type: 'safety', narrative: 'x' }, e, s.cookieHeader);
        expect(res.status).toBe(403);
    });
});

describe('POST /:id/resolve', () => {
    it('stamps the resolution and audits it', async () => {
        env.DB.__on(/SELECT id, resolved_at FROM incidents WHERE id = \?/, { id: INC, resolved_at: null }, 'first');
        const updates = [];
        env.DB.__on(/UPDATE incidents/, (sql, args) => { updates.push({ sql, args }); return {}; }, 'run');
        const audits = [];
        env.DB.__on(/INSERT INTO audit_log/, (sql, args) => { audits.push({ sql, args }); return {}; }, 'run');

        const res = await post(`/api/admin/incidents/${INC}/resolve`, { note: 'Treated on site, player continued.' });
        expect(res.status).toBe(200);
        expect(updates[0].sql).toMatch(/resolved_by_user_id = \?/);
        expect(updates[0].args[1]).toBe('u_owner');
        expect(updates[0].args[2]).toBe('Treated on site, player continued.');
        // writeAudit BINDS the action (the raw INSERTs elsewhere inline it).
        expect(audits.some((a) => a.args.includes('incident.resolved'))).toBe(true);
    });

    it('requires a note — the note IS the record of how it was closed', async () => {
        const updates = [];
        env.DB.__on(/UPDATE incidents/, (sql, args) => { updates.push(args); return {}; }, 'run');
        const res = await post(`/api/admin/incidents/${INC}/resolve`, { note: '  ' });
        expect(res.status).toBe(400);
        expect(updates).toHaveLength(0);
    });

    it('409s an already-resolved incident rather than overwriting the first resolution', async () => {
        env.DB.__on(/SELECT id, resolved_at FROM incidents WHERE id = \?/, { id: INC, resolved_at: 123 }, 'first');
        const res = await post(`/api/admin/incidents/${INC}/resolve`, { note: 'again' });
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/already resolved/);
    });

    it('404s an unknown incident', async () => {
        env.DB.__on(/SELECT id, resolved_at FROM incidents WHERE id = \?/, null, 'first');
        expect((await post(`/api/admin/incidents/${INC}/resolve`, { note: 'x' })).status).toBe(404);
    });
});

describe('POST /:id/reopen — resolving is not a one-way trip', () => {
    it('clears the resolution columns and audits', async () => {
        const updates = [];
        env.DB.__on(/UPDATE incidents/, (sql, args) => {
            updates.push({ sql, args });
            return { meta: { changes: 1 } };
        }, 'run');
        const audits = [];
        env.DB.__on(/INSERT INTO audit_log/, (sql, args) => { audits.push(args); return {}; }, 'run');

        const res = await post(`/api/admin/incidents/${INC}/reopen`);
        expect(res.status).toBe(200);
        expect(updates[0].sql).toMatch(/resolved_at = NULL/);
        expect(updates[0].sql).toMatch(/resolution_note = NULL/);
        // Guarded, so reopening an open incident is a no-op not a silent success.
        expect(updates[0].sql).toMatch(/resolved_at IS NOT NULL/);
        expect(audits.some((a) => a.includes('incident.reopened'))).toBe(true);
    });

    it('404s when the incident was not resolved', async () => {
        env.DB.__on(/UPDATE incidents/, { meta: { changes: 0 } }, 'run');
        expect((await post(`/api/admin/incidents/${INC}/reopen`)).status).toBe(404);
    });
});

describe('GET /api/admin/incidents', () => {
    function bindList(rows) {
        env.DB.__on(/FROM incidents i/, { results: rows }, 'all');
        env.DB.__on(/SELECT COUNT\(\*\) AS n/, { n: rows.length, serious: rows.filter((r) => r.severity === 'serious').length }, 'first');
    }

    it('returns incidents with the event title and a summary', async () => {
        bindList([
            { id: INC, event_id: 'ev_1', event_title: 'Operation Last Light', type: 'injury',
              severity: 'serious', filed_at: 1, resolved_at: null, narrative: 'x' },
        ]);
        const res = await get('/api/admin/incidents?status=open');
        expect(res.status).toBe(200);
        const j = await res.json();
        expect(j.incidents[0].eventTitle).toBe('Operation Last Light');
        expect(j.summary).toEqual({ open: 1, openSerious: 1 });
    });

    it('filters open vs resolved in SQL, not client-side', async () => {
        let captured = '';
        env.DB.__on(/FROM incidents i/, (sql) => { captured = sql; return { results: [] }; }, 'all');
        env.DB.__on(/SELECT COUNT\(\*\) AS n/, { n: 0, serious: 0 }, 'first');

        await get('/api/admin/incidents?status=open');
        expect(captured).toMatch(/resolved_at IS NULL/);

        const e2 = createMockEnv();
        const s2 = await createAdminSession(e2, { id: 'u2', role: 'owner' });
        let captured2 = '';
        e2.DB.__on(/FROM incidents i/, (sql) => { captured2 = sql; return { results: [] }; }, 'all');
        e2.DB.__on(/SELECT COUNT\(\*\) AS n/, { n: 0, serious: 0 }, 'first');
        await worker.fetch(req('/api/admin/incidents?status=resolved', { headers: { cookie: s2.cookieHeader } }), e2, {});
        expect(captured2).toMatch(/resolved_at IS NOT NULL/);
    });

    it('ignores an unknown severity filter rather than returning nothing', async () => {
        let captured = '';
        env.DB.__on(/FROM incidents i/, (sql) => { captured = sql; return { results: [] }; }, 'all');
        env.DB.__on(/SELECT COUNT\(\*\) AS n/, { n: 0, serious: 0 }, 'first');
        await get('/api/admin/incidents?severity=apocalyptic');
        expect(captured).not.toMatch(/i\.severity = \?/);
    });

    it('is readable by staff — reads are open, writes are not', async () => {
        const e = createMockEnv();
        const s = await createAdminSession(e, { id: 'u_staff', role: 'staff' });
        e.DB.__on(/FROM incidents i/, { results: [] }, 'all');
        e.DB.__on(/SELECT COUNT\(\*\) AS n/, { n: 0, serious: 0 }, 'first');
        const res = await worker.fetch(req('/api/admin/incidents', { headers: { cookie: s.cookieHeader } }), e, {});
        expect(res.status).toBe(200);
    });
});

// Post-M5.5 P4 — tests for GET /api/admin/staff/:id/incidents.
//
// Returns two lists:
//   filedBy   — incidents where i.filed_by_person_id = personId
//   involving — incidents where the person appears in incident_persons
// Status per row (server-computed):
//   resolved_at NOT NULL → 'resolved'
//   escalated_at NOT NULL → 'escalated'
//   else → 'open'

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';

let env;
let cookieHeader;
const PERSON_ID = 'prs_1';
const now = Date.now();

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

async function fetchIncidents() {
    return worker.fetch(
        new Request(`https://airactionsport.com/api/admin/staff/${PERSON_ID}/incidents`, {
            headers: { cookie: cookieHeader },
        }),
        env, {},
    );
}

describe('GET /api/admin/staff/:id/incidents', () => {
    it('returns 403 when caller lacks staff.read', async () => {
        bindCapabilities(env.DB, 'u_owner', []);
        const res = await fetchIncidents();
        expect(res.status).toBe(403);
    });

    it('returns empty lists when person has no incidents on file', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        env.DB.__on(/WHERE i\.filed_by_person_id = \?/, { results: [] }, 'all');
        env.DB.__on(/FROM incident_persons ip/, { results: [] }, 'all');

        const res = await fetchIncidents();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ filedBy: [], involving: [] });
    });

    it('returns filedBy rows with computed status across open / escalated / resolved', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        env.DB.__on(/WHERE i\.filed_by_person_id = \?/, {
            results: [
                {
                    id: 'inc_open', event_id: 'ev_1', event_title: 'Op Night',
                    type: 'safety', severity: 'minor', location: 'Field 1',
                    narrative: 'Tripping hazard noted near bunker', filed_at: now - 3600000,
                    escalated_at: null, resolved_at: null, resolution_note: null,
                },
                {
                    id: 'inc_escalated', event_id: 'ev_1', event_title: 'Op Night',
                    type: 'injury', severity: 'moderate', location: 'CQB',
                    narrative: '...', filed_at: now - 7200000,
                    escalated_at: now - 7100000, resolved_at: null, resolution_note: null,
                },
                {
                    id: 'inc_resolved', event_id: 'ev_0', event_title: 'Op Prior',
                    type: 'equipment', severity: 'minor', location: null,
                    narrative: '...', filed_at: now - 86400000 * 2,
                    escalated_at: null, resolved_at: now - 86400000, resolution_note: 'Replaced.',
                },
            ],
        }, 'all');
        env.DB.__on(/FROM incident_persons ip/, { results: [] }, 'all');

        const res = await fetchIncidents();
        expect(res.status).toBe(200);
        const body = await res.json();
        const byId = Object.fromEntries(body.filedBy.map((i) => [i.id, i]));
        expect(byId.inc_open.status).toBe('open');
        expect(byId.inc_escalated.status).toBe('escalated');
        expect(byId.inc_resolved.status).toBe('resolved');
        // Camel-cased contract
        expect(byId.inc_open).toMatchObject({
            eventId: 'ev_1', eventTitle: 'Op Night', filedAt: expect.any(Number),
            severity: 'minor', type: 'safety', resolvedAt: null,
        });
    });

    it('returns involving rows with involvement + involvementNotes', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        env.DB.__on(/WHERE i\.filed_by_person_id = \?/, { results: [] }, 'all');
        env.DB.__on(/FROM incident_persons ip/, {
            results: [
                {
                    id: 'inc_witness', event_id: 'ev_2', event_title: 'Field Test',
                    type: 'dispute', severity: 'minor', location: null,
                    narrative: 'Two players disagreed on a hit call', filed_at: now - 5000,
                    escalated_at: null, resolved_at: null, resolution_note: null,
                    involvement: 'witness', involvement_notes: 'Saw the exchange from 10m away',
                },
                {
                    id: 'inc_victim', event_id: 'ev_2', event_title: 'Field Test',
                    type: 'injury', severity: 'serious', location: 'Hill',
                    narrative: 'Sprained ankle', filed_at: now - 10000,
                    escalated_at: now - 9000, resolved_at: now - 8000, resolution_note: 'Transport to ER',
                    involvement: 'victim', involvement_notes: null,
                },
            ],
        }, 'all');

        const res = await fetchIncidents();
        const body = await res.json();
        expect(body.involving).toHaveLength(2);
        const witness = body.involving.find((i) => i.id === 'inc_witness');
        expect(witness.involvement).toBe('witness');
        expect(witness.involvementNotes).toBe('Saw the exchange from 10m away');
        expect(witness.status).toBe('open');

        const victim = body.involving.find((i) => i.id === 'inc_victim');
        expect(victim.involvement).toBe('victim');
        expect(victim.severity).toBe('serious');
        expect(victim.status).toBe('resolved'); // resolved_at takes precedence over escalated_at
    });
});

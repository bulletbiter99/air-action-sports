// M5 R15 — event-day checklists route tests.
// Covers GET / + POST /:id/items/:itemId/toggle gated by
// requireEventDayAuth.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createPortalCookie } from '../../../../worker/lib/portalSession.js';

const SECRET = 'test_session_secret_must_be_at_least_32_bytes_long_padding';
const PORTAL_SESSION_ID = 'ps_test_001';
const PERSON_ID = 'prs_test_001';
const EVENT_ID = 'evt_test_001';
const EVENT_DAY_SESSION_ID = 'eds_aBcDeF012345';
const CHECKLIST_ID = 'echk_test_001';
const ITEM_ID = 'echki_test_001';

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
// GET /api/event-day/checklists
// ────────────────────────────────────────────────────────────────────

describe('GET /api/event-day/checklists', () => {
    it('returns 401 without portal cookie', async () => {
        const req = new Request('https://airactionsport.com/api/event-day/checklists');
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 401 without event-day session cookie', async () => {
        const cookie = await buildPortalCookie();
        const req = new Request('https://airactionsport.com/api/event-day/checklists', {
            headers: { cookie },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 200 with nested checklists+items shape on happy path', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM event_checklists\s+WHERE event_id = \?/, {
            results: [
                {
                    id: CHECKLIST_ID, template_id: 'ckt_1',
                    slug: 'pre_event_safety', title: 'Pre-event safety', role_key: 'lead_marshal',
                    completed_at: null, completed_by_person_id: null, created_at: 1700000000000,
                },
            ],
        }, 'all');
        env.DB.__on(/FROM event_checklist_items\s+WHERE event_checklist_id = \?/, {
            results: [
                { id: ITEM_ID, template_item_id: 'cti_a', position: 10, label: 'Briefing', required: 1, done_at: null, done_by_person_id: null, notes: null },
                { id: 'echki_2', template_item_id: 'cti_b', position: 20, label: 'Chronograph', required: 1, done_at: 1700001000000, done_by_person_id: 'prs_1', notes: null },
            ],
        }, 'all');

        const req = new Request('https://airactionsport.com/api/event-day/checklists', {
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.eventId).toBe(EVENT_ID);
        expect(body.total).toBe(1);
        expect(body.completed).toBe(0);
        expect(body.checklists).toHaveLength(1);
        expect(body.checklists[0]).toMatchObject({
            id: CHECKLIST_ID,
            slug: 'pre_event_safety',
            title: 'Pre-event safety',
            roleKey: 'lead_marshal',
            completedAt: null,
        });
        expect(body.checklists[0].items).toHaveLength(2);
    });

    it('returns 200 with empty array when no checklists instantiated', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM event_checklists\s+WHERE event_id = \?/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/event-day/checklists', {
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.checklists).toEqual([]);
        expect(body.total).toBe(0);
        expect(body.completed).toBe(0);
    });

    it('reports completed count when checklists have completed_at', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM event_checklists\s+WHERE event_id = \?/, {
            results: [
                { id: 'echk_1', template_id: 't', slug: 's1', title: 'A', role_key: null, completed_at: 1700001000000, completed_by_person_id: 'prs_1', created_at: 1 },
                { id: 'echk_2', template_id: 't', slug: 's2', title: 'B', role_key: null, completed_at: null, completed_by_person_id: null, created_at: 2 },
            ],
        }, 'all');
        env.DB.__on(/FROM event_checklist_items\s+WHERE event_checklist_id = \?/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/event-day/checklists', {
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.json();
        expect(body.total).toBe(2);
        expect(body.completed).toBe(1);
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/checklists/:id/items/:itemId/toggle
// ────────────────────────────────────────────────────────────────────

describe('POST /api/event-day/checklists/:id/items/:itemId/toggle', () => {
    it('returns 401 without portal cookie', async () => {
        const req = new Request(
            `https://airactionsport.com/api/event-day/checklists/${CHECKLIST_ID}/items/${ITEM_ID}/toggle`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ done: true }),
            },
        );
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 400 done_required when body.done is missing or not boolean', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        for (const body of [{}, { done: 'yes' }, { done: 1 }]) {
            const req = new Request(
                `https://airactionsport.com/api/event-day/checklists/${CHECKLIST_ID}/items/${ITEM_ID}/toggle`,
                {
                    method: 'POST',
                    headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                },
            );
            const res = await worker.fetch(req, env, {});
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('done_required');
        }
    });

    it('returns 404 item_not_found', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM event_checklist_items eci[\s\S]+INNER JOIN event_checklists ec/, null, 'first');

        const req = new Request(
            `https://airactionsport.com/api/event-day/checklists/${CHECKLIST_ID}/items/${ITEM_ID}/toggle`,
            {
                method: 'POST',
                headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ done: true }),
            },
        );
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.error).toBe('item_not_found');
    });

    it('returns 404 wrong_event when item belongs to a different event', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM event_checklist_items eci[\s\S]+INNER JOIN event_checklists ec/, {
            id: ITEM_ID, event_checklist_id: CHECKLIST_ID,
            position: 10, label: 'X', required: 1,
            done_at: null, event_id: 'evt_DIFFERENT',
        }, 'first');

        const req = new Request(
            `https://airactionsport.com/api/event-day/checklists/${CHECKLIST_ID}/items/${ITEM_ID}/toggle`,
            {
                method: 'POST',
                headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ done: true }),
            },
        );
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.error).toBe('wrong_event');
    });

    it('returns 200 + ok shape + recomputed completedAt on happy path (done=true completes the parent)', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM event_checklist_items eci[\s\S]+INNER JOIN event_checklists ec/, {
            id: ITEM_ID, event_checklist_id: CHECKLIST_ID,
            position: 10, label: 'Briefing', required: 1,
            done_at: null, event_id: EVENT_ID,
        }, 'first');
        env.DB.__on(/SELECT id, required, done_at FROM event_checklist_items WHERE event_checklist_id = \?/, {
            results: [
                { id: ITEM_ID, required: 1, done_at: null }, // patched to newDoneAt
                { id: 'echki_2', required: 1, done_at: 1699000000000 },
            ],
        }, 'all');
        env.DB.__on(/UPDATE event_checklist_items/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE event_checklists\s+SET completed_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request(
            `https://airactionsport.com/api/event-day/checklists/${CHECKLIST_ID}/items/${ITEM_ID}/toggle`,
            {
                method: 'POST',
                headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ done: true }),
            },
        );
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.checklistId).toBe(CHECKLIST_ID);
        expect(body.checklistCompletedAt).toBeGreaterThan(0); // parent now complete
        expect(body.item.doneAt).toBeGreaterThan(0);
    });

    it('returns 200 + completedAt=null when done=false un-completes the parent', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM event_checklist_items eci[\s\S]+INNER JOIN event_checklists ec/, {
            id: ITEM_ID, event_checklist_id: CHECKLIST_ID,
            position: 10, label: 'Briefing', required: 1,
            done_at: 1700000000000, event_id: EVENT_ID,
        }, 'first');
        env.DB.__on(/SELECT id, required, done_at FROM event_checklist_items WHERE event_checklist_id = \?/, {
            results: [
                { id: ITEM_ID, required: 1, done_at: 1700000000000 }, // patched to null
                { id: 'echki_2', required: 1, done_at: 1699000000000 },
            ],
        }, 'all');
        env.DB.__on(/UPDATE event_checklist_items/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE event_checklists\s+SET completed_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request(
            `https://airactionsport.com/api/event-day/checklists/${CHECKLIST_ID}/items/${ITEM_ID}/toggle`,
            {
                method: 'POST',
                headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ done: false }),
            },
        );
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.checklistCompletedAt).toBeNull();
        expect(body.item.doneAt).toBeNull();

        const writes = env.DB.__writes();
        const audit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'event_day.checklist_item_undone')
        );
        expect(audit).toBeDefined();
    });

    it('returns 400 checklist_id_mismatch when URL :id does not match item parent', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM event_checklist_items eci[\s\S]+INNER JOIN event_checklists ec/, {
            id: ITEM_ID, event_checklist_id: 'echk_REAL_PARENT',
            position: 10, label: 'X', required: 1,
            done_at: null, event_id: EVENT_ID,
        }, 'first');
        env.DB.__on(/SELECT id, required, done_at FROM event_checklist_items WHERE event_checklist_id = \?/, {
            results: [{ id: ITEM_ID, required: 1, done_at: null }],
        }, 'all');
        env.DB.__on(/UPDATE event_checklist_items/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE event_checklists\s+SET completed_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        // URL has the WRONG :id (echk_test_001 != echk_REAL_PARENT)
        const req = new Request(
            `https://airactionsport.com/api/event-day/checklists/echk_WRONG/items/${ITEM_ID}/toggle`,
            {
                method: 'POST',
                headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ done: true }),
            },
        );
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('checklist_id_mismatch');
    });
});

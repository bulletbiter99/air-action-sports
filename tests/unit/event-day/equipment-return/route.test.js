// M5 R14 — event-day equipment-return route tests.
// Covers POST /lookup + POST /:assignmentId/complete with the
// requireEventDayAuth gate, active-event scoping, condition enum
// validation, and damage-charge-review flag.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createPortalCookie } from '../../../../worker/lib/portalSession.js';

const SECRET = 'test_session_secret_must_be_at_least_32_bytes_long_padding';
const PORTAL_SESSION_ID = 'ps_test_001';
const PERSON_ID = 'prs_test_001';
const EVENT_ID = 'evt_test_001';
const EVENT_DAY_SESSION_ID = 'eds_aBcDeF012345';
const ASSIGNMENT_ID = 'ra_test_001';

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
// POST /api/event-day/equipment-return/lookup
// ────────────────────────────────────────────────────────────────────

describe('POST /api/event-day/equipment-return/lookup', () => {
    it('returns 401 without portal cookie', async () => {
        const req = new Request('https://airactionsport.com/api/event-day/equipment-return/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrToken: 'rt_x' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 400 when qrToken missing', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        const req = new Request('https://airactionsport.com/api/event-day/equipment-return/lookup', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('returns 404 when no active assignment matches the token', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM rental_assignments ra[\s\S]+INNER JOIN rental_items/, null, 'first');

        const req = new Request('https://airactionsport.com/api/event-day/equipment-return/lookup', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrToken: 'rt_unknown' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('assignment_not_found');
    });

    it('returns 404 wrong_event when assignment belongs to a different event', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM rental_assignments ra[\s\S]+INNER JOIN rental_items/, {
            id: ASSIGNMENT_ID,
            rental_item_id: 'ri_1',
            attendee_id: 'att_1',
            booking_id: 'b_1',
            event_id: 'evt_DIFFERENT',
            checked_in_at: null,
            checked_out_at: 1700000000000,
            item_name: 'Marker Rental',
            item_sku: 'MK-001',
            item_category: 'marker',
            attendee_first: 'Jane',
            attendee_last: 'Doe',
            attendee_qr: 'qr_001',
            buyer_name: 'Jane Doe',
            buyer_email: 'jane@e.com',
        }, 'first');

        const req = new Request('https://airactionsport.com/api/event-day/equipment-return/lookup', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrToken: 'MK-001' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('wrong_event');
        expect(body.activeEventId).toBe(EVENT_ID);
    });

    it('returns 200 with assignment + item + attendee + booking shape on happy path', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM rental_assignments ra[\s\S]+INNER JOIN rental_items/, {
            id: ASSIGNMENT_ID,
            rental_item_id: 'ri_1',
            attendee_id: 'att_1',
            booking_id: 'b_1',
            event_id: EVENT_ID,
            checked_in_at: null,
            checked_out_at: 1700000000000,
            item_name: 'Marker Rental',
            item_sku: 'MK-001',
            item_category: 'marker',
            attendee_first: 'Jane',
            attendee_last: 'Doe',
            attendee_qr: 'qr_001',
            buyer_name: 'Jane Doe',
            buyer_email: 'jane@e.com',
        }, 'first');

        const req = new Request('https://airactionsport.com/api/event-day/equipment-return/lookup', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrToken: 'MK-001' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.assignment.id).toBe(ASSIGNMENT_ID);
        expect(body.item).toMatchObject({ id: 'ri_1', name: 'Marker Rental', sku: 'MK-001', category: 'marker' });
        expect(body.attendee).toMatchObject({
            id: 'att_1',
            firstName: 'Jane',
            lastName: 'Doe',
            fullName: 'Jane Doe',
            qrToken: 'qr_001',
        });
        expect(body.booking).toMatchObject({ id: 'b_1', buyerName: 'Jane Doe', buyerEmail: 'jane@e.com' });
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/equipment-return/:assignmentId/complete
// ────────────────────────────────────────────────────────────────────

describe('POST /api/event-day/equipment-return/:assignmentId/complete', () => {
    it('returns 401 without portal cookie', async () => {
        const req = new Request(`https://airactionsport.com/api/event-day/equipment-return/${ASSIGNMENT_ID}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ condition: 'good' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 400 invalid_condition for unknown / missing condition', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();

        for (const body of [{}, { condition: 'unknown' }, { condition: '' }]) {
            const req = new Request(`https://airactionsport.com/api/event-day/equipment-return/${ASSIGNMENT_ID}/complete`, {
                method: 'POST',
                headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const res = await worker.fetch(req, env, {});
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('invalid_condition');
        }
    });

    it('returns 404 when assignment not found', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM rental_assignments ra[\s\S]+INNER JOIN bookings/, null, 'first');

        const req = new Request(`https://airactionsport.com/api/event-day/equipment-return/${ASSIGNMENT_ID}/complete`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ condition: 'good' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('returns 404 wrong_event when assignment belongs to a different event', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM rental_assignments ra[\s\S]+INNER JOIN bookings/, {
            id: ASSIGNMENT_ID,
            checked_in_at: null,
            attendee_id: 'att_1',
            booking_id: 'b_1',
            event_id: 'evt_DIFFERENT',
        }, 'first');

        const req = new Request(`https://airactionsport.com/api/event-day/equipment-return/${ASSIGNMENT_ID}/complete`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ condition: 'good' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('wrong_event');
    });

    it('returns 409 already_returned when assignment already has checked_in_at', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM rental_assignments ra[\s\S]+INNER JOIN bookings/, {
            id: ASSIGNMENT_ID,
            checked_in_at: 1700000000000,
            attendee_id: 'att_1',
            booking_id: 'b_1',
            event_id: EVENT_ID,
        }, 'first');

        const req = new Request(`https://airactionsport.com/api/event-day/equipment-return/${ASSIGNMENT_ID}/complete`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ condition: 'good' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toBe('already_returned');
    });

    it('returns 200 with requiresChargeReview=false for good condition', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM rental_assignments ra[\s\S]+INNER JOIN bookings/, {
            id: ASSIGNMENT_ID,
            checked_in_at: null,
            attendee_id: 'att_1',
            booking_id: 'b_1',
            event_id: EVENT_ID,
        }, 'first');
        env.DB.__on(/UPDATE rental_assignments[\s\S]+condition_on_return/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE event_day_sessions/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request(`https://airactionsport.com/api/event-day/equipment-return/${ASSIGNMENT_ID}/complete`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ condition: 'good' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.assignmentId).toBe(ASSIGNMENT_ID);
        expect(body.condition).toBe('good');
        expect(body.requiresChargeReview).toBe(false);
    });

    it('returns 200 with requiresChargeReview=true for damaged condition + writes audit + bumps counter', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM rental_assignments ra[\s\S]+INNER JOIN bookings/, {
            id: ASSIGNMENT_ID,
            checked_in_at: null,
            attendee_id: 'att_1',
            booking_id: 'b_1',
            event_id: EVENT_ID,
        }, 'first');
        env.DB.__on(/UPDATE rental_assignments[\s\S]+condition_on_return/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE event_day_sessions/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request(`https://airactionsport.com/api/event-day/equipment-return/${ASSIGNMENT_ID}/complete`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ condition: 'damaged', notes: 'Hopper crack', replacementFeeCents: 5000 }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.condition).toBe('damaged');
        expect(body.requiresChargeReview).toBe(true);

        const writes = env.DB.__writes();
        // condition + notes + replacementFee bound positionally
        const update = writes.find((w) => /UPDATE rental_assignments/.test(w.sql));
        expect(update.args).toContain('damaged');
        expect(update.args).toContain('Hopper crack');
        expect(update.args).toContain(5000);

        // Counter bump
        const counter = writes.find((w) =>
            /UPDATE event_day_sessions/.test(w.sql) && /equipment_returns/.test(w.sql)
        );
        expect(counter).toBeDefined();

        // Audit row
        const audit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'event_day.equipment_returned')
        );
        expect(audit).toBeDefined();
    });

    it('returns 200 with requiresChargeReview=true for lost condition', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM rental_assignments ra[\s\S]+INNER JOIN bookings/, {
            id: ASSIGNMENT_ID,
            checked_in_at: null,
            attendee_id: 'att_1',
            booking_id: 'b_1',
            event_id: EVENT_ID,
        }, 'first');
        env.DB.__on(/UPDATE rental_assignments[\s\S]+condition_on_return/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE event_day_sessions/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request(`https://airactionsport.com/api/event-day/equipment-return/${ASSIGNMENT_ID}/complete`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ condition: 'lost' }),
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.json();
        expect(body.requiresChargeReview).toBe(true);
    });
});

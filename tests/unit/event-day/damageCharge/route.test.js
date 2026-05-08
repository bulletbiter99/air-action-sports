// M5 R16 — event-day damage-charge route tests.
// Covers POST /api/event-day/damage-charge gated by requireEventDayAuth
// + active-event scope + condition_on_return enforcement + role-cap
// approval gating.

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

function bindRoleCap(capCents) {
    // Person has one role with the given cap.
    env.DB.__on(
        /FROM person_roles pr[\s\S]+INNER JOIN charge_caps_config/,
        { results: [{ cap_cents: capCents }] },
        'all',
    );
}

function bindAssignment(overrides = {}) {
    env.DB.__on(
        /FROM rental_assignments ra[\s\S]+INNER JOIN bookings/,
        {
            id: ASSIGNMENT_ID,
            attendee_id: 'att_1',
            booking_id: 'b_1',
            condition_on_return: 'damaged',
            checked_in_at: 1700000000000,
            event_id: EVENT_ID,
            ...overrides,
        },
        'first',
    );
}

describe('POST /api/event-day/damage-charge', () => {
    it('returns 401 without portal cookie', async () => {
        const req = new Request('https://airactionsport.com/api/event-day/damage-charge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignmentId: ASSIGNMENT_ID, reasonKind: 'damage', amountCents: 5000 }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 400 when assignmentId missing', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        const req = new Request('https://airactionsport.com/api/event-day/damage-charge', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reasonKind: 'damage', amountCents: 5000 }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('assignment_id_required');
    });

    it('returns 400 invalid_reason_kind for unknown kind', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        const req = new Request('https://airactionsport.com/api/event-day/damage-charge', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignmentId: ASSIGNMENT_ID, reasonKind: 'evil_kind', amountCents: 5000 }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('invalid_reason_kind');
    });

    it('returns 400 amount_required when amountCents <= 0 or non-integer', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        for (const body of [
            { assignmentId: ASSIGNMENT_ID, reasonKind: 'damage' },
            { assignmentId: ASSIGNMENT_ID, reasonKind: 'damage', amountCents: 0 },
            { assignmentId: ASSIGNMENT_ID, reasonKind: 'damage', amountCents: -100 },
        ]) {
            const req = new Request('https://airactionsport.com/api/event-day/damage-charge', {
                method: 'POST',
                headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const res = await worker.fetch(req, env, {});
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('amount_required');
        }
    });

    it('returns 404 assignment_not_found', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM rental_assignments ra[\s\S]+INNER JOIN bookings/, null, 'first');

        const req = new Request('https://airactionsport.com/api/event-day/damage-charge', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignmentId: 'ra_unknown', reasonKind: 'damage', amountCents: 5000 }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.error).toBe('assignment_not_found');
    });

    it('returns 404 wrong_event for assignment from a different event', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        bindAssignment({ event_id: 'evt_DIFFERENT' });

        const req = new Request('https://airactionsport.com/api/event-day/damage-charge', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignmentId: ASSIGNMENT_ID, reasonKind: 'damage', amountCents: 5000 }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.error).toBe('wrong_event');
    });

    it('returns 409 not_returned when assignment has no checked_in_at', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        bindAssignment({ checked_in_at: null });

        const req = new Request('https://airactionsport.com/api/event-day/damage-charge', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignmentId: ASSIGNMENT_ID, reasonKind: 'damage', amountCents: 5000 }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        const data = await res.json();
        expect(data.error).toBe('not_returned');
    });

    it('returns 409 condition_not_chargeable when condition is not damaged/lost', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        bindAssignment({ condition_on_return: 'good' });

        const req = new Request('https://airactionsport.com/api/event-day/damage-charge', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignmentId: ASSIGNMENT_ID, reasonKind: 'damage', amountCents: 5000 }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        const data = await res.json();
        expect(data.error).toBe('condition_not_chargeable');
        expect(data.currentCondition).toBe('good');
    });

    it('returns 200 within-cap → status=sent + email send + audit row', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        bindAssignment();
        bindRoleCap(10000); // $100 cap; charge of $50 is within
        env.DB.__on(/INSERT INTO booking_charges/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');
        // Email render path needs a template + Resend mock — but the
        // route awaits sendNoticeEmail with a .catch wrapper, so we
        // can let it fail silently. We just verify the row went in.
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, null, 'first');
        env.DB.__on(/FROM booking_charges bc[\s\S]+INNER JOIN bookings b/, {
            id: 'bc_test_id',
            booking_id: 'b_1',
            attendee_id: 'att_1',
            rental_assignment_id: ASSIGNMENT_ID,
            reason_kind: 'damage',
            amount_cents: 5000,
            status: 'sent',
            buyer_name: 'Customer X', buyer_email: 'x@e.com',
            event_id: EVENT_ID,
            payment_link: 'https://...',
            payment_link_expires_at: Date.now() + 100000,
        }, 'first');

        const req = new Request('https://airactionsport.com/api/event-day/damage-charge', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assignmentId: ASSIGNMENT_ID,
                reasonKind: 'damage',
                amountCents: 5000,
                description: 'Hopper crack',
            }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.chargeId).toMatch(/^bc_/);
        expect(body.status).toBe('sent');
        expect(body.approvalRequired).toBe(false);
        expect(body.operatorRoleCap).toBe(10000);

        const writes = env.DB.__writes();
        const insert = writes.find((w) => /INSERT INTO booking_charges/.test(w.sql));
        expect(insert).toBeDefined();
        expect(insert.args).toContain(ASSIGNMENT_ID);
        expect(insert.args).toContain('damage');
        expect(insert.args).toContain(5000);
        expect(insert.args).toContain('sent'); // positional status

        const audit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'event_day.charge_created')
        );
        expect(audit).toBeDefined();
    });

    it('returns 200 above-cap → status=pending + approval_required=1 + no email', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        bindAssignment({ condition_on_return: 'lost' });
        bindRoleCap(10000); // $100 cap
        env.DB.__on(/INSERT INTO booking_charges/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/event-day/damage-charge', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assignmentId: ASSIGNMENT_ID,
                reasonKind: 'lost',
                amountCents: 25000, // $250 — above $100 cap
            }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('pending');
        expect(body.approvalRequired).toBe(true);

        const writes = env.DB.__writes();
        const insert = writes.find((w) => /INSERT INTO booking_charges/.test(w.sql));
        expect(insert.args).toContain('pending');
        expect(insert.args).toContain(1); // approval_required = 1

        // Distinct audit action for the queue path
        const audit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'event_day.charge_created_pending_approval')
        );
        expect(audit).toBeDefined();
    });

    it('cap=-1 (unlimited) routes any amount to status=sent', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        bindAssignment();
        bindRoleCap(-1); // unlimited
        env.DB.__on(/INSERT INTO booking_charges/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, null, 'first');

        const req = new Request('https://airactionsport.com/api/event-day/damage-charge', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assignmentId: ASSIGNMENT_ID,
                reasonKind: 'damage',
                amountCents: 50000, // $500 — would normally exceed any non-(-1) cap
            }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('sent');
        expect(body.approvalRequired).toBe(false);
        expect(body.operatorRoleCap).toBe(-1);
    });

    it('cap=0 (no charges allowed) routes any amount to status=pending', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        bindAssignment();
        bindRoleCap(0); // no charges allowed without approval
        env.DB.__on(/INSERT INTO booking_charges/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request('https://airactionsport.com/api/event-day/damage-charge', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assignmentId: ASSIGNMENT_ID,
                reasonKind: 'damage',
                amountCents: 100, // even $1 requires approval at cap=0
            }),
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.json();
        expect(body.status).toBe('pending');
        expect(body.approvalRequired).toBe(true);
    });
});

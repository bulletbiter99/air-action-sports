// M5 R13 — event-day check-in route tests.
//
// Covers POST /api/event-day/checkin/by-qr and POST /:id (with the
// waiver-block + Lead-Marshal bypass logic) and POST /:id/check-out.
// All endpoints are gated by requireEventDayAuth (R12 lib).

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createPortalCookie } from '../../../../worker/lib/portalSession.js';

const SECRET = 'test_session_secret_must_be_at_least_32_bytes_long_padding';
const PORTAL_SESSION_ID = 'ps_test_001';
const PERSON_ID = 'prs_test_001';
const EVENT_ID = 'evt_test_001';
const EVENT_DAY_SESSION_ID = 'eds_aBcDeF012345';
const ATTENDEE_ID = 'att_aBcDeF012345';

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

// ────────────────────────────────────────────────────────────────────
// Helper: bind the requireEventDayAuth chain so the route can pass.
// ────────────────────────────────────────────────────────────────────

function bindEventDaySession({ withRoles = [] } = {}) {
    env.DB.__on(/SELECT \* FROM event_day_sessions WHERE id = \?/, {
        id: EVENT_DAY_SESSION_ID,
        event_id: EVENT_ID,
        person_id: PERSON_ID,
        portal_session_id: PORTAL_SESSION_ID,
        signed_out_at: null,
        checkins_performed: 0,
        walkups_created: 0,
        incidents_filed: 0,
        equipment_returns: 0,
    }, 'first');
    env.DB.__on(/SELECT id, date_iso, past FROM events WHERE id = \?/, {
        id: EVENT_ID, date_iso: todayIso(), past: 0,
    }, 'first');
    env.DB.__on(/SELECT id, full_name, email FROM persons WHERE id = \?/, {
        id: PERSON_ID, full_name: 'Test Marshal', email: 'm@e.com',
    }, 'first');
    // Bind person_roles for the bypass capability check.
    env.DB.__on(
        /FROM person_roles[\s\S]*INNER JOIN roles/,
        { results: withRoles.map((key) => ({ key })) },
        'all',
    );
}

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/checkin/by-qr
// ────────────────────────────────────────────────────────────────────

describe('POST /api/event-day/checkin/by-qr', () => {
    it('returns 401 without portal cookie', async () => {
        const req = new Request('https://airactionsport.com/api/event-day/checkin/by-qr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrToken: 'qr_x' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 401 without event-day session cookie', async () => {
        const cookie = await buildPortalCookie();
        const req = new Request('https://airactionsport.com/api/event-day/checkin/by-qr', {
            method: 'POST',
            headers: { cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrToken: 'qr_x' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 400 when qrToken missing', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        const req = new Request('https://airactionsport.com/api/event-day/checkin/by-qr', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('returns 404 when qrToken not recognized', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM attendees a[\s\S]+JOIN bookings b/, null, 'first');
        const req = new Request('https://airactionsport.com/api/event-day/checkin/by-qr', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrToken: 'qr_nope' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('qr_not_recognized');
    });

    it('returns 404 wrong_event when attendee belongs to a different event', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM attendees a[\s\S]+JOIN bookings b/, {
            id: ATTENDEE_ID,
            qr_token: 'qr_x',
            event_id: 'evt_DIFFERENT',
            booking_id: 'b_1',
            booking_status: 'paid',
            first_name: 'Jane',
            last_name: 'Doe',
            ticket_type_id: 'tt_1',
            ticket_type_name: 'Adult',
            checked_in_at: null,
            waiver_id: 'w_1',
            waiver_signed_at: 1700000000000,
            waiver_is_minor: 0,
            buyer_name: 'Buyer',
            buyer_email: 'b@e.com',
        }, 'first');
        const req = new Request('https://airactionsport.com/api/event-day/checkin/by-qr', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrToken: 'qr_x' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('wrong_event');
        expect(body.activeEventId).toBe(EVENT_ID);
    });

    it('returns 200 with attendee + booking shape on happy path; canBypass=false for non-marshal', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession({ withRoles: ['field_marshal'] });
        env.DB.__on(/FROM attendees a[\s\S]+JOIN bookings b/, {
            id: ATTENDEE_ID,
            qr_token: 'qr_x',
            event_id: EVENT_ID,
            booking_id: 'b_1',
            booking_status: 'paid',
            first_name: 'Jane',
            last_name: 'Doe',
            ticket_type_id: 'tt_1',
            ticket_type_name: 'Adult',
            checked_in_at: null,
            waiver_id: 'w_1',
            waiver_signed_at: 1700000000000,
            waiver_is_minor: 0,
            buyer_name: 'Buyer',
            buyer_email: 'b@e.com',
        }, 'first');
        const req = new Request('https://airactionsport.com/api/event-day/checkin/by-qr', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrToken: 'qr_x' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.attendee.id).toBe(ATTENDEE_ID);
        expect(body.attendee.fullName).toBe('Jane Doe');
        expect(body.booking.eventId).toBe(EVENT_ID);
        expect(body.canBypass).toBe(false);
    });

    it('returns canBypass=true when caller has lead_marshal role', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession({ withRoles: ['lead_marshal'] });
        env.DB.__on(/FROM attendees a[\s\S]+JOIN bookings b/, {
            id: ATTENDEE_ID,
            qr_token: 'qr_x',
            event_id: EVENT_ID,
            booking_id: 'b_1',
            booking_status: 'paid',
            first_name: 'Jane',
            last_name: null,
            ticket_type_id: 'tt_1',
            ticket_type_name: 'Adult',
            checked_in_at: null,
            waiver_id: null,
            waiver_signed_at: null,
            waiver_is_minor: null,
            buyer_name: 'Buyer',
            buyer_email: 'b@e.com',
        }, 'first');
        const req = new Request('https://airactionsport.com/api/event-day/checkin/by-qr', {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrToken: 'qr_x' }),
        });
        const res = await worker.fetch(req, env, {});
        const body = await res.json();
        expect(body.canBypass).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/checkin/:attendeeId
// ────────────────────────────────────────────────────────────────────

describe('POST /api/event-day/checkin/:attendeeId', () => {
    it('returns 404 when attendee not found', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/SELECT id, booking_id, event_id, waiver_id, checked_in_at FROM attendees/, null, 'first');
        const req = new Request(`https://airactionsport.com/api/event-day/checkin/${ATTENDEE_ID}`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
    });

    it('returns 200 idempotent when already checked in', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/SELECT id, booking_id, event_id, waiver_id, checked_in_at FROM attendees/, {
            id: ATTENDEE_ID,
            booking_id: 'b_1',
            event_id: EVENT_ID,
            waiver_id: 'w_1',
            checked_in_at: 1700000000000,
        }, 'first');
        const req = new Request(`https://airactionsport.com/api/event-day/checkin/${ATTENDEE_ID}`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.alreadyCheckedIn).toBe(true);
        expect(body.attendee.checkedInAt).toBe(1700000000000);
    });

    it('returns 409 waiver_required when waiver missing and not bypassing', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession({ withRoles: ['field_marshal'] }); // not lead_marshal
        env.DB.__on(/SELECT id, booking_id, event_id, waiver_id, checked_in_at FROM attendees/, {
            id: ATTENDEE_ID,
            booking_id: 'b_1',
            event_id: EVENT_ID,
            waiver_id: null,
            checked_in_at: null,
        }, 'first');
        const req = new Request(`https://airactionsport.com/api/event-day/checkin/${ATTENDEE_ID}`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toBe('waiver_required');
        expect(body.canBypass).toBe(false);
    });

    it('returns 403 forbidden_bypass when bypass attempted without capability', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession({ withRoles: ['field_marshal'] });
        env.DB.__on(/SELECT id, booking_id, event_id, waiver_id, checked_in_at FROM attendees/, {
            id: ATTENDEE_ID,
            booking_id: 'b_1',
            event_id: EVENT_ID,
            waiver_id: null,
            checked_in_at: null,
        }, 'first');
        const req = new Request(`https://airactionsport.com/api/event-day/checkin/${ATTENDEE_ID}`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ bypassWaiver: true, bypassReason: 'verified ID' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe('forbidden_bypass');
        expect(body.requiresCapability).toBe('event_day.checkin.bypass_waiver');
    });

    it('returns 400 bypass_reason_required when lead_marshal omits the reason', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession({ withRoles: ['lead_marshal'] });
        env.DB.__on(/SELECT id, booking_id, event_id, waiver_id, checked_in_at FROM attendees/, {
            id: ATTENDEE_ID,
            booking_id: 'b_1',
            event_id: EVENT_ID,
            waiver_id: null,
            checked_in_at: null,
        }, 'first');
        const req = new Request(`https://airactionsport.com/api/event-day/checkin/${ATTENDEE_ID}`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ bypassWaiver: true }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('bypass_reason_required');
    });

    it('returns 200 + writes audit row + bumps counter on lead_marshal bypass', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession({ withRoles: ['lead_marshal'] });
        env.DB.__on(/SELECT id, booking_id, event_id, waiver_id, checked_in_at FROM attendees/, {
            id: ATTENDEE_ID,
            booking_id: 'b_1',
            event_id: EVENT_ID,
            waiver_id: null,
            checked_in_at: null,
        }, 'first');
        env.DB.__on(/UPDATE attendees SET checked_in_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE event_day_sessions/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request(`https://airactionsport.com/api/event-day/checkin/${ATTENDEE_ID}`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ bypassWaiver: true, bypassReason: 'Verified ID at gate' }),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.bypassed).toBe(true);
        expect(body.attendee.checkedInAt).toBeGreaterThan(0);

        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'event_day.checkin_bypass_waiver')
        );
        expect(auditWrite).toBeDefined();
        // Reason captured in meta_json
        const metaArg = auditWrite.args.find((a) => typeof a === 'string' && a.startsWith('{'));
        expect(JSON.parse(metaArg).reason).toBe('Verified ID at gate');

        // Counter bumped
        const counterWrite = writes.find((w) =>
            /UPDATE event_day_sessions/.test(w.sql) &&
            /checkins_performed/.test(w.sql)
        );
        expect(counterWrite).toBeDefined();
    });

    it('returns 200 + writes normal audit row + bumps counter on happy-path (waiver present)', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/SELECT id, booking_id, event_id, waiver_id, checked_in_at FROM attendees/, {
            id: ATTENDEE_ID,
            booking_id: 'b_1',
            event_id: EVENT_ID,
            waiver_id: 'w_1',
            checked_in_at: null,
        }, 'first');
        env.DB.__on(/UPDATE attendees SET checked_in_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE event_day_sessions/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request(`https://airactionsport.com/api/event-day/checkin/${ATTENDEE_ID}`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.bypassed).toBe(false);

        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'event_day.attendee_checked_in')
        );
        expect(auditWrite).toBeDefined();
    });

    it('returns 404 wrong_event when attendee.event_id differs from active event', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/SELECT id, booking_id, event_id, waiver_id, checked_in_at FROM attendees/, {
            id: ATTENDEE_ID,
            booking_id: 'b_1',
            event_id: 'evt_DIFFERENT',
            waiver_id: 'w_1',
            checked_in_at: null,
        }, 'first');
        const req = new Request(`https://airactionsport.com/api/event-day/checkin/${ATTENDEE_ID}`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('wrong_event');
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/checkin/:attendeeId/check-out
// ────────────────────────────────────────────────────────────────────

describe('POST /api/event-day/checkin/:attendeeId/check-out', () => {
    it('returns 409 when attendee is not currently checked in', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/SELECT id, event_id, booking_id, checked_in_at FROM attendees/, {
            id: ATTENDEE_ID,
            event_id: EVENT_ID,
            booking_id: 'b_1',
            checked_in_at: null,
        }, 'first');
        const req = new Request(`https://airactionsport.com/api/event-day/checkin/${ATTENDEE_ID}/check-out`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toBe('not_checked_in');
    });

    it('returns 200 + writes audit on happy-path check-out', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/SELECT id, event_id, booking_id, checked_in_at FROM attendees/, {
            id: ATTENDEE_ID,
            event_id: EVENT_ID,
            booking_id: 'b_1',
            checked_in_at: 1700000000000,
        }, 'first');
        env.DB.__on(/UPDATE attendees SET checked_in_at = NULL/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');

        const req = new Request(`https://airactionsport.com/api/event-day/checkin/${ATTENDEE_ID}/check-out`, {
            method: 'POST',
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}`, 'Content-Type': 'application/json' },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.attendee.checkedInAt).toBe(null);

        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'event_day.attendee_checked_out')
        );
        expect(auditWrite).toBeDefined();
    });
});

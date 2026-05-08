// M5 R14 — event-day roster route tests.
// Covers GET /api/event-day/roster — gated by requireEventDayAuth,
// scoped to active event, optional ?q= filter on attendee/buyer
// name + email.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createPortalCookie } from '../../../../worker/lib/portalSession.js';

const SECRET = 'test_session_secret_must_be_at_least_32_bytes_long_padding';
const PORTAL_SESSION_ID = 'ps_test_001';
const PERSON_ID = 'prs_test_001';
const EVENT_ID = 'evt_test_001';
const EVENT_DAY_SESSION_ID = 'eds_aBcDeF012345';

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

describe('GET /api/event-day/roster', () => {
    it('returns 401 without portal cookie', async () => {
        const req = new Request('https://airactionsport.com/api/event-day/roster');
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 401 without event-day session cookie', async () => {
        const cookie = await buildPortalCookie();
        const req = new Request('https://airactionsport.com/api/event-day/roster', {
            headers: { cookie },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(401);
    });

    it('returns 200 with attendees array + count + camelCase shape', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM attendees a[\s\S]+INNER JOIN bookings b/, {
            results: [
                {
                    id: 'att_1', first_name: 'Jane', last_name: 'Doe',
                    email: 'jane@e.com', phone: '555-1234',
                    qr_token: 'qr_001', checked_in_at: 1700000000000, waiver_id: 'w_1',
                    booking_id: 'b_1', booking_status: 'paid',
                    buyer_name: 'Jane Doe', buyer_email: 'jane@e.com',
                    ticket_type_name: 'Adult',
                    waiver_signed_at: 1690000000000, waiver_is_minor: 0,
                },
                {
                    id: 'att_2', first_name: 'Bob', last_name: null,
                    email: null, phone: null,
                    qr_token: 'qr_002', checked_in_at: null, waiver_id: null,
                    booking_id: 'b_2', booking_status: 'paid',
                    buyer_name: 'Bob Senior', buyer_email: 'bsr@e.com',
                    ticket_type_name: 'Junior',
                    waiver_signed_at: null, waiver_is_minor: 1,
                },
            ],
        }, 'all');

        const req = new Request('https://airactionsport.com/api/event-day/roster', {
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.eventId).toBe(EVENT_ID);
        expect(body.count).toBe(2);
        expect(body.attendees).toHaveLength(2);

        expect(body.attendees[0]).toMatchObject({
            id: 'att_1',
            fullName: 'Jane Doe',
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane@e.com',
            phone: '555-1234',
            qrToken: 'qr_001',
            ticketType: 'Adult',
            checkedInAt: 1700000000000,
            waiverId: 'w_1',
            waiverSigned: true,
            waiverSignedAt: 1690000000000,
            isMinor: false,
            bookingId: 'b_1',
            bookingStatus: 'paid',
            buyerName: 'Jane Doe',
        });

        expect(body.attendees[1]).toMatchObject({
            id: 'att_2',
            firstName: 'Bob',
            lastName: null,
            email: 'bsr@e.com', // falls back to buyer email
            waiverId: null,
            waiverSigned: false,
            isMinor: true,
        });
    });

    it('returns empty array + count=0 when no attendees', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM attendees a[\s\S]+INNER JOIN bookings b/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/event-day/roster', {
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.attendees).toEqual([]);
        expect(body.count).toBe(0);
    });

    it('binds active event id positionally (no event-id override possible from caller)', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM attendees a[\s\S]+INNER JOIN bookings b/, { results: [] }, 'all');

        // Even if the caller supplies a bogus event_id query parameter,
        // the route uses c.get('event').id from the session.
        const req = new Request('https://airactionsport.com/api/event-day/roster?event_id=evt_HIJACK', {
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const rosterQuery = writes.find((w) => /FROM attendees a/.test(w.sql));
        expect(rosterQuery.args).toContain(EVENT_ID);
        expect(rosterQuery.args).not.toContain('evt_HIJACK');
    });

    it('?q= adds a substring filter against attendee + buyer name/email', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM attendees a[\s\S]+INNER JOIN bookings b/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/event-day/roster?q=Doe', {
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const rosterQuery = writes.find((w) => /FROM attendees a/.test(w.sql));
        // Lowercased + wrapped in % wildcards
        const needles = rosterQuery.args.filter((a) => typeof a === 'string' && a.startsWith('%') && a.endsWith('%'));
        expect(needles.length).toBeGreaterThanOrEqual(1);
        for (const n of needles) {
            expect(n).toBe('%doe%');
        }
        expect(rosterQuery.sql).toMatch(/LOWER\(a\.first_name\) LIKE/);
    });

    it('?q= empty + whitespace-only → no filter clause added', async () => {
        const cookie = await buildPortalCookie();
        bindEventDaySession();
        env.DB.__on(/FROM attendees a[\s\S]+INNER JOIN bookings b/, { results: [] }, 'all');

        const req = new Request('https://airactionsport.com/api/event-day/roster?q=%20%20', {
            headers: { cookie: `${cookie}; aas_event_day_session=${EVENT_DAY_SESSION_ID}` },
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const rosterQuery = writes.find((w) => /FROM attendees a/.test(w.sql));
        // No LIKE filter when q is whitespace
        expect(rosterQuery.sql).not.toMatch(/LIKE/);
    });
});

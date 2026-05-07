// audit Group E #51 — POST /api/admin/bookings/manual auto-links existing
// waivers via findExistingValidWaiver (same path the Stripe webhook uses,
// after the B4a/4b waiverLookup relocation).
//
// When findExistingValidWaiver returns a waiver_id for the buyer's
// (email, firstName, lastName) tuple within the claim period, the new
// attendee row gets waiver_id pre-populated and a 'waiver.auto_linked'
// audit row is written.
//
// Source: worker/routes/admin/bookings.js lines 339-365.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import {
    createAdminBookingFixture,
    bindAdminBookingFixture,
    buildManualBody,
} from '../../helpers/adminBookingFixture.js';

describe('POST /api/admin/bookings/manual — waiver auto-link (E51)', () => {
    it('links existing waiver to new attendee + emits waiver.auto_linked audit row', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        const fixture = createAdminBookingFixture();
        bindAdminBookingFixture(env, fixture, { waiverMatch: 'wv_existing_123' });

        const body = buildManualBody({
            paymentMethod: 'cash',
            attendees: [
                {
                    firstName: 'Alice',
                    lastName: 'Smith',
                    email: 'alice@example.com',
                    ticketTypeId: 'tt_std',
                },
            ],
        });
        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/bookings/manual', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }),
            env,
            {},
        );
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();

        // Attendee INSERT carries waiver_id at bind index 10
        // INSERT INTO attendees (
        //   id[0], booking_id[1], ticket_type_id[2], first_name[3], last_name[4],
        //   email[5], phone[6], qr_token[7], created_at[8], custom_answers_json[9],
        //   waiver_id[10]
        // )
        const attendeeInsert = writes.find(
            (w) => w.kind === 'run' && /INSERT INTO attendees/.test(w.sql),
        );
        expect(attendeeInsert).toBeTruthy();
        expect(attendeeInsert.args[10]).toBe('wv_existing_123');

        // 'waiver.auto_linked' audit row for the linked attendee
        const autoLinkedAudit = writes.find(
            (w) => w.kind === 'run'
                && /INSERT INTO audit_log/.test(w.sql)
                && /'waiver\.auto_linked'/.test(w.sql),
        );
        expect(autoLinkedAudit).toBeTruthy();
        expect(autoLinkedAudit.args[0]).toBe('u_actor');
        // target_id is the new attendee id (matches attendeeInsert.args[0])
        expect(autoLinkedAudit.args[1]).toBe(attendeeInsert.args[0]);
        expect(JSON.parse(autoLinkedAudit.args[2])).toMatchObject({
            waiver_id: 'wv_existing_123',
        });
    });

    it('does NOT emit waiver.auto_linked when no matching waiver exists', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        const fixture = createAdminBookingFixture();
        bindAdminBookingFixture(env, fixture);  // no waiverMatch — returns null

        const body = buildManualBody({ paymentMethod: 'cash' });
        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/bookings/manual', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }),
            env,
            {},
        );
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const attendeeInsert = writes.find(
            (w) => w.kind === 'run' && /INSERT INTO attendees/.test(w.sql),
        );
        expect(attendeeInsert.args[10]).toBeNull();  // waiver_id NULL when no match

        const autoLinkedAudit = writes.find(
            (w) => w.kind === 'run'
                && /INSERT INTO audit_log/.test(w.sql)
                && /'waiver\.auto_linked'/.test(w.sql),
        );
        expect(autoLinkedAudit).toBeUndefined();
    });
});

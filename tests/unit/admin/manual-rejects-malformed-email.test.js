// M3 B6 — POST /api/admin/bookings/manual rejects malformed buyer email
// with HTTP 400 before any DB writes.
//
// Pre-B6 (B5 only): the dual-write returned null customer_id and the
// booking row carried NULL — operationally tolerated until backfill.
// Post-B6: bookings.customer_id is NOT NULL, so passing through with
// null would cascade into a constraint violation on the bookings
// INSERT. The manual handler now validates email format at the API
// boundary and short-circuits to a 400 before findOrCreate even gets
// the chance to fail later in the path.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import {
    createAdminBookingFixture,
    bindAdminBookingFixture,
    buildManualBody,
} from '../../helpers/adminBookingFixture.js';

describe('POST /api/admin/bookings/manual — malformed email rejection (B6)', () => {
    it('returns 400 when buyer email has no @ (normalizeEmail returns null)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        const fixture = createAdminBookingFixture();
        bindAdminBookingFixture(env, fixture);
        // findOrCreate's SELECT customers WHERE email_normalized — never reached
        // because format check rejects upstream. Default mockD1 returns null
        // for unmatched first(), which would have caused INSERT INTO customers
        // (the dual-write success path) — but we should never get there.
        env.DB.__on(/SELECT id FROM customers WHERE email_normalized/, null, 'first');

        const body = buildManualBody({
            paymentMethod: 'cash',
            buyer: {
                fullName: 'Bad Buyer',
                email: 'not-an-email',
                phone: '5551234567',
            },
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
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/email format/i);

        // No bookings INSERT should have been attempted
        const writes = env.DB.__writes();
        const bookingInsert = writes.find(
            (w) => w.kind === 'run' && /INSERT INTO bookings/.test(w.sql),
        );
        expect(bookingInsert).toBeUndefined();
    });

    it('valid email passes through (sanity — does NOT regress the cash happy path)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_actor', role: 'manager' });
        const fixture = createAdminBookingFixture();
        bindAdminBookingFixture(env, fixture);

        const body = buildManualBody({
            paymentMethod: 'cash',
            buyer: {
                fullName: 'Alice Smith',
                email: 'alice@example.com',
                phone: '5551234567',
            },
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
    });
});

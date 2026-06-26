// Multi-day events — Phase 6 review follow-up. Route-level coverage for the PUT
// /:id span cross-check, which parseEventBody cannot reproduce: it compares the
// EFFECTIVE end against the EFFECTIVE start (patched value when present, else
// the stored row) so a start-only edit that pushes the start past the stored
// end, or stretches the stored span beyond 31 days, is caught. This guard is
// the only thing protecting the event-day check-in window from a partial-edit
// span corruption, so it gets a worker.fetch-level test.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

// Stored 2-day event (start 06-20, end 06-21).
const EXISTING = { id: 'evt_1', site_id: null, date_iso: '2026-06-20T16:00:00', end_date_iso: '2026-06-21T22:00:00' };

function putReq(id, body, cookieHeader) {
    return new Request(`https://airactionsport.com/api/admin/events/${id}`, {
        method: 'PUT',
        headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('PUT /api/admin/events/:id — multi-day span cross-check', () => {
    it('rejects a start-only edit that moves the start AFTER the stored end (400 on-or-after)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
        env.DB.__on(/SELECT id, site_id, date_iso, end_date_iso FROM events WHERE id = \?/, EXISTING, 'first');
        const res = await worker.fetch(putReq('evt_1', { dateIso: '2026-06-25T16:00:00' }, cookieHeader), env, {});
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/on or after/);
    });

    it('rejects a start-only edit that stretches the stored span past 31 days (400 within-31)', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
        env.DB.__on(/SELECT id, site_id, date_iso, end_date_iso FROM events WHERE id = \?/, EXISTING, 'first');
        const res = await worker.fetch(putReq('evt_1', { dateIso: '2026-05-01T00:00:00' }, cookieHeader), env, {});
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/within 31 days/);
    });
});

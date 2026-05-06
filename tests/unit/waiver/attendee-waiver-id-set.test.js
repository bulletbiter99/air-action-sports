// audit Group C #34 — POST /api/waivers/:qrToken sets attendees.waiver_id.
//
// Source: worker/routes/waivers.js lines 299-301:
//     await c.env.DB.prepare(
//         `UPDATE attendees SET waiver_id = ? WHERE id = ?`
//     ).bind(waiverId, attendee.id).run();
//
// Order of writes is INSERT waivers → UPDATE attendees → INSERT audit_log.
// This test locks both the UPDATE shape AND the relative order, since the
// UPDATE depends on the freshly-minted `wv_…` id from the INSERT.

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createWaiverFixture, postWaiver } from '../../helpers/waiverFixture.js';

describe('POST /api/waivers/:qrToken — attendees.waiver_id linkage', () => {
    it('issues UPDATE attendees SET waiver_id binding the new wv_ id and attendee id', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);
        const data = await res.json();

        const updates = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('UPDATE attendees SET waiver_id')
        );
        expect(updates).toHaveLength(1);

        const [bindWaiverId, bindAttendeeId] = updates[0].args;
        // Bound waiverId matches the response's waiverId (and matches /^wv_/).
        expect(bindWaiverId).toBe(data.waiverId);
        expect(bindWaiverId).toMatch(/^wv_/);
        expect(bindAttendeeId).toBe(fixture.attendee.id);
    });

    it('writes in the order: INSERT waivers → UPDATE attendees → INSERT audit_log', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const writes = env.DB.__writes().filter(w => w.kind === 'run');
        const idxInsertWaiver = writes.findIndex(w => w.sql.includes('INSERT INTO waivers'));
        const idxUpdateAttendee = writes.findIndex(w => w.sql.includes('UPDATE attendees SET waiver_id'));
        const idxAuditLog = writes.findIndex(w =>
            w.sql.includes('INSERT INTO audit_log') && w.sql.includes("'waiver.signed'")
        );

        expect(idxInsertWaiver).toBeGreaterThanOrEqual(0);
        expect(idxUpdateAttendee).toBeGreaterThan(idxInsertWaiver);
        expect(idxAuditLog).toBeGreaterThan(idxUpdateAttendee);
    });
});

// audit Group C #36 — POST /api/waivers/:qrToken returns 409 if
// attendee.waiver_id is already set.
//
// Source: worker/routes/waivers.js lines 161-162:
//     if (!attendee) return c.json({ error: 'Invalid waiver link' }, 404);
//     if (attendee.waiver_id) return c.json({ error: 'Waiver already signed for this player' }, 409);
//
// The 409 short-circuits BEFORE any of the field-validation checks. So even
// a payload with missing required fields still gets the 409 (the
// already-signed check fires first). Most importantly: NO writes occur —
// no waivers row, no attendees update, no audit row.

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import {
    createWaiverFixture,
    bindWaiverFixture,
    postWaiverWithOpts,
} from '../../helpers/waiverFixture.js';

describe('POST /api/waivers/:qrToken — 409 already-signed', () => {
    it('returns 409 with "already signed" error when attendee.waiver_id is set', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiverWithOpts(env, fixture, { attendeeAlreadySigned: true });
        expect(res.status).toBe(409);
        const data = await res.json();
        expect(data.error).toMatch(/already/i);
    });

    it('writes NOTHING when attendee is already signed (no waiver, no update, no audit)', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiverWithOpts(env, fixture, { attendeeAlreadySigned: true });
        expect(res.status).toBe(409);

        const writes = env.DB.__writes().filter(w => w.kind === 'run');
        // No INSERT INTO waivers
        expect(writes.find(w => w.sql.includes('INSERT INTO waivers'))).toBeUndefined();
        // No UPDATE attendees SET waiver_id
        expect(writes.find(w => w.sql.includes('UPDATE attendees SET waiver_id'))).toBeUndefined();
        // No audit row of any flavor
        expect(writes.find(w => w.sql.includes('INSERT INTO audit_log'))).toBeUndefined();
    });

    it('returns 409 BEFORE field-validation runs (short-circuit on attendee state)', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();
        // Strip required fields. If the already-signed branch did NOT
        // short-circuit first, we'd see a 400 "Missing required fields".
        // The 409 here proves the order of checks.
        bindWaiverFixture(env.DB, fixture, { attendeeAlreadySigned: true });

        const body = JSON.stringify({}); // empty payload
        const req = new Request(
            `https://airactionsport.com/api/waivers/${fixture.qrToken}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': String(new TextEncoder().encode(body).byteLength),
                    'CF-Connecting-IP': '203.0.113.1',
                    'User-Agent': 'vitest-waiver-fixture/1.0',
                },
                body,
            }
        );
        const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
        const { default: worker } = await import('../../../worker/index.js');
        const res = await worker.fetch(req, env, ctx);

        expect(res.status).toBe(409);
        const data = await res.json();
        expect(data.error).toMatch(/already/i);
        // Critical: NOT a 400 about missing fields.
        expect(data.error).not.toMatch(/missing required/i);
    });
});

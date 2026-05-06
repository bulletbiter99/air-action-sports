// audit Group C #29 — POST /api/waivers/:qrToken at age 16-17 requires
// parent fields but NOT supervising-adult fields.
//
// Source: worker/routes/waivers.js lines 206-225. The parent-bloc check
// fires for both '12-15' and '16-17' tiers, but the supervising-adult bloc
// check fires ONLY for '12-15'. So a 16-17 signer who provides full parent
// fields (and no supervising-adult fields) must accept.

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import {
    createWaiverFixture,
    validTeenPayload,
    postWaiver,
} from '../../helpers/waiverFixture.js';

async function teenFixture() {
    const fixture = await createWaiverFixture();
    fixture.payload = validTeenPayload();
    return fixture;
}

describe('POST /api/waivers/:qrToken — age 16-17 (parent-only)', () => {
    it('rejects 400 when parent fields are missing', async () => {
        const env = createMockEnv();
        const fixture = await teenFixture();

        // Drop the parent bloc.
        const res = await postWaiver(env, fixture, {
            parentName: '',
            parentSignature: '',
            parentConsent: false,
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/parent/i);
    });

    it('rejects 400 when parentInitials is missing', async () => {
        const env = createMockEnv();
        const fixture = await teenFixture();

        const res = await postWaiver(env, fixture, { parentInitials: '' });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/initial/i);
    });

    it('accepts 200 with parent bloc and NO supervising-adult fields', async () => {
        const env = createMockEnv();
        const fixture = await teenFixture();

        // teen baseline omits supervisingAdult* — proves the 12-15-only branch
        // does NOT fire for 16-17.
        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.ageTier).toBe('16-17');
    });
});

// audit Group C #28 — POST /api/waivers/:qrToken at age 12-15 requires
// parent fields AND supervising-adult fields.
//
// Source: worker/routes/waivers.js lines 206-225:
//     if (tier === '12-15' || tier === '16-17') {
//         if (!body.parentName || !body.parentSignature || body.parentConsent !== true) { ... 400 }
//         if (typeof body.parentInitials !== 'string' || !body.parentInitials.trim()) { ... 400 }
//     }
//     if (tier === '12-15') {
//         if (!body.supervisingAdultName || !body.supervisingAdultName.trim()) { ... 400 }
//         if (!body.supervisingAdultSignature || !body.supervisingAdultSignature.trim()) { ... 400 }
//     }
//
// 12-15 requires the full parent bloc PLUS the on-site supervising-adult bloc.
// Each missing field returns 400 in order; tests target one field at a time.

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import {
    createWaiverFixture,
    validYouthPayload,
    postWaiver,
} from '../../helpers/waiverFixture.js';

async function youthFixture() {
    const fixture = await createWaiverFixture();
    fixture.payload = validYouthPayload();
    return fixture;
}

describe('POST /api/waivers/:qrToken — age 12-15 (parent + supervisor)', () => {
    it('rejects 400 when parentName is missing', async () => {
        const env = createMockEnv();
        const fixture = await youthFixture();

        const res = await postWaiver(env, fixture, { parentName: '' });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/parent/i);
    });

    it('rejects 400 when parentSignature is missing', async () => {
        const env = createMockEnv();
        const fixture = await youthFixture();

        const res = await postWaiver(env, fixture, { parentSignature: '' });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/parent/i);
    });

    it('rejects 400 when parentConsent is not strictly true', async () => {
        const env = createMockEnv();
        const fixture = await youthFixture();

        const res = await postWaiver(env, fixture, { parentConsent: false });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/parent/i);
    });

    it('rejects 400 when parentInitials is missing or whitespace-only', async () => {
        const env = createMockEnv();
        const fixture = await youthFixture();

        // Whitespace-only must reject — handler uses .trim() check.
        const res = await postWaiver(env, fixture, { parentInitials: '   ' });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/initial/i);
    });

    it('rejects 400 when supervisingAdultName is missing (12-15 only)', async () => {
        const env = createMockEnv();
        const fixture = await youthFixture();

        const res = await postWaiver(env, fixture, { supervisingAdultName: '' });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/supervising/i);
    });

    it('rejects 400 when supervisingAdultSignature is missing (12-15 only)', async () => {
        const env = createMockEnv();
        const fixture = await youthFixture();

        const res = await postWaiver(env, fixture, { supervisingAdultSignature: '' });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/supervising/i);
    });

    it('accepts 200 when 12-15 attendee provides parent bloc + supervising-adult bloc', async () => {
        const env = createMockEnv();
        const fixture = await youthFixture();

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.ageTier).toBe('12-15');
    });
});

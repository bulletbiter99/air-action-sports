// audit Group C #31 — POST /api/waivers/:qrToken at every tier requires
// juryTrialInitials (§22 gate).
//
// Source: worker/routes/waivers.js lines 202-204:
//     if (typeof body.juryTrialInitials !== 'string' || !body.juryTrialInitials.trim()) {
//         return c.json({ error: 'Jury Trial Waiver initials are required (§22).' }, 400);
//     }
//
// This check fires AFTER the under-12 hard block but BEFORE the
// tier-specific parent-fields check. So at every valid tier (12-15, 16-17,
// 18+), missing or whitespace-only juryTrialInitials must return 400.

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import {
    createWaiverFixture,
    validTeenPayload,
    validYouthPayload,
    postWaiver,
} from '../../helpers/waiverFixture.js';

describe('POST /api/waivers/:qrToken — juryTrialInitials required (§22)', () => {
    it('rejects 400 at 18+ when juryTrialInitials is missing', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();
        const { juryTrialInitials, ...rest } = fixture.payload;
        fixture.payload = rest;

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/§22|jury trial/i);
    });

    it('rejects 400 at 16-17 when juryTrialInitials is missing', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();
        const teen = validTeenPayload();
        const { juryTrialInitials, ...rest } = teen;
        fixture.payload = rest;

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/§22|jury trial/i);
    });

    it('rejects 400 at 12-15 when juryTrialInitials is missing', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();
        const youth = validYouthPayload();
        const { juryTrialInitials, ...rest } = youth;
        fixture.payload = rest;

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/§22|jury trial/i);
    });

    it('rejects 400 when juryTrialInitials is whitespace-only', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture, { juryTrialInitials: '   ' });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/§22|jury trial/i);
    });
});

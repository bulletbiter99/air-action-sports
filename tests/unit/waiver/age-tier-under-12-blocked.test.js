// audit Group C #27 — POST /api/waivers/:qrToken rejects under-12 dob
// (hard block; cannot waive online at any tier).
//
// Source: worker/routes/waivers.js lines 22-28, 196-200:
//     function ageTier(age) {
//         if (age == null) return null;
//         if (age < 12) return null;        // hard block
//         ...
//     }
//     ...
//     const tier = ageTier(age);
//     if (!tier) {
//         return c.json({ error: 'Players must be at least 12 years old to participate at any AAS event.' }, 400);
//     }
//
// Under-12 must hard-fail with 400 BEFORE any tier-specific check. The error
// must reference the 12-year minimum so signers know why they were blocked.

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import {
    createWaiverFixture,
    dobYearsAgo,
    postWaiver,
} from '../../helpers/waiverFixture.js';

describe('POST /api/waivers/:qrToken — under-12 hard block', () => {
    it('rejects 400 when dob makes attendee under 12', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        // 8 years old is solidly under 12 with no leap-year flake risk.
        const res = await postWaiver(env, fixture, { dob: dobYearsAgo(8) });
        expect(res.status).toBe(400);
        const data = await res.json();
        // Error must reference the 12-year minimum.
        expect(data.error).toMatch(/12/);

        const inserts = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('INSERT INTO waivers')
        );
        expect(inserts).toHaveLength(0);
    });

    it('rejects under-12 BEFORE checking parent / supervising-adult fields', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        // Even with a fully-populated parent + supervising-adult bloc, an
        // 8-year-old still hard-fails. The under-12 gate must short-circuit
        // before tier-specific field checks fire.
        const res = await postWaiver(env, fixture, {
            dob: dobYearsAgo(8),
            parentName: 'Carol Smith',
            parentSignature: 'Carol Smith',
            parentConsent: true,
            parentInitials: 'CS',
            supervisingAdultName: 'Carol Smith',
            supervisingAdultSignature: 'Carol Smith',
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/12/);
        // Make sure we hit the age gate, not the parent-fields gate.
        expect(data.error).not.toMatch(/parent/i);
    });
});

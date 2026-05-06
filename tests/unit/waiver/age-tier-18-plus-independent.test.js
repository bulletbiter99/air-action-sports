// audit Group C #30 — POST /api/waivers/:qrToken at age 18+ accepts
// independent signer (no parent or supervising-adult fields required).
//
// Source: worker/routes/waivers.js lines 206-225. Both tier-specific blocks
// gate on `tier === '12-15' || tier === '16-17'` and `tier === '12-15'`
// respectively. For '18+' neither block fires; only the universal jury-trial
// initials check (line 202-204) and the required-fields check apply.

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createWaiverFixture, postWaiver } from '../../helpers/waiverFixture.js';

describe('POST /api/waivers/:qrToken — age 18+ independent', () => {
    it('accepts 200 with no parent or supervising-adult fields', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();
        // Default fixture is 18+ adult with NO parent/supervisor fields. The
        // happy path here is precisely "no extras required."

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.ageTier).toBe('18+');
        expect(typeof data.waiverId).toBe('string');
        expect(data.waiverId).toMatch(/^wv_/);
    });

    it('does not require parent fields for 18+ even when explicitly omitted', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        // Explicitly nulled-out parent + supervisor fields must NOT block 18+.
        // (Belt-and-suspenders against a future regression that runs the
        // parent check for all tiers.)
        const res = await postWaiver(env, fixture, {
            parentName: '',
            parentSignature: '',
            parentConsent: false,
            parentInitials: '',
            supervisingAdultName: '',
            supervisingAdultSignature: '',
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.ageTier).toBe('18+');
    });
});

// audit Group C #25 — POST /api/waivers/:qrToken rejects missing
// erecordsConsent (HTTP 400, ESIGN §7001(c) gate).
//
// Source: worker/routes/waivers.js lines 175-177:
//     if (body.erecordsConsent !== true) {
//         return c.json({ error: '...consent to receive records electronically...' }, 400);
//     }
//
// The check is strict-equal to boolean true. Missing, false, "true", and 1
// must all reject. The error string must mention electronic records so users
// can recover.

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createWaiverFixture, postWaiver } from '../../helpers/waiverFixture.js';

describe('POST /api/waivers/:qrToken — erecordsConsent (ESIGN §7001(c))', () => {
    it('rejects 400 when erecordsConsent is missing', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();
        // Strip erecordsConsent from the body. Spread + delete keeps the rest
        // of the valid baseline intact.
        const { erecordsConsent, ...rest } = fixture.payload;
        fixture.payload = rest;

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/electron/i);

        // Handler must NOT have written the waiver row.
        const inserts = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('INSERT INTO waivers')
        );
        expect(inserts).toHaveLength(0);
    });

    it('rejects 400 when erecordsConsent is false', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture, { erecordsConsent: false });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/electron/i);
    });

    it('rejects 400 when erecordsConsent is non-strict-true (string "true")', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        // The check is `!== true`, so any non-boolean-true value rejects.
        const res = await postWaiver(env, fixture, { erecordsConsent: 'true' });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/electron/i);
    });
});

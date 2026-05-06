// audit Group C #26 — POST /api/waivers/:qrToken rejects signature that
// doesn't match attendee name (case/whitespace insensitive).
//
// Source: worker/routes/waivers.js lines 180-188:
//     const expectedName = [attendee.first_name, attendee.last_name].filter(Boolean).join(' ').trim();
//     if (expectedName) {
//         const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
//         if (norm(body.signature) !== norm(expectedName)) {
//             return c.json({ error: `Signature must match the name on your ticket: ${expectedName}` }, 400);
//         }
//     }
//
// The norm() function: trim, lowercase, collapse internal whitespace runs to
// a single space. Tests cover:
//   - plain mismatch → 400 with the expected name in the error
//   - case-insensitive accept (lowercase signature)
//   - whitespace-tolerant accept (extra spaces around or between names)

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createWaiverFixture, postWaiver } from '../../helpers/waiverFixture.js';

describe('POST /api/waivers/:qrToken — signature must match attendee name', () => {
    it('rejects 400 when signature is a different name', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture, { signature: 'Carol Jones' });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/must match/i);
        // The error string surfaces the expected name so the signer can fix it.
        expect(data.error).toMatch(/Alice Smith/);

        const inserts = env.DB.__writes().filter(w =>
            w.kind === 'run' && w.sql.includes('INSERT INTO waivers')
        );
        expect(inserts).toHaveLength(0);
    });

    it('accepts when signature matches case-insensitively', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture, { signature: 'alice smith' });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
    });

    it('accepts when signature has extra/internal whitespace', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        // norm() trims and collapses whitespace runs, so multi-space and
        // leading/trailing spaces should still match.
        const res = await postWaiver(env, fixture, { signature: '  Alice    Smith  ' });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
    });

    it('accepts when signature combines case and whitespace tolerance', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture, { signature: '  ALICE   smith ' });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
    });
});

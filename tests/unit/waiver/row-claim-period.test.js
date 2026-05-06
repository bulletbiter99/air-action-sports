// audit Group C #33 — POST /api/waivers/:qrToken stamps
// claim_period_expires_at = signed_at + 365d.
//
// INSERT bind indices (worker/routes/waivers.js lines 239-296):
//   [11] signed_at               — Date.now() at submit time
//   [20] created_at              — same nowMs literal as signed_at
//   [35] claim_period_expires_at — nowMs + (365 * 24 * 3600 * 1000)
//
// The 365d arithmetic uses literal milliseconds (CLAIM_PERIOD_MS at
// waivers.js:11), NOT calendar months — leap years are NOT special-cased.
// This test locks the millisecond arithmetic exactly. We freeze time to
// make the assertion byte-exact and immune to test-runner clock drift.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createWaiverFixture, postWaiver } from '../../helpers/waiverFixture.js';

const FROZEN_NOW = new Date('2026-05-06T12:00:00Z').getTime();
const CLAIM_PERIOD_MS = 365 * 24 * 60 * 60 * 1000;

function findWaiverInsert(env) {
    return env.DB.__writes().find(w =>
        w.kind === 'run' && w.sql.includes('INSERT INTO waivers')
    );
}

describe('POST /api/waivers/:qrToken — claim period + signed_at', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_NOW));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('binds signed_at to Date.now() at submit time (idx 11)', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const ins = findWaiverInsert(env);
        expect(ins.args[11]).toBe(FROZEN_NOW);

        // Response also returns signedAt.
        const data = await res.json();
        expect(data.signedAt).toBe(FROZEN_NOW);
    });

    it('binds created_at and signed_at to the same nowMs literal (idx 11 === idx 20)', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const ins = findWaiverInsert(env);
        // Both columns share the same nowMs binding — guards against future
        // refactor that recomputes Date.now() between the two binds.
        expect(ins.args[11]).toBe(ins.args[20]);
        expect(ins.args[20]).toBe(FROZEN_NOW);
    });

    it('binds claim_period_expires_at = signed_at + 365d in milliseconds (idx 35)', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const ins = findWaiverInsert(env);
        expect(ins.args[35]).toBe(FROZEN_NOW + CLAIM_PERIOD_MS);
        // Sanity: 365 * 24 * 3600 * 1000 = 31536000000 ms
        expect(ins.args[35] - ins.args[11]).toBe(31536000000);

        // Response surfaces the expiry too.
        const data = await res.json();
        expect(data.claimPeriodExpiresAt).toBe(FROZEN_NOW + CLAIM_PERIOD_MS);
    });
});

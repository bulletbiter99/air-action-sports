// audit Group C #28-#30 effects (companion to age-tier validation tests in
// batch 4a) — POST /api/waivers/:qrToken stamps tier-derived flags onto the
// waivers row.
//
// INSERT bind indices (worker/routes/waivers.js lines 245-297):
//   [14] is_minor             — 1 for '12-15' or '16-17', 0 for '18+'
//   [25] erecords_consent     — literal 1 (handler hard-codes; body must
//                                already be true to reach this point)
//   [27] age_tier             — '12-15' / '16-17' / '18+' literal string
//
// Source: `const isMinor = tier === '12-15' || tier === '16-17';`
//         (waivers.js line 227), and `isMinor ? 1 : 0` at bind site (275).
// erecords_consent at bind site (286) is the literal `1`, not the body's
// boolean true. This is locked here so a future refactor can't silently
// flip the column to a 0 if a future client sends a different shape.

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import {
    createWaiverFixture,
    validTeenPayload,
    validYouthPayload,
    postWaiver,
} from '../../helpers/waiverFixture.js';

function findWaiverInsert(env) {
    return env.DB.__writes().find(w =>
        w.kind === 'run' && w.sql.includes('INSERT INTO waivers')
    );
}

describe('POST /api/waivers/:qrToken — tier-derived row flags', () => {
    it('binds is_minor=0 + age_tier="18+" for adult signer', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const ins = findWaiverInsert(env);
        expect(ins.args[14]).toBe(0);
        expect(ins.args[27]).toBe('18+');

        // Response echoes the tier.
        const data = await res.json();
        expect(data.ageTier).toBe('18+');
    });

    it('binds is_minor=1 + age_tier="16-17" for teen signer', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();
        fixture.payload = validTeenPayload();

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const ins = findWaiverInsert(env);
        expect(ins.args[14]).toBe(1);
        expect(ins.args[27]).toBe('16-17');
    });

    it('binds is_minor=1 + age_tier="12-15" for youth signer', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();
        fixture.payload = validYouthPayload();

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const ins = findWaiverInsert(env);
        expect(ins.args[14]).toBe(1);
        expect(ins.args[27]).toBe('12-15');
    });

    it('binds erecords_consent to literal integer 1 (idx 25), not the body bool', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const ins = findWaiverInsert(env);
        // Locked: handler hard-codes 1 at bind site, regardless of what the
        // body shape was (only required to be `=== true` to pass validation).
        expect(ins.args[25]).toBe(1);
        // Strictness — must be the integer 1, not the boolean true.
        expect(ins.args[25]).not.toBe(true);
    });
});

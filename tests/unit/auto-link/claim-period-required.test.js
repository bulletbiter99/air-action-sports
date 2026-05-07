// audit Group D #41 — findExistingValidWaiver returns null when
// claim_period_expires_at is null (waivers without an explicit claim period
// are not eligible for auto-link).
//
// Source: worker/routes/webhooks.js line 28 — the SQL filter
// `claim_period_expires_at IS NOT NULL` excludes such rows. The mock D1
// returns null when no row matches the filter, and the function in turn
// returns null. This test locks the SQL clause + the null-row → null-result
// behavior together.

import { describe, it, expect } from 'vitest';
import { findExistingValidWaiver } from '../../../worker/lib/waiverLookup.js';
import { createMockD1 } from '../../helpers/mockD1.js';

describe('findExistingValidWaiver — claim period required', () => {
    it('SQL contains the IS NOT NULL filter on claim_period_expires_at', async () => {
        const db = createMockD1();
        // Mock returns a row regardless — this test only inspects the SQL.
        db.__on(/SELECT id FROM waivers/, { id: 'wv_x' }, 'first');

        await findExistingValidWaiver(db, 'a@x.com', 'Alice', 'Smith', 1);

        const sql = db.__writes()[0].sql;
        expect(sql).toContain('claim_period_expires_at IS NOT NULL');
    });

    it('returns null when D1 returns no row (e.g., all matches had NULL claim_period)', async () => {
        const db = createMockD1();
        // Default mock D1 returns null on first() when no handler matches —
        // but be explicit here so the test reads as "DB found no row, fn → null".
        db.__on(/SELECT id FROM waivers/, null, 'first');

        const result = await findExistingValidWaiver(db, 'a@x.com', 'Alice', 'Smith', 1);
        expect(result).toBeNull();
    });
});

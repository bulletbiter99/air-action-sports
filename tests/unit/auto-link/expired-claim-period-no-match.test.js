// audit Group D #42 — findExistingValidWaiver returns null when
// claim_period_expires_at <= asOfMs (expired waivers don't auto-link).
//
// Source: worker/routes/webhooks.js line 29 — the SQL filter
// `claim_period_expires_at > ?` is strictly greater-than (asOfMs equality
// is exclusive). The asOfMs value is bound at idx 2 faithfully — no unit
// conversion, no rounding. When the mock returns null (because the SQL
// filter would have excluded every candidate), the function returns null.

import { describe, it, expect } from 'vitest';
import { findExistingValidWaiver } from '../../../worker/lib/waiverLookup.js';
import { createMockD1 } from '../../helpers/mockD1.js';

describe('findExistingValidWaiver — expired claim period rejects', () => {
    it('SQL uses strict > comparison on claim_period_expires_at (equality is exclusive)', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_x' }, 'first');

        await findExistingValidWaiver(db, 'a@x.com', 'Alice', 'Smith', 1);

        const sql = db.__writes()[0].sql;
        expect(sql).toContain('claim_period_expires_at > ?');
        // Negative assertion: no >= comparison sneaking in.
        expect(sql).not.toContain('claim_period_expires_at >=');
    });

    it('binds asOfMs at idx 2 faithfully (no rounding, no unit conversion)', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_x' }, 'first');

        // Use a millisecond value that would round if accidentally divided
        // by 1000. If the function silently converted to seconds, the bind
        // would change.
        const asOfMs = 1746528123456;
        await findExistingValidWaiver(db, 'a@x.com', 'Alice', 'Smith', asOfMs);

        expect(db.__writes()[0].args[2]).toBe(asOfMs);
    });

    it('returns null when D1 returns no row (e.g., every candidate is expired)', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, null, 'first');

        const result = await findExistingValidWaiver(db, 'a@x.com', 'Alice', 'Smith', 9999999999);
        expect(result).toBeNull();
    });
});

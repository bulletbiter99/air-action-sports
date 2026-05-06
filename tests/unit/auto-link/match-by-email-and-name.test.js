// audit Group D #43 + #44 baseline — happy path: when an existing waiver
// matches by (email, full_name) AND has a non-null, non-expired claim
// period, findExistingValidWaiver returns its id.
//
// Source: worker/routes/webhooks.js lines 22-33. The SQL is:
//     SELECT id FROM waivers
//      WHERE LOWER(TRIM(email)) = ?
//        AND LOWER(TRIM(player_name)) = ?
//        AND claim_period_expires_at IS NOT NULL
//        AND claim_period_expires_at > ?
//      ORDER BY signed_at DESC
//      LIMIT 1
// Bound in order: (normEmail, normName, asOfMs).

import { describe, it, expect } from 'vitest';
import { findExistingValidWaiver } from '../../../worker/routes/webhooks.js';
import { createMockD1 } from '../../helpers/mockD1.js';

describe('findExistingValidWaiver — baseline match by email + name', () => {
    it('returns the wv_id when D1 returns a row', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_test_match' }, 'first');

        const result = await findExistingValidWaiver(
            db,
            'alice@example.com',
            'Alice',
            'Smith',
            1746528000000,
        );
        expect(result).toBe('wv_test_match');
    });

    it('issues exactly one query against waivers, with the locked SQL shape', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_x' }, 'first');

        await findExistingValidWaiver(db, 'alice@example.com', 'Alice', 'Smith', 1);

        const writes = db.__writes();
        expect(writes).toHaveLength(1);
        const { sql, kind } = writes[0];
        expect(kind).toBe('first');
        // Substring match — locks the load-bearing clauses without breaking
        // on cosmetic whitespace changes.
        expect(sql).toContain('SELECT id FROM waivers');
        expect(sql).toContain('LOWER(TRIM(email)) = ?');
        expect(sql).toContain('LOWER(TRIM(player_name)) = ?');
        expect(sql).toContain('claim_period_expires_at IS NOT NULL');
        expect(sql).toContain('claim_period_expires_at >');
        expect(sql).toContain('ORDER BY signed_at DESC');
        expect(sql).toContain('LIMIT 1');
    });

    it('binds exactly 3 args in order: normEmail, normName, asOfMs', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_x' }, 'first');

        await findExistingValidWaiver(
            db,
            'alice@example.com',
            'Alice',
            'Smith',
            1746528000000,
        );

        const args = db.__writes()[0].args;
        expect(args).toHaveLength(3);
        expect(args[0]).toBe('alice@example.com');
        expect(args[1]).toBe('alice smith');
        expect(args[2]).toBe(1746528000000);
    });
});

// milestone-only — locks the full normalization pipeline + interface
// contract of findExistingValidWaiver in one shot. The function is shared
// between the Stripe webhook handler (worker/routes/webhooks.js line 141)
// and the admin manual booking handler (audit Group E #51, deferred to a
// later batch). Both call sites pass (db, email, firstName, lastName,
// asOfMs) — so this contract test guards both flows simultaneously.
//
// Pipeline applied to every input:
//   email      → trim() → toLowerCase()                            (idx 0 bind)
//   firstName + lastName → filter(Boolean).join(' ').trim()
//                       → toLowerCase().replace(/\s+/g, ' ')      (idx 1 bind)
//   asOfMs     → passed through unchanged                          (idx 2 bind)

import { describe, it, expect } from 'vitest';
import { findExistingValidWaiver } from '../../../worker/lib/waiverLookup.js';
import { createMockD1 } from '../../helpers/mockD1.js';

describe('findExistingValidWaiver — cross-flow normalization pipeline', () => {
    it('applies all four normalization rules in one shot', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_match' }, 'first');

        // Maximally messy inputs:
        //   email has leading/trailing whitespace AND mixed case
        //   firstName has leading whitespace AND lowercase
        //   lastName has trailing whitespace AND uppercase
        //   asOfMs is a non-round millisecond value
        const result = await findExistingValidWaiver(
            db,
            '  ALICE@example.com ',
            '  alice',
            '  SMITH  ',
            1234567890,
        );

        expect(result).toBe('wv_match');

        const writes = db.__writes();
        expect(writes).toHaveLength(1);
        expect(writes[0].args).toHaveLength(3);
        // Idx 0: email trimmed + lowercased
        expect(writes[0].args[0]).toBe('alice@example.com');
        // Idx 1: name lowercased + internal-whitespace collapsed + outer-trimmed
        expect(writes[0].args[1]).toBe('alice smith');
        // Idx 2: asOfMs passed through unchanged
        expect(writes[0].args[2]).toBe(1234567890);
    });

    it('locks the (3-args, in this order) interface contract for both call sites', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_x' }, 'first');

        await findExistingValidWaiver(db, 'a@x.com', 'A', 'B', 99);

        // Future refactor that flips bind order or drops/adds a bind would
        // silently break BOTH the webhook flow and admin manual booking
        // flow. This assertion is the contract.
        const args = db.__writes()[0].args;
        expect(args).toHaveLength(3);
        expect(typeof args[0]).toBe('string');  // email
        expect(typeof args[1]).toBe('string');  // name
        expect(typeof args[2]).toBe('number');  // asOfMs
    });
});

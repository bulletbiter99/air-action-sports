// audit Group D #46 — findExistingValidWaiver does NOT match a sibling
// with the same email but a different name.
//
// Source: worker/routes/webhooks.js — the SQL filter is
//     LOWER(TRIM(email)) = ? AND LOWER(TRIM(player_name)) = ?
// (a tuple match, not just email). So two siblings booking under one
// parent's email get distinct normalized name binds, and a query with one
// sibling's name doesn't return the other's waiver.
//
// Identity = (email, full_name), per webhooks.js comment lines 14-17.

import { describe, it, expect } from 'vitest';
import { findExistingValidWaiver } from '../../../worker/routes/webhooks.js';
import { createMockD1 } from '../../helpers/mockD1.js';

describe('findExistingValidWaiver — sibling differentiation by name', () => {
    it('different last name produces a different normName bind', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_x' }, 'first');

        // Alice and Bob share an email (parent's address) but have
        // different last names. The two queries bind distinct normName
        // values (idx 1).
        await findExistingValidWaiver(db, 'parent@x.com', 'Alice', 'Smith', 1);
        await findExistingValidWaiver(db, 'parent@x.com', 'Bob', 'Jones', 1);

        const writes = db.__writes();
        expect(writes).toHaveLength(2);
        expect(writes[0].args[1]).toBe('alice smith');
        expect(writes[1].args[1]).toBe('bob jones');
        // Same email is bound for both
        expect(writes[0].args[0]).toBe('parent@x.com');
        expect(writes[1].args[0]).toBe('parent@x.com');
    });

    it('querying for sibling does not return the other sibling\'s waiver', async () => {
        const db = createMockD1();
        // "Smart" mock: only return Alice's waiver if the bind matches her
        // normalized name. Any other normalized name returns null. This
        // simulates D1's SQL filter behavior.
        db.__on(
            /SELECT id FROM waivers/,
            (sql, args) => (args[1] === 'alice smith' ? { id: 'wv_alice' } : null),
            'first',
        );

        // Alice (the original) — matches.
        const alice = await findExistingValidWaiver(db, 'parent@x.com', 'Alice', 'Smith', 1);
        expect(alice).toBe('wv_alice');

        // Bob (sibling, different last name) — no match.
        const bob = await findExistingValidWaiver(db, 'parent@x.com', 'Bob', 'Jones', 1);
        expect(bob).toBeNull();

        // Carol (sibling, different first AND last) — no match.
        const carol = await findExistingValidWaiver(db, 'parent@x.com', 'Carol', 'Lee', 1);
        expect(carol).toBeNull();
    });
});

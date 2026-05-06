// audit Group D #44 — findExistingValidWaiver matches case- and whitespace-
// insensitively on player_name.
//
// Source: worker/routes/webhooks.js lines 20, 23:
//     const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
//     const normName = fullName.toLowerCase().replace(/\s+/g, ' ');
//
// Pipeline: filter falsy parts, join with single space, trim outer
// whitespace, lowercase, then collapse internal whitespace runs to single
// spaces. The bind value (idx 1) reflects the final form. Tests cover both
// firstName and lastName whitespace cases plus the single-name (D40
// boundary) case where lastName is falsy.

import { describe, it, expect } from 'vitest';
import { findExistingValidWaiver } from '../../../worker/routes/webhooks.js';
import { createMockD1 } from '../../helpers/mockD1.js';

describe('findExistingValidWaiver — whitespace-tolerant name matching', () => {
    it('collapses internal whitespace and lowercases the name', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_x' }, 'first');

        // firstName has trailing whitespace; the join + lowercase + collapse
        // pipeline must produce 'alice smith'.
        await findExistingValidWaiver(db, 'a@x.com', '  Alice  ', 'Smith', 1);

        expect(db.__writes()[0].args[1]).toBe('alice smith');
    });

    it('trims surrounding whitespace on lastName too', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_x' }, 'first');

        await findExistingValidWaiver(db, 'a@x.com', 'Alice', '  Smith  ', 1);

        expect(db.__writes()[0].args[1]).toBe('alice smith');
    });

    it('handles single-name attendees (lastName falsy) — fullName is just firstName', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_x' }, 'first');

        // filter(Boolean) drops null lastName → fullName === 'Alice'.
        // This proves D40's boundary: lastName falsy is OK as long as
        // firstName provides a non-empty fullName.
        await findExistingValidWaiver(db, 'a@x.com', 'Alice', null, 1);

        expect(db.__writes()[0].args[1]).toBe('alice');
    });
});

// audit Group D #39 + #40 — findExistingValidWaiver returns null on empty
// email, AND returns null on empty fullName.
//
// Source: worker/routes/webhooks.js lines 18-21:
//     if (!email) return null;
//     const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
//     if (!fullName) return null;
//
// Both checks short-circuit BEFORE the db.prepare call, so a null-input
// invocation must not issue any SQL queries (test asserts via db.__writes()).
// This is the cheap-no-op contract the webhook handler relies on.

import { describe, it, expect } from 'vitest';
import { findExistingValidWaiver } from '../../../worker/routes/webhooks.js';
import { createMockD1 } from '../../helpers/mockD1.js';

describe('findExistingValidWaiver — null inputs return null without DB call', () => {
    it('returns null on empty-string email', async () => {
        const db = createMockD1();
        const result = await findExistingValidWaiver(db, '', 'Alice', 'Smith', 1);
        expect(result).toBeNull();
        expect(db.__writes()).toHaveLength(0);
    });

    it('returns null on null email', async () => {
        const db = createMockD1();
        const result = await findExistingValidWaiver(db, null, 'Alice', 'Smith', 1);
        expect(result).toBeNull();
        expect(db.__writes()).toHaveLength(0);
    });

    it('returns null on undefined email', async () => {
        const db = createMockD1();
        const result = await findExistingValidWaiver(db, undefined, 'Alice', 'Smith', 1);
        expect(result).toBeNull();
        expect(db.__writes()).toHaveLength(0);
    });

    it('returns null when both firstName and lastName are falsy', async () => {
        const db = createMockD1();
        // filter(Boolean) drops both null entries → fullName === ''
        const result = await findExistingValidWaiver(db, 'a@x.com', null, null, 1);
        expect(result).toBeNull();
        expect(db.__writes()).toHaveLength(0);
    });

    it('returns null when both names collapse to empty after trim', async () => {
        const db = createMockD1();
        // Whitespace-only strings ARE truthy, so they survive filter(Boolean).
        // join(' ') + trim() then collapses '   '+' '+'   ' → '' so the
        // fullName check fires.
        const result = await findExistingValidWaiver(db, 'a@x.com', '   ', '   ', 1);
        expect(result).toBeNull();
        expect(db.__writes()).toHaveLength(0);
    });
});

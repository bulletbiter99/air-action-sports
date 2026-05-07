// audit Group D #43 — findExistingValidWaiver matches case-insensitively
// on email.
//
// Source: worker/routes/webhooks.js line 22:
//     const normEmail = email.trim().toLowerCase();
// (And the SQL filter is `LOWER(TRIM(email)) = ?`, so a bind of an
// already-lowercased + trimmed value matches DB rows regardless of how the
// email was originally stored.)
//
// Tests assert the bind value (idx 0). Trim happens before lowercase but
// neither order affects the result for ASCII emails.

import { describe, it, expect } from 'vitest';
import { findExistingValidWaiver } from '../../../worker/lib/waiverLookup.js';
import { createMockD1 } from '../../helpers/mockD1.js';

describe('findExistingValidWaiver — case-insensitive email matching', () => {
    it('lowercases mixed-case email before binding', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_x' }, 'first');

        await findExistingValidWaiver(db, 'Alice@Example.COM', 'Alice', 'Smith', 1);

        expect(db.__writes()[0].args[0]).toBe('alice@example.com');
    });

    it('trims leading and trailing whitespace from email', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_x' }, 'first');

        await findExistingValidWaiver(db, '   alice@example.com   ', 'Alice', 'Smith', 1);

        expect(db.__writes()[0].args[0]).toBe('alice@example.com');
    });

    it('lowercases domain segments including subdomain (full string lowercase)', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_x' }, 'first');

        await findExistingValidWaiver(
            db,
            'ALICE@SUBDOMAIN.EXAMPLE.COM',
            'Alice',
            'Smith',
            1,
        );

        // Whole string lowercased — locked guarantee, not "only the local part."
        expect(db.__writes()[0].args[0]).toBe('alice@subdomain.example.com');
    });
});

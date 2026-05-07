// audit Group D #45 — findExistingValidWaiver returns latest by signed_at
// when multiple match (most-recent waiver wins as the auto-link target).
//
// Source: worker/routes/webhooks.js line 30:
//     ORDER BY signed_at DESC
//     LIMIT 1
//
// The SQL itself encodes the tiebreaker — D1 selects the latest row, so
// the function returns the latest match's id. Tests lock the SQL clauses;
// the actual ordering is D1's job.

import { describe, it, expect } from 'vitest';
import { findExistingValidWaiver } from '../../../worker/lib/waiverLookup.js';
import { createMockD1 } from '../../helpers/mockD1.js';

describe('findExistingValidWaiver — latest-by-signed_at tiebreaker', () => {
    it('SQL has ORDER BY signed_at DESC LIMIT 1', async () => {
        const db = createMockD1();
        db.__on(/SELECT id FROM waivers/, { id: 'wv_x' }, 'first');

        await findExistingValidWaiver(db, 'a@x.com', 'Alice', 'Smith', 1);

        const sql = db.__writes()[0].sql;
        expect(sql).toContain('ORDER BY signed_at DESC');
        expect(sql).toContain('LIMIT 1');
        // Negative assertion: not ascending.
        expect(sql).not.toContain('ORDER BY signed_at ASC');
    });

    it('returns whichever id D1 selects (function trusts D1 to apply the order)', async () => {
        const db = createMockD1();
        // Simulate D1 having applied ORDER BY signed_at DESC LIMIT 1 — the
        // mock returns whichever id we say is "latest." The function must
        // pass it through unchanged.
        db.__on(/SELECT id FROM waivers/, { id: 'wv_latest_signed' }, 'first');

        const result = await findExistingValidWaiver(db, 'a@x.com', 'Alice', 'Smith', 1);
        expect(result).toBe('wv_latest_signed');
    });
});

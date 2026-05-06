// POST-side integrity failure — companion to audit Group C #37/#38 (which
// number the GET-side path explicitly). The POST handler also calls
// getLiveWaiverDocument at submit time and refuses to write a waiver row
// when the doc's stored body_sha256 doesn't match the recomputed hash.
//
// Source: worker/routes/waivers.js lines 232-236:
//     const doc = await getLiveWaiverDocument(c.env);
//     if (!doc) return c.json({ error: 'No waiver document is currently active' }, 500);
//     if (doc._integrity === 'mismatch') {
//         return c.json({ error: 'Waiver document integrity check failed' }, 500);
//     }
//
// Distinct from the GET path (which writes an audit row), the POST path
// returns 500 WITHOUT emitting an audit row. This is locked here so a future
// refactor doesn't accidentally double-log the integrity failure or — worse —
// silently fall through and write a waiver row pointing at a tampered doc.

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import {
    createWaiverFixture,
    postWaiverWithOpts,
} from '../../helpers/waiverFixture.js';

describe('POST /api/waivers/:qrToken — integrity failure on submit', () => {
    it('returns 500 with "integrity check failed" when stored body_sha256 doesn\'t match', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiverWithOpts(env, fixture, { tamperedDoc: true });
        expect(res.status).toBe(500);
        const data = await res.json();
        expect(data.error).toMatch(/integrity/i);
    });

    it('writes NOTHING from the POST path on integrity failure', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiverWithOpts(env, fixture, { tamperedDoc: true });
        expect(res.status).toBe(500);

        const writes = env.DB.__writes().filter(w => w.kind === 'run');
        // No waivers row
        expect(writes.find(w => w.sql.includes('INSERT INTO waivers'))).toBeUndefined();
        // No attendees update
        expect(writes.find(w => w.sql.includes('UPDATE attendees SET waiver_id'))).toBeUndefined();
        // No audit row of ANY flavor — the POST path is silent on integrity
        // failure (the GET path is the one that emits the audit row).
        expect(writes.find(w => w.sql.includes('INSERT INTO audit_log'))).toBeUndefined();
    });
});

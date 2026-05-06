// audit Group C #37 + #38 — getLiveWaiverDocument flags 'mismatch' when
// body_html SHA-256 ≠ stored body_sha256, AND GET /api/waivers/:qrToken
// refuses to serve when the integrity check fails AND writes audit row
// 'waiver_document.integrity_failure'.
//
// Source: worker/routes/waivers.js lines 65-96.
//
// The audit row is emitted ONLY on the GET path (the POST path returns 500
// silently — see integrity-fail-on-post.test.js). The audit row's INSERT
// shape:
//     INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
//     VALUES (NULL, 'waiver_document.integrity_failure', 'waiver_document', ?, ?, ?)
// 3 binds: doc.id, meta_json (JSON.stringify({ expected, recomputed })), Date.now().
// (No ip_address column on this audit row — distinct from the 'waiver.signed' shape.)

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createWaiverFixture } from '../../helpers/waiverFixture.js';

const TAMPERED_HASH = 'a'.repeat(64);

async function getWaiver(env, qrToken) {
    const url = `https://airactionsport.com/api/waivers/${qrToken}`;
    const req = new Request(url, {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '203.0.113.1' },
    });
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
    return worker.fetch(req, env, ctx);
}

function bindGetIntegrityFixture(env, fixture) {
    // GET handler hits a JOIN query (different from POST's SELECT *), so we
    // register a regex that matches the JOIN-shape SELECT.
    env.DB.__on(
        /SELECT a\.\*, b\.event_id/,
        {
            ...fixture.attendee,
            event_id: 'ev_test',
            buyer_name: 'Buyer',
            buyer_email: 'b@x.com',
            buyer_phone: '5550000',
        },
        'first',
    );
    env.DB.__on(
        /SELECT \* FROM events WHERE id/,
        { id: 'ev_test', title: 'Op Night', date_iso: '2026-05-09T08:00:00-06:00', published: 1 },
        'first',
    );
    // Tampered doc — stored hash doesn't match sha256(body_html).
    env.DB.__on(
        /FROM waiver_documents/,
        { ...fixture.doc, body_sha256: TAMPERED_HASH },
        'first',
    );
}

describe('GET /api/waivers/:qrToken — integrity failure', () => {
    it('returns 500 with "integrity check failed" error', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();
        bindGetIntegrityFixture(env, fixture);

        const res = await getWaiver(env, fixture.qrToken);
        expect(res.status).toBe(500);
        const data = await res.json();
        expect(data.error).toMatch(/integrity/i);
    });

    it('writes audit row "waiver_document.integrity_failure" with target_type=waiver_document', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();
        bindGetIntegrityFixture(env, fixture);

        await getWaiver(env, fixture.qrToken);

        const audits = env.DB.__writes().filter(w =>
            w.kind === 'run'
            && w.sql.includes('INSERT INTO audit_log')
            && w.sql.includes("'waiver_document.integrity_failure'")
        );
        expect(audits).toHaveLength(1);
        // target_type is the literal 'waiver_document' (not a bind).
        expect(audits[0].sql).toContain("'waiver_document'");
        // target_id (idx 0) is the live doc id — so an investigator can find
        // exactly which row was tampered.
        expect(audits[0].args[0]).toBe(fixture.doc.id);
    });

    it('audit meta_json carries both expected (stored) and recomputed hashes', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();
        bindGetIntegrityFixture(env, fixture);

        await getWaiver(env, fixture.qrToken);

        const audit = env.DB.__writes().find(w =>
            w.kind === 'run'
            && w.sql.includes('INSERT INTO audit_log')
            && w.sql.includes("'waiver_document.integrity_failure'")
        );
        expect(audit).toBeDefined();
        const meta = JSON.parse(audit.args[1]);
        // expected = the (tampered) hash that was stored on the row
        expect(meta.expected).toBe(TAMPERED_HASH);
        // recomputed = the actual sha256(body_html) — matches fixture's
        // correct hash since fixture.doc.body_sha256 was computed from
        // body_html before we overrode it with TAMPERED_HASH at bind time.
        expect(meta.recomputed).toBe(fixture.doc.body_sha256);
        expect(meta.recomputed).not.toBe(meta.expected);
    });
});

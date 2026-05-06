// audit Group C #35 — POST /api/waivers/:qrToken writes audit row
// 'waiver.signed' targeting the attendee.
//
// Source: worker/routes/waivers.js lines 303-317:
//     INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
//     VALUES (NULL, 'waiver.signed', 'attendee', ?, ?, ?, ?)
//
// Bind order:
//   [0] attendee.id          — target_id
//   [1] meta_json (string)   — { waiver_id, booking_id, waiver_document_id, waiver_document_version, body_sha256 }
//   [2] ip                   — CF-Connecting-IP header value (or X-Forwarded-For, or null)
//   [3] nowMs                — created_at timestamp (same as signed_at on the waivers row)

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createWaiverFixture, postWaiver } from '../../helpers/waiverFixture.js';

function findSignedAuditRow(env) {
    return env.DB.__writes().find(w =>
        w.kind === 'run'
        && w.sql.includes('INSERT INTO audit_log')
        && w.sql.includes("'waiver.signed'")
    );
}

describe('POST /api/waivers/:qrToken — audit row "waiver.signed"', () => {
    it('emits one audit row per signed waiver, target_type=attendee', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const audits = env.DB.__writes().filter(w =>
            w.kind === 'run'
            && w.sql.includes('INSERT INTO audit_log')
            && w.sql.includes("'waiver.signed'")
        );
        expect(audits).toHaveLength(1);

        // SQL has the literal target_type='attendee' baked in (not a bind),
        // so verifying via SQL substring suffices.
        expect(audits[0].sql).toContain("'attendee'");
        // target_id (idx 0) is the attendee id.
        expect(audits[0].args[0]).toBe(fixture.attendee.id);
    });

    it('meta_json contains waiver_id, booking_id, waiver_document_id+version, body_sha256', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);
        const data = await res.json();

        const row = findSignedAuditRow(env);
        expect(row).toBeDefined();

        const meta = JSON.parse(row.args[1]);
        expect(meta.waiver_id).toBe(data.waiverId);
        expect(meta.booking_id).toBe(fixture.attendee.booking_id);
        expect(meta.waiver_document_id).toBe(fixture.doc.id);
        expect(meta.waiver_document_version).toBe(fixture.doc.version);
        expect(meta.body_sha256).toBe(fixture.doc.body_sha256);
    });

    it('user_id column is NULL (public endpoint, no admin context)', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const row = findSignedAuditRow(env);
        // SQL has VALUES (NULL, 'waiver.signed', 'attendee', ?, ?, ?, ?) —
        // user_id is the literal NULL, not a bind. Verify the SQL shape.
        expect(row.sql).toMatch(/VALUES\s*\(\s*NULL\s*,\s*'waiver\.signed'/);
    });

    it('ip_address (idx 2) reflects the CF-Connecting-IP request header', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture();

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const row = findSignedAuditRow(env);
        // The fixture's postWaiver helper sets CF-Connecting-IP to
        // '203.0.113.1' (TEST-NET-3 RFC 5737 documentation range).
        expect(row.args[2]).toBe('203.0.113.1');
    });
});

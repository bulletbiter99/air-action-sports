// audit Group C #32 — POST /api/waivers/:qrToken stamps body_html_snapshot
// + body_sha256 + waiver_document_version on the waivers row, plus the
// waiver_document_id (the document the snapshot belongs to).
//
// INSERT bind indices (worker/routes/waivers.js lines 245-297):
//   [21] waiver_document_id        — doc.id (live document)
//   [22] waiver_document_version   — doc.version
//   [23] body_html_snapshot        — doc.body_html (full HTML of the live doc)
//   [24] body_sha256               — doc.body_sha256 (recomputed-and-verified)
//
// All four come from the live document fetched server-side at submit time
// (line 232: `const doc = await getLiveWaiverDocument(c.env)`), NOT from
// anything the client sent. This guards against a malicious client trying
// to claim it signed an older / different document.

import { describe, it, expect } from 'vitest';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createWaiverFixture, postWaiver } from '../../helpers/waiverFixture.js';

function findWaiverInsert(env) {
    return env.DB.__writes().find(w =>
        w.kind === 'run' && w.sql.includes('INSERT INTO waivers')
    );
}

describe('POST /api/waivers/:qrToken — waiver row doc link + snapshot', () => {
    it('binds waiver_document_id from the live doc (idx 21)', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture({
            docFields: { id: 'wd_specific_id_42' },
        });

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const ins = findWaiverInsert(env);
        expect(ins).toBeDefined();
        expect(ins.args[21]).toBe('wd_specific_id_42');
    });

    it('binds waiver_document_version from the live doc (idx 22)', async () => {
        const env = createMockEnv();
        const fixture = await createWaiverFixture({
            docFields: { version: 7 },
        });

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const ins = findWaiverInsert(env);
        expect(ins.args[22]).toBe(7);

        // Response also surfaces the version to the client.
        const data = await res.json();
        expect(data.waiverDocumentVersion).toBe(7);
    });

    it('binds body_html_snapshot from the live doc body_html (idx 23)', async () => {
        const env = createMockEnv();
        const customHtml = '<h1>Custom v9 Body</h1><p>Many words here.</p>';
        const fixture = await createWaiverFixture({ bodyHtml: customHtml });

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const ins = findWaiverInsert(env);
        // Full HTML is snapshotted verbatim.
        expect(ins.args[23]).toBe(customHtml);
    });

    it('binds body_sha256 from the live doc (idx 24, equals snapshot hash)', async () => {
        const env = createMockEnv();
        const customHtml = '<h1>Hash check</h1>';
        const fixture = await createWaiverFixture({ bodyHtml: customHtml });

        const res = await postWaiver(env, fixture);
        expect(res.status).toBe(200);

        const ins = findWaiverInsert(env);
        // The fixture's body_sha256 is the real SHA-256 of body_html. The
        // INSERT must bind that same hash — proves the row links to a hash
        // that round-trips against body_html_snapshot.
        expect(ins.args[24]).toBe(fixture.doc.body_sha256);
        // 64 hex chars
        expect(ins.args[24]).toMatch(/^[0-9a-f]{64}$/);
    });
});

// Sprint 4 B5 — pins the SUA seed's integrity contract (migration 0080).
//
// The agreement-signing flow snapshots sua_body_sha256_snapshot from the live
// template at signing time, so a seed whose body_sha256 does NOT equal
// sha256(body_html) would poison every signature's integrity trail from day
// one. Runs against the real migrated schema (the seed INSERT itself already
// proves 0080 applies — this checks the DATA is right, which the schema
// guard's compile-only pass cannot).

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { getSchemaDb } from '../../helpers/realSchema.js';

describe('migration 0080 — SUA seed integrity', () => {
    it('seeds exactly one LIVE template', () => {
        const rows = getSchemaDb().prepare(
            'SELECT id, version, title, retired_at FROM site_use_agreement_documents',
        ).all();
        expect(rows).toHaveLength(1);
        expect(rows[0].version).toBe(1);
        expect(rows[0].retired_at).toBeNull();
        // The title must broadcast that this is not attorney-reviewed text.
        expect(rows[0].title).toMatch(/PLACEHOLDER/);
    });

    it('body_sha256 equals sha256(body_html) exactly as stored', () => {
        const row = getSchemaDb().prepare(
            'SELECT body_html, body_sha256 FROM site_use_agreement_documents WHERE retired_at IS NULL',
        ).get();
        const actual = createHash('sha256').update(row.body_html, 'utf8').digest('hex');
        expect(row.body_sha256).toBe(actual);
    });

    it('the body itself carries the needs-review banner', () => {
        const row = getSchemaDb().prepare(
            'SELECT body_html FROM site_use_agreement_documents WHERE retired_at IS NULL',
        ).get();
        expect(row.body_html).toMatch(/NOT BEEN REVIEWED BY AN ATTORNEY/);
        expect(row.body_html).toMatch(/docs\/runbooks\/sua-template\.md/);
    });
});

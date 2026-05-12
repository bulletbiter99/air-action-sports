// Vitest unit tests for the pure helpers in scripts/seed-sites.js.
// I/O paths (wrangler shell-out) are not exercised here.

import { describe, it, expect } from 'vitest';
import {
    SEED_SITES,
    buildSeedPlan,
    planToSql,
    planToHumanSummary,
    escapeSqlString,
    makeSiteId,
    makeFieldId,
} from '../../../scripts/seed-sites.js';

describe('SEED_SITES constant', () => {
    it('has 2 sites: ghost-town + foxtrot', () => {
        expect(SEED_SITES).toHaveLength(2);
        const slugs = SEED_SITES.map((s) => s.slug);
        expect(slugs).toContain('ghost-town');
        expect(slugs).toContain('foxtrot');
    });

    it('each site has exactly 1 field with matching slug', () => {
        for (const site of SEED_SITES) {
            expect(site.fields).toHaveLength(1);
            expect(site.fields[0].slug).toBe(site.slug);
        }
    });

    it('Ghost Town is in Hiawatha UT 84545', () => {
        const gt = SEED_SITES.find((s) => s.slug === 'ghost-town');
        expect(gt.city).toBe('Hiawatha');
        expect(gt.state).toBe('UT');
        expect(gt.postal_code).toBe('84545');
    });

    it('Foxtrot is in Kaysville UT 84037', () => {
        const fox = SEED_SITES.find((s) => s.slug === 'foxtrot');
        expect(fox.city).toBe('Kaysville');
        expect(fox.state).toBe('UT');
        expect(fox.postal_code).toBe('84037');
    });

    it('uses 30-minute default arrival/cleanup buffers', () => {
        for (const site of SEED_SITES) {
            expect(site.default_arrival_buffer_minutes).toBe(30);
            expect(site.default_cleanup_buffer_minutes).toBe(30);
        }
    });
});

describe('buildSeedPlan', () => {
    it('with empty existing tables: plans 2 site inserts + 2 field inserts', () => {
        const plan = buildSeedPlan([], []);
        const inserts = plan.filter((p) => p.kind === 'insert_site');
        const fieldInserts = plan.filter((p) => p.kind === 'insert_field');
        expect(inserts).toHaveLength(2);
        expect(fieldInserts).toHaveLength(2);
        expect(plan.filter((p) => p.kind.startsWith('skip'))).toHaveLength(0);
    });

    it('insert_site ops include all 13 site payload fields', () => {
        const plan = buildSeedPlan([], []);
        const gtInsert = plan.find(
            (p) => p.kind === 'insert_site' && p.site_slug === 'ghost-town',
        );
        expect(gtInsert.payload.slug).toBe('ghost-town');
        expect(gtInsert.payload.name).toBe('Ghost Town');
        expect(gtInsert.payload.city).toBe('Hiawatha');
        expect(gtInsert.payload.postal_code).toBe('84545');
        expect(gtInsert.payload.default_arrival_buffer_minutes).toBe(30);
    });

    it('generates site_<random12> ID format', () => {
        const plan = buildSeedPlan([], []);
        const siteInserts = plan.filter((p) => p.kind === 'insert_site');
        for (const op of siteInserts) {
            expect(op.site_id).toMatch(/^site_[0-9A-Za-z]{12}$/);
        }
    });

    it('generates fld_<random12> ID format', () => {
        const plan = buildSeedPlan([], []);
        const fieldInserts = plan.filter((p) => p.kind === 'insert_field');
        for (const op of fieldInserts) {
            expect(op.field_id).toMatch(/^fld_[0-9A-Za-z]{12}$/);
        }
    });

    it('field insert references its parent site_id from the same plan', () => {
        const plan = buildSeedPlan([], []);
        const gtSite = plan.find(
            (p) => p.kind === 'insert_site' && p.site_slug === 'ghost-town',
        );
        const gtField = plan.find(
            (p) => p.kind === 'insert_field' && p.site_slug === 'ghost-town',
        );
        expect(gtField.site_id).toBe(gtSite.site_id);
        expect(gtField.payload.site_id).toBe(gtSite.site_id);
    });

    it('idempotent when Ghost Town already exists: plans only Foxtrot site + foxtrot field', () => {
        const existingSites = [{ id: 'site_existing01234', slug: 'ghost-town' }];
        const existingFields = [
            { id: 'fld_existing01234', site_id: 'site_existing01234', slug: 'ghost-town' },
        ];
        const plan = buildSeedPlan(existingSites, existingFields);
        const inserts = plan.filter((p) => p.kind === 'insert_site');
        const fieldInserts = plan.filter((p) => p.kind === 'insert_field');
        const skips = plan.filter((p) => p.kind.startsWith('skip'));
        expect(inserts).toHaveLength(1);
        expect(inserts[0].site_slug).toBe('foxtrot');
        expect(fieldInserts).toHaveLength(1);
        expect(fieldInserts[0].site_slug).toBe('foxtrot');
        expect(skips).toHaveLength(2); // ghost-town site + ghost-town field
    });

    it('idempotent when both sites + both fields already exist: no inserts', () => {
        const existingSites = [
            { id: 'site_existing01234', slug: 'ghost-town' },
            { id: 'site_existing56789', slug: 'foxtrot' },
        ];
        const existingFields = [
            { id: 'fld_g01234567890', site_id: 'site_existing01234', slug: 'ghost-town' },
            { id: 'fld_f01234567890', site_id: 'site_existing56789', slug: 'foxtrot' },
        ];
        const plan = buildSeedPlan(existingSites, existingFields);
        const inserts = plan.filter((p) => p.kind.startsWith('insert'));
        expect(inserts).toHaveLength(0);
        expect(plan.filter((p) => p.kind.startsWith('skip'))).toHaveLength(4);
    });

    it('site exists but field is missing: inserts field only', () => {
        const existingSites = [{ id: 'site_existing01234', slug: 'ghost-town' }];
        const existingFields = []; // field row dropped/never created
        const plan = buildSeedPlan(existingSites, existingFields);
        const siteInserts = plan.filter((p) => p.kind === 'insert_site');
        const fieldInserts = plan.filter((p) => p.kind === 'insert_field');
        // ghost-town site skipped (exists); ghost-town field inserted; foxtrot site + field inserted
        expect(siteInserts.map((p) => p.site_slug)).toEqual(['foxtrot']);
        expect(fieldInserts).toHaveLength(2);
        const gtFieldInsert = fieldInserts.find((p) => p.site_slug === 'ghost-town');
        expect(gtFieldInsert.payload.site_id).toBe('site_existing01234');
    });

    it('accepts injected seedData for test isolation', () => {
        const customSeed = [
            {
                slug: 'test-site',
                name: 'Test Site',
                address: null,
                city: 'Testville',
                state: 'CA',
                postal_code: '90210',
                total_acreage: 5.5,
                notes: 'unit test',
                default_arrival_buffer_minutes: 15,
                default_cleanup_buffer_minutes: 45,
                default_blackout_window: null,
                fields: [{ slug: 'a', name: 'A', approximate_acreage: null, notes: null }],
            },
        ];
        const plan = buildSeedPlan([], [], customSeed);
        const siteInsert = plan.find((p) => p.kind === 'insert_site');
        expect(siteInsert.payload.slug).toBe('test-site');
        expect(siteInsert.payload.total_acreage).toBe(5.5);
    });
});

describe('planToSql', () => {
    it('produces 2 SQL statements per insert_site op (INSERT + audit_log)', () => {
        const plan = [
            {
                kind: 'insert_site',
                site_slug: 'ghost-town',
                site_id: 'site_test123',
                payload: {
                    id: 'site_test123',
                    slug: 'ghost-town',
                    name: 'Ghost Town',
                    address: null,
                    city: 'Hiawatha',
                    state: 'UT',
                    postal_code: '84545',
                    total_acreage: null,
                    notes: null,
                    default_arrival_buffer_minutes: 30,
                    default_cleanup_buffer_minutes: 30,
                    default_blackout_window: null,
                },
            },
        ];
        const sql = planToSql(plan, 1700000000000);
        expect(sql).toHaveLength(2);
        expect(sql[0]).toContain('INSERT INTO sites');
        expect(sql[0]).toContain("'ghost-town'");
        expect(sql[0]).toContain("'Hiawatha'");
        expect(sql[1]).toContain('INSERT INTO audit_log');
        expect(sql[1]).toContain("'site.created'");
    });

    it('produces 2 SQL statements per insert_field op (INSERT + audit_log)', () => {
        const plan = [
            {
                kind: 'insert_field',
                site_slug: 'ghost-town',
                site_id: 'site_test123',
                field_slug: 'ghost-town',
                field_id: 'fld_test456',
                payload: {
                    id: 'fld_test456',
                    site_id: 'site_test123',
                    slug: 'ghost-town',
                    name: 'Ghost Town',
                    approximate_acreage: null,
                    notes: null,
                },
            },
        ];
        const sql = planToSql(plan, 1700000000000);
        expect(sql).toHaveLength(2);
        expect(sql[0]).toContain('INSERT INTO site_fields');
        expect(sql[1]).toContain('INSERT INTO audit_log');
        expect(sql[1]).toContain("'site_field.created'");
    });

    it('skip ops produce no SQL', () => {
        const plan = [
            { kind: 'skip_site_exists', site_slug: 'ghost-town', existing_id: 'site_x' },
            { kind: 'skip_field_exists', site_slug: 'ghost-town', field_slug: 'main', existing_id: 'fld_x' },
        ];
        expect(planToSql(plan, 1700000000000)).toHaveLength(0);
    });

    it('full end-to-end: empty input → 2 site INSERTs + 2 field INSERTs + 4 audit_log INSERTs (8 total)', () => {
        const plan = buildSeedPlan([], []);
        const sql = planToSql(plan, 1700000000000);
        expect(sql).toHaveLength(8);
        // INSERT INTO sites (with paren) disambiguates from site_fields
        expect(sql.filter((s) => s.includes('INSERT INTO sites ('))).toHaveLength(2);
        expect(sql.filter((s) => s.includes('INSERT INTO site_fields'))).toHaveLength(2);
        expect(sql.filter((s) => s.includes('INSERT INTO audit_log'))).toHaveLength(4);
    });
});

describe('escapeSqlString', () => {
    it('returns NULL for null/undefined', () => {
        expect(escapeSqlString(null)).toBe('NULL');
        expect(escapeSqlString(undefined)).toBe('NULL');
    });

    it("doubles single quotes (SQL injection defense)", () => {
        expect(escapeSqlString("O'Brien")).toBe("'O''Brien'");
        // Leading quote → escaped to '' → outer wrap adds another → 3 leading quotes
        expect(escapeSqlString("'; DROP TABLE sites; --")).toBe(
            "'''; DROP TABLE sites; --'",
        );
    });

    it('wraps normal strings in single quotes', () => {
        expect(escapeSqlString('Ghost Town')).toBe("'Ghost Town'");
        expect(escapeSqlString('')).toBe("''");
    });
});

describe('makeSiteId / makeFieldId', () => {
    it('generates site_<random12> format', () => {
        const id = makeSiteId();
        expect(id).toMatch(/^site_[0-9A-Za-z]{12}$/);
    });

    it('generates fld_<random12> format', () => {
        const id = makeFieldId();
        expect(id).toMatch(/^fld_[0-9A-Za-z]{12}$/);
    });

    it('generates unique IDs across calls', () => {
        const ids = new Set();
        for (let i = 0; i < 50; i++) ids.add(makeSiteId());
        expect(ids.size).toBe(50);
    });
});

describe('planToHumanSummary', () => {
    it('formats each op type with a distinguishing prefix', () => {
        const plan = [
            { kind: 'insert_site', site_slug: 'ghost-town', site_id: 'site_x' },
            { kind: 'insert_field', site_slug: 'ghost-town', field_slug: 'main', field_id: 'fld_x' },
            { kind: 'skip_site_exists', site_slug: 'foxtrot', existing_id: 'site_y' },
            { kind: 'skip_field_exists', site_slug: 'foxtrot', field_slug: 'main', existing_id: 'fld_y' },
        ];
        const summary = planToHumanSummary(plan);
        expect(summary[0]).toMatch(/^\+ site /);
        expect(summary[1]).toMatch(/^\+ field /);
        expect(summary[2]).toMatch(/^· site /);
        expect(summary[3]).toMatch(/^· field /);
    });
});

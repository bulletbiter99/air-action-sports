// Vitest unit tests for the pure helpers in
// scripts/backfill-events-site-id.js. I/O paths (wrangler shell-out)
// are not exercised here.

import { describe, it, expect } from 'vitest';
import {
    parseSiteFromLocation,
    buildBackfillPlan,
    planToSql,
    planToHumanSummary,
    escapeSqlString,
} from '../../../scripts/backfill-events-site-id.js';

describe('parseSiteFromLocation', () => {
    it('matches "Ghost Town - Rural Neighborhood" → ghost-town', () => {
        expect(parseSiteFromLocation('Ghost Town - Rural Neighborhood')).toBe('ghost-town');
    });

    it('is case-insensitive', () => {
        expect(parseSiteFromLocation('GHOST TOWN')).toBe('ghost-town');
        expect(parseSiteFromLocation('ghost town')).toBe('ghost-town');
        expect(parseSiteFromLocation('Ghost Town')).toBe('ghost-town');
    });

    it('matches Foxtrot variants', () => {
        expect(parseSiteFromLocation('Foxtrot')).toBe('foxtrot');
        expect(parseSiteFromLocation('Foxtrot Fields private game')).toBe('foxtrot');
        expect(parseSiteFromLocation('FOXTROT')).toBe('foxtrot');
    });

    it('trims whitespace', () => {
        expect(parseSiteFromLocation('  Ghost Town  ')).toBe('ghost-town');
    });

    it('returns null for unparseable input', () => {
        expect(parseSiteFromLocation('Some other place')).toBeNull();
        expect(parseSiteFromLocation('CQB Building')).toBeNull(); // not an official location
        expect(parseSiteFromLocation('Compound')).toBeNull(); // not an official location
    });

    it('returns null for empty/null/undefined', () => {
        expect(parseSiteFromLocation(null)).toBeNull();
        expect(parseSiteFromLocation(undefined)).toBeNull();
        expect(parseSiteFromLocation('')).toBeNull();
        expect(parseSiteFromLocation('   ')).toBeNull();
    });

    it('matches when site name appears mid-string', () => {
        expect(parseSiteFromLocation('Annual event at Ghost Town in Utah')).toBe('ghost-town');
    });

    it('Ghost Town takes precedence over Foxtrot when both appear (first-match)', () => {
        // Belt-and-suspenders test — if location somehow names both,
        // Ghost Town wins (it's checked first). Production data has
        // 1 event with "Ghost Town" only; this is a defensive test.
        expect(parseSiteFromLocation('Ghost Town and Foxtrot crossover')).toBe('ghost-town');
    });
});

describe('buildBackfillPlan', () => {
    const sites = [
        { id: 'site_g0001', slug: 'ghost-town' },
        { id: 'site_f0001', slug: 'foxtrot' },
    ];

    it('with 1 unparseable+parseable mix: 1 update + 1 unparseable', () => {
        const events = [
            { id: 'ev_001', location: 'Ghost Town - Rural Neighborhood', site_id: null },
            { id: 'ev_002', location: 'Random place', site_id: null },
        ];
        const plan = buildBackfillPlan(events, sites);
        const updates = plan.filter((p) => p.kind === 'update');
        const unparseable = plan.filter((p) => p.kind === 'skip_unparseable');
        expect(updates).toHaveLength(1);
        expect(updates[0].event_id).toBe('ev_001');
        expect(updates[0].slug).toBe('ghost-town');
        expect(updates[0].site_id).toBe('site_g0001');
        expect(unparseable).toHaveLength(1);
        expect(unparseable[0].event_id).toBe('ev_002');
    });

    it('idempotent — events with site_id already set are skipped', () => {
        const events = [
            { id: 'ev_001', location: 'Ghost Town', site_id: 'site_g0001' },
        ];
        const plan = buildBackfillPlan(events, sites);
        const updates = plan.filter((p) => p.kind === 'update');
        const alreadySet = plan.filter((p) => p.kind === 'skip_already_set');
        expect(updates).toHaveLength(0);
        expect(alreadySet).toHaveLength(1);
        expect(alreadySet[0].existing_site_id).toBe('site_g0001');
    });

    it('handles null location gracefully', () => {
        const events = [{ id: 'ev_001', location: null, site_id: null }];
        const plan = buildBackfillPlan(events, sites);
        expect(plan).toHaveLength(1);
        expect(plan[0].kind).toBe('skip_unparseable');
    });

    it('handles empty events list', () => {
        expect(buildBackfillPlan([], sites)).toHaveLength(0);
    });

    it('flags as unparseable if parsed slug has no matching site row', () => {
        // Should never happen if seed-sites ran, but defensive: if
        // parseSiteFromLocation returns "ghost-town" but the sites
        // table doesn't have that slug, we treat it as unparseable.
        const events = [
            { id: 'ev_001', location: 'Ghost Town', site_id: null },
        ];
        const plan = buildBackfillPlan(events, []); // empty sites
        expect(plan[0].kind).toBe('skip_unparseable');
    });

    it('Foxtrot location maps to Foxtrot site_id', () => {
        const events = [
            { id: 'ev_002', location: 'Foxtrot field weekend game', site_id: null },
        ];
        const plan = buildBackfillPlan(events, sites);
        const upd = plan.find((p) => p.kind === 'update');
        expect(upd.slug).toBe('foxtrot');
        expect(upd.site_id).toBe('site_f0001');
    });

    it('production reality: 1 event with Ghost Town location → 1 update', () => {
        // Mirrors the actual production state observed during B1
        // spot-check: events table has 1 row with
        // location="Ghost Town - Rural Neighborhood".
        const events = [
            {
                id: 'ev_real_production',
                location: 'Ghost Town - Rural Neighborhood',
                site_id: null,
            },
        ];
        const plan = buildBackfillPlan(events, sites);
        const updates = plan.filter((p) => p.kind === 'update');
        expect(updates).toHaveLength(1);
        expect(updates[0].slug).toBe('ghost-town');
    });
});

describe('planToSql', () => {
    it('produces UPDATE + audit_log per update op', () => {
        const plan = [
            {
                kind: 'update',
                event_id: 'ev_001',
                location: 'Ghost Town',
                slug: 'ghost-town',
                site_id: 'site_g0001',
            },
        ];
        const sql = planToSql(plan, 1700000000000);
        expect(sql).toHaveLength(2);
        expect(sql[0]).toContain('UPDATE events');
        expect(sql[0]).toContain("SET site_id = 'site_g0001'");
        expect(sql[0]).toContain("WHERE id = 'ev_001'");
        expect(sql[0]).toContain('AND site_id IS NULL'); // double-check idempotency
        expect(sql[1]).toContain('INSERT INTO audit_log');
        expect(sql[1]).toContain("'event.site_id_backfilled'");
    });

    it('skip ops produce no SQL', () => {
        const plan = [
            { kind: 'skip_already_set', event_id: 'ev_001', location: 'X', existing_site_id: 'site_x' },
            { kind: 'skip_unparseable', event_id: 'ev_002', location: 'Y' },
        ];
        expect(planToSql(plan, 1700000000000)).toHaveLength(0);
    });

    it('audit meta_json includes location, slug, site_id, and source', () => {
        const plan = [
            {
                kind: 'update',
                event_id: 'ev_001',
                location: 'Ghost Town',
                slug: 'ghost-town',
                site_id: 'site_g0001',
            },
        ];
        const sql = planToSql(plan, 1700000000000);
        const auditLog = sql[1];
        expect(auditLog).toContain('"location":"Ghost Town"');
        expect(auditLog).toContain('"slug":"ghost-town"');
        expect(auditLog).toContain('"site_id":"site_g0001"');
        expect(auditLog).toContain('"source":"backfill-events-site-id"');
    });
});

describe('escapeSqlString', () => {
    it('returns NULL for null/undefined', () => {
        expect(escapeSqlString(null)).toBe('NULL');
        expect(escapeSqlString(undefined)).toBe('NULL');
    });

    it("doubles single quotes", () => {
        expect(escapeSqlString("O'Brien's")).toBe("'O''Brien''s'");
    });
});

describe('planToHumanSummary', () => {
    it('formats each op type', () => {
        const plan = [
            {
                kind: 'update',
                event_id: 'ev_001',
                location: 'Ghost Town',
                slug: 'ghost-town',
                site_id: 'site_g0001',
            },
            { kind: 'skip_already_set', event_id: 'ev_002', location: 'X', existing_site_id: 'site_y' },
            { kind: 'skip_unparseable', event_id: 'ev_003', location: 'Z' },
        ];
        const summary = planToHumanSummary(plan);
        expect(summary[0]).toMatch(/^\+ event ev_001 -> ghost-town/);
        expect(summary[1]).toMatch(/^· event ev_002 already has site_id/);
        expect(summary[2]).toMatch(/^! event ev_003 unparseable/);
    });
});

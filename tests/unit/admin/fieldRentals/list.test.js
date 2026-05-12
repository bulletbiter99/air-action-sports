// M5.5 Batch 7a — GET /api/admin/field-rentals list-endpoint tests.
//
// Covers:
//   - Capability gating (403 without field_rentals.read)
//   - Default response shape (rentals + total + limit + offset)
//   - Filters (status, site_id, customer_id, engagement_type, coi_status,
//     starts_at_after/before, archived)
//   - q free-text search with PII gating (search-notes only when viewer has read.pii)
//   - Pagination + order_by/order whitelisting
//   - Format applies viewer-capability-aware PII masking

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';

let env;
let cookieHeader;

const sampleRental = (overrides = {}) => ({
    id: 'fr_001',
    customer_id: 'cus_x',
    site_id: 'site_g',
    site_field_ids: 'fld_main',
    engagement_type: 'tactical_training',
    lead_source: 'email',
    recurrence_id: null,
    recurrence_instance_index: null,
    scheduled_starts_at: 1000,
    scheduled_ends_at: 2000,
    arrival_window_starts_at: null,
    cleanup_buffer_ends_at: null,
    status: 'lead',
    status_changed_at: 1000,
    status_change_reason: null,
    site_fee_cents: 50000,
    addon_fees_json: '[]',
    discount_cents: 0,
    discount_reason: null,
    tax_cents: 0,
    total_cents: 50000,
    deposit_required_cents: null,
    deposit_due_at: null,
    deposit_received_at: null,
    deposit_method: null,
    deposit_reference: null,
    deposit_received_by: null,
    balance_due_at: null,
    balance_received_at: null,
    balance_method: null,
    balance_reference: null,
    balance_received_by: null,
    coi_status: 'not_required',
    coi_expires_at: null,
    headcount_estimate: null,
    schedule_notes: null,
    equipment_notes: null,
    staffing_notes: null,
    special_permissions_json: '{}',
    requirements_coi_received: 0,
    requirements_agreement_signed: 0,
    requirements_deposit_received: 0,
    requirements_briefing_scheduled: 0,
    requirements_walkthrough_completed: 0,
    notes: 'private contact info',
    notes_sensitive: null,
    aas_site_coordinator_person_id: null,
    archived_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    cancellation_deposit_retained: 0,
    created_by: 'u_owner',
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
});

function req(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

// ────────────────────────────────────────────────────────────────────
// Capability gating
// ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/field-rentals — capability gating', () => {
    it('returns 403 without field_rentals.read', async () => {
        bindCapabilities(env.DB, 'u_owner', []);

        const res = await worker.fetch(req('/api/admin/field-rentals', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('field_rentals.read');
    });

    it('returns 200 with field_rentals.read', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read']);
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 0 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, { results: [] }, 'all');

        const res = await worker.fetch(req('/api/admin/field-rentals', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
    });
});

// ────────────────────────────────────────────────────────────────────
// Default response shape
// ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/field-rentals — default response', () => {
    beforeEach(() => bindCapabilities(env.DB, 'u_owner', ['field_rentals.read']));

    it('returns { rentals, total, limit, offset } shape', async () => {
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 2 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, {
            results: [
                sampleRental({ id: 'fr_a' }),
                sampleRental({ id: 'fr_b' }),
            ],
        }, 'all');

        const res = await worker.fetch(req('/api/admin/field-rentals', { headers: { cookie: cookieHeader } }), env, {});
        const body = await res.json();
        expect(body.total).toBe(2);
        expect(body.rentals).toHaveLength(2);
        expect(body.limit).toBe(50);
        expect(body.offset).toBe(0);
        expect(body.rentals[0].id).toBe('fr_a');
    });

    it('masks notes by default (no read.pii)', async () => {
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 1 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, {
            results: [sampleRental({ id: 'fr_a' })],
        }, 'all');

        const res = await worker.fetch(req('/api/admin/field-rentals', { headers: { cookie: cookieHeader } }), env, {});
        const body = await res.json();
        expect(body.rentals[0].notes).toBe('***');
    });

});

describe('GET /api/admin/field-rentals — PII unmask via read.pii', () => {
    // Separate describe so the prior describe's beforeEach (which binds
    // capabilities with only `field_rentals.read`) doesn't preempt the
    // `field_rentals.read.pii` handler — mockD1 returns the first matching
    // __on registration.
    it('unmasks notes when viewer has read.pii', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read', 'field_rentals.read.pii']);
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 1 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, {
            results: [sampleRental({ id: 'fr_a' })],
        }, 'all');

        const res = await worker.fetch(req('/api/admin/field-rentals', { headers: { cookie: cookieHeader } }), env, {});
        const body = await res.json();
        expect(body.rentals[0].notes).toBe('private contact info');
    });
});

// ────────────────────────────────────────────────────────────────────
// Filters
// ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/field-rentals — filters', () => {
    beforeEach(() => bindCapabilities(env.DB, 'u_owner', ['field_rentals.read']));

    it('archived default excludes archived rentals (archived_at IS NULL)', async () => {
        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, (sql) => {
            capturedSql = sql;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, { results: [] }, 'all');

        await worker.fetch(req('/api/admin/field-rentals', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedSql).toMatch(/archived_at IS NULL/);
    });

    it('archived=true includes only archived (archived_at IS NOT NULL)', async () => {
        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, (sql) => {
            capturedSql = sql;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, { results: [] }, 'all');

        await worker.fetch(req('/api/admin/field-rentals?archived=true', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedSql).toMatch(/archived_at IS NOT NULL/);
    });

    it('archived=all omits any archived filter', async () => {
        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, (sql) => {
            capturedSql = sql;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, { results: [] }, 'all');

        await worker.fetch(req('/api/admin/field-rentals?archived=all', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedSql).not.toMatch(/archived_at/);
    });

    it('status filter binds the value', async () => {
        let capturedBinds = null;
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 0 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(req('/api/admin/field-rentals?status=lead', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedBinds).toContain('lead');
    });

    it('status comma-separated parses to multiple binds', async () => {
        let capturedBinds = null;
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 0 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(req('/api/admin/field-rentals?status=lead,draft,sent', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedBinds).toContain('lead');
        expect(capturedBinds).toContain('draft');
        expect(capturedBinds).toContain('sent');
    });

    it('status with unknown value is ignored (does not error)', async () => {
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 0 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, { results: [] }, 'all');

        const res = await worker.fetch(req('/api/admin/field-rentals?status=bogus', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
    });

    it('site_id filter binds', async () => {
        let capturedBinds = null;
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 0 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(req('/api/admin/field-rentals?site_id=site_g', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedBinds).toContain('site_g');
    });

    it('customer_id filter binds', async () => {
        let capturedBinds = null;
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 0 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(req('/api/admin/field-rentals?customer_id=cus_xyz', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedBinds).toContain('cus_xyz');
    });

    it('engagement_type valid filter binds; unknown is ignored', async () => {
        let capturedBinds = null;
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 0 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(req('/api/admin/field-rentals?engagement_type=paintball', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedBinds).toContain('paintball');

        capturedBinds = null;
        await worker.fetch(req('/api/admin/field-rentals?engagement_type=bogus', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedBinds).not.toContain('bogus');
    });

    it('starts_at_after / starts_at_before bind as numbers', async () => {
        let capturedBinds = null;
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 0 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(req('/api/admin/field-rentals?starts_at_after=1000&starts_at_before=2000', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedBinds).toContain(1000);
        expect(capturedBinds).toContain(2000);
    });
});

// ────────────────────────────────────────────────────────────────────
// Search (q) — PII-aware
// ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/field-rentals — q search PII gating', () => {
    it('q without read.pii: search excludes notes column', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read']);
        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, (sql) => {
            capturedSql = sql;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, { results: [] }, 'all');

        await worker.fetch(req('/api/admin/field-rentals?q=alice', { headers: { cookie: cookieHeader } }), env, {});
        // Without read.pii, search clause is (schedule_notes OR id) — NO notes
        expect(capturedSql).toMatch(/schedule_notes/);
        expect(capturedSql).not.toMatch(/LOWER\(notes\)/);
    });

    it('q with read.pii: search includes notes column', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read', 'field_rentals.read.pii']);
        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, (sql) => {
            capturedSql = sql;
            return { n: 0 };
        }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, { results: [] }, 'all');

        await worker.fetch(req('/api/admin/field-rentals?q=alice', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedSql).toMatch(/LOWER\(notes\)/);
    });

    it('q lowercases and wraps with % needle markers', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read']);
        let capturedBinds = null;
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 0 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(req('/api/admin/field-rentals?q=Alice', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedBinds).toContain('%alice%');
    });
});

// ────────────────────────────────────────────────────────────────────
// Pagination + ordering
// ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/field-rentals — pagination + ordering', () => {
    beforeEach(() => bindCapabilities(env.DB, 'u_owner', ['field_rentals.read']));

    it('limit clamps to 200 max', async () => {
        let capturedBinds = null;
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 0 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, (sql, args) => {
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await worker.fetch(req('/api/admin/field-rentals?limit=5000', { headers: { cookie: cookieHeader } }), env, {});
        // last 2 binds are limit + offset
        expect(capturedBinds[capturedBinds.length - 2]).toBe(200);
        expect(capturedBinds[capturedBinds.length - 1]).toBe(0);
    });

    it('order_by whitelist rejects bogus values (falls back to scheduled_starts_at)', async () => {
        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 0 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        await worker.fetch(req('/api/admin/field-rentals?order_by=DROP_TABLE', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedSql).toMatch(/ORDER BY scheduled_starts_at/);
        expect(capturedSql).not.toMatch(/DROP_TABLE/);
    });

    it('order direction accepts asc / desc only', async () => {
        let capturedSql = '';
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM field_rentals/, { n: 0 }, 'first');
        env.DB.__on(/SELECT \* FROM field_rentals/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        await worker.fetch(req('/api/admin/field-rentals?order=asc', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedSql).toMatch(/ASC/);

        await worker.fetch(req('/api/admin/field-rentals?order=BOGUS', { headers: { cookie: cookieHeader } }), env, {});
        expect(capturedSql).toMatch(/DESC/); // falls back to default desc
    });
});

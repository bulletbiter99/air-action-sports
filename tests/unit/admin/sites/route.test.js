// M5.5 Batch 6.5 — admin sites route tests.
//
// Covers GET/POST/PUT/DELETE for /api/admin/sites and its nested
// /fields and /blackouts endpoints. Uses mockD1 + createAdminSession.
// Capability gating verified via requireCapability mocks.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';

function req(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

// Bind cap-list mocks for a user so requireCapability resolves to the
// provided cap set. listCapabilities issues:
//   1. SELECT id, role, role_preset_key FROM users WHERE id = ?
//   2. SELECT capability_key FROM role_preset_capabilities WHERE role_preset_key = ?
function bindCapabilities(env, userId, capKeys) {
    env.DB.__on(/SELECT id, role, role_preset_key FROM users WHERE id/, {
        id: userId,
        role: 'owner',
        role_preset_key: 'owner',
    }, 'first');
    env.DB.__on(/SELECT capability_key FROM role_preset_capabilities WHERE role_preset_key/, {
        results: capKeys.map((k) => ({ capability_key: k })),
    }, 'all');
}

const ALL_SITES_CAPS = ['sites.read', 'sites.write', 'sites.archive', 'sites.blackout_create'];

describe('GET /api/admin/sites — list', () => {
    it('returns sites with stats', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ['sites.read']);

        env.DB.__on(/FROM sites/, {
            results: [
                {
                    id: 'site_1', slug: 'ghost-town', name: 'Ghost Town',
                    address: null, city: 'Hiawatha', state: 'UT', postal_code: '84545',
                    total_acreage: null, notes: null, active: 1, archived_at: null,
                    default_arrival_buffer_minutes: 30, default_cleanup_buffer_minutes: 30,
                    default_blackout_window: null,
                    created_at: 1000, updated_at: 1000,
                    active_field_count: 1, upcoming_event_count: 1, upcoming_rental_count: 0,
                },
            ],
        }, 'all');

        const res = await worker.fetch(
            req('/api/admin/sites', { headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.sites).toHaveLength(1);
        expect(json.sites[0].name).toBe('Ghost Town');
        expect(json.sites[0].activeFieldCount).toBe(1);
        expect(json.sites[0].upcomingEventCount).toBe(1);
        expect(json.sites[0].upcomingRentalCount).toBe(0);
    });

    it('without sites.read returns 403', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_staff', role: 'staff' });
        bindCapabilities(env, 'u_staff', []); // no caps

        const res = await worker.fetch(
            req('/api/admin/sites', { headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.requiresCapability).toBe('sites.read');
    });

    it('archived=true does NOT filter out archived sites', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ['sites.read']);

        let capturedSql = '';
        env.DB.__on(/FROM sites/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        await worker.fetch(
            req('/api/admin/sites?archived=true', { headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(capturedSql).not.toMatch(/WHERE s\.archived_at IS NULL/);
    });
});

describe('GET /api/admin/sites/:id — detail', () => {
    it('returns site + fields + blackouts + stats', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ['sites.read']);

        const siteRow = {
            id: 'site_1', slug: 'ghost-town', name: 'Ghost Town',
            address: null, city: 'Hiawatha', state: 'UT', postal_code: '84545',
            total_acreage: null, notes: null, active: 1, archived_at: null,
            default_arrival_buffer_minutes: 30, default_cleanup_buffer_minutes: 30,
            default_blackout_window: null, created_at: 1000, updated_at: 1000,
        };
        env.DB.__on(/SELECT \* FROM sites WHERE id = \?/, siteRow, 'first');
        env.DB.__on(/FROM site_fields WHERE site_id = \?/, {
            results: [
                { id: 'fld_1', site_id: 'site_1', slug: 'main', name: 'Main', approximate_acreage: 12.5, notes: null, active: 1, archived_at: null, created_at: 1000 },
            ],
        }, 'all');
        env.DB.__on(/FROM site_blackouts WHERE site_id = \?/, { results: [] }, 'all');
        env.DB.__on(/COUNT\(\*\) AS n FROM events WHERE site_id/, { n: 2 }, 'first');
        env.DB.__on(/COUNT\(\*\) AS n FROM field_rentals WHERE site_id/, { n: 0 }, 'first');

        const res = await worker.fetch(
            req('/api/admin/sites/site_1', { headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.site.id).toBe('site_1');
        expect(json.fields).toHaveLength(1);
        expect(json.blackouts).toHaveLength(0);
        expect(json.stats.upcomingEventCount).toBe(2);
        expect(json.stats.upcomingRentalCount).toBe(0);
    });

    it('returns 404 for unknown id', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ['sites.read']);

        env.DB.__on(/SELECT \* FROM sites WHERE id = \?/, null, 'first');

        const res = await worker.fetch(
            req('/api/admin/sites/missing', { headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(res.status).toBe(404);
    });
});

describe('POST /api/admin/sites — create', () => {
    it('creates with provided slug', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        env.DB.__on(/SELECT id FROM sites WHERE slug = \?/, null, 'first'); // no conflict
        env.DB.__on(/INSERT INTO sites/, { meta: { changes: 1, last_row_id: 1 }, success: true }, 'run');
        // Audit log INSERT
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1, last_row_id: 1 }, success: true }, 'run');
        // Post-insert SELECT
        env.DB.__on(/SELECT \* FROM sites WHERE id = \?/, {
            id: 'site_abc', slug: 'new-site', name: 'New Site',
            address: null, city: null, state: null, postal_code: null,
            total_acreage: null, notes: null, active: 1, archived_at: null,
            default_arrival_buffer_minutes: 30, default_cleanup_buffer_minutes: 30,
            default_blackout_window: null, created_at: 5000, updated_at: 5000,
        }, 'first');

        const res = await worker.fetch(
            req('/api/admin/sites', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'New Site', slug: 'new-site' }),
            }),
            env, {},
        );
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.site.slug).toBe('new-site');
        expect(json.site.name).toBe('New Site');
    });

    it('auto-slugs from name when slug omitted', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        let insertSql = '';
        let insertBinds = null;
        env.DB.__on(/SELECT id FROM sites WHERE slug = \?/, null, 'first');
        env.DB.__on(/INSERT INTO sites/, (sql, args) => {
            insertSql = sql;
            insertBinds = args;
            return { meta: { changes: 1 }, success: true };
        }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 }, success: true }, 'run');
        env.DB.__on(/SELECT \* FROM sites WHERE id = \?/, {
            id: 'site_abc', slug: 'my-new-site', name: 'My New Site',
            address: null, city: null, state: null, postal_code: null,
            total_acreage: null, notes: null, active: 1, archived_at: null,
            default_arrival_buffer_minutes: 30, default_cleanup_buffer_minutes: 30,
            default_blackout_window: null, created_at: 5000, updated_at: 5000,
        }, 'first');

        const res = await worker.fetch(
            req('/api/admin/sites', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'My New Site' }),
            }),
            env, {},
        );
        expect(res.status).toBe(201);
        // Auto-slug should produce 'my-new-site'
        expect(insertBinds[1]).toBe('my-new-site'); // 2nd bind = slug
    });

    it('409 on duplicate slug', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        env.DB.__on(/SELECT id FROM sites WHERE slug = \?/, { id: 'site_existing' }, 'first');

        const res = await worker.fetch(
            req('/api/admin/sites', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Ghost Town', slug: 'ghost-town' }),
            }),
            env, {},
        );
        expect(res.status).toBe(409);
        const json = await res.json();
        expect(json.error).toMatch(/already in use/);
    });

    it('400 when name missing', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        const res = await worker.fetch(
            req('/api/admin/sites', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ slug: 'no-name' }),
            }),
            env, {},
        );
        expect(res.status).toBe(400);
    });

    it('without sites.write returns 403', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_staff', role: 'staff' });
        bindCapabilities(env, 'u_staff', ['sites.read']); // read only

        const res = await worker.fetch(
            req('/api/admin/sites', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'X' }),
            }),
            env, {},
        );
        expect(res.status).toBe(403);
    });
});

describe('PUT /api/admin/sites/:id — update', () => {
    it('updates fields + writes audit', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        env.DB.__on(/SELECT id, slug FROM sites WHERE id = \?/, { id: 'site_1', slug: 'ghost-town' }, 'first');
        env.DB.__on(/UPDATE sites SET/, { meta: { changes: 1 }, success: true }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 }, success: true }, 'run');
        env.DB.__on(/SELECT \* FROM sites WHERE id = \?/, {
            id: 'site_1', slug: 'ghost-town', name: 'Ghost Town Updated',
            address: null, city: 'Hiawatha', state: 'UT', postal_code: '84545',
            total_acreage: null, notes: null, active: 1, archived_at: null,
            default_arrival_buffer_minutes: 30, default_cleanup_buffer_minutes: 30,
            default_blackout_window: null, created_at: 1000, updated_at: 5000,
        }, 'first');

        const res = await worker.fetch(
            req('/api/admin/sites/site_1', {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Ghost Town Updated' }),
            }),
            env, {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.site.name).toBe('Ghost Town Updated');
    });

    it('404 on unknown id', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        env.DB.__on(/SELECT id, slug FROM sites WHERE id = \?/, null, 'first');

        const res = await worker.fetch(
            req('/api/admin/sites/missing', {
                method: 'PUT',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'X' }),
            }),
            env, {},
        );
        expect(res.status).toBe(404);
    });
});

describe('DELETE /api/admin/sites/:id — archive', () => {
    it('archives when no upcoming events or rentals', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        env.DB.__on(/SELECT id, name, archived_at FROM sites WHERE id/, {
            id: 'site_1', name: 'Ghost Town', archived_at: null,
        }, 'first');
        env.DB.__on(/COUNT\(\*\) AS n FROM events WHERE site_id/, { n: 0 }, 'first');
        env.DB.__on(/COUNT\(\*\) AS n FROM field_rentals WHERE site_id/, { n: 0 }, 'first');
        env.DB.__on(/UPDATE sites SET archived_at/, { meta: { changes: 1 }, success: true }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 }, success: true }, 'run');

        const res = await worker.fetch(
            req('/api/admin/sites/site_1', {
                method: 'DELETE',
                headers: { cookie: cookieHeader },
            }),
            env, {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.archived).toBe(true);
    });

    it('409 if site has upcoming events', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        env.DB.__on(/SELECT id, name, archived_at FROM sites WHERE id/, {
            id: 'site_1', name: 'Ghost Town', archived_at: null,
        }, 'first');
        env.DB.__on(/COUNT\(\*\) AS n FROM events WHERE site_id/, { n: 2 }, 'first');
        env.DB.__on(/COUNT\(\*\) AS n FROM field_rentals WHERE site_id/, { n: 0 }, 'first');

        const res = await worker.fetch(
            req('/api/admin/sites/site_1', { method: 'DELETE', headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(res.status).toBe(409);
        const json = await res.json();
        expect(json.upcomingEventCount).toBe(2);
    });

    it('409 if already archived', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        env.DB.__on(/SELECT id, name, archived_at FROM sites WHERE id/, {
            id: 'site_1', name: 'Ghost Town', archived_at: 999,
        }, 'first');

        const res = await worker.fetch(
            req('/api/admin/sites/site_1', { method: 'DELETE', headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(res.status).toBe(409);
    });

    it('without sites.archive returns 403', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'manager' });
        bindCapabilities(env, 'u1', ['sites.read', 'sites.write']); // missing archive

        const res = await worker.fetch(
            req('/api/admin/sites/site_1', { method: 'DELETE', headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(res.status).toBe(403);
    });
});

describe('POST /api/admin/sites/:id/fields — add field', () => {
    it('creates field', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        env.DB.__on(/SELECT id, archived_at FROM sites WHERE id/, { id: 'site_1', archived_at: null }, 'first');
        env.DB.__on(/SELECT id FROM site_fields WHERE site_id = \? AND slug = \?/, null, 'first');
        env.DB.__on(/INSERT INTO site_fields/, { meta: { changes: 1 }, success: true }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 }, success: true }, 'run');
        env.DB.__on(/SELECT \* FROM site_fields WHERE id = \?/, {
            id: 'fld_1', site_id: 'site_1', slug: 'main', name: 'Main',
            approximate_acreage: 12.5, notes: null, active: 1, archived_at: null,
            created_at: 5000,
        }, 'first');

        const res = await worker.fetch(
            req('/api/admin/sites/site_1/fields', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Main', approximateAcreage: 12.5 }),
            }),
            env, {},
        );
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.field.slug).toBe('main');
    });

    it('409 on duplicate field slug within site', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        env.DB.__on(/SELECT id, archived_at FROM sites WHERE id/, { id: 'site_1', archived_at: null }, 'first');
        env.DB.__on(/SELECT id FROM site_fields WHERE site_id = \? AND slug = \?/, { id: 'fld_existing' }, 'first');

        const res = await worker.fetch(
            req('/api/admin/sites/site_1/fields', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Main', slug: 'main' }),
            }),
            env, {},
        );
        expect(res.status).toBe(409);
    });
});

describe('DELETE /api/admin/sites/:id/fields/:fieldId — archive field', () => {
    it('archives field', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        env.DB.__on(/SELECT id, name, archived_at FROM site_fields WHERE id = \? AND site_id/, {
            id: 'fld_1', name: 'Main', archived_at: null,
        }, 'first');
        env.DB.__on(/UPDATE site_fields SET archived_at/, { meta: { changes: 1 }, success: true }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 }, success: true }, 'run');

        const res = await worker.fetch(
            req('/api/admin/sites/site_1/fields/fld_1', { method: 'DELETE', headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.archived).toBe(true);
    });
});

describe('POST /api/admin/sites/:id/blackouts — create blackout', () => {
    it('creates blackout', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        env.DB.__on(/SELECT id, archived_at FROM sites WHERE id/, { id: 'site_1', archived_at: null }, 'first');
        env.DB.__on(/INSERT INTO site_blackouts/, { meta: { changes: 1 }, success: true }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 }, success: true }, 'run');
        env.DB.__on(/SELECT \* FROM site_blackouts WHERE id = \?/, {
            id: 'blk_1', site_id: 'site_1', starts_at: 1000, ends_at: 2000,
            reason: 'Maintenance', created_by: 'u1', created_at: 500,
        }, 'first');

        const res = await worker.fetch(
            req('/api/admin/sites/site_1/blackouts', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ startsAt: 1000, endsAt: 2000, reason: 'Maintenance' }),
            }),
            env, {},
        );
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.blackout.reason).toBe('Maintenance');
    });

    it('400 when endsAt <= startsAt', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        env.DB.__on(/SELECT id, archived_at FROM sites WHERE id/, { id: 'site_1', archived_at: null }, 'first');

        const res = await worker.fetch(
            req('/api/admin/sites/site_1/blackouts', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ startsAt: 2000, endsAt: 1000 }),
            }),
            env, {},
        );
        expect(res.status).toBe(400);
    });

    it('without sites.blackout_create returns 403', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'manager' });
        bindCapabilities(env, 'u1', ['sites.read', 'sites.write']); // missing blackout_create

        const res = await worker.fetch(
            req('/api/admin/sites/site_1/blackouts', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ startsAt: 1000, endsAt: 2000 }),
            }),
            env, {},
        );
        expect(res.status).toBe(403);
    });
});

describe('DELETE /api/admin/sites/:id/blackouts/:blackoutId — delete', () => {
    it('hard-deletes blackout', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u1', role: 'owner' });
        bindCapabilities(env, 'u1', ALL_SITES_CAPS);

        env.DB.__on(/SELECT id FROM site_blackouts WHERE id = \? AND site_id/, { id: 'blk_1' }, 'first');
        env.DB.__on(/DELETE FROM site_blackouts/, { meta: { changes: 1 }, success: true }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 }, success: true }, 'run');

        const res = await worker.fetch(
            req('/api/admin/sites/site_1/blackouts/blk_1', { method: 'DELETE', headers: { cookie: cookieHeader } }),
            env, {},
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.deleted).toBe(true);
    });
});

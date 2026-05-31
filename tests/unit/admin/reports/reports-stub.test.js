// M7 Batch 1a — admin Reports route tests.
//
// All four personas — Owner (5, B2), Bookkeeper (3, B3), Marketing (4, B4),
// Site Coordinator (4, B5) — are IMPLEMENTED and return 200 with a report
// payload (or text/csv with ?format=csv, gated on reports.export). No endpoint
// returns 501 anymore. Without the persona-specific capability,
// requireCapability fires 403 first.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';

let env;
let cookieHeader;

function req(path) {
    return new Request(`https://airactionsport.com${path}`, {
        headers: { cookie: cookieHeader },
    });
}

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

describe('GET /api/admin/reports/* — Owner endpoints (Batch 2 — implemented)', () => {
    it('revenue-trends returns 200 with a report payload when viewer has reports.read.owner', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.owner']);
        const res = await worker.fetch(req('/api/admin/reports/owner/revenue-trends'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.report).toBe('revenue-trends');
        expect(Array.isArray(data.series)).toBe(true);
        expect(data.window).toBeTruthy();
        expect(typeof data.totalCents).toBe('number');
    });

    it('owner endpoint returns 403 without reports.read.owner', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read']);
        const res = await worker.fetch(req('/api/admin/reports/owner/aov-trend'), env, {});
        expect(res.status).toBe(403);
    });

    it('owner endpoint returns 401 without admin session', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read.owner']);
        const noCookieReq = new Request('https://airactionsport.com/api/admin/reports/owner/refund-rate');
        const res = await worker.fetch(noCookieReq, env, {});
        expect(res.status).toBe(401);
    });

    it('CSV export returns text/csv when viewer also has reports.export', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.owner', 'reports.export']);
        const res = await worker.fetch(req('/api/admin/reports/owner/revenue-trends?format=csv'), env, {});
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/csv');
        const body = await res.text();
        expect(body).toContain('Date,Gross');
    });

    it('CSV export returns 403 without reports.export (read.owner alone is not enough)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.owner']);
        const res = await worker.fetch(req('/api/admin/reports/owner/refund-rate?format=csv'), env, {});
        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.requiresCapability).toBe('reports.export');
    });
});

describe('GET /api/admin/reports/* — Bookkeeper endpoints (Batch 3 — implemented)', () => {
    it('payouts returns 200 with rows + totals when viewer has reports.read.bookkeeper', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper']);
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/payouts'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.report).toBe('payouts');
        expect(Array.isArray(data.rows)).toBe(true);
        expect(data.totals).toBeTruthy();
    });

    it('period-comparison returns 200 with a 7-metric array', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper']);
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/period-comparison'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.report).toBe('period-comparison');
        expect(Array.isArray(data.metrics)).toBe(true);
        expect(data.metrics).toHaveLength(7);
    });

    it('returns 403 without reports.read.bookkeeper', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read.owner']);  // owner cap, not bookkeeper
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/tax-fee-summary'), env, {});
        expect(res.status).toBe(403);
    });

    it('CSV export returns text/csv when viewer also has reports.export', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper', 'reports.export']);
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/payouts?format=csv'), env, {});
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/csv');
        expect(await res.text()).toContain('Stripe Gross');
    });

    it('CSV export returns 403 without reports.export', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper']);
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/period-comparison?format=csv'), env, {});
        expect(res.status).toBe(403);
        expect((await res.json()).requiresCapability).toBe('reports.export');
    });
});

describe('GET /api/admin/reports/* — Marketing endpoints (Batch 4 — implemented)', () => {
    it('conversion-funnel returns 200 with an events array when viewer has reports.read.marketing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.marketing']);
        const res = await worker.fetch(req('/api/admin/reports/marketing/conversion-funnel'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.report).toBe('conversion-funnel');
        expect(Array.isArray(data.events)).toBe(true);
    });

    it('channel-attribution returns 200 with channels + hasData flag', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.marketing']);
        const res = await worker.fetch(req('/api/admin/reports/marketing/channel-attribution'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.report).toBe('channel-attribution');
        expect(Array.isArray(data.channels)).toBe(true);
        expect(typeof data.hasData).toBe('boolean');
    });

    it('returns 403 without reports.read.marketing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read']);
        const res = await worker.fetch(req('/api/admin/reports/marketing/customer-cohorts'), env, {});
        expect(res.status).toBe(403);
    });

    it('CSV export returns text/csv when viewer also has reports.export', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.marketing', 'reports.export']);
        const res = await worker.fetch(req('/api/admin/reports/marketing/promo-performance?format=csv'), env, {});
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/csv');
        expect(await res.text()).toContain('Code');
    });

    it('CSV export returns 403 without reports.export', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.marketing']);
        const res = await worker.fetch(req('/api/admin/reports/marketing/channel-attribution?format=csv'), env, {});
        expect(res.status).toBe(403);
        expect((await res.json()).requiresCapability).toBe('reports.export');
    });
});

describe('GET /api/admin/reports/* — Site Coordinator endpoints (Batch 5 — implemented)', () => {
    it('field-rental-revenue returns 200 with rows + totals when viewer has reports.read.site_coordinator', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.site_coordinator']);
        const res = await worker.fetch(req('/api/admin/reports/site-coordinator/field-rental-revenue'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.report).toBe('field-rental-revenue');
        expect(Array.isArray(data.rows)).toBe(true);
        expect(data.totals).toBeTruthy();
    });

    it('coi-compliance returns 200 with the 5 status buckets', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.site_coordinator']);
        const res = await worker.fetch(req('/api/admin/reports/site-coordinator/coi-compliance'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.report).toBe('coi-compliance');
        expect(data.buckets).toHaveProperty('valid');
        expect(data.buckets).toHaveProperty('expired');
    });

    it('returns 403 without reports.read.site_coordinator', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read']);
        const res = await worker.fetch(req('/api/admin/reports/site-coordinator/coi-compliance'), env, {});
        expect(res.status).toBe(403);
    });

    it('CSV export returns text/csv when viewer also has reports.export', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.site_coordinator', 'reports.export']);
        const res = await worker.fetch(req('/api/admin/reports/site-coordinator/recurrence-retention?format=csv'), env, {});
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/csv');
        expect(await res.text()).toContain('Window');
    });

    it('CSV export returns 403 without reports.export', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.site_coordinator']);
        const res = await worker.fetch(req('/api/admin/reports/site-coordinator/field-rental-revenue?format=csv'), env, {});
        expect(res.status).toBe(403);
        expect((await res.json()).requiresCapability).toBe('reports.export');
    });
});

describe('All 16 endpoints mounted', () => {
    it('every Owner report endpoint returns 200 (implemented in Batch 2)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.owner']);
        const paths = [
            '/api/admin/reports/owner/revenue-trends',
            '/api/admin/reports/owner/retention',
            '/api/admin/reports/owner/refund-rate',
            '/api/admin/reports/owner/repeat-customers',
            '/api/admin/reports/owner/aov-trend',
        ];
        for (const path of paths) {
            const res = await worker.fetch(req(path), env, {});
            expect(res.status, `${path} should be 200`).toBe(200);
        }
    });

    it('every Bookkeeper report endpoint returns 200 (3 endpoints; 1099 thresholds links elsewhere)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper']);
        const paths = [
            '/api/admin/reports/bookkeeper/payouts',
            '/api/admin/reports/bookkeeper/tax-fee-summary',
            '/api/admin/reports/bookkeeper/period-comparison',
        ];
        for (const path of paths) {
            const res = await worker.fetch(req(path), env, {});
            expect(res.status, `${path} should be 200`).toBe(200);
        }
    });

    it('every Marketing report endpoint returns 200 (implemented in Batch 4)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.marketing']);
        const paths = [
            '/api/admin/reports/marketing/conversion-funnel',
            '/api/admin/reports/marketing/promo-performance',
            '/api/admin/reports/marketing/customer-cohorts',
            '/api/admin/reports/marketing/channel-attribution',
        ];
        for (const path of paths) {
            const res = await worker.fetch(req(path), env, {});
            expect(res.status, `${path} should be 200`).toBe(200);
        }
    });

    it('every Site Coordinator report endpoint returns 200 (implemented in Batch 5)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.site_coordinator']);
        const paths = [
            '/api/admin/reports/site-coordinator/field-rental-revenue',
            '/api/admin/reports/site-coordinator/coi-compliance',
            '/api/admin/reports/site-coordinator/lead-conversion',
            '/api/admin/reports/site-coordinator/recurrence-retention',
        ];
        for (const path of paths) {
            const res = await worker.fetch(req(path), env, {});
            expect(res.status, `${path} should be 200`).toBe(200);
        }
    });
});

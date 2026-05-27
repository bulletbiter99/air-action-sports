// M7 Batch 1a — admin Reports route stub tests.
//
// All 16 endpoints return 501 Not Implemented for capability-holding users
// (until populated in Batches 2-5). Without the persona-specific capability,
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

describe('GET /api/admin/reports/* — Owner endpoints (Batch 2 destinations)', () => {
    it('owner endpoint returns 501 stub when viewer has reports.read.owner', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.owner']);
        const res = await worker.fetch(req('/api/admin/reports/owner/revenue-trends'), env, {});
        expect(res.status).toBe(501);
        const data = await res.json();
        expect(data.persona).toBe('owner');
        expect(data.report).toBe('revenue-trends');
        expect(data.status).toBe('stub');
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
});

describe('GET /api/admin/reports/* — Bookkeeper endpoints (Batch 3)', () => {
    it('returns 501 with reports.read.bookkeeper', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper']);
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/payouts'), env, {});
        expect(res.status).toBe(501);
        const data = await res.json();
        expect(data.persona).toBe('bookkeeper');
    });

    it('returns 403 without reports.read.bookkeeper', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read.owner']);  // owner cap, not bookkeeper
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/tax-fee-summary'), env, {});
        expect(res.status).toBe(403);
    });
});

describe('GET /api/admin/reports/* — Marketing endpoints (Batch 4)', () => {
    it('returns 501 with reports.read.marketing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.marketing']);
        const res = await worker.fetch(req('/api/admin/reports/marketing/conversion-funnel'), env, {});
        expect(res.status).toBe(501);
        const data = await res.json();
        expect(data.persona).toBe('marketing');
    });

    it('returns 403 without reports.read.marketing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read']);
        const res = await worker.fetch(req('/api/admin/reports/marketing/customer-cohorts'), env, {});
        expect(res.status).toBe(403);
    });
});

describe('GET /api/admin/reports/* — Site Coordinator endpoints (Batch 5)', () => {
    it('returns 501 with reports.read.site_coordinator', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.site_coordinator']);
        const res = await worker.fetch(req('/api/admin/reports/site-coordinator/field-rental-revenue'), env, {});
        expect(res.status).toBe(501);
        const data = await res.json();
        expect(data.persona).toBe('site-coordinator');
    });

    it('returns 403 without reports.read.site_coordinator', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read']);
        const res = await worker.fetch(req('/api/admin/reports/site-coordinator/coi-compliance'), env, {});
        expect(res.status).toBe(403);
    });
});

describe('All 16 endpoints mounted', () => {
    it('every Owner report endpoint exists (5 endpoints)', async () => {
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
            expect(res.status, `${path} should be 501 stub`).toBe(501);
        }
    });

    it('every Bookkeeper report endpoint exists (3 endpoints; 1099 thresholds links elsewhere)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper']);
        const paths = [
            '/api/admin/reports/bookkeeper/payouts',
            '/api/admin/reports/bookkeeper/tax-fee-summary',
            '/api/admin/reports/bookkeeper/period-comparison',
        ];
        for (const path of paths) {
            const res = await worker.fetch(req(path), env, {});
            expect(res.status, `${path} should be 501 stub`).toBe(501);
        }
    });

    it('every Marketing report endpoint exists (4 endpoints)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.marketing']);
        const paths = [
            '/api/admin/reports/marketing/conversion-funnel',
            '/api/admin/reports/marketing/promo-performance',
            '/api/admin/reports/marketing/customer-cohorts',
            '/api/admin/reports/marketing/channel-attribution',
        ];
        for (const path of paths) {
            const res = await worker.fetch(req(path), env, {});
            expect(res.status, `${path} should be 501 stub`).toBe(501);
        }
    });

    it('every Site Coordinator report endpoint exists (4 endpoints)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.site_coordinator']);
        const paths = [
            '/api/admin/reports/site-coordinator/field-rental-revenue',
            '/api/admin/reports/site-coordinator/coi-compliance',
            '/api/admin/reports/site-coordinator/lead-conversion',
            '/api/admin/reports/site-coordinator/recurrence-retention',
        ];
        for (const path of paths) {
            const res = await worker.fetch(req(path), env, {});
            expect(res.status, `${path} should be 501 stub`).toBe(501);
        }
    });
});

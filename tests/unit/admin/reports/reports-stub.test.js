// M7 Batch 1a — admin Reports route tests.
//
// All four personas — Owner (5, B2), Bookkeeper (3, B3), Marketing (4, B4),
// Site Coordinator (4, B5) — are IMPLEMENTED and return 200 with a report
// payload (or text/csv with ?format=csv, gated on reports.export). No endpoint
// returns 501 anymore. Under the OPEN-READS model, JSON reads are open to any
// authenticated admin (requireReadAccess); only the in-handler reports.export
// CSV gate still 403s.

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

    it('per-event-pnl returns 200 with events + totals (margin)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.owner']);
        const res = await worker.fetch(req('/api/admin/reports/owner/per-event-pnl'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.report).toBe('per-event-pnl');
        expect(Array.isArray(data.events)).toBe(true);
        expect(data.totals).toHaveProperty('marginCents');
    });

    it('per-event-pnl CSV export returns text/csv with reports.export', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.owner', 'reports.export']);
        const res = await worker.fetch(req('/api/admin/reports/owner/per-event-pnl?format=csv'), env, {});
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/csv');
        expect(await res.text()).toContain('Event,Date,Revenue,Direct Costs,Margin');
    });

    it('scorecard returns 200 with 13 weeks + 6 metrics + a summary', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.owner']);
        const res = await worker.fetch(req('/api/admin/reports/owner/scorecard'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.report).toBe('owner-scorecard');
        expect(data.weeks).toHaveLength(13);
        expect(data.weeks[12].isCurrent).toBe(true);
        expect(data.metrics).toHaveLength(6);
        expect(data.metrics[0].cells).toHaveLength(13);
        expect(data.summary).toHaveProperty('on');
    });

    it('scorecard CSV export returns text/csv with reports.export', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.owner', 'reports.export']);
        const res = await worker.fetch(req('/api/admin/reports/owner/scorecard?format=csv'), env, {});
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/csv');
        expect(await res.text()).toContain('Metric,Target,Avg');
    });

    it('owner read is open to any authenticated admin (open-reads model)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read']); // no reports.read.owner
        const res = await worker.fetch(req('/api/admin/reports/owner/aov-trend'), env, {});
        expect(res.status).toBe(200);
        expect((await res.json()).report).toBe('aov-trend');
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

    it('budget-vs-actual returns 200 with categories + totals (incl. netCents)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper']);
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/budget-vs-actual'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.report).toBe('budget-vs-actual');
        expect(Array.isArray(data.categories)).toBe(true);
        expect(data.totals).toBeTruthy();
        expect(typeof data.totals.netCents).toBe('number');
    });

    it('budget-vs-actual CSV export returns text/csv with reports.export', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper', 'reports.export']);
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/budget-vs-actual?format=csv'), env, {});
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/csv');
        expect(await res.text()).toContain('Category,Budgeted,Spent,Variance');
    });

    it('stripe-fees returns 200 with series + coverage + totals', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper']);
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/stripe-fees'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.report).toBe('stripe-fees');
        expect(Array.isArray(data.series)).toBe(true);
        expect(data.coverage).toHaveProperty('captured');
        expect(data.totals).toHaveProperty('keptCents');
        expect(data.refunds).toHaveProperty('feeCents');
        expect(data).toHaveProperty('netKeptCents');
    });

    it('stripe-fees CSV export returns text/csv with reports.export', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper', 'reports.export']);
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/stripe-fees?format=csv'), env, {});
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/csv');
        expect(await res.text()).toContain('Month,Gross,Stripe Fees,Net Deposited,Sales Tax,Kept,Refund Fees Lost');
    });

    it('ar-aging returns 200 with buckets + totals + dso', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper']);
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/ar-aging'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.report).toBe('ar-aging');
        expect(Array.isArray(data.buckets)).toBe(true);
        expect(data.buckets).toHaveLength(5);
        expect(data.totals).toHaveProperty('amountCents');
        expect(data).toHaveProperty('dso');
    });

    it('ar-aging CSV export returns text/csv with reports.export', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper', 'reports.export']);
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/ar-aging?format=csv'), env, {});
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/csv');
        expect(await res.text()).toContain('Renter,Site,Due Date,Days Overdue,Amount,Bucket');
    });

    it('bookkeeper read is open to any authenticated admin (open-reads model)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read.owner']);  // owner cap, not bookkeeper
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/tax-fee-summary'), env, {});
        expect(res.status).toBe(200);
        expect((await res.json()).report).toBe('tax-fee-summary');
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

    it('marketing read is open to any authenticated admin (open-reads model)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read']); // no reports.read.marketing
        const res = await worker.fetch(req('/api/admin/reports/marketing/customer-cohorts'), env, {});
        expect(res.status).toBe(200);
        expect((await res.json()).report).toBe('customer-cohorts');
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

    it('site-coordinator read is open to any authenticated admin (open-reads model)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read']); // no reports.read.site_coordinator
        const res = await worker.fetch(req('/api/admin/reports/site-coordinator/coi-compliance'), env, {});
        expect(res.status).toBe(200);
        expect((await res.json()).report).toBe('coi-compliance');
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
            '/api/admin/reports/owner/per-event-pnl',
            '/api/admin/reports/owner/scorecard',
        ];
        for (const path of paths) {
            const res = await worker.fetch(req(path), env, {});
            expect(res.status, `${path} should be 200`).toBe(200);
        }
    });

    it('every Bookkeeper report endpoint returns 200 (6 endpoints; 1099 thresholds links elsewhere)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper']);
        const paths = [
            '/api/admin/reports/bookkeeper/payouts',
            '/api/admin/reports/bookkeeper/tax-fee-summary',
            '/api/admin/reports/bookkeeper/period-comparison',
            '/api/admin/reports/bookkeeper/budget-vs-actual',
            '/api/admin/reports/bookkeeper/stripe-fees',
            '/api/admin/reports/bookkeeper/ar-aging',
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

// The operator's custom from/to date pickers resolve on the DENVER calendar.
//
// These dates are Mountain days as far as the operator is concerned. Read as UTC
// midnight they began 6-7h early, so "1st to the 31st" silently swept in the
// evening of the previous month and cut off the evening of the 31st itself.
//
// parseCustomBounds is module-private, so this exercises it through the route
// and reads the bound window back off the JSON response. Before this change
// there was NO server-side coverage of custom bounds at all — the only "custom"
// tests were for the client-side query-string builder.
describe('custom date range resolves on the Denver calendar', () => {
    async function windowFor(qs) {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.owner']);
        const res = await worker.fetch(req(`/api/admin/reports/owner/revenue-trends${qs}`), env, {});
        expect(res.status).toBe(200);
        return (await res.json()).window;
    }

    it('starts at midnight Denver on the from-date (06:00Z in MDT)', async () => {
        const w = await windowFor('?period=custom&from=2026-07-01&to=2026-07-31');
        expect(w.startMs).toBe(Date.parse('2026-07-01T06:00:00Z'));
        expect(w.period).toBe('custom');
    });

    it('ends at midnight Denver AFTER the to-date, so the end day is inclusive', async () => {
        const w = await windowFor('?period=custom&from=2026-07-01&to=2026-07-31');
        expect(w.endMs).toBe(Date.parse('2026-08-01T06:00:00Z'));
        // A 7 PM Mountain sale on the 31st is INSIDE the range. Under UTC bounds
        // it fell past the end and vanished from the operator's own date range.
        expect(Date.parse('2026-08-01T01:00:00Z')).toBeLessThan(w.endMs);
    });

    it('uses the 7h MST offset in winter, not a hardcoded 6h', async () => {
        const w = await windowFor('?period=custom&from=2026-01-01&to=2026-01-31');
        expect(w.startMs).toBe(Date.parse('2026-01-01T07:00:00Z'));
        expect(w.endMs).toBe(Date.parse('2026-02-01T07:00:00Z'));
    });

    // A range whose end lands on a DST transition day: advancing the end by a
    // fixed 86400000 would land an hour inside or short of the next midnight.
    it('advances the end by a CALENDAR day across a DST transition', async () => {
        const w = await windowFor('?period=custom&from=2026-10-25&to=2026-11-01');
        // 1 Nov is the 25-hour fall-back day, so 2 Nov midnight is MST (07:00Z).
        expect(w.endMs).toBe(Date.parse('2026-11-02T07:00:00Z'));
        expect(w.endMs - Date.parse('2026-11-01T06:00:00Z')).toBe(25 * 60 * 60 * 1000);
    });

    it('falls back to last_30d when either bound is missing or unparseable', async () => {
        expect((await windowFor('?period=custom&from=2026-07-01')).period).toBe('last_30d');
        expect((await windowFor('?period=custom&from=nope&to=2026-07-31')).period).toBe('last_30d');
    });
});

// End-to-end through a representative report: the month a payment lands in is
// now its DENVER month. 2026-08-01T01:00Z is 31 July, 7 PM Mountain — the old
// strftime bucket filed it under August; it is July's money.
describe('month buckets are Denver months (end-to-end through payouts)', () => {
    it('a 7 PM Mountain sale on the 31st lands in July, not August', async () => {
        bindCapabilities(env.DB, 'u_owner', ['reports.read', 'reports.read.bookkeeper']);
        env.DB.__on(/SELECT paid_at, status, total_cents\s+FROM bookings/, {
            results: [
                { paid_at: Date.parse('2026-08-01T01:00:00Z'), status: 'paid', total_cents: 5000 },
                { paid_at: Date.parse('2026-08-15T18:00:00Z'), status: 'paid', total_cents: 1000 },
            ],
        }, 'all');
        env.DB.__on(/SELECT received_at, amount_cents\s+FROM field_rental_payments/, { results: [] }, 'all');
        const res = await worker.fetch(req('/api/admin/reports/bookkeeper/payouts'), env, {});
        expect(res.status).toBe(200);
        const data = await res.json();
        const months = Object.fromEntries(data.rows.map((r) => [r.month, r.stripeGrossCents]));
        expect(months['2026-07']).toBe(5000);
        expect(months['2026-08']).toBe(1000);
    });
});

// M7 Batch 1a — admin Reports route shell.
//
// All 16 endpoints return 501 Not Implemented until populated in Batches 2-5
// (per persona). Each endpoint is gated on the persona-specific capability
// from migration 0062, so 403s fire at the cap-check stage before 501.
//
//   Owner reports (5)  — Batch 2: revenue-trends, retention, refund-rate,
//                                  repeat-customers, aov-trend
//   Bookkeeper (3)     — Batch 3: payouts, tax-fee-summary, period-comparison
//                                  (1099 thresholds links to existing M5 page)
//   Marketing (4)      — Batch 4: conversion-funnel, promo-performance,
//                                  customer-cohorts, channel-attribution
//   Site Coordinator(4)— Batch 5: field-rental-revenue, coi-compliance,
//                                  lead-conversion, recurrence-retention
//
// Mounted at /api/admin/reports in worker/index.js.

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability } from '../../lib/capabilities.js';

const adminReports = new Hono();
adminReports.use('*', requireAuth);

function notImplemented(c, persona, report) {
    return c.json({
        error: 'Not implemented',
        persona,
        report,
        status: 'stub',
        note: 'M7 Batches 2-5 will populate this endpoint per persona.',
    }, 501);
}

// ────────────────────────────────────────────────────────────────────
// Owner reports (Batch 2)
// ────────────────────────────────────────────────────────────────────

adminReports.get('/owner/revenue-trends',
    requireCapability('reports.read.owner'),
    (c) => notImplemented(c, 'owner', 'revenue-trends'));

adminReports.get('/owner/retention',
    requireCapability('reports.read.owner'),
    (c) => notImplemented(c, 'owner', 'retention'));

adminReports.get('/owner/refund-rate',
    requireCapability('reports.read.owner'),
    (c) => notImplemented(c, 'owner', 'refund-rate'));

adminReports.get('/owner/repeat-customers',
    requireCapability('reports.read.owner'),
    (c) => notImplemented(c, 'owner', 'repeat-customers'));

adminReports.get('/owner/aov-trend',
    requireCapability('reports.read.owner'),
    (c) => notImplemented(c, 'owner', 'aov-trend'));

// ────────────────────────────────────────────────────────────────────
// Bookkeeper reports (Batch 3)
// ────────────────────────────────────────────────────────────────────

adminReports.get('/bookkeeper/payouts',
    requireCapability('reports.read.bookkeeper'),
    (c) => notImplemented(c, 'bookkeeper', 'payouts'));

adminReports.get('/bookkeeper/tax-fee-summary',
    requireCapability('reports.read.bookkeeper'),
    (c) => notImplemented(c, 'bookkeeper', 'tax-fee-summary'));

adminReports.get('/bookkeeper/period-comparison',
    requireCapability('reports.read.bookkeeper'),
    (c) => notImplemented(c, 'bookkeeper', 'period-comparison'));

// ────────────────────────────────────────────────────────────────────
// Marketing reports (Batch 4)
// ────────────────────────────────────────────────────────────────────

adminReports.get('/marketing/conversion-funnel',
    requireCapability('reports.read.marketing'),
    (c) => notImplemented(c, 'marketing', 'conversion-funnel'));

adminReports.get('/marketing/promo-performance',
    requireCapability('reports.read.marketing'),
    (c) => notImplemented(c, 'marketing', 'promo-performance'));

adminReports.get('/marketing/customer-cohorts',
    requireCapability('reports.read.marketing'),
    (c) => notImplemented(c, 'marketing', 'customer-cohorts'));

adminReports.get('/marketing/channel-attribution',
    requireCapability('reports.read.marketing'),
    (c) => notImplemented(c, 'marketing', 'channel-attribution'));

// ────────────────────────────────────────────────────────────────────
// Site Coordinator reports (Batch 5)
// ────────────────────────────────────────────────────────────────────

adminReports.get('/site-coordinator/field-rental-revenue',
    requireCapability('reports.read.site_coordinator'),
    (c) => notImplemented(c, 'site-coordinator', 'field-rental-revenue'));

adminReports.get('/site-coordinator/coi-compliance',
    requireCapability('reports.read.site_coordinator'),
    (c) => notImplemented(c, 'site-coordinator', 'coi-compliance'));

adminReports.get('/site-coordinator/lead-conversion',
    requireCapability('reports.read.site_coordinator'),
    (c) => notImplemented(c, 'site-coordinator', 'lead-conversion'));

adminReports.get('/site-coordinator/recurrence-retention',
    requireCapability('reports.read.site_coordinator'),
    (c) => notImplemented(c, 'site-coordinator', 'recurrence-retention'));

export default adminReports;

// M5 Batch 11 — 1099 thresholds rollup (Surface 4b).
//
// IRS 1099-NEC threshold: $600 in 1099 payments per recipient per tax
// year. Below threshold: no 1099 needed. At/above: must file 1099-NEC
// by January 31 of the following year.
//
// This rollup is the Bookkeeper's most-requested view per pain point #14.
//
// Endpoints (capability-gated):
//   GET  /api/admin/1099-thresholds?tax_year=2026   rollup with status per person
//   GET  /api/admin/1099-thresholds/export?tax_year=2026  CSV export
//   POST /api/admin/1099-thresholds/lock-year       lock a tax year
//
// R11 refactor: pure helpers + I/O wrappers + auto-lock cron sweep
// extracted to worker/lib/thresholds1099.js. The route now consumes
// those helpers; same response shapes preserved.

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability } from '../../lib/capabilities.js';
import {
    IRS_1099_THRESHOLD_CENTS,
    aggregate1099TotalsForYear,
    formatIrs1099Csv,
    getYearLock,
    lockTaxYear,
} from '../../lib/thresholds1099.js';

const adminThresholds = new Hono();
adminThresholds.use('*', requireAuth);

adminThresholds.get('/', requireCapability('staff.thresholds_1099.read'), async (c) => {
    const url = new URL(c.req.url);
    const taxYear = Number(url.searchParams.get('tax_year')) || new Date().getUTCFullYear();

    const [recipients, lock] = await Promise.all([
        aggregate1099TotalsForYear(c.env, taxYear),
        getYearLock(c.env, taxYear),
    ]);

    return c.json({
        tax_year: taxYear,
        threshold_cents: IRS_1099_THRESHOLD_CENTS,
        locked: Boolean(lock),
        locked_at: lock?.locked_at,
        locked_reason: lock?.locked_reason,
        recipients,
    });
});

adminThresholds.get('/export', requireCapability('staff.thresholds_1099.export'), async (c) => {
    const url = new URL(c.req.url);
    const taxYear = Number(url.searchParams.get('tax_year')) || new Date().getUTCFullYear();

    const rollup = await aggregate1099TotalsForYear(c.env, taxYear);
    const csv = formatIrs1099Csv(rollup);

    return new Response(csv, {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="1099-thresholds-${taxYear}.csv"`,
        },
    });
});

adminThresholds.post('/lock-year', requireCapability('staff.thresholds_1099.lock_year'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const taxYear = Number(body.taxYear);
    if (!taxYear || taxYear < 2020 || taxYear > 2100) {
        return c.json({ error: 'taxYear required (between 2020 and 2100)' }, 400);
    }

    const existing = await getYearLock(c.env, taxYear);
    if (existing) return c.json({ error: 'Year already locked' }, 409);

    const result = await lockTaxYear(c.env, {
        taxYear,
        userId: user.id,
        reason: 'manual_close',
        notes: body.notes || null,
    });

    return c.json({ ok: true, taxYear: result.taxYear });
});

export default adminThresholds;

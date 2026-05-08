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

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';

const adminThresholds = new Hono();
adminThresholds.use('*', requireAuth);

const IRS_1099_THRESHOLD_CENTS = 600_00;

adminThresholds.get('/', requireCapability('staff.thresholds_1099.read'), async (c) => {
    const url = new URL(c.req.url);
    const taxYear = Number(url.searchParams.get('tax_year')) || new Date().getUTCFullYear();

    // Aggregate paid 1099 entries per person.
    const rows = await c.env.DB.prepare(
        `SELECT le.person_id, p.full_name, p.email, p.legal_name, p.ein,
                SUM(CASE WHEN le.pay_kind LIKE '1099%' THEN le.amount_cents ELSE 0 END) AS total_1099_cents,
                SUM(CASE WHEN le.pay_kind = 'w2_hourly' OR le.pay_kind = 'w2_salary' THEN le.amount_cents ELSE 0 END) AS total_w2_cents,
                COUNT(le.id) AS entry_count,
                MIN(le.worked_at) AS first_entry_at,
                MAX(le.worked_at) AS last_entry_at,
                COUNT(CASE WHEN le.paid_at IS NULL THEN 1 END) AS unpaid_count
         FROM labor_entries le
         INNER JOIN persons p ON p.id = le.person_id
         WHERE le.tax_year = ?
           AND p.archived_at IS NULL
         GROUP BY le.person_id, p.full_name, p.email, p.legal_name, p.ein
         ORDER BY total_1099_cents DESC`,
    ).bind(taxYear).all();

    const lock = await c.env.DB.prepare(
        'SELECT tax_year, locked_at, locked_reason FROM tax_year_locks WHERE tax_year = ?'
    ).bind(taxYear).first();

    return c.json({
        tax_year: taxYear,
        threshold_cents: IRS_1099_THRESHOLD_CENTS,
        locked: Boolean(lock),
        locked_at: lock?.locked_at,
        locked_reason: lock?.locked_reason,
        recipients: (rows.results || []).map((r) => ({
            personId: r.person_id,
            fullName: r.full_name,
            email: r.email,
            legalName: r.legal_name,
            ein: r.ein,
            total1099Cents: r.total_1099_cents || 0,
            totalW2Cents: r.total_w2_cents || 0,
            entryCount: r.entry_count,
            firstEntryAt: r.first_entry_at,
            lastEntryAt: r.last_entry_at,
            unpaidCount: r.unpaid_count,
            requires1099: (r.total_1099_cents || 0) >= IRS_1099_THRESHOLD_CENTS,
        })),
    });
});

adminThresholds.get('/export', requireCapability('staff.thresholds_1099.export'), async (c) => {
    const url = new URL(c.req.url);
    const taxYear = Number(url.searchParams.get('tax_year')) || new Date().getUTCFullYear();

    const rows = await c.env.DB.prepare(
        `SELECT le.person_id, p.full_name, p.email, p.legal_name, p.ein,
                SUM(CASE WHEN le.pay_kind LIKE '1099%' THEN le.amount_cents ELSE 0 END) AS total_1099_cents
         FROM labor_entries le
         INNER JOIN persons p ON p.id = le.person_id
         WHERE le.tax_year = ?
           AND p.archived_at IS NULL
         GROUP BY le.person_id`,
    ).bind(taxYear).all();

    const headers = ['Person ID', 'Full Name', 'Legal Name', 'EIN', 'Email', '1099 Total (USD)', 'Requires 1099-NEC'];
    const lines = [headers.join(',')];
    for (const r of rows.results || []) {
        const total = (r.total_1099_cents || 0) / 100;
        const requires = total >= 600 ? 'YES' : 'no';
        const safe = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
        lines.push([
            safe(r.person_id), safe(r.full_name), safe(r.legal_name),
            safe(r.ein), safe(r.email), total.toFixed(2), requires,
        ].join(','));
    }

    return new Response(lines.join('\n'), {
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

    const existing = await c.env.DB.prepare('SELECT * FROM tax_year_locks WHERE tax_year = ?').bind(taxYear).first();
    if (existing) return c.json({ error: 'Year already locked' }, 409);

    // Snapshot totals at lock time
    const totals = await c.env.DB.prepare(
        `SELECT
           SUM(CASE WHEN pay_kind = 'w2_hourly' OR pay_kind = 'w2_salary' THEN amount_cents ELSE 0 END) AS w2,
           SUM(CASE WHEN pay_kind LIKE '1099%' THEN amount_cents ELSE 0 END) AS k1099
         FROM labor_entries WHERE tax_year = ?`,
    ).bind(taxYear).first();

    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO tax_year_locks (tax_year, locked_at, locked_by_user_id, locked_reason,
                                      total_w2_cents, total_1099_cents, notes)
         VALUES (?, ?, ?, 'manual_close', ?, ?, ?)`,
    ).bind(
        taxYear, now, user.id,
        totals?.w2 || 0, totals?.k1099 || 0,
        body.notes || null,
    ).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'tax_year.locked',
        targetType: 'tax_year',
        targetId: String(taxYear),
        meta: { totals_w2_cents: totals?.w2 || 0, totals_1099_cents: totals?.k1099 || 0 },
    });

    return c.json({ ok: true, taxYear });
});

export default adminThresholds;

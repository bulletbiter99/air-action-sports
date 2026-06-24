// M7 Batch 3 — Bookkeeper reports tab content.
//
// Three table-based reports under one shared filter, plus a deep-link tile to
// the existing M5 1099-thresholds page (not a report):
//   1. Payouts summary  — monthly Stripe + field-rental gross, refunds, net
//   2. Tax & fee summary — monthly tax + fees + totals MetricCard
//   3. Period comparison — current vs prior window, metric by metric
//   4. 1099 Thresholds   — link to /admin/staff/1099-thresholds
//
// Comparison toggle is hidden: payouts/tax-fee don't use it and period
// comparison always compares. Event scope applies to all three reports.
// CSV export hits the same endpoint with ?format=csv (server gates on
// reports.export; ReportLayout hides the button without it).

import { useState } from 'react';
import { useReportData, downloadReportCsv } from './reportData.js';
import { Link } from 'react-router-dom';
import ReportFilters from './ReportFilters.jsx';
import ReportLayout from './ReportLayout.jsx';
import ReportEmptyState from './ReportEmptyState.jsx';
import ReportTable from './ReportTable.jsx';
import MetricCard from './charts/MetricCard.jsx';
import { formatMoney } from '../../utils/money.js';
import { categoryLabel } from '../../utils/expenseCategories.js';

const BK_BASE = '/api/admin/reports/bookkeeper';

function useReport(path, filters) { return useReportData(BK_BASE, path, filters); }
const downloadCsv = (path, filters) => downloadReportCsv(BK_BASE, path, filters);

const money = (cents) => formatMoney(cents);

function DeltaCell({ delta, metricKey }) {
    if (!delta || delta.deltaPct == null) {
        return <span style={{ color: 'var(--color-text-subtle)' }}>—</span>;
    }
    const up = delta.deltaPct > 0;
    const flat = delta.deltaPct === 0;
    const inverse = metricKey === 'refunds'; // more refunds = worse → flip color
    const good = inverse ? !up : up;
    const color = flat ? 'var(--color-text-muted)' : good ? 'var(--color-success)' : 'var(--color-danger)';
    const arrow = flat ? '→' : up ? '▲' : '▼';
    return <span style={{ color, fontWeight: 700 }}>{arrow} {Math.abs(delta.deltaPct * 100).toFixed(1)}%</span>;
}

function PayoutsCard({ filters }) {
    const { data, loading, error } = useReport('payouts', filters);
    const rows = data?.rows || [];
    const columns = [
        { key: 'month', label: 'Month' },
        { key: 'stripeGrossCents', label: 'Stripe Gross', align: 'right', render: money },
        { key: 'fieldRentalGrossCents', label: 'Field Rental Gross', align: 'right', render: money },
        { key: 'refundsCents', label: 'Refunds', align: 'right', render: money },
        { key: 'netCents', label: 'Net', align: 'right', render: money },
    ];
    const footer = data?.totals ? { month: 'Total', ...data.totals } : null;
    return (
        <ReportLayout
            title="Payouts summary"
            description="Money in by month — Stripe bookings + field-rental payments, net of refunds."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('payouts', filters)}
        >
            {rows.length === 0 ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <>
                    <ReportTable columns={columns} rows={rows} footer={footer} />
                    {data?.scopedNote && <p style={note}>{data.scopedNote}</p>}
                </>
            )}
        </ReportLayout>
    );
}

function TaxFeeCard({ filters }) {
    const { data, loading, error } = useReport('tax-fee-summary', filters);
    const series = data?.series || [];
    const columns = [
        { key: 'month', label: 'Month' },
        { key: 'taxCents', label: 'Tax', align: 'right', render: money },
        { key: 'feeCents', label: 'Fees', align: 'right', render: money },
        { key: 'totalCents', label: 'Total', align: 'right', render: money },
    ];
    const footer = data?.totals ? { month: 'Total', ...data.totals } : null;
    return (
        <ReportLayout
            title="Tax & fee summary"
            description="Tax and fees collected by month (paid + comp bookings)."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('tax-fee-summary', filters)}
        >
            {series.length === 0 ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <div style={chartRow}>
                    <div style={chartCol}>
                        <ReportTable columns={columns} rows={series} footer={footer} />
                    </div>
                    <MetricCard
                        label="Tax + fees collected"
                        value={money(data.totals.totalCents)}
                        sublabel={`${money(data.totals.taxCents)} tax · ${money(data.totals.feeCents)} fees`}
                    />
                </div>
            )}
        </ReportLayout>
    );
}

function PeriodComparisonCard({ filters }) {
    const { data, loading, error } = useReport('period-comparison', filters);
    const metrics = data?.metrics || [];
    const fmt = (kind, v) => (kind === 'money' ? money(v) : v);
    const columns = [
        { key: 'label', label: 'Metric' },
        { key: 'current', label: 'Current', align: 'right', render: (v, row) => fmt(row.kind, v) },
        { key: 'prior', label: 'Prior', align: 'right', render: (v, row) => fmt(row.kind, v) },
        { key: 'delta', label: 'Change', align: 'right', render: (v, row) => <DeltaCell delta={v} metricKey={row.key} /> },
    ];
    return (
        <ReportLayout
            title="Period comparison"
            description="Current period vs the equal-length prior period, metric by metric."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('period-comparison', filters)}
        >
            {metrics.length === 0 ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <ReportTable columns={columns} rows={metrics} />
            )}
        </ReportLayout>
    );
}

function VarianceCell({ cents }) {
    const c = Number(cents) || 0;
    if (c === 0) return <span style={{ color: 'var(--color-text-muted)' }}>{money(0)}</span>;
    const good = c > 0; // under budget = favorable
    const color = good ? 'var(--color-success)' : 'var(--color-danger)';
    return <span style={{ color, fontWeight: 700 }}>{good ? '▼ ' : '▲ '}{money(Math.abs(c))}</span>;
}

function BudgetVsActualCard({ filters }) {
    const { data, loading, error } = useReport('budget-vs-actual', filters);
    const totals = data?.totals;
    const categories = (data?.categories || []).map((r) => ({ ...r, label: categoryLabel(r.category) }));
    const columns = [
        { key: 'label', label: 'Category' },
        { key: 'budgetedCents', label: 'Budgeted', align: 'right', render: money },
        { key: 'spentCents', label: 'Spent', align: 'right', render: money },
        { key: 'varianceCents', label: 'Variance', align: 'right', render: (v) => <VarianceCell cents={v} /> },
    ];
    const footer = totals
        ? { label: 'Total', budgetedCents: totals.budgetedCents, spentCents: totals.spentCents, varianceCents: totals.varianceCents }
        : null;
    const hasAnything = totals && (categories.length > 0 || totals.earnedCents !== 0);
    return (
        <ReportLayout
            title="P&L vs budget"
            description="Recorded expenses vs your monthly budgets by category, plus net income (earned revenue − expenses). Org-wide — not affected by the event filter."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('budget-vs-actual', filters)}
        >
            {!hasAnything ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <div style={chartRow}>
                    <div style={chartCol}>
                        {categories.length > 0
                            ? <ReportTable columns={columns} rows={categories} footer={footer} />
                            : <p style={note}>No expenses or budgets recorded in this period.</p>}
                    </div>
                    <div style={metricStack}>
                        <MetricCard label="Earned revenue" value={money(totals.earnedCents)} />
                        <MetricCard
                            label="Total expenses"
                            value={money(totals.spentCents)}
                            sublabel={totals.budgetedCents > 0 ? `${money(totals.budgetedCents)} budgeted` : 'no budget set'}
                        />
                        <MetricCard label="Net income" value={money(totals.netCents)} sublabel="revenue − expenses" />
                    </div>
                </div>
            )}
        </ReportLayout>
    );
}

function StripeFeesCard({ filters }) {
    const { data, loading, error } = useReport('stripe-fees', filters);
    const series = data?.series || [];
    const totals = data?.totals;
    const coverage = data?.coverage;
    const columns = [
        { key: 'month', label: 'Month' },
        { key: 'grossCents', label: 'Gross', align: 'right', render: money },
        { key: 'feeCents', label: 'Stripe fees', align: 'right', render: money },
        { key: 'netCents', label: 'Net deposited', align: 'right', render: money },
        { key: 'taxCents', label: 'Sales tax', align: 'right', render: money },
        { key: 'keptCents', label: 'Kept', align: 'right', render: (v) => <span style={{ fontWeight: 700 }}>{money(v)}</span> },
    ];
    const footer = totals ? { month: 'Total', ...totals } : null;
    const incomplete = coverage && coverage.total > 0 && coverage.captured < coverage.total;
    return (
        <ReportLayout
            title="Stripe fees & true net"
            description="What Stripe actually took per charge vs your pass-through. Net deposited = gross − Stripe's real fee; Kept = net − sales tax. Paid bookings only."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('stripe-fees', filters)}
        >
            {series.length === 0 ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <div style={chartRow}>
                    <div style={chartCol}>
                        <ReportTable columns={columns} rows={series} footer={footer} />
                        {incomplete && (
                            <p style={note}>
                                {coverage.captured} of {coverage.total} paid bookings reconciled — the rest fill in on the nightly Stripe sync.
                            </p>
                        )}
                    </div>
                    <MetricCard
                        label="Kept (net of fees + tax)"
                        value={money(totals.keptCents)}
                        sublabel={data.effectiveFeeRate != null ? `${(data.effectiveFeeRate * 100).toFixed(2)}% effective Stripe fee` : 'awaiting reconciliation'}
                    />
                </div>
            )}
        </ReportLayout>
    );
}

function Thresholds1099Card() {
    return (
        <ReportLayout
            title="1099 Thresholds"
            description="Contractor 1099-NEC threshold tracking lives on the dedicated Staff page."
        >
            <div style={linkWrap}>
                <p style={{ color: 'var(--color-text-muted)', margin: 0, maxWidth: 620 }}>
                    Year-to-date contractor payouts, the $600 threshold flags, EIN / legal-name
                    readiness, and the lock-year + CSV export are all managed on the Staff 1099 page.
                </p>
                <Link to="/admin/staff/1099-thresholds" style={linkBtn}>Open 1099 Thresholds →</Link>
            </div>
        </ReportLayout>
    );
}

export default function BookkeeperReports() {
    const [filters, setFilters] = useState({ period: 'mtd', comparison: false, eventId: 'all' });

    return (
        <div>
            <div style={{ marginBottom: '1.5rem' }}>
                <ReportFilters value={filters} onChange={setFilters} showEventScope showComparison={false} />
            </div>
            <PayoutsCard filters={filters} />
            <BudgetVsActualCard filters={filters} />
            <StripeFeesCard filters={filters} />
            <TaxFeeCard filters={filters} />
            <PeriodComparisonCard filters={filters} />
            <Thresholds1099Card />
        </div>
    );
}

// ── styles ───────────────────────────────────────────────────────────
const chartRow = { display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' };
const chartCol = { flex: '1 1 420px', minWidth: 0 };
const metricStack = { display: 'flex', flexDirection: 'column', gap: '0.75rem' };
const note = { color: 'var(--color-text-subtle)', fontSize: '0.8rem', fontStyle: 'italic', marginTop: '0.5rem' };
const linkWrap = { display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' };
const linkBtn = {
    display: 'inline-block',
    background: 'var(--color-accent)',
    color: 'var(--color-accent-on-accent)',
    padding: '0.5rem 1rem',
    borderRadius: 4,
    textDecoration: 'none',
    fontWeight: 700,
    fontSize: '0.9rem',
};

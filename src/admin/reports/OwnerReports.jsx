// M7 Batch 2 — Owner reports tab content.
//
// Five reports under one shared tab-level filter (period / comparison / event
// scope) — "filters apply to all reports in the active tab" (reports-scope.md):
//   1. Revenue trends   — daily gross LineChart + total/delta MetricCard
//   2. Refund rate      — monthly rate LineChart + rate/delta MetricCard
//   3. AOV trend        — monthly AOV LineChart + AOV/delta MetricCard
//   4. Retention        — series-to-series ProgressBar rows
//   5. Repeat customers — lifetime bucket ProgressBar rows + repeat % MetricCard
//
// Each card fetches its own endpoint (parallel on mount; refetch on filter
// change) and renders a no-data empty state when its payload is empty.
// CSV export hits the same endpoint with ?format=csv (server gates on
// reports.export; ReportLayout hides the button without it).

import { useState, useEffect } from 'react';
import ReportFilters from './ReportFilters.jsx';
import ReportLayout from './ReportLayout.jsx';
import ReportEmptyState from './ReportEmptyState.jsx';
import LineChart from './charts/LineChart.jsx';
import MetricCard from './charts/MetricCard.jsx';
import { ProgressBar } from '../charts.jsx';
import { formatMoney } from '../../utils/money.js';

const OWNER_BASE = '/api/admin/reports/owner';

function buildQuery(f, csv = false) {
    const p = new URLSearchParams();
    if (f.period) p.set('period', f.period);
    if (f.comparison) p.set('comparison', '1');
    if (f.eventId && f.eventId !== 'all') p.set('event_id', f.eventId);
    if (csv) p.set('format', 'csv');
    const s = p.toString();
    return s ? `?${s}` : '';
}

function useReport(path, filters) {
    const [state, setState] = useState({ data: null, loading: true, error: null });
    useEffect(() => {
        let cancelled = false;
        setState((s) => ({ ...s, loading: true, error: null }));
        fetch(`${OWNER_BASE}/${path}${buildQuery(filters)}`, { credentials: 'include', cache: 'no-store' })
            .then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
            .catch((e) => { if (!cancelled) setState({ data: null, loading: false, error: e.message }); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path, filters.period, filters.comparison, filters.eventId]);
    return state;
}

function downloadCsv(path, filters) {
    const a = document.createElement('a');
    a.href = `${OWNER_BASE}/${path}${buildQuery(filters, true)}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// ── Small label/format helpers ───────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function compactMoney(cents) {
    const d = (Number(cents) || 0) / 100;
    if (Math.abs(d) >= 1000) return `$${(d / 1000).toFixed(1)}k`;
    return `$${Math.round(d)}`;
}
function dayLabel(iso) {
    if (!iso) return '';
    const p = String(iso).split('-');
    return p.length >= 3 ? `${Number(p[1])}/${Number(p[2])}` : iso;
}
function monthLabel(ym) {
    if (!ym) return '';
    const p = String(ym).split('-');
    if (p.length < 2) return ym;
    return `${MONTHS[Number(p[1]) - 1] || p[1]} '${p[0].slice(2)}`;
}

// ── Shared categorical bars (retention + repeat buckets) ─────────────
function CategoryBars({ items, formatValue = (v) => v }) {
    const max = Math.max(1, ...items.map((i) => i.value));
    return (
        <div style={catWrap}>
            {items.map((it) => (
                <div key={it.label} style={catRow}>
                    <span style={catLabel} title={it.label}>{it.label}</span>
                    <ProgressBar value={it.value} max={max} height={10} color="var(--color-accent)" />
                    <span style={catValue}>{formatValue(it.value)}</span>
                </div>
            ))}
        </div>
    );
}

// ── The five report cards ────────────────────────────────────────────

function RevenueTrendsCard({ filters }) {
    const { data, loading, error } = useReport('revenue-trends', filters);
    const series = (data?.series || []).map((p) => ({ label: p.date, value: p.grossCents }));
    return (
        <ReportLayout
            title="Revenue trends"
            description="Gross revenue (paid + refunded originals) over the selected period."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('revenue-trends', filters)}
        >
            {series.length === 0 ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <div style={chartRow}>
                    <div style={chartCol}>
                        <LineChart data={series} formatValue={compactMoney} formatLabel={dayLabel} ariaLabel="Daily gross revenue" />
                    </div>
                    <MetricCard
                        label={`Total · ${data.window?.label || ''}`}
                        value={formatMoney(data.totalCents)}
                        delta={data.delta}
                        sublabel={filters.comparison ? 'vs prior period' : 'Enable comparison for delta'}
                    />
                </div>
            )}
        </ReportLayout>
    );
}

function RefundRateCard({ filters }) {
    const { data, loading, error } = useReport('refund-rate', filters);
    const series = (data?.series || []).map((r) => ({ label: r.month, value: Number((r.rate * 100).toFixed(1)) }));
    return (
        <ReportLayout
            title="Refund rate"
            description="Share of charged bookings later refunded (Stripe + external), by month."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('refund-rate', filters)}
        >
            {(!data || data.charged === 0) ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <div style={chartRow}>
                    <div style={chartCol}>
                        <LineChart data={series} formatValue={(v) => `${v}%`} formatLabel={monthLabel} color="var(--color-danger)" ariaLabel="Monthly refund rate" />
                    </div>
                    <MetricCard
                        label="Refund rate"
                        value={`${(data.rate * 100).toFixed(1)}%`}
                        delta={data.delta}
                        deltaInverse
                        sublabel={`${data.refunded} of ${data.charged} charged`}
                    />
                </div>
            )}
        </ReportLayout>
    );
}

function AovTrendCard({ filters }) {
    const { data, loading, error } = useReport('aov-trend', filters);
    const series = (data?.series || []).map((r) => ({ label: r.month, value: r.avgCents }));
    return (
        <ReportLayout
            title="Average order value"
            description="Mean paid-booking total per month over the selected period."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('aov-trend', filters)}
        >
            {series.length === 0 ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <div style={chartRow}>
                    <div style={chartCol}>
                        <LineChart data={series} formatValue={compactMoney} formatLabel={monthLabel} ariaLabel="Monthly average order value" />
                    </div>
                    <MetricCard
                        label="AOV"
                        value={formatMoney(data.aovCents)}
                        delta={data.delta}
                        sublabel={`${data.bookings} paid bookings`}
                    />
                </div>
            )}
        </ReportLayout>
    );
}

function RetentionCard({ filters }) {
    const { data, loading, error } = useReport('retention', filters);
    const transitions = data?.transitions || [];
    const items = transitions.map((t) => ({ label: `${t.fromSeries} → ${t.toSeries}`, value: Math.round(t.retainedPct * 100) }));
    return (
        <ReportLayout
            title="Retention by event series"
            description="Customers who booked one series and returned for the next (uses full booking history)."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('retention', filters)}
        >
            {items.length === 0 ? (
                <ReportEmptyState
                    kind="no-data"
                    title="Not enough series yet"
                    description="Series-to-series retention needs at least two event series (the events.site branding). It will populate as more series run."
                />
            ) : (
                <CategoryBars items={items} formatValue={(v) => `${v}%`} />
            )}
        </ReportLayout>
    );
}

function RepeatCustomersCard({ filters }) {
    const { data, loading, error } = useReport('repeat-customers', filters);
    const buckets = data?.buckets || {};
    const items = Object.entries(buckets).map(([label, value]) => ({ label: `${label} bookings`, value }));
    const hasAny = (data?.total || 0) > 0;
    return (
        <ReportLayout
            title="Repeat customers"
            description="Lifetime booking distribution across the current customer base (period filter does not apply)."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('repeat-customers', filters)}
        >
            {!hasAny ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <div style={chartRow}>
                    <div style={chartCol}>
                        <CategoryBars items={items} />
                    </div>
                    <MetricCard
                        label="Repeat customers"
                        value={`${data.repeatTotal}`}
                        sublabel={`${Math.round(data.repeatPct * 100)}% of ${data.total} booked`}
                        hint="Booked 2 or more times"
                    />
                </div>
            )}
        </ReportLayout>
    );
}

export default function OwnerReports() {
    const [filters, setFilters] = useState({ period: 'mtd', comparison: false, eventId: 'all' });

    return (
        <div>
            <div style={{ marginBottom: '1.5rem' }}>
                <ReportFilters value={filters} onChange={setFilters} showEventScope showComparison />
            </div>
            <RevenueTrendsCard filters={filters} />
            <RefundRateCard filters={filters} />
            <AovTrendCard filters={filters} />
            <RetentionCard filters={filters} />
            <RepeatCustomersCard filters={filters} />
        </div>
    );
}

// ── styles ───────────────────────────────────────────────────────────
const chartRow = { display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap' };
const chartCol = { flex: '1 1 360px', minWidth: 0 };

const catWrap = { display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%' };
const catRow = {
    display: 'grid',
    gridTemplateColumns: 'minmax(120px, 180px) 1fr 56px',
    alignItems: 'center',
    gap: '0.75rem',
};
const catLabel = {
    fontSize: '0.85rem',
    color: 'var(--color-text-muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
};
const catValue = {
    fontSize: '0.85rem',
    fontWeight: 700,
    color: 'var(--color-text)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
};

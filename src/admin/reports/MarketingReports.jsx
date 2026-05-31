// M7 Batch 4 — Marketing reports tab content.
//
// Four reports under one shared filter (period + event scope; comparison
// hidden — no marketing report does prior-period comparison):
//   1. Conversion funnel by event — Bookings → Paid → Checked-in → Waivers
//   2. Promo code performance      — per-code uses / revenue / status
//   3. Customer cohorts            — acquisition-month repeat rate (lifetime)
//   4. Channel attribution         — paid bookings by referral (+ null fallback)
//
// Reuses ProgressBar (src/admin/charts.jsx) for funnel stage bars and
// ReportTable for the three tabular reports. CSV export hits the same
// endpoint with ?format=csv (server gates on reports.export).

import { useState } from 'react';
import { useReportData, downloadReportCsv } from './reportData.js';
import ReportFilters from './ReportFilters.jsx';
import ReportLayout from './ReportLayout.jsx';
import ReportEmptyState from './ReportEmptyState.jsx';
import ReportTable from './ReportTable.jsx';
import { ProgressBar } from '../charts.jsx';
import { formatMoney } from '../../utils/money.js';

const MK_BASE = '/api/admin/reports/marketing';

function useReport(path, filters) { return useReportData(MK_BASE, path, filters); }
const downloadCsv = (path, filters) => downloadReportCsv(MK_BASE, path, filters);

const money = (cents) => formatMoney(cents);

function StatusPill({ status }) {
    const color = status === 'active'
        ? 'var(--color-success)'
        : status === 'expired' ? 'var(--color-danger)' : 'var(--color-text-subtle)';
    return <span style={{ color, fontWeight: 700, textTransform: 'capitalize' }}>{status}</span>;
}

function FunnelBlock({ event }) {
    const top = event.stages[0]?.count || 0;
    return (
        <div style={funnelBlock}>
            <div style={funnelTitle}>
                {event.title || 'Untitled event'}
                {event.dateIso && <span style={funnelDate}>{event.dateIso}</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {event.stages.map((s) => (
                    <div key={s.name} style={funnelRow}>
                        <span style={funnelStageLabel}>{s.name}</span>
                        <ProgressBar value={s.count} max={Math.max(1, top)} height={10} color="var(--color-accent)" />
                        <span style={funnelCount}>
                            {s.count}
                            {s.pctOfPrev != null && <span style={funnelPct}> ({Math.round(s.pctOfPrev * 100)}%)</span>}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ConversionFunnelCard({ filters }) {
    const { data, loading, error } = useReport('conversion-funnel', filters);
    const events = data?.events || [];
    return (
        <ReportLayout
            title="Conversion funnel by event"
            description="Bookings → Paid → Checked-in → Waivers, per event. Stage % is drop-off from the previous stage."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('conversion-funnel', filters)}
        >
            {events.length === 0 ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {events.map((ev) => <FunnelBlock key={ev.eventId} event={ev} />)}
                    {data?.truncated && <p style={note}>Showing the 25 most recent events — narrow by event scope to see others.</p>}
                </div>
            )}
        </ReportLayout>
    );
}

function PromoPerformanceCard({ filters }) {
    const { data, loading, error } = useReport('promo-performance', filters);
    const promos = data?.promos || [];
    const columns = [
        { key: 'code', label: 'Code' },
        { key: 'discountLabel', label: 'Discount' },
        { key: 'uses', label: 'Uses', align: 'right' },
        { key: 'redemptions', label: 'Redemptions', align: 'right' },
        { key: 'discountCents', label: 'Discount Given', align: 'right', render: money },
        { key: 'revenueCents', label: 'Revenue', align: 'right', render: money },
        { key: 'status', label: 'Status', render: (v) => <StatusPill status={v} /> },
    ];
    return (
        <ReportLayout
            title="Promo code performance"
            description="Lifetime usage and attributed revenue per code (period/event filters don't apply)."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('promo-performance', filters)}
        >
            {promos.length === 0 ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <ReportTable columns={columns} rows={promos.map((p) => ({ ...p, key: p.id }))} />
            )}
        </ReportLayout>
    );
}

function CustomerCohortsCard({ filters }) {
    const { data, loading, error } = useReport('customer-cohorts', filters);
    const cohorts = data?.cohorts || [];
    const columns = [
        { key: 'month', label: 'Acquisition Month' },
        { key: 'newCount', label: 'New', align: 'right' },
        { key: 'repeatCount', label: 'Repeat', align: 'right' },
        { key: 'repeatPct', label: 'Repeat %', align: 'right', render: (v) => `${Math.round(v * 100)}%` },
    ];
    const footer = data?.totals
        ? { month: 'Total', newCount: data.totals.newCount, repeatCount: data.totals.repeatCount, repeatPct: data.totals.repeatPct }
        : null;
    return (
        <ReportLayout
            title="Customer cohorts"
            description="New customers by first-booking month, and how many became repeat customers (lifetime)."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('customer-cohorts', filters)}
        >
            {cohorts.length === 0 ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <ReportTable columns={columns} rows={cohorts} footer={footer} />
            )}
        </ReportLayout>
    );
}

function ChannelAttributionCard({ filters }) {
    const { data, loading, error } = useReport('channel-attribution', filters);
    const channels = data?.channels || [];
    const columns = [
        { key: 'channel', label: 'Channel' },
        { key: 'bookings', label: 'Bookings', align: 'right' },
        { key: 'revenueCents', label: 'Revenue', align: 'right', render: money },
        { key: 'pctOfRevenue', label: '% of Revenue', align: 'right', render: (v) => `${Math.round(v * 100)}%` },
    ];
    return (
        <ReportLayout
            title="Channel attribution"
            description="Paid bookings grouped by referral source over the selected period."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('channel-attribution', filters)}
        >
            {(!data || !data.hasData) ? (
                <ReportEmptyState
                    kind="no-data"
                    title="No channel data yet"
                    description="Channel attribution needs referral-source capture. M8 will add a Referral field to the booking flow; until then this shows only manually-tagged historical data."
                />
            ) : (
                <ReportTable columns={columns} rows={channels.map((ch, i) => ({ ...ch, key: ch.channel || i }))} />
            )}
        </ReportLayout>
    );
}

export default function MarketingReports() {
    const [filters, setFilters] = useState({ period: 'mtd', comparison: false, eventId: 'all' });

    return (
        <div>
            <div style={{ marginBottom: '1.5rem' }}>
                <ReportFilters value={filters} onChange={setFilters} showEventScope showComparison={false} />
            </div>
            <ConversionFunnelCard filters={filters} />
            <PromoPerformanceCard filters={filters} />
            <CustomerCohortsCard filters={filters} />
            <ChannelAttributionCard filters={filters} />
        </div>
    );
}

// ── styles ───────────────────────────────────────────────────────────
const note = { color: 'var(--color-text-subtle)', fontSize: '0.8rem', fontStyle: 'italic', marginTop: '0.25rem' };

const funnelBlock = {
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    padding: '1rem',
    background: 'var(--color-bg-sunken)',
};
const funnelTitle = {
    fontWeight: 700,
    color: 'var(--color-text)',
    marginBottom: '0.75rem',
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'baseline',
    flexWrap: 'wrap',
};
const funnelDate = { fontSize: '0.8rem', color: 'var(--color-text-subtle)', fontWeight: 400 };
const funnelRow = {
    display: 'grid',
    gridTemplateColumns: 'minmax(80px, 110px) 1fr minmax(90px, 120px)',
    alignItems: 'center',
    gap: '0.75rem',
};
const funnelStageLabel = { fontSize: '0.85rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' };
const funnelCount = {
    fontSize: '0.85rem',
    fontWeight: 700,
    color: 'var(--color-text)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
};
const funnelPct = { color: 'var(--color-text-subtle)', fontWeight: 400 };

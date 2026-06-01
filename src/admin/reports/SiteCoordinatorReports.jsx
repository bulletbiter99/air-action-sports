// M7 Batch 5 — Site Coordinator reports tab content (field rentals persona).
//
// Four reports under one shared filter (period only — field rentals aren't
// event-scoped, and comparison isn't used here):
//   1. Field rental revenue by site — realized revenue per site, by month
//   2. COI compliance status        — active rentals by certificate status
//   3. Lead-to-booking conversion   — field-rental pipeline funnel
//   4. Recurrence retention         — % of series still active at 90/180/365d
//
// Reuses ReportTable (revenue/expiring/series tables), MetricCard (COI buckets
// + retention), ProgressBar (lead funnel), and Link → the field-rental detail
// page for COI deep-links. Field rentals have 0 production rows today, so
// empty states are expected.

import { useState } from 'react';
import { useReportData, downloadReportCsv } from './reportData.js';
import { Link } from 'react-router-dom';
import ReportFilters from './ReportFilters.jsx';
import ReportLayout from './ReportLayout.jsx';
import ReportEmptyState from './ReportEmptyState.jsx';
import ReportTable from './ReportTable.jsx';
import MetricCard from './charts/MetricCard.jsx';
import { ProgressBar } from '../charts.jsx';
import { formatMoney } from '../../utils/money.js';
import { fmtDate } from '../../utils/dateFormat.js';

const SC_BASE = '/api/admin/reports/site-coordinator';

function useReport(path, filters) { return useReportData(SC_BASE, path, filters); }
const downloadCsv = (path, filters) => downloadReportCsv(SC_BASE, path, filters);

const money = (cents) => formatMoney(cents);

function StageBars({ stages }) {
    const top = stages[0]?.count || 0;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {stages.map((s) => (
                <div key={s.name} style={stageRow}>
                    <span style={stageLabel}>{s.name}</span>
                    <ProgressBar value={s.count} max={Math.max(1, top)} height={10} color="var(--color-accent)" />
                    <span style={stageCount}>
                        {s.count}
                        {s.pctOfPrev != null && <span style={stagePct}> ({Math.round(s.pctOfPrev * 100)}%)</span>}
                    </span>
                </div>
            ))}
        </div>
    );
}

function FieldRentalRevenueCard({ filters }) {
    const { data, loading, error } = useReport('field-rental-revenue', filters);
    const rows = data?.rows || [];
    const columns = [
        { key: 'site', label: 'Site' },
        { key: 'month', label: 'Month' },
        { key: 'rentals', label: 'Rentals', align: 'right' },
        { key: 'revenueCents', label: 'Revenue', align: 'right', render: money },
    ];
    const footer = data?.totals
        ? { site: 'Total', month: '', rentals: data.totals.rentals, revenueCents: data.totals.revenueCents }
        : null;
    return (
        <ReportLayout
            title="Field rental revenue by site"
            description="Realized revenue (paid + completed rentals) per site, by month."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('field-rental-revenue', filters)}
        >
            {rows.length === 0 ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <ReportTable columns={columns} rows={rows} footer={footer} />
            )}
        </ReportLayout>
    );
}

function CoiComplianceCard({ filters }) {
    const { data, loading, error } = useReport('coi-compliance', filters);
    const b = data?.buckets;
    const expiringSoon = data?.expiringSoon || [];
    const columns = [
        { key: 'id', label: 'Rental', render: (v) => <Link to={`/admin/field-rentals/${v}`} style={linkInline}>{v}</Link> },
        { key: 'site', label: 'Site' },
        { key: 'coiExpiresAt', label: 'Expires', render: (v) => fmtDate(v) },
        { key: 'daysUntil', label: 'Days left', align: 'right' },
    ];
    return (
        <ReportLayout
            title="COI compliance status"
            description="Active rentals by certificate-of-insurance status (current snapshot — period filter doesn't apply)."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('coi-compliance', filters)}
        >
            {(!b || data.total === 0) ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <>
                    <div style={metricRow}>
                        <MetricCard label="Valid" value={`${b.valid}`} />
                        <MetricCard label="Expiring ≤30d" value={`${b.expiring30}`} />
                        <MetricCard label="Expiring ≤60d" value={`${b.expiring60}`} />
                        <MetricCard label="Missing" value={`${b.missing}`} />
                        <MetricCard label="Expired" value={`${b.expired}`} />
                    </div>
                    {expiringSoon.length > 0 && (
                        <div style={{ marginTop: '1.25rem' }}>
                            <h3 style={subhead}>Expiring within 60 days</h3>
                            <ReportTable columns={columns} rows={expiringSoon} />
                        </div>
                    )}
                </>
            )}
        </ReportLayout>
    );
}

function LeadConversionCard({ filters }) {
    const { data, loading, error } = useReport('lead-conversion', filters);
    const stages = data?.stages || [];
    return (
        <ReportLayout
            title="Lead-to-booking conversion"
            description="Field-rental pipeline for leads created in the period. Approximated from current status; cancelled/refunded counted as lost."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('lead-conversion', filters)}
        >
            {(!data || data.created === 0) ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <div style={chartRow}>
                    <div style={chartCol}><StageBars stages={stages} /></div>
                    <MetricCard
                        label="Lead → Paid"
                        value={`${Math.round(data.conversionPct * 100)}%`}
                        sublabel={`${data.created} created · ${data.lost} lost`}
                    />
                </div>
            )}
        </ReportLayout>
    );
}

function RecurrenceRetentionCard({ filters }) {
    const { data, loading, error } = useReport('recurrence-retention', filters);
    const r = data?.retention;
    const series = data?.series || [];
    const columns = [
        { key: 'site', label: 'Site' },
        { key: 'frequency', label: 'Frequency', render: (v) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : '') },
        { key: 'startsOn', label: 'Started' },
        { key: 'active', label: 'Status', render: (v) => (v ? 'Active' : 'Ended') },
    ];
    return (
        <ReportLayout
            title="Recurrence retention"
            description="Share of recurrence series still active at each age (current snapshot — period filter doesn't apply)."
            loading={loading}
            error={error}
            onExportCsv={() => downloadCsv('recurrence-retention', filters)}
        >
            {(!data || data.total === 0) ? (
                <ReportEmptyState kind="no-data" />
            ) : (
                <>
                    <div style={metricRow}>
                        <MetricCard label="90-day retention" value={`${Math.round(r.d90.pct * 100)}%`} sublabel={`${r.d90.retained}/${r.d90.eligible} series`} />
                        <MetricCard label="180-day retention" value={`${Math.round(r.d180.pct * 100)}%`} sublabel={`${r.d180.retained}/${r.d180.eligible} series`} />
                        <MetricCard label="365-day retention" value={`${Math.round(r.d365.pct * 100)}%`} sublabel={`${r.d365.retained}/${r.d365.eligible} series`} />
                    </div>
                    <div style={{ marginTop: '1.25rem' }}>
                        <ReportTable columns={columns} rows={series.map((s) => ({ ...s, key: s.id }))} />
                    </div>
                </>
            )}
        </ReportLayout>
    );
}

export default function SiteCoordinatorReports() {
    const [filters, setFilters] = useState({ period: 'mtd', comparison: false, eventId: 'all' });

    return (
        <div>
            <div style={{ marginBottom: '1.5rem' }}>
                <ReportFilters value={filters} onChange={setFilters} showEventScope={false} showComparison={false} />
            </div>
            <FieldRentalRevenueCard filters={filters} />
            <CoiComplianceCard filters={filters} />
            <LeadConversionCard filters={filters} />
            <RecurrenceRetentionCard filters={filters} />
        </div>
    );
}

// ── styles ───────────────────────────────────────────────────────────
const metricRow = { display: 'flex', gap: '1rem', flexWrap: 'wrap' };
const chartRow = { display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap' };
const chartCol = { flex: '1 1 360px', minWidth: 0 };
const subhead = { color: 'var(--color-text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', margin: '0 0 0.5rem' };
const linkInline = { color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 600 };

const stageRow = {
    display: 'grid',
    gridTemplateColumns: 'minmax(70px, 90px) 1fr minmax(90px, 120px)',
    alignItems: 'center',
    gap: '0.75rem',
};
const stageLabel = { fontSize: '0.85rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' };
const stageCount = { fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const stagePct = { color: 'var(--color-text-subtle)', fontWeight: 400 };

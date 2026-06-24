import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import LineChart from './reports/charts/LineChart.jsx';
import { formatMoney, formatMoneyCompact } from '../utils/money.js';
import { dayLabel } from '../utils/dateFormat.js';

export default function AdminCashFlow() {
    const { isAuthenticated, loading, hasCapability } = useAdmin();
    const navigate = useNavigate();

    const [opening, setOpening] = useState('');   // dollar string
    const [runRate, setRunRate] = useState('');   // dollar string ('' until prefilled)
    const [data, setData] = useState(null);
    const [loadingData, setLoadingData] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (loading) return;
        if (!isAuthenticated) navigate('/admin/login');
        else if (!hasCapability('finances.read')) navigate('/admin');
    }, [loading, isAuthenticated, hasCapability, navigate]);

    // prefillRunRate: on first/auto load we send no override and adopt the
    // server-derived run-rate into the input; the Update button passes false.
    const runForecast = useCallback(async (openingStr, runRateStr, prefillRunRate) => {
        setLoadingData(true);
        setError(null);
        const params = new URLSearchParams();
        const oc = Math.round(parseFloat(openingStr || '0') * 100);
        params.set('opening_cents', String(Number.isFinite(oc) ? oc : 0));
        if (!prefillRunRate && runRateStr !== '' && runRateStr != null) {
            const rc = Math.round(parseFloat(runRateStr) * 100);
            if (Number.isFinite(rc)) params.set('weekly_revenue_cents', String(rc));
        }
        try {
            const res = await fetch(`/api/admin/cash-flow?${params}`, { credentials: 'include', cache: 'no-store' });
            if (!res.ok) { setError('Failed to load forecast'); setLoadingData(false); return; }
            const d = await res.json();
            setData(d);
            if (prefillRunRate) setRunRate(((d.assumptions?.weeklyRevenueCents || 0) / 100).toFixed(2));
        } catch {
            setError('Failed to load forecast');
        }
        setLoadingData(false);
    }, []);

    useEffect(() => { if (isAuthenticated) runForecast('', '', true); }, [isAuthenticated, runForecast]);

    if (loading || !isAuthenticated) return null;

    const rows = data?.rows || [];
    const series = rows.map((r) => ({ label: r.label, value: r.closingCents }));
    const troughNegative = data && data.minClosingCents < 0;
    const chartColor = troughNegative ? 'var(--color-danger)' : 'var(--color-accent)';

    return (
        <div style={pageWrap}>
            <AdminPageHeader
                title="Cash Flow Forecast"
                description="13-week projected cash position. Receipts = a booking-revenue run-rate + scheduled field-rental payments; disbursements = your monthly budgets. Enter your current cash balance to anchor it."
            />

            {error && <div style={errBanner}>{error}</div>}

            <div style={controls}>
                <label style={field}>
                    <span style={lbl}>Current cash balance ($)</span>
                    <input type="number" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" style={input} />
                </label>
                <label style={field}>
                    <span style={lbl}>Projected weekly revenue ($)</span>
                    <input type="number" step="0.01" value={runRate} onChange={(e) => setRunRate(e.target.value)} placeholder="0.00" style={input} />
                    <span style={hint}>{data?.assumptions?.revenueDerived ? 'Auto from trailing 8 weeks — edit to override' : 'Manual override'}</span>
                </label>
                <button style={primaryBtn} onClick={() => runForecast(opening, runRate, false)} disabled={loadingData}>
                    {loadingData ? 'Updating…' : 'Update forecast'}
                </button>
            </div>

            {data && (
                <>
                    <div style={summaryRow}>
                        <SummaryCard label="Ending balance (wk 13)" value={formatMoney(data.endingCents)} />
                        <SummaryCard
                            label="Lowest point"
                            value={formatMoney(data.minClosingCents)}
                            sub={data.minClosingWeekLabel ? `week of ${dayLabel(data.minClosingWeekLabel)}` : null}
                            danger={troughNegative}
                        />
                        <SummaryCard label="Total receipts" value={formatMoney(data.totalReceiptsCents)} />
                        <SummaryCard label="Total disbursements" value={formatMoney(data.totalDisbursementsCents)} />
                    </div>

                    {troughNegative && (
                        <div style={warnBanner}>
                            ⚠ Projected cash dips below zero{data.minClosingWeekLabel ? ` the week of ${dayLabel(data.minClosingWeekLabel)}` : ''}. Tighten budgets, pull receipts forward, or raise the balance.
                        </div>
                    )}

                    <section style={section}>
                        <h2 style={h2}>Projected closing cash</h2>
                        <LineChart data={series} color={chartColor} formatValue={formatMoneyCompact} formatLabel={dayLabel} ariaLabel="Projected closing cash over 13 weeks" />
                    </section>

                    <section style={section}>
                        <div className="admin-table-wrap"><table style={table}>
                            <thead><tr>
                                <th style={th}>Week of</th>
                                <th style={thR}>Opening</th>
                                <th style={thR}>Receipts</th>
                                <th style={thR}>Disbursements</th>
                                <th style={thR}>Net</th>
                                <th style={thR}>Closing</th>
                            </tr></thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.startMs} style={tr}>
                                        <td style={td}>{dayLabel(r.label)}</td>
                                        <td style={tdR}>{formatMoney(r.openingCents)}</td>
                                        <td style={tdR}>{formatMoney(r.receiptsCents)}</td>
                                        <td style={tdR}>{formatMoney(r.disbursementsCents)}</td>
                                        <td style={{ ...tdR, color: r.netCents < 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>{formatMoney(r.netCents)}</td>
                                        <td style={{ ...tdR, fontWeight: 700, color: r.closingCents < 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>{formatMoney(r.closingCents)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table></div>
                    </section>
                </>
            )}
        </div>
    );
}

function SummaryCard({ label, value, sub, danger }) {
    return (
        <div style={card}>
            <div style={cardLabel}>{label}</div>
            <div style={{ ...cardValue, color: danger ? 'var(--color-danger)' : 'var(--color-text)' }}>{value}</div>
            {sub && <div style={cardSub}>{sub}</div>}
        </div>
    );
}

const pageWrap = { maxWidth: 1100, margin: '0 auto', padding: 'var(--space-32)' };
const controls = { display: 'flex', gap: 'var(--space-16)', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 'var(--space-24)' };
const field = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' };
const lbl = { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)', letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase', color: 'var(--color-accent)' };
const hint = { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' };
const input = { width: 200, padding: 'var(--space-8) var(--space-12)', background: 'var(--color-bg-page)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text)', fontSize: 'var(--font-size-base)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const primaryBtn = { padding: 'var(--space-8) var(--space-16)', background: 'var(--color-accent)', color: 'var(--color-accent-on-accent)', border: 'none', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-extrabold)', letterSpacing: 'var(--letter-spacing-wider)', textTransform: 'uppercase', cursor: 'pointer' };
const summaryRow = { display: 'flex', gap: 'var(--space-16)', flexWrap: 'wrap', marginBottom: 'var(--space-16)' };
const card = { flex: '1 1 200px', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', padding: 'var(--space-16)' };
const cardLabel = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', marginBottom: 'var(--space-4)' };
const cardValue = { fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-extrabold)', fontVariantNumeric: 'tabular-nums' };
const cardSub = { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' };
const section = { background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', padding: 'var(--space-24)', marginBottom: 'var(--space-16)' };
const h2 = { fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-extrabold)', letterSpacing: 'var(--letter-spacing-wider)', color: 'var(--color-accent)', textTransform: 'uppercase', margin: '0 0 var(--space-16)' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-base)' };
const th = { textAlign: 'left', padding: 'var(--space-8) var(--space-12)', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--color-accent)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-extrabold)', letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase' };
const thR = { ...th, textAlign: 'right' };
const tr = { borderBottom: '1px solid var(--color-border-subtle)' };
const td = { padding: 'var(--space-8) var(--space-12)', color: 'var(--color-text)' };
const tdR = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const errBanner = { background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger)', color: 'var(--color-danger)', padding: 'var(--space-12)', marginBottom: 'var(--space-16)', fontSize: 'var(--font-size-base)' };
const warnBanner = { background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger)', color: 'var(--color-danger)', padding: 'var(--space-12)', marginBottom: 'var(--space-16)', fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-bold)' };

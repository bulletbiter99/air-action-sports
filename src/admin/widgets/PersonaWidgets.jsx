// M3 Batch 9 — widget components for the persona-tailored AdminDashboard.
// M4 B4b — wrapped each widget in useWidgetData for cadence-aware refresh.
//
// Each widget is a self-contained component that fetches its own data
// from existing admin endpoints via useWidgetData (src/hooks/useWidgetData.js).
// The shell (AdminDashboardPersona) renders them per the persona-keyed
// PERSONA_LAYOUTS array in personaLayouts.js. To add a widget, implement
// it here and register it in WIDGETS at the bottom; to add it to a
// persona, append the key to that persona's array in personaLayouts.js.
//
// Cadence tiers (per useWidgetData):
//   tier='static'  — fetch once on mount, no polling. Use when data is
//                    aggregate / slow-moving (RevenueSummary, CronHealth).
//   tier='live'    — 5min default → 30s on event day → 10s during check-in.
//                    Use when data shifts intra-day (TodayEvents, RecentBookings).
//
// API endpoints consumed (all admin-cookie-authenticated):
//   /api/admin/analytics/overview     → RevenueSummary
//   /api/admin/analytics/cron-status  → CronHealth
//   /api/admin/events                 → TodayEvents (client-filters to today)
//   /api/admin/bookings?limit=5       → RecentBookings

import { Link } from 'react-router-dom';
import { formatMoney } from '../../utils/money.js';
import { useWidgetData } from '../../hooks/useWidgetData.js';

// ────────────────────────────────────────────────────────────────────
// RevenueSummary — net / gross / refunded across all time
// Owner persona only (financial visibility scoped to owner role).
// ────────────────────────────────────────────────────────────────────

export function RevenueSummary() {
    const { data, error: err } = useWidgetData(
        '/api/admin/analytics/overview',
        { tier: 'static' },
    );

    return (
        <section className="admin-persona-widget admin-persona-widget--revenue">
            <h2>Revenue</h2>
            {err && <p className="admin-persona-widget__error">Error: {err}</p>}
            {!data && !err && <p className="admin-persona-widget__loading">Loading…</p>}
            {data && (
                <div className="admin-persona-widget__stats">
                    <Stat label="Net revenue" value={formatMoney(data.totals?.netRevenueCents)} highlight />
                    <Stat label="Gross" value={formatMoney(data.totals?.grossRevenueCents)} />
                    <Stat label="Refunded" value={formatMoney(data.totals?.refundedCents)} />
                    <Stat label="Avg order" value={formatMoney(data.totals?.avgOrderCents)} />
                    <Stat label="Bookings" value={data.totals?.bookings ?? 0} />
                    <Stat
                        label="Refund rate"
                        value={data.totals?.paidCount > 0
                            ? `${Math.round((data.totals.refundRate || 0) * 100)}%`
                            : '—'}
                    />
                </div>
            )}
            <Link to="/admin/analytics" className="admin-persona-widget__link">View full analytics →</Link>
        </section>
    );
}

// ────────────────────────────────────────────────────────────────────
// CronHealth — green/red strip per the same logic the legacy
// dashboard uses. Reads /api/admin/analytics/cron-status; renders
// stale (>60min) as red, fresh as green.
// ────────────────────────────────────────────────────────────────────

export function CronHealth() {
    const { data, error: err } = useWidgetData(
        '/api/admin/analytics/cron-status',
        { tier: 'static' },
    );

    const stale = data && (data.lastSweepAgeMs == null || data.lastSweepAgeMs > 60 * 60 * 1000);
    const status = err ? 'error' : !data ? 'loading' : stale ? 'stale' : 'fresh';

    return (
        <section className={`admin-persona-widget admin-persona-widget--cron admin-persona-widget--cron-${status}`}>
            <h2>Reminder cron</h2>
            {err && <p className="admin-persona-widget__error">Error: {err}</p>}
            {!data && !err && <p className="admin-persona-widget__loading">Loading…</p>}
            {data && (
                <div>
                    <p className="admin-persona-widget__cron-line">
                        <strong>{stale ? 'STALE' : 'OK'}</strong>
                        {' '}— last sweep {formatAge(data.lastSweepAgeMs)} ago
                    </p>
                    <p className="admin-persona-widget__cron-line admin-persona-widget__muted">
                        24h reminders sent: {data.last24hReminders24hCount ?? 0} ·
                        {' '}1h reminders: {data.last24hReminders1hCount ?? 0}
                    </p>
                </div>
            )}
        </section>
    );
}

// ────────────────────────────────────────────────────────────────────
// TodayEvents — events scheduled for today's date with quick links.
// Manager + staff personas use this for event-day prep.
// ────────────────────────────────────────────────────────────────────

export function TodayEvents() {
    const { data: rawData, error: err } = useWidgetData(
        '/api/admin/events',
        { tier: 'live' },
    );
    // Client-side filter to today; data refreshes on cadence-driven re-fetch
    // so the filter stays current as the day rolls.
    const today = ymdLocal(new Date());
    const events = rawData
        ? (rawData.events || []).filter((e) => {
            if (!e.dateIso) return false;
            return ymdLocal(new Date(e.dateIso)) === today;
        })
        : null;

    return (
        <section className="admin-persona-widget admin-persona-widget--events">
            <h2>Today's events</h2>
            {err && <p className="admin-persona-widget__error">Error: {err}</p>}
            {!events && !err && <p className="admin-persona-widget__loading">Loading…</p>}
            {events && events.length === 0 && (
                <p className="admin-persona-widget__empty">No events today.</p>
            )}
            {events && events.length > 0 && (
                <ul className="admin-persona-widget__list">
                    {events.map((e) => (
                        <li key={e.id} className="admin-persona-widget__event">
                            <strong>{e.title}</strong>
                            <span className="admin-persona-widget__muted">
                                {' '}· {e.location || 'TBA'}{e.timeRange ? ` · ${e.timeRange}` : ''}
                            </span>
                            <div className="admin-persona-widget__event-links">
                                <Link to={`/admin/roster?event=${encodeURIComponent(e.id)}`}>Roster</Link>
                                <Link to="/admin/scan">Scan</Link>
                                <Link to="/admin/rentals/assignments">Rentals</Link>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

// ────────────────────────────────────────────────────────────────────
// RecentBookings — last 5 bookings across all events. Status pills
// match the AdminCustomers.jsx style for visual consistency.
// ────────────────────────────────────────────────────────────────────

export function RecentBookings() {
    const { data: rawData, error: err } = useWidgetData(
        '/api/admin/bookings?limit=5',
        { tier: 'live' },
    );
    const bookings = rawData ? (rawData.bookings || []) : null;

    return (
        <section className="admin-persona-widget admin-persona-widget--bookings">
            <h2>Recent bookings</h2>
            {err && <p className="admin-persona-widget__error">Error: {err}</p>}
            {!bookings && !err && <p className="admin-persona-widget__loading">Loading…</p>}
            {bookings && bookings.length === 0 && (
                <p className="admin-persona-widget__empty">No bookings yet.</p>
            )}
            {bookings && bookings.length > 0 && (
                <table className="admin-persona-widget__table">
                    <thead>
                        <tr>
                            <th>Buyer</th>
                            <th>Status</th>
                            <th className="admin-persona-widget__num">Total</th>
                            <th>When</th>
                        </tr>
                    </thead>
                    <tbody>
                        {bookings.map((b) => (
                            <tr key={b.id}>
                                <td>{b.fullName || b.email || <em>—</em>}</td>
                                <td><StatusPill status={b.status} /></td>
                                <td className="admin-persona-widget__num">{formatMoney(b.totalCents)}</td>
                                <td>{formatRelative(b.createdAt)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}

// ────────────────────────────────────────────────────────────────────
// Shared small components
// ────────────────────────────────────────────────────────────────────

function Stat({ label, value, highlight = false }) {
    return (
        <div className={highlight ? 'admin-persona-widget__stat admin-persona-widget__stat--highlight' : 'admin-persona-widget__stat'}>
            <div className="admin-persona-widget__stat-label">{label}</div>
            <div className="admin-persona-widget__stat-value">{value ?? '—'}</div>
        </div>
    );
}

function StatusPill({ status }) {
    const cls = `admin-persona-widget__pill admin-persona-widget__pill--${status || 'unknown'}`;
    return <span className={cls}>{status || '—'}</span>;
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function ymdLocal(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatRelative(ms) {
    if (!ms) return '—';
    const diff = Date.now() - Number(ms);
    const sec = Math.round(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day}d ago`;
    try {
        return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return '—';
    }
}

function formatAge(ms) {
    if (ms == null) return 'unknown';
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h`;
    return `${Math.round(hr / 24)}d`;
}

// ────────────────────────────────────────────────────────────────────
// Widget registry. Keys mirror the entries in personaLayouts.js.
// ────────────────────────────────────────────────────────────────────

export const WIDGETS = {
    RevenueSummary,
    CronHealth,
    TodayEvents,
    RecentBookings,
};

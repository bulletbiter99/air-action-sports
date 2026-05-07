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
import { useWidgetData, useTodayActive } from '../../hooks/useWidgetData.js';

// ────────────────────────────────────────────────────────────────────
// RevenueSummary — net / gross / refunded scoped to current month
// (M4 B4d added ?period=mtd; pre-B4d was lifetime).
// Owner persona only (financial visibility scoped to owner role).
// ────────────────────────────────────────────────────────────────────

export function RevenueSummary() {
    const { data, error: err } = useWidgetData(
        '/api/admin/analytics/overview?period=mtd',
        { tier: 'static' },
    );

    return (
        <section className="admin-persona-widget admin-persona-widget--revenue">
            <h2>Revenue (this month)</h2>
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
// M4 B4c — Booking Coordinator persona widgets
// ────────────────────────────────────────────────────────────────────

// BookingCoordinatorKPIs — 4-stat grid for the BC persona's
// at-a-glance summary. Reuses /api/admin/analytics/overview (already
// shared with RevenueSummary; same URL deduped at the edge) + a count
// of bookings with pending refunds. tier='live' so it auto-promotes
// to 30s polling on event days.
//
// KPI selections in B4c are pragmatic — a future B4d combined endpoint
// (/api/admin/dashboard/kpis) can refine to the audit's exact "New today /
// Needs action / Refund queue / Walk-ups today" without touching this
// widget's render shape.
export function BookingCoordinatorKPIs() {
    const { data: overview, error: overviewErr } = useWidgetData(
        '/api/admin/analytics/overview',
        { tier: 'live' },
    );
    const { data: refundQueue } = useWidgetData(
        '/api/admin/bookings?has_refund=true&status=paid&limit=1',
        { tier: 'live' },
    );

    const totals = overview?.totals;
    const refundCount = refundQueue?.total ?? 0;

    return (
        <section className="admin-persona-widget admin-persona-widget--bc-kpis">
            <h2>At a glance</h2>
            {overviewErr && <p className="admin-persona-widget__error">Error: {overviewErr}</p>}
            {!totals && !overviewErr && <p className="admin-persona-widget__loading">Loading…</p>}
            {totals && (
                <div className="admin-persona-widget__stats">
                    <Stat label="Bookings" value={totals.bookings ?? 0} highlight />
                    <Stat label="Pending refunds" value={refundCount} />
                    <Stat label="Attendees" value={totals.attendees ?? 0} />
                    <Stat label="Checked in" value={totals.checkedIn ?? 0} />
                </div>
            )}
        </section>
    );
}

// BookingsNeedingAction — paid bookings with missing waivers. The BC
// triages these every morning. Compact 4-row table with a "View all"
// link to /admin/bookings?waiver_status=missing for the full list.
export function BookingsNeedingAction() {
    const { data, error: err } = useWidgetData(
        '/api/admin/bookings?waiver_status=missing&status=paid&limit=4',
        { tier: 'live' },
    );
    const bookings = data ? (data.bookings || []) : null;

    return (
        <section className="admin-persona-widget admin-persona-widget--needs-action">
            <h2>Needs action</h2>
            {err && <p className="admin-persona-widget__error">Error: {err}</p>}
            {!bookings && !err && <p className="admin-persona-widget__loading">Loading…</p>}
            {bookings && bookings.length === 0 && (
                <p className="admin-persona-widget__empty">All caught up — no missing waivers.</p>
            )}
            {bookings && bookings.length > 0 && (
                <table className="admin-persona-widget__table">
                    <thead>
                        <tr>
                            <th>Buyer</th>
                            <th>Total</th>
                            <th>Issue</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {bookings.map((b) => (
                            <tr key={b.id}>
                                <td>{b.fullName || b.email || <em>—</em>}</td>
                                <td className="admin-persona-widget__num">{formatMoney(b.totalCents)}</td>
                                <td><span className="admin-persona-widget__pill admin-persona-widget__pill--pending">Waiver missing</span></td>
                                <td className="admin-persona-widget__num">
                                    <Link to={`/admin/bookings/${encodeURIComponent(b.id)}`}>Open →</Link>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            <Link
                to="/admin/bookings?waiver_status=missing&status=paid"
                className="admin-persona-widget__link"
            >
                View all →
            </Link>
        </section>
    );
}

// TodayCheckIns — gates render on /api/admin/today/active (B4b). When
// activeEventToday=true, fetches today's events + total attendee count
// from /api/admin/analytics/overview. Polls at 30s during event-day
// (current /today/active stub returns checkInOpen=false; B4d wires the
// real check-in window so this widget hits the 10s tier).
export function TodayCheckIns() {
    const todayActive = useTodayActive();
    const { data: rawEvents, error: eventsErr } = useWidgetData(
        '/api/admin/events',
        { tier: 'live' },
    );
    const { data: overview } = useWidgetData(
        '/api/admin/analytics/overview',
        { tier: 'live' },
    );

    const today = ymdLocal(new Date());
    const todaysEvents = rawEvents
        ? (rawEvents.events || []).filter((e) => e.dateIso && ymdLocal(new Date(e.dateIso)) === today)
        : null;

    const isActiveDay = todayActive?.activeEventToday;
    const totals = overview?.totals;
    const checkedIn = totals?.checkedIn ?? 0;
    const attendees = totals?.attendees ?? 0;

    return (
        <section className="admin-persona-widget admin-persona-widget--today-checkins">
            <h2>Today's check-ins</h2>
            {eventsErr && <p className="admin-persona-widget__error">Error: {eventsErr}</p>}
            {!isActiveDay && (
                <p className="admin-persona-widget__empty">No events today.</p>
            )}
            {isActiveDay && !todaysEvents && (
                <p className="admin-persona-widget__loading">Loading…</p>
            )}
            {isActiveDay && todaysEvents && (
                <>
                    <div className="admin-persona-widget__stats">
                        <Stat
                            label="Checked in"
                            value={`${checkedIn} / ${attendees}`}
                            highlight
                        />
                        <Stat label="Events today" value={todaysEvents.length} />
                    </div>
                    {todaysEvents.length > 0 && (
                        <ul className="admin-persona-widget__list">
                            {todaysEvents.map((e) => (
                                <li key={e.id} className="admin-persona-widget__event">
                                    <strong>{e.title}</strong>
                                    {e.timeRange && (
                                        <span className="admin-persona-widget__muted"> · {e.timeRange}</span>
                                    )}
                                    <div className="admin-persona-widget__event-links">
                                        <Link to={`/admin/scan?event=${encodeURIComponent(e.id)}`}>Scan</Link>
                                        <Link to={`/admin/roster?event=${encodeURIComponent(e.id)}`}>Roster</Link>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </section>
    );
}

// QuickActions — 4-tile grid of high-frequency BC operations. Pure
// static link grid; no fetching. Cadence-irrelevant.
export function QuickActions() {
    return (
        <section className="admin-persona-widget admin-persona-widget--quick-actions">
            <h2>Quick actions</h2>
            <div className="admin-persona-widget__tiles">
                <Link to="/admin/new-booking" className="admin-persona-widget__tile">
                    <span className="admin-persona-widget__tile-label">+ New booking</span>
                </Link>
                <Link to="/admin/scan" className="admin-persona-widget__tile">
                    <span className="admin-persona-widget__tile-label">Scan ticket</span>
                </Link>
                <Link to="/admin/roster" className="admin-persona-widget__tile">
                    <span className="admin-persona-widget__tile-label">Roster</span>
                </Link>
                <Link to="/admin/rentals/assignments" className="admin-persona-widget__tile">
                    <span className="admin-persona-widget__tile-label">Rentals</span>
                </Link>
            </div>
        </section>
    );
}

// RecentFeedback — last 5 unresolved feedback items. Polls live so
// new submissions surface within 30s on event day. Each row links to
// /admin/feedback/:id for triage.
export function RecentFeedback() {
    const { data, error: err } = useWidgetData(
        '/api/admin/feedback?status=new&limit=5',
        { tier: 'live' },
    );
    const items = data ? (data.items || []) : null;

    return (
        <section className="admin-persona-widget admin-persona-widget--recent-feedback">
            <h2>Recent feedback</h2>
            {err && <p className="admin-persona-widget__error">Error: {err}</p>}
            {!items && !err && <p className="admin-persona-widget__loading">Loading…</p>}
            {items && items.length === 0 && (
                <p className="admin-persona-widget__empty">No new feedback.</p>
            )}
            {items && items.length > 0 && (
                <ul className="admin-persona-widget__list">
                    {items.map((it) => (
                        <li key={it.id} className="admin-persona-widget__feedback-item">
                            <div>
                                <strong>{it.title || it.type || 'Untitled'}</strong>
                                {it.priority && (
                                    <span className={`admin-persona-widget__pill admin-persona-widget__pill--${priorityClass(it.priority)}`}>
                                        {it.priority}
                                    </span>
                                )}
                            </div>
                            <div className="admin-persona-widget__muted">
                                {it.email || 'Anonymous'} · {formatRelative(it.createdAt)}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <Link to="/admin/feedback?status=new" className="admin-persona-widget__link">
                View all →
            </Link>
        </section>
    );
}

function priorityClass(priority) {
    if (priority === 'critical' || priority === 'high') return 'refunded'; // red-ish
    if (priority === 'medium') return 'pending';                            // amber
    return 'comp';                                                          // blue (low / default)
}

// ────────────────────────────────────────────────────────────────────
// M4 B4d — Owner persona extension widgets
// ────────────────────────────────────────────────────────────────────

// UpcomingEventsReadiness — top-3 upcoming events with capacity and
// waiver readiness bars. Owner uses this for "do we need to push
// promo?" decisions (low capacity %) and "who needs to chase waivers?"
// (low waiver %). tier='live' so the bars stay current as bookings come in.
export function UpcomingEventsReadiness() {
    const { data, error: err } = useWidgetData(
        '/api/admin/dashboard/upcoming-readiness',
        { tier: 'live' },
    );
    const events = data ? (data.events || []) : null;

    return (
        <section className="admin-persona-widget admin-persona-widget--upcoming-readiness">
            <h2>Upcoming readiness</h2>
            {err && <p className="admin-persona-widget__error">Error: {err}</p>}
            {!events && !err && <p className="admin-persona-widget__loading">Loading…</p>}
            {events && events.length === 0 && (
                <p className="admin-persona-widget__empty">No upcoming events.</p>
            )}
            {events && events.length > 0 && (
                <ul className="admin-persona-widget__list">
                    {events.map((e) => (
                        <li key={e.eventId} className="admin-persona-widget__readiness-row">
                            <div className="admin-persona-widget__readiness-head">
                                <strong>{e.title}</strong>
                                <span className="admin-persona-widget__muted"> · {e.dateIso}</span>
                            </div>
                            <CapacityBar
                                label="Capacity"
                                pct={e.capacityPct}
                                detail={`${e.paidCount} / ${e.totalSlots}`}
                            />
                            <CapacityBar
                                label="Waivers"
                                pct={e.waiverPct}
                                detail={`${e.waiverSignedCount} / ${e.attendeeCount}`}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

// ActionQueue — 4-stat grid of items needing owner attention with deep
// links into the relevant admin page. tier='live' to surface new items
// as they arrive during the day.
export function ActionQueue() {
    const { data, error: err } = useWidgetData(
        '/api/admin/dashboard/action-queue',
        { tier: 'live' },
    );

    return (
        <section className="admin-persona-widget admin-persona-widget--action-queue">
            <h2>Action queue</h2>
            {err && <p className="admin-persona-widget__error">Error: {err}</p>}
            {!data && !err && <p className="admin-persona-widget__loading">Loading…</p>}
            {data && (
                <div className="admin-persona-widget__action-queue-stats">
                    <ActionQueueStat
                        label="Missing waivers"
                        count={data.missingWaiversCount}
                        href="/admin/bookings?waiver_status=missing&status=paid"
                    />
                    <ActionQueueStat
                        label="Pending countersigns"
                        count={data.pendingVendorCountersignsCount}
                        href="/admin/vendors"
                    />
                    <ActionQueueStat
                        label="New feedback"
                        count={data.feedbackUntriagedCount}
                        href="/admin/feedback?status=new"
                    />
                    <ActionQueueStat
                        label="Refunds (7d)"
                        count={data.recentRefundsCount}
                        href="/admin/bookings?has_refund=true"
                    />
                </div>
            )}
        </section>
    );
}

function ActionQueueStat({ label, count, href }) {
    const isAction = (count || 0) > 0;
    return (
        <Link
            to={href}
            className={`admin-persona-widget__action-stat${isAction ? ' admin-persona-widget__action-stat--active' : ''}`}
        >
            <div className="admin-persona-widget__action-stat-count">{count ?? 0}</div>
            <div className="admin-persona-widget__action-stat-label">{label}</div>
        </Link>
    );
}

// CapacityBar — small reusable progress bar for percentages. Used by
// UpcomingEventsReadiness; could be reused by future readiness widgets.
function CapacityBar({ label, pct, detail }) {
    const safe = Math.max(0, Math.min(100, pct || 0));
    return (
        <div className="admin-persona-widget__capacity-bar">
            <div className="admin-persona-widget__capacity-bar-head">
                <span className="admin-persona-widget__capacity-bar-label">{label}</span>
                <span className="admin-persona-widget__muted">{detail} · {safe}%</span>
            </div>
            <div className="admin-persona-widget__capacity-bar-track">
                <div
                    className="admin-persona-widget__capacity-bar-fill"
                    style={{ width: `${safe}%` }}
                />
            </div>
        </div>
    );
}

// RecentActivity — last 10 audit log entries. Reuses /api/admin/audit-log
// which is owner+manager gated; safe since RecentActivity only renders
// in the owner persona layout. tier='live' for owner pulse-of-ops view.
export function RecentActivity() {
    const { data, error: err } = useWidgetData(
        '/api/admin/audit-log?limit=10',
        { tier: 'live' },
    );
    const entries = data ? (data.entries || []) : null;

    return (
        <section className="admin-persona-widget admin-persona-widget--recent-activity">
            <h2>Recent activity</h2>
            {err && <p className="admin-persona-widget__error">Error: {err}</p>}
            {!entries && !err && <p className="admin-persona-widget__loading">Loading…</p>}
            {entries && entries.length === 0 && (
                <p className="admin-persona-widget__empty">No recent activity.</p>
            )}
            {entries && entries.length > 0 && (
                <ul className="admin-persona-widget__list">
                    {entries.map((e) => (
                        <li key={e.id} className="admin-persona-widget__activity-item">
                            <div>
                                <strong>{e.action}</strong>
                                {e.targetType && (
                                    <span className="admin-persona-widget__muted"> · {e.targetType}</span>
                                )}
                            </div>
                            <div className="admin-persona-widget__muted">
                                {e.userName || e.userEmail || 'system'} · {formatRelative(e.createdAt)}
                            </div>
                        </li>
                    ))}
                </ul>
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
    // M4 B4c — Booking Coordinator persona widgets
    BookingCoordinatorKPIs,
    BookingsNeedingAction,
    TodayCheckIns,
    QuickActions,
    RecentFeedback,
    // M4 B4d — Owner persona extension widgets
    UpcomingEventsReadiness,
    ActionQueue,
    RecentActivity,
};

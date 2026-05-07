// M4 Batch 2b — dedicated /admin/bookings list page (Surface 2).
//
// Replaces the inline bookings table that lived on the legacy AdminDashboard.
// Per the M4 plan, B5 will add the sidebar nav entry; for now the page is
// reachable by direct URL.
//
// What's here in B2b:
//   - 4 quick-filter chips (All / Needs action / Pending payment / Refund queue)
//   - Date-range row (ad-hoc, two date inputs — date-type FilterBar support is
//     a placeholder per M2; revisit when FilterBar gains date support)
//   - FilterBar with 3 enum filters (status, payment method, waiver status) +
//     search + saved-views dropdown (M4 B2a D1-backed hook)
//   - Bulk action toolbar (visible when rows selected): Resend confirmation,
//     Resend waiver request — manager+ only
//   - Export CSV — manager+ only; filter-scoped (NOT selection-scoped) per
//     M4 prompt; downloads the full filter result up to 10k rows
//   - Pagination (50/page; offset-based, matches the API)
//
// Detail view (`/admin/bookings/:id`) is B3's territory; the View button
// here will 404 until B3 ships.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import FilterBar from '../components/admin/FilterBar.jsx';
import { formatMoney } from '../utils/money.js';
import './AdminBookings.css';

const STATUS_OPTIONS = [
    { value: 'paid', label: 'Paid' },
    { value: 'pending', label: 'Pending' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'refunded', label: 'Refunded' },
    { value: 'comp', label: 'Comp' },
];

const PAYMENT_METHOD_OPTIONS = [
    { value: 'card', label: 'Card' },
    { value: 'cash', label: 'Cash' },
    { value: 'venmo', label: 'Venmo' },
    { value: 'paypal', label: 'PayPal' },
    { value: 'comp', label: 'Comp' },
];

const WAIVER_STATUS_OPTIONS = [
    { value: 'complete', label: 'Complete (all signed)' },
    { value: 'missing', label: 'Missing (none signed)' },
    { value: 'partial', label: 'Partial (some signed)' },
];

const FILTER_SCHEMA = [
    { key: 'status', label: 'Status', type: 'enum', options: STATUS_OPTIONS },
    { key: 'payment_method', label: 'Payment method', type: 'enum', options: PAYMENT_METHOD_OPTIONS },
    { key: 'waiver_status', label: 'Waiver status', type: 'enum', options: WAIVER_STATUS_OPTIONS },
];

// 4 quick-filter shortcuts per the M4 milestone prompt. The original prompt
// said "Refund queue" should be `refund_requested = true AND status != refunded`,
// but `refund_requested` is not a column today (introduced in B3 with
// migration 0027). For B2b, "Refund queue" maps to `status = refunded` —
// already-refunded bookings the operator may want to review. The semantics
// will tighten in B3 when the refund-requested workflow ships.
const QUICK_FILTERS = [
    { id: 'all',             label: 'All bookings',     filters: {}, dateFromShift: null },
    { id: 'needs-action',    label: 'Needs action',     filters: { waiver_status: 'missing', status: 'paid' }, dateFromShift: null },
    { id: 'pending-payment', label: 'Pending payment',  filters: { status: 'pending' }, dateFromShift: 24 * 60 * 60 * 1000 },
    { id: 'refund-queue',    label: 'Refund queue',     filters: { status: 'refunded' }, dateFromShift: null },
];

const PAGE_SIZE = 50;

export default function AdminBookings() {
    const { isAuthenticated, hasRole } = useAdmin();
    const navigate = useNavigate();

    const [filters, setFilters] = useState({});
    const [search, setSearch] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [bookings, setBookings] = useState([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [activeQuickFilter, setActiveQuickFilter] = useState('all');
    const [bulkActionMsg, setBulkActionMsg] = useState(null);

    // Reset pagination + selection whenever filters change so the user
    // sees fresh page-1 results and doesn't carry stale selection across
    // a different filter result set.
    useEffect(() => { setOffset(0); setSelectedIds(new Set()); }, [filters, search, dateFrom, dateTo]);

    const queryParams = useMemo(() => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(filters)) {
            if (value !== undefined && value !== null && value !== '') {
                params.set(key, String(value));
            }
        }
        if (search) params.set('q', search);
        if (dateFrom) params.set('from', String(new Date(dateFrom).getTime()));
        // dateTo is inclusive of the day — extend to end-of-day so a same-day
        // booking matches when from=date and to=date.
        if (dateTo) params.set('to', String(new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1));
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(offset));
        return params;
    }, [filters, search, dateFrom, dateTo, offset]);

    const loadBookings = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/bookings?${queryParams}`, {
                credentials: 'include', cache: 'no-store',
            });
            if (res.ok) {
                const data = await res.json();
                setBookings(data.bookings || []);
                setTotal(data.total || 0);
            }
        } finally {
            setLoading(false);
        }
    }, [queryParams]);

    useEffect(() => { if (isAuthenticated) loadBookings(); }, [isAuthenticated, loadBookings]);

    function applyQuickFilter(qf) {
        setActiveQuickFilter(qf.id);
        setFilters({ ...qf.filters });
        if (qf.dateFromShift) {
            const d = new Date(Date.now() - qf.dateFromShift);
            setDateFrom(d.toISOString().slice(0, 10));
        } else {
            setDateFrom('');
        }
        setDateTo('');
        setSearch('');
    }

    // Detect when the user manually changed filters away from a quick-filter
    // preset — flip the active chip to "all" so the highlighted state is honest.
    useEffect(() => {
        if (activeQuickFilter === 'all') return;
        // Naive: if any filter doesn't match the active quick-filter's filters,
        // assume the user diverged. This is good enough for chip highlighting.
        const qf = QUICK_FILTERS.find((q) => q.id === activeQuickFilter);
        if (!qf) return;
        for (const [key, value] of Object.entries(qf.filters)) {
            if (filters[key] !== value) {
                setActiveQuickFilter('all');
                return;
            }
        }
        for (const key of Object.keys(filters)) {
            if (filters[key] && !(key in qf.filters)) {
                setActiveQuickFilter('all');
                return;
            }
        }
    }, [filters, activeQuickFilter]);

    function toggleRow(id) {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelectedIds(next);
    }

    function selectAllOnPage() {
        setSelectedIds(new Set(bookings.map((b) => b.id)));
    }

    function clearSelection() {
        setSelectedIds(new Set());
    }

    function flashBulkMsg(kind, text, ms = 5000) {
        setBulkActionMsg({ kind, text });
        setTimeout(() => setBulkActionMsg(null), ms);
    }

    async function bulkResendConfirmation() {
        if (selectedIds.size === 0) return;
        setBulkActionMsg({ kind: 'pending', text: 'Sending…' });
        try {
            const res = await fetch('/api/admin/bookings/bulk/resend-confirmation', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingIds: [...selectedIds] }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                flashBulkMsg('ok', `Sent ${data.sent}, skipped ${data.skipped}, failed ${data.failed}`);
            } else {
                flashBulkMsg('err', data.error || 'Failed');
            }
        } catch (err) {
            flashBulkMsg('err', err?.message || 'Network error');
        }
    }

    async function bulkResendWaiverRequest() {
        if (selectedIds.size === 0) return;
        setBulkActionMsg({ kind: 'pending', text: 'Sending…' });
        try {
            const res = await fetch('/api/admin/bookings/bulk/resend-waiver-request', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingIds: [...selectedIds] }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                flashBulkMsg('ok', `Sent ${data.sent} waiver request${data.sent === 1 ? '' : 's'}, skipped ${data.skipped} (already signed), failed ${data.failed}`);
            } else {
                flashBulkMsg('err', data.error || 'Failed');
            }
        } catch (err) {
            flashBulkMsg('err', err?.message || 'Network error');
        }
    }

    function exportCsv() {
        const params = new URLSearchParams(queryParams);
        params.delete('limit');
        params.delete('offset');
        // Browser-driven download. Content-Disposition on the response sets
        // the filename; we rely on the browser to handle the GET + download.
        window.location.href = `/api/admin/bookings/export.csv?${params}`;
    }

    if (!isAuthenticated) return null;

    const allOnPageSelected = bookings.length > 0 && bookings.every((b) => selectedIds.has(b.id));
    const canBulkAction = hasRole?.('manager');

    return (
        <div className="admin-bookings">
            <header className="admin-bookings__header">
                <h1>Bookings</h1>
                {hasRole?.('manager') && (
                    <Link to="/admin/new-booking" className="admin-bookings__cta">+ New Booking</Link>
                )}
            </header>

            <div className="admin-bookings__quick-filters">
                {QUICK_FILTERS.map((qf) => (
                    <button
                        key={qf.id}
                        type="button"
                        className={`admin-bookings__quick-chip${activeQuickFilter === qf.id ? ' admin-bookings__quick-chip--active' : ''}`}
                        onClick={() => applyQuickFilter(qf)}
                    >
                        {qf.label}
                    </button>
                ))}
            </div>

            <div className="admin-bookings__date-range">
                <label>
                    From <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </label>
                <label>
                    To <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </label>
                {(dateFrom || dateTo) && (
                    <button
                        type="button"
                        className="admin-bookings__date-clear"
                        onClick={() => { setDateFrom(''); setDateTo(''); }}
                    >
                        Clear dates
                    </button>
                )}
            </div>

            <FilterBar
                schema={FILTER_SCHEMA}
                value={filters}
                onChange={setFilters}
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search name or email…"
                resultCount={total}
                savedViewsKey="adminBookings"
            />

            {bulkActionMsg && (
                <div className={`admin-bookings__bulk-msg admin-bookings__bulk-msg--${bulkActionMsg.kind}`}>
                    {bulkActionMsg.text}
                </div>
            )}

            {selectedIds.size > 0 && canBulkAction && (
                <div className="admin-bookings__bulk-toolbar">
                    <span className="admin-bookings__bulk-count">{selectedIds.size} selected</span>
                    <button type="button" onClick={bulkResendConfirmation}>Resend confirmation</button>
                    <button type="button" onClick={bulkResendWaiverRequest}>Resend waiver request</button>
                    <button type="button" onClick={clearSelection} className="admin-bookings__bulk-clear">Clear</button>
                </div>
            )}

            {canBulkAction && (
                <div className="admin-bookings__export">
                    <button type="button" onClick={exportCsv}>Export CSV (current filter)</button>
                </div>
            )}

            <div className="admin-bookings__table-wrap">
                <table className="admin-bookings__table">
                    <thead>
                        <tr>
                            {canBulkAction && (
                                <th className="admin-bookings__col-check">
                                    <input
                                        type="checkbox"
                                        checked={allOnPageSelected}
                                        onChange={(e) => e.target.checked ? selectAllOnPage() : clearSelection()}
                                        aria-label="Select all on page"
                                    />
                                </th>
                            )}
                            <th>Created</th>
                            <th>Buyer</th>
                            <th>Email</th>
                            <th className="admin-bookings__num">Players</th>
                            <th className="admin-bookings__num">Total</th>
                            <th>Method</th>
                            <th>Status</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={canBulkAction ? 9 : 8} className="admin-bookings__loading">Loading…</td></tr>
                        )}
                        {!loading && bookings.length === 0 && (
                            <tr><td colSpan={canBulkAction ? 9 : 8} className="admin-bookings__empty">No bookings match the current filter.</td></tr>
                        )}
                        {!loading && bookings.map((b) => (
                            <tr key={b.id}>
                                {canBulkAction && (
                                    <td className="admin-bookings__col-check">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(b.id)}
                                            onChange={() => toggleRow(b.id)}
                                            aria-label={`Select booking ${b.id}`}
                                        />
                                    </td>
                                )}
                                <td>{b.createdAt ? new Date(b.createdAt).toLocaleString() : '—'}</td>
                                <td><strong>{b.fullName || '—'}</strong></td>
                                <td>{b.email || '—'}</td>
                                <td className="admin-bookings__num">{b.playerCount ?? '—'}</td>
                                <td className="admin-bookings__num">{formatMoney(b.totalCents)}</td>
                                <td>{b.paymentMethod || '—'}</td>
                                <td>
                                    <span className={`admin-bookings__status admin-bookings__status--${b.status || 'unknown'}`}>{b.status || '—'}</span>
                                </td>
                                <td>
                                    <button type="button" className="admin-bookings__view" onClick={() => navigate(`/admin/bookings/${b.id}`)}>View</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {total > PAGE_SIZE && (
                <div className="admin-bookings__pagination">
                    <button
                        type="button"
                        disabled={offset === 0}
                        onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    >
                        ← Prev
                    </button>
                    <span className="admin-bookings__page-info">
                        {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
                    </span>
                    <button
                        type="button"
                        disabled={offset + PAGE_SIZE >= total}
                        onClick={() => setOffset(offset + PAGE_SIZE)}
                    >
                        Next →
                    </button>
                </div>
            )}
        </div>
    );
}

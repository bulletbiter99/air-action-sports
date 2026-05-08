// M3 Batch 8b — admin customers list page.
//
// Backed by GET /api/admin/customers (B8a). Uses M2's FilterBar primitive
// for search + archived filter. M4 B12b removed the customers_entity
// flag gate — page is now always live.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import FilterBar from '../components/admin/FilterBar';
import { formatMoney } from '../utils/money.js';
import './AdminCustomers.css';

const FILTER_SCHEMA = [
    {
        key: 'archived',
        label: 'Status',
        type: 'enum',
        options: [
            { value: 'false', label: 'Active' },
            { value: 'true',  label: 'Archived' },
            { value: 'all',   label: 'All' },
        ],
    },
];

const PAGE_SIZE = 50;

export default function AdminCustomers() {
    const [filters, setFilters] = useState({ archived: 'false' });
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const [data, setData] = useState({ total: 0, customers: [] });
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);

    const archivedParam = filters.archived || 'false';

    const fetchPage = useCallback(async () => {
        setLoading(true);
        setErr(null);
        const params = new URLSearchParams();
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(page * PAGE_SIZE));
        params.set('archived', archivedParam);
        if (search.trim()) params.set('q', search.trim());
        try {
            const res = await fetch(`/api/admin/customers?${params.toString()}`, {
                credentials: 'include',
                cache: 'no-store',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            setData({ total: json.total || 0, customers: json.customers || [] });
        } catch (e) {
            setErr(String(e.message || e));
        } finally {
            setLoading(false);
        }
    }, [page, archivedParam, search]);

    // Refetch when filters/search/page change. Debounce search lightly so
    // typing doesn't fire a request per keystroke.
    useEffect(() => {
        const t = setTimeout(fetchPage, 250);
        return () => clearTimeout(t);
    }, [fetchPage]);

    // Reset to page 0 when filters/search change so we don't end up
    // showing an "empty page 7" state after narrowing the result set.
    useEffect(() => { setPage(0); }, [archivedParam, search]);

    const totalPages = useMemo(() => Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE)), [data.total]);

    return (
        <div className="admin-customers">
            <header className="admin-customers__header">
                <h1>Customers</h1>
                <p className="admin-customers__subtitle">
                    {data.total} {data.total === 1 ? 'customer' : 'customers'}
                </p>
            </header>

            <FilterBar
                schema={FILTER_SCHEMA}
                value={filters}
                onChange={setFilters}
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search by email or name…"
                resultCount={data.total}
                savedViewsKey="adminCustomers"
            />

            {err && <p className="admin-customers__error">Error: {err}</p>}

            <div className="admin-customers__table-wrap">
                <table className="admin-customers__table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th className="admin-customers__num">Bookings</th>
                            <th className="admin-customers__num">Attendees</th>
                            <th className="admin-customers__num">LTV</th>
                            <th className="admin-customers__num">Refunds</th>
                            <th>Last booking</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={8} className="admin-customers__loading">Loading…</td></tr>
                        )}
                        {!loading && data.customers.length === 0 && (
                            <tr><td colSpan={8} className="admin-customers__empty">No customers match.</td></tr>
                        )}
                        {!loading && data.customers.map((c) => (
                            <tr key={c.id} className={c.archivedAt ? 'admin-customers__row admin-customers__row--archived' : 'admin-customers__row'}>
                                <td>
                                    <Link to={`/admin/customers/${c.id}`} className="admin-customers__name-link">
                                        {c.name || <em>(no name)</em>}
                                    </Link>
                                </td>
                                <td className="admin-customers__email">{c.email || <em>—</em>}</td>
                                <td className="admin-customers__num">{c.totalBookings}</td>
                                <td className="admin-customers__num">{c.totalAttendees}</td>
                                <td className="admin-customers__num">{formatMoney(c.lifetimeValueCents)}</td>
                                <td className="admin-customers__num">{c.refundCount}</td>
                                <td>{c.lastBookingAt ? formatDate(c.lastBookingAt) : '—'}</td>
                                <td>
                                    {c.archivedAt ? (
                                        <span className="admin-customers__pill admin-customers__pill--archived">
                                            {c.archivedReason || 'archived'}
                                        </span>
                                    ) : (
                                        <span className="admin-customers__pill admin-customers__pill--active">active</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {totalPages > 1 && (
                <div className="admin-customers__pager">
                    <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                        ← Prev
                    </button>
                    <span>Page {page + 1} of {totalPages}</span>
                    <button type="button" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                        Next →
                    </button>
                </div>
            )}
        </div>
    );
}

function formatDate(ms) {
    try {
        return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return '—';
    }
}

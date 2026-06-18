// M5.5 Batch 8 — Field Rentals list page. Backed by GET /api/admin/field-rentals.
//
// Renders a table of field rentals with filter chips + free-text search. Click
// row → /admin/field-rentals/:id. "+ New Rental" → /admin/field-rentals/new.
// Inline styles match the M5+ AdminSites / AdminSiteDetail convention.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import FilterBar from '../components/admin/FilterBar.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';

// ────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ────────────────────────────────────────────────────────────────────

export const STATUS_OPTIONS = [
    'lead', 'draft', 'sent', 'agreed', 'paid', 'completed', 'cancelled', 'refunded',
];
export const ENGAGEMENT_TYPES = [
    'private_skirmish', 'paintball', 'tactical_training', 'film_shoot',
    'corporate', 'youth_program', 'other',
];
export const COI_STATUSES = ['not_required', 'pending', 'received', 'expired'];
export const ARCHIVED_OPTIONS = ['active', 'archived', 'all'];

/**
 * Maps a field-rental status to a badge label, color, and ordinal severity.
 * Severity is used only for sorting helpers in this file; consumers don't
 * inspect it.
 */
export function classifyStatus(status) {
    const map = {
        lead:      { label: 'Lead',      color: 'var(--color-text-muted)', bg: 'var(--color-bg-sunken)' },
        draft:     { label: 'Draft',     color: 'var(--color-text-muted)', bg: 'var(--color-bg-sunken)' },
        sent:      { label: 'Sent',      color: 'var(--color-info)',       bg: 'var(--color-info-soft)' },
        agreed:    { label: 'Agreed',    color: 'var(--color-info)',       bg: 'var(--color-info-soft)' },
        paid:      { label: 'Paid',      color: 'var(--color-success)',    bg: 'var(--color-success-soft)' },
        completed: { label: 'Completed', color: 'var(--color-text-muted)', bg: 'var(--color-bg-sunken)' },
        cancelled: { label: 'Cancelled', color: 'var(--color-danger)',     bg: 'var(--color-danger-soft)' },
        refunded:  { label: 'Refunded',  color: 'var(--color-warning)',    bg: 'var(--color-warning-soft)' },
    };
    return map[status] || { label: status || '—', color: 'var(--color-text-muted)', bg: 'var(--color-bg-sunken)' };
}

/**
 * Maps a COI status (+ optional expires-at) to a pill label and color. When
 * status is `received`, the color shifts to amber / red as expiry approaches.
 */
export function classifyCoiStatus(coiStatus, expiresAtMs, nowMs) {
    if (coiStatus === 'not_required') return { label: 'Not required', color: 'var(--color-text-muted)', bg: 'var(--color-bg-sunken)' };
    if (coiStatus === 'pending') return { label: 'COI pending', color: 'var(--color-warning)', bg: 'var(--color-warning-soft)' };
    if (coiStatus === 'expired') return { label: 'COI expired', color: 'var(--color-danger)', bg: 'var(--color-danger-soft)' };
    if (coiStatus === 'received') {
        const expires = Number(expiresAtMs);
        const now = Number(nowMs);
        if (Number.isFinite(expires) && Number.isFinite(now)) {
            const days = Math.floor((expires - now) / 86400000);
            if (days < 0) return { label: 'COI expired', color: 'var(--color-danger)', bg: 'var(--color-danger-soft)' };
            if (days < 7) return { label: `COI ${days}d left`, color: 'var(--color-danger)', bg: 'var(--color-danger-soft)' };
            if (days < 30) return { label: `COI ${days}d left`, color: 'var(--color-warning)', bg: 'var(--color-warning-soft)' };
        }
        return { label: 'COI received', color: 'var(--color-success)', bg: 'var(--color-success-soft)' };
    }
    return { label: coiStatus || '—', color: 'var(--color-text-muted)', bg: 'var(--color-bg-sunken)' };
}

/**
 * Parses a URLSearchParams (or compatible reader) into the filter shape
 * the list endpoint accepts. Defensive — unknown enum values stay through
 * unmolested; the server-side route ignores anything outside its CHECK enums.
 */
export function parseListFilters(searchParams) {
    if (!searchParams || typeof searchParams.get !== 'function') return defaultFilters();
    return {
        status: searchParams.get('status') || '',
        site_id: searchParams.get('site_id') || '',
        engagement_type: searchParams.get('engagement_type') || '',
        coi_status: searchParams.get('coi_status') || '',
        archived: searchParams.get('archived') || '',
        q: searchParams.get('q') || '',
        limit: clampLimit(Number(searchParams.get('limit'))),
        offset: clampOffset(Number(searchParams.get('offset'))),
    };
}

function defaultFilters() {
    return { status: '', site_id: '', engagement_type: '', coi_status: '', archived: '', q: '', limit: 50, offset: 0 };
}

function clampLimit(n) {
    if (!Number.isFinite(n) || n <= 0) return 50;
    if (n > 200) return 200;
    return Math.floor(n);
}

function clampOffset(n) {
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
}

/**
 * Filter state → query string (without the leading `?`). Empty values dropped.
 */
export function buildListQueryString(filters) {
    if (!filters || typeof filters !== 'object') return '';
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
        if (v === '' || v == null) continue;
        if (k === 'limit' || k === 'offset') {
            const n = Number(v);
            if (Number.isFinite(n)) params.set(k, String(n));
        } else {
            params.set(k, String(v));
        }
    }
    return params.toString();
}

// ────────────────────────────────────────────────────────────────────
// Inline styles
// ────────────────────────────────────────────────────────────────────

const containerStyle = { padding: 'var(--space-24)' };
const primaryBtn = {
    background: 'var(--color-accent)', color: 'var(--color-accent-on-accent)', border: 'none',
    padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 700,
    textDecoration: 'none', display: 'inline-block',
};
const tableBox = { background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', padding: 'var(--space-16)' };
const tableStyle = { width: '100%', borderCollapse: 'collapse' };
const thStyle = {
    textAlign: 'left', padding: '10px 12px',
    fontWeight: 800, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
    color: 'var(--color-accent)',
    borderBottom: '1px solid var(--color-border-strong)',
};
const tdStyle = { padding: '12px', borderBottom: '1px solid var(--border-soft, #f0f0f0)', fontSize: 14 };
const rowStyle = { cursor: 'pointer' };
const archivedRowStyle = { opacity: 0.55 };
const errorStyle = { background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger)', color: 'var(--color-text)', padding: 'var(--space-12)', borderRadius: 4, marginBottom: 'var(--space-12)' };
const badgeStyle = (cls) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 12,
    background: cls.bg, color: cls.color, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
});
const paginationStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-12)', fontSize: 13 };
const pageBtnStyle = {
    padding: '6px 12px', border: '1px solid var(--border-soft, #d0d0d0)',
    borderRadius: 4, background: 'transparent', color: 'var(--color-text)', cursor: 'pointer',
};

function formatDate(ms) {
    if (ms == null || !Number.isFinite(Number(ms))) return '—';
    const d = new Date(Number(ms));
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatScheduleWindow(startsAtMs, endsAtMs) {
    if (startsAtMs == null || endsAtMs == null) return '—';
    if (!Number.isFinite(Number(startsAtMs)) || !Number.isFinite(Number(endsAtMs))) return '—';
    const start = new Date(Number(startsAtMs));
    const end = new Date(Number(endsAtMs));
    const sameDay = start.toDateString() === end.toDateString();
    if (sameDay) {
        return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}–${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    }
    return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} → ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function formatMoney(cents) {
    if (cents == null || !Number.isFinite(Number(cents))) return '—';
    return `$${(Number(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function requirementsProgress(rental) {
    const r = rental?.requirements || {};
    const flags = [
        r.coiReceived, r.agreementSigned, r.depositReceived,
        r.briefingScheduled, r.walkthroughCompleted,
    ];
    const completed = flags.filter(Boolean).length;
    return `${completed}/5`;
}

// ────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────

export default function AdminFieldRentals() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const filters = useMemo(() => parseListFilters(searchParams), [searchParams]);

    const [data, setData] = useState({ rentals: [], total: 0, limit: 50, offset: 0 });
    const [sites, setSites] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const nowMs = Date.now();

    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            setErr('');
            try {
                const qs = buildListQueryString(filters);
                const res = await fetch(`/api/admin/field-rentals${qs ? `?${qs}` : ''}`, { credentials: 'include', cache: 'no-store' });
                if (!res.ok) {
                    const d = await res.json().catch(() => ({}));
                    throw new Error(d.error || `HTTP ${res.status}`);
                }
                const json = await res.json();
                if (!cancelled) setData(json);
            } catch (e) {
                if (!cancelled) setErr(e.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [filters]);

    useEffect(() => {
        // Fetch sites once for the dropdown filter.
        fetch('/api/admin/sites', { credentials: 'include' })
            .then((r) => r.ok ? r.json() : { sites: [] })
            .then((d) => setSites(d.sites || []))
            .catch(() => setSites([]));
    }, []);

    const filterSchema = useMemo(() => [
        { key: 'status', label: 'Status', type: 'enum', options: STATUS_OPTIONS.map((s) => ({ value: s, label: classifyStatus(s).label })) },
        { key: 'site_id', label: 'Site', type: 'enum', options: sites.map((s) => ({ value: s.id, label: s.name })) },
        { key: 'engagement_type', label: 'Engagement type', type: 'enum', options: ENGAGEMENT_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })) },
        { key: 'coi_status', label: 'COI status', type: 'enum', options: COI_STATUSES.map((c) => ({ value: c, label: c.replace(/_/g, ' ') })) },
        { key: 'archived', label: 'Archived', type: 'enum', options: [{ value: 'true', label: 'Archived only' }, { value: 'all', label: 'All (incl. archived)' }] },
    ], [sites]);

    // FilterBar is a controlled component that hands back the full next filter
    // object; reset paging whenever the filter set changes.
    const applyFilters = (next) => {
        setSearchParams(new URLSearchParams(buildListQueryString({ ...next, offset: 0 })));
    };

    // Live search; replace: true keeps per-keystroke typing out of the history stack.
    const setSearch = (q) => {
        setSearchParams(new URLSearchParams(buildListQueryString({ ...filters, q, offset: 0 })), { replace: true });
    };

    const goToPage = (direction) => {
        const delta = direction === 'next' ? data.limit : -data.limit;
        const nextOffset = Math.max(0, data.offset + delta);
        const next = { ...filters, offset: nextOffset };
        setSearchParams(new URLSearchParams(buildListQueryString(next)));
    };

    const isFiltered = Boolean(
        filters.q || filters.status || filters.site_id ||
        filters.engagement_type || filters.coi_status || filters.archived,
    );

    return (
        <div style={containerStyle}>
            <AdminPageHeader
                title="Field Rentals"
                description="Private and corporate field bookings. Track status, COI compliance, documents, and payments."
                breadcrumb={[{ label: 'Field Rentals' }]}
                primaryAction={<Link to="/admin/field-rentals/new" style={primaryBtn}>+ New Rental</Link>}
            />

            {err && <div style={errorStyle}>{err}</div>}

            <FilterBar
                schema={filterSchema}
                value={filters}
                onChange={applyFilters}
                searchValue={filters.q}
                onSearchChange={setSearch}
                searchPlaceholder="Search notes, ID…"
                resultCount={data.total}
                savedViewsKey="adminFieldRentals"
            />

            {loading && <EmptyState variant="loading" title="Loading field rentals…" compact />}

            {!loading && data.rentals.length === 0 && (
                <EmptyState
                    isFiltered={isFiltered}
                    title={isFiltered ? 'No field rentals match these filters' : 'No field rentals yet'}
                    description={isFiltered
                        ? 'Try clearing a filter or expanding the search.'
                        : 'Field rentals will appear here once created.'}
                    action={<Link to="/admin/field-rentals/new" style={primaryBtn}>+ New Rental</Link>}
                />
            )}

            {!loading && data.rentals.length > 0 && (
                <>
                    <div style={tableBox}>
                    <table style={tableStyle}>
                        <thead>
                            <tr>
                                <th style={thStyle}>ID</th>
                                <th style={thStyle}>Schedule</th>
                                <th style={thStyle}>Status</th>
                                <th style={thStyle}>COI</th>
                                <th style={thStyle}>Total</th>
                                <th style={thStyle}>Reqs</th>
                                <th style={thStyle}>Type</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.rentals.map((r) => {
                                const status = classifyStatus(r.status);
                                const coi = classifyCoiStatus(r.coiStatus, r.coiExpiresAt, nowMs);
                                return (
                                    <tr
                                        key={r.id}
                                        style={{ ...rowStyle, ...(r.archivedAt ? archivedRowStyle : null) }}
                                        onClick={() => navigate(`/admin/field-rentals/${r.id}`)}
                                    >
                                        <td style={tdStyle}>
                                            <code style={{ fontSize: 12 }}>{r.id}</code>
                                        </td>
                                        <td style={tdStyle}>{formatScheduleWindow(r.scheduledStartsAt, r.scheduledEndsAt)}</td>
                                        <td style={tdStyle}><span style={badgeStyle(status)}>{status.label}</span></td>
                                        <td style={tdStyle}><span style={badgeStyle(coi)}>{coi.label}</span></td>
                                        <td style={tdStyle}>{formatMoney(r.totalCents)}</td>
                                        <td style={tdStyle}>{requirementsProgress(r)}</td>
                                        <td style={tdStyle}>{(r.engagementType || '').replace(/_/g, ' ')}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    </div>

                    <div style={paginationStyle}>
                        <div>
                            {data.offset + 1}–{Math.min(data.offset + data.rentals.length, data.total)} of {data.total}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                type="button"
                                style={pageBtnStyle}
                                disabled={data.offset === 0}
                                onClick={() => goToPage('prev')}
                            >
                                ← Prev
                            </button>
                            <button
                                type="button"
                                style={pageBtnStyle}
                                disabled={data.offset + data.rentals.length >= data.total}
                                onClick={() => goToPage('next')}
                            >
                                Next →
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

// Export internal formatters as named exports too (tests import them).
export { formatDate, formatScheduleWindow, formatMoney, requirementsProgress };

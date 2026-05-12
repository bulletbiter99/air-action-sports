// M5.5 Batch 8 — Field Rentals list page. Backed by GET /api/admin/field-rentals.
//
// Renders a table of field rentals with filter chips + free-text search. Click
// row → /admin/field-rentals/:id. "+ New Rental" → /admin/field-rentals/new.
// Inline styles match the M5+ AdminSites / AdminSiteDetail convention.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

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
        lead:      { label: 'Lead',      color: '#94a3b8', bg: '#f1f5f9' },
        draft:     { label: 'Draft',     color: '#475569', bg: '#e2e8f0' },
        sent:      { label: 'Sent',      color: '#1d4ed8', bg: '#dbeafe' },
        agreed:    { label: 'Agreed',    color: '#0e7490', bg: '#cffafe' },
        paid:      { label: 'Paid',      color: '#065f46', bg: '#d1fae5' },
        completed: { label: 'Completed', color: '#374151', bg: '#e5e7eb' },
        cancelled: { label: 'Cancelled', color: '#991b1b', bg: '#fee2e2' },
        refunded:  { label: 'Refunded',  color: '#9a3412', bg: '#fed7aa' },
    };
    return map[status] || { label: status || '—', color: '#475569', bg: '#e2e8f0' };
}

/**
 * Maps a COI status (+ optional expires-at) to a pill label and color. When
 * status is `received`, the color shifts to amber / red as expiry approaches.
 */
export function classifyCoiStatus(coiStatus, expiresAtMs, nowMs) {
    if (coiStatus === 'not_required') return { label: 'Not required', color: '#475569', bg: '#e5e7eb' };
    if (coiStatus === 'pending') return { label: 'COI pending', color: '#92400e', bg: '#fef3c7' };
    if (coiStatus === 'expired') return { label: 'COI expired', color: '#991b1b', bg: '#fee2e2' };
    if (coiStatus === 'received') {
        const expires = Number(expiresAtMs);
        const now = Number(nowMs);
        if (Number.isFinite(expires) && Number.isFinite(now)) {
            const days = Math.floor((expires - now) / 86400000);
            if (days < 0) return { label: 'COI expired', color: '#991b1b', bg: '#fee2e2' };
            if (days < 7) return { label: `COI ${days}d left`, color: '#991b1b', bg: '#fee2e2' };
            if (days < 30) return { label: `COI ${days}d left`, color: '#92400e', bg: '#fef3c7' };
        }
        return { label: 'COI received', color: '#065f46', bg: '#d1fae5' };
    }
    return { label: coiStatus || '—', color: '#475569', bg: '#e5e7eb' };
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
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-16)' };
const titleStyle = { fontSize: 24, fontWeight: 700, margin: 0 };
const primaryBtn = {
    background: 'var(--orange-strong, #d4541a)', color: 'white', border: 'none',
    padding: '8px 16px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
    textDecoration: 'none', display: 'inline-block',
};
const filterBarStyle = {
    display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap',
    padding: 'var(--space-12)', background: 'var(--surface-elevated, #f5f5f5)',
    borderRadius: 4, marginBottom: 'var(--space-12)',
};
const selectStyle = {
    padding: '6px 10px', border: '1px solid var(--border-soft, #d0d0d0)',
    borderRadius: 4, fontSize: 13, background: 'white',
};
const inputStyle = {
    padding: '6px 10px', border: '1px solid var(--border-soft, #d0d0d0)',
    borderRadius: 4, fontSize: 13, minWidth: 200,
};
const tableStyle = { width: '100%', borderCollapse: 'collapse', background: 'var(--surface-card, white)', borderRadius: 4, overflow: 'hidden' };
const thStyle = {
    textAlign: 'left', padding: '10px 12px', background: 'var(--surface-elevated, #f5f5f5)',
    fontWeight: 600, fontSize: 13, color: 'var(--text-secondary, #666)',
    borderBottom: '1px solid var(--border-soft, #e0e0e0)',
};
const tdStyle = { padding: '12px', borderBottom: '1px solid var(--border-soft, #f0f0f0)', fontSize: 14 };
const rowStyle = { cursor: 'pointer' };
const archivedRowStyle = { opacity: 0.55 };
const errorStyle = { background: '#fef0f0', border: '1px solid #d4541a', padding: 'var(--space-12)', borderRadius: 4, marginBottom: 'var(--space-12)' };
const badgeStyle = (cls) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 12,
    background: cls.bg, color: cls.color, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
});
const emptyStateStyle = {
    padding: 'var(--space-24)', textAlign: 'center', background: 'var(--surface-card, white)',
    borderRadius: 4, color: 'var(--text-secondary, #666)',
};
const paginationStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-12)', fontSize: 13 };
const pageBtnStyle = {
    padding: '6px 12px', border: '1px solid var(--border-soft, #d0d0d0)',
    borderRadius: 4, background: 'white', cursor: 'pointer',
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
    const [searchInput, setSearchInput] = useState(filters.q);
    const nowMs = Date.now();

    useEffect(() => {
        setSearchInput(filters.q || '');
    }, [filters.q]);

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

    const updateFilter = (key, value) => {
        const next = { ...filters, [key]: value, offset: 0 };
        setSearchParams(new URLSearchParams(buildListQueryString(next)));
    };

    const submitSearch = (e) => {
        e?.preventDefault?.();
        updateFilter('q', searchInput);
    };

    const goToPage = (direction) => {
        const delta = direction === 'next' ? data.limit : -data.limit;
        const nextOffset = Math.max(0, data.offset + delta);
        const next = { ...filters, offset: nextOffset };
        setSearchParams(new URLSearchParams(buildListQueryString(next)));
    };

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <h1 style={titleStyle}>Field Rentals</h1>
                <Link to="/admin/field-rentals/new" style={primaryBtn}>+ New Rental</Link>
            </div>

            {err && <div style={errorStyle}>{err}</div>}

            <div style={filterBarStyle}>
                <form onSubmit={submitSearch} style={{ display: 'flex', gap: 8, flex: '1 1 240px' }}>
                    <input
                        style={inputStyle}
                        type="search"
                        placeholder="Search notes, ID…"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                    />
                    <button type="submit" style={{ ...pageBtnStyle, padding: '6px 12px' }}>Search</button>
                </form>

                <select style={selectStyle} value={filters.status} onChange={(e) => updateFilter('status', e.target.value)} aria-label="Status">
                    <option value="">All statuses</option>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{classifyStatus(s).label}</option>)}
                </select>

                <select style={selectStyle} value={filters.site_id} onChange={(e) => updateFilter('site_id', e.target.value)} aria-label="Site">
                    <option value="">All sites</option>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>

                <select style={selectStyle} value={filters.engagement_type} onChange={(e) => updateFilter('engagement_type', e.target.value)} aria-label="Engagement type">
                    <option value="">All types</option>
                    {ENGAGEMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>

                <select style={selectStyle} value={filters.coi_status} onChange={(e) => updateFilter('coi_status', e.target.value)} aria-label="COI status">
                    <option value="">Any COI</option>
                    {COI_STATUSES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                </select>

                <select style={selectStyle} value={filters.archived} onChange={(e) => updateFilter('archived', e.target.value)} aria-label="Archived">
                    <option value="">Active only</option>
                    <option value="true">Archived only</option>
                    <option value="all">All (incl. archived)</option>
                </select>
            </div>

            {loading && <div style={emptyStateStyle}>Loading…</div>}

            {!loading && data.rentals.length === 0 && (
                <div style={emptyStateStyle}>
                    No field rentals match this view.{' '}
                    <Link to="/admin/field-rentals/new" style={{ color: 'var(--orange-strong, #d4541a)' }}>Create the first one →</Link>
                </div>
            )}

            {!loading && data.rentals.length > 0 && (
                <>
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

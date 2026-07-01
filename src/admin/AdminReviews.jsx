import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import FilterBar from '../components/admin/FilterBar.jsx';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';

// Admin review moderation (attendee-verified reviews, 0077, Batch 5b).
// Reviews auto-publish; this page is the takedown surface. Hiding a review
// drops it from the public site + the SSR aggregateRating instantly.

const STATUS_LABEL = { published: 'Published', hidden: 'Hidden' };
const STATUS_COLOR = { published: '#27ae60', hidden: '#7f8c8d' };
const RATINGS = [5, 4, 3, 2, 1];

const REVIEW_FILTER_SCHEMA = [
  { key: 'status', label: 'Status', type: 'enum',
    options: [{ value: 'published', label: 'Published' }, { value: 'hidden', label: 'Hidden' }] },
  { key: 'rating', label: 'Rating', type: 'enum',
    options: RATINGS.map((r) => ({ value: String(r), label: `${r} ★` })) },
];

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString() : '—');
const stars = (n) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

export default function AdminReviews() {
  const { isAuthenticated, loading } = useAdmin();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ published: 0, hidden: 0, total: 0, average: null });
  const [loadingList, setLoadingList] = useState(false);
  const [filters, setFilters] = useState({ status: '', rating: '', q: '' });
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const load = useCallback(async () => {
    setLoadingList(true);
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.rating) params.set('rating', filters.rating);
    if (filters.q) params.set('q', filters.q);
    const res = await fetch(`/api/admin/reviews?${params}`, { credentials: 'include', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setItems(data.items || []);
      setSummary(data.summary || {});
    }
    setLoadingList(false);
  }, [filters]);

  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  if (!isAuthenticated) return null;

  const isFiltered = Boolean(filters.status || filters.rating || filters.q);

  return (
    <div style={pageWrap}>
      <AdminPageHeader
        title="Reviews"
        description="Attendee-submitted event reviews. Reviews publish automatically — hide anything abusive or off-topic and it drops from the public site (and your rating) instantly."
      />

      <div style={statsGrid}>
        <StatCard label="Published" value={summary.published} accent onClick={() => setFilters({ status: 'published', rating: '', q: '' })} />
        <StatCard label="Hidden" value={summary.hidden} onClick={() => setFilters({ status: 'hidden', rating: '', q: '' })} />
        <StatCard label="Avg rating" value={summary.average != null ? `${summary.average} ★` : '—'} />
        <StatCard label="All time" value={summary.total} onClick={() => setFilters({ status: '', rating: '', q: '' })} />
      </div>

      <FilterBar
        schema={REVIEW_FILTER_SCHEMA}
        value={filters}
        onChange={setFilters}
        searchValue={filters.q}
        onSearchChange={(q) => setFilters({ ...filters, q })}
        searchPlaceholder="Search title / comment / author…"
        resultCount={items.length}
        savedViewsKey="adminReviews"
      />

      <section style={tableBox}>
        {loadingList && <EmptyState variant="loading" title="Loading reviews…" compact />}
        {!loadingList && items.length === 0 && (
          <EmptyState
            isFiltered={isFiltered}
            title={isFiltered ? 'No reviews match these filters' : 'No reviews yet'}
            description={isFiltered
              ? 'Try clearing a filter or expanding the search.'
              : 'Reviews appear here after attendees rate an event they played.'}
          />
        )}
        {!loadingList && items.length > 0 && (
          <div className="admin-table-wrap">
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Received</th>
                  <th style={th}>Event</th>
                  <th style={th}>Rating</th>
                  <th style={th}>Author</th>
                  <th style={th}>Review</th>
                  <th style={th}>Status</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} style={tr}>
                    <td style={tdSmall}>{fmtDate(r.createdAt)}</td>
                    <td style={tdMuted}>{r.event?.title || '—'}</td>
                    <td style={tdStars} title={`${r.rating} of 5`}>{stars(r.rating)}</td>
                    <td style={tdMuted}>{r.authorName}</td>
                    <td style={tdTitle}>{r.title || r.comment || <em style={{ color: 'var(--color-text-subtle)' }}>(no comment)</em>}</td>
                    <td style={td}>
                      <Pill color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Pill>
                      {r.bookingFlag && <Pill color="#e74c3c">{r.bookingFlag}</Pill>}
                    </td>
                    <td style={td}>
                      <button type="button" style={subtleBtn} onClick={() => setSelected(r)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <ReviewDetail
          review={selected}
          onClose={() => setSelected(null)}
          onUpdated={(updated) => {
            setItems((arr) => arr.map((x) => (x.id === updated.id ? updated : x)));
            setSelected(updated);
            load();
          }}
        />
      )}
    </div>
  );
}

function ReviewDetail({ review, onClose, onUpdated }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const moderate = async (action) => {
    setSaving(true); setErr('');
    const res = await fetch(`/api/admin/reviews/${review.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'hide' ? { action, reason } : { action }),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(data.error || 'Update failed'); return; }
    onUpdated(data.item);
  };

  const isHidden = review.status === 'hidden';

  return (
    <div className="admin-modal-back" style={modalBg} onClick={onClose}>
      <div className="admin-modal-card" style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>Review detail</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={closeX}>×</button>
        </div>

        <div style={pillRow}>
          <span style={bigStars} title={`${review.rating} of 5`}>{stars(review.rating)}</span>
          <Pill color={STATUS_COLOR[review.status]}>{STATUS_LABEL[review.status]}</Pill>
          {review.verified ? <Pill color="#27ae60">Verified</Pill> : null}
          {review.bookingFlag && <Pill color="#e74c3c">Booking {review.bookingFlag}</Pill>}
          <span style={pillRowDate}>{fmtDate(review.createdAt)}</span>
        </div>

        {review.title && <h2 style={detailH2}>{review.title}</h2>}
        <div style={descriptionBox}>{review.comment || <em>(no written comment)</em>}</div>

        <div style={{ ...metaGrid, marginTop: 'var(--space-16)' }}>
          <MetaRow label="Author" value={review.authorName} />
          <MetaRow label="Event" value={review.event?.title || '—'} />
          <MetaRow label="Email" value={review.email || '—'} />
          <MetaRow label="Edits" value={String(review.editCount ?? 0)} />
          <MetaRow label="ID" value={<code style={{ fontSize: 'var(--font-size-sm)' }}>{review.id}</code>} />
        </div>

        <div style={sectionLabel}>Moderation</div>
        {isHidden ? (
          <>
            {review.hiddenReason && (
              <div style={{ ...descriptionBox, marginBottom: 'var(--space-12)' }}>
                <strong>Hidden reason:</strong> {review.hiddenReason}
              </div>
            )}
            {err && <div style={errorText}>{err}</div>}
            <div style={modalActions}>
              <button type="button" onClick={() => moderate('unhide')} disabled={saving} style={primaryBtn}>
                {saving ? 'Restoring…' : 'Restore (unhide)'}
              </button>
            </div>
          </>
        ) : (
          <>
            <label style={fieldLabel}>
              <div style={fieldLabelText}>Reason (optional, internal)</div>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{ ...input, resize: 'vertical' }}
                placeholder="Why is this being hidden? (spam, abuse, off-topic…)"
              />
            </label>
            <div style={warnBox}>⚠ Hiding removes this review from the public site and your rating immediately.</div>
            {err && <div style={errorText}>{err}</div>}
            <div style={modalActions}>
              <button type="button" onClick={() => moderate('hide')} disabled={saving} style={dangerBtn}>
                {saving ? 'Hiding…' : 'Hide review'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{ ...statCard, cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ ...statCardLabel, color: accent ? 'var(--color-accent)' : 'var(--color-accent)' }}>{label}</div>
      <div style={statCardValue}>{value ?? 0}</div>
    </button>
  );
}

function Pill({ children, color }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: 'var(--space-4) var(--space-8)',
      borderRadius: 'var(--radius-sm)',
      background: `${color}22`,
      color,
      fontSize: 'var(--font-size-xs)',
      fontWeight: 'var(--font-weight-extrabold)',
      letterSpacing: 'var(--letter-spacing-wide)',
      textTransform: 'uppercase',
      marginRight: 'var(--space-4)',
    }}>{children}</span>
  );
}

function MetaRow({ label, value }) {
  return (
    <div style={metaRow}>
      <div style={metaRowLabel}>{label}</div>
      <div style={metaRowValue}>{value}</div>
    </div>
  );
}

const pageWrap = { maxWidth: 1200, margin: '0 auto', padding: 'var(--space-32)' };
const statsGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-12)' };
const statCard = { background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', padding: 'var(--space-16)', textAlign: 'left', color: 'inherit', fontFamily: 'inherit' };
const statCardLabel = { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)', letterSpacing: 'var(--letter-spacing-wide)', color: 'var(--color-accent)', textTransform: 'uppercase' };
const statCardValue = { fontSize: 'var(--font-size-3xl)', fontWeight: 'var(--font-weight-extrabold)', color: 'var(--color-text)', margin: 'var(--space-4) 0' };
const tableBox = { background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', padding: 'var(--space-24)', marginTop: 'var(--space-16)' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-base)' };
const th = { textAlign: 'left', padding: 'var(--space-8) var(--space-12)', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--color-accent)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-extrabold)', letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid var(--color-border-subtle)' };
const td = { padding: 'var(--space-8) var(--space-12)', color: 'var(--color-text)', verticalAlign: 'top' };
const tdSmall = { ...td, fontSize: 'var(--font-size-sm)' };
const tdMuted = { ...td, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' };
const tdTitle = { ...td, maxWidth: 360, fontWeight: 'var(--font-weight-semibold)' };
const tdStars = { ...td, color: 'var(--color-accent)', letterSpacing: '2px', whiteSpace: 'nowrap' };
const input = { padding: 'var(--space-8) var(--space-12)', background: 'var(--color-bg-page)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text)', fontSize: 'var(--font-size-base)', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const primaryBtn = { padding: 'var(--space-8) var(--space-16)', background: 'var(--color-accent)', color: 'var(--color-accent-on-accent)', border: 'none', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-extrabold)', letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase', cursor: 'pointer' };
const subtleBtn = { padding: 'var(--space-4) var(--space-12)', background: 'transparent', border: '1px solid var(--color-border-strong)', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase', cursor: 'pointer' };
const dangerBtn = { padding: 'var(--space-8) var(--space-16)', background: 'transparent', border: '1px solid var(--color-danger)', color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-extrabold)', letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase', cursor: 'pointer' };
const modalBg = { position: 'fixed', inset: 0, background: 'var(--color-overlay-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 'var(--space-16)' };
const modal = { background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-strong)', padding: 'var(--space-24)', width: '100%', maxWidth: 640, borderRadius: 'var(--radius-md)', maxHeight: '92vh', overflowY: 'auto' };
const modalHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-16)' };
const modalTitle = { margin: 0, color: 'var(--color-text)', fontSize: 'var(--font-size-md)', letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase' };
const modalActions = { display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-16)', flexWrap: 'wrap' };
const closeX = { width: 32, height: 32, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xl)', lineHeight: 1, cursor: 'pointer', borderRadius: 'var(--radius-md)', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const descriptionBox = { background: 'var(--color-bg-page)', border: '1px solid var(--color-border)', padding: 'var(--space-12)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontSize: 'var(--font-size-base)', lineHeight: 'var(--line-height-normal)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const detailH2 = { color: 'var(--color-text)', margin: '0 0 var(--space-8)', fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-extrabold)' };
const bigStars = { color: 'var(--color-accent)', fontSize: 'var(--font-size-lg)', letterSpacing: '2px' };
const metaGrid = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' };
const metaRow = { display: 'grid', gridTemplateColumns: '80px 1fr', gap: 'var(--space-8)', padding: 'var(--space-4) 0', borderBottom: '1px solid var(--color-border-subtle)' };
const metaRowLabel = { fontSize: 'var(--font-size-xs)', letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 'var(--font-weight-bold)' };
const metaRowValue = { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-base)', wordBreak: 'break-word' };
const sectionLabel = { fontSize: 'var(--font-size-sm)', letterSpacing: 'var(--letter-spacing-wider)', textTransform: 'uppercase', color: 'var(--color-accent)', fontWeight: 'var(--font-weight-extrabold)', margin: 'var(--space-24) 0 var(--space-8)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-16)' };
const fieldLabel = { display: 'block', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' };
const fieldLabelText = { fontSize: 'var(--font-size-sm)', letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase', color: 'var(--color-accent)', fontWeight: 'var(--font-weight-bold)', marginBottom: 'var(--space-4)' };
const pillRow = { display: 'flex', gap: 'var(--space-8)', marginBottom: 'var(--space-12)', flexWrap: 'wrap', alignItems: 'center' };
const pillRowDate = { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', marginLeft: 'auto' };
const errorText = { color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)', margin: 'var(--space-8) 0' };
const warnBox = { color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)', margin: 'var(--space-8) 0', padding: 'var(--space-8)', background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-sm)' };

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import FeedbackModal from '../components/FeedbackModal';
import FilterBar from '../components/admin/FilterBar.jsx';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';

const TYPE_LABEL = { bug: 'Bug', feature: 'Feature', usability: 'Usability', other: 'Other' };
const STATUS_LABEL = {
  new: 'New', triaged: 'Triaged', 'in-progress': 'In progress',
  resolved: 'Resolved', 'wont-fix': "Won't fix", duplicate: 'Duplicate',
};
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['new', 'triaged', 'in-progress', 'resolved', 'wont-fix', 'duplicate'];
const TYPES = ['bug', 'feature', 'usability', 'other'];

// FilterBar schema — used by the chip-based filter row replacing the
// hand-built selects below. Status/type/priority become chips; `q`
// (search) is a separate FilterBar prop, not part of the chip schema.
const FEEDBACK_FILTER_SCHEMA = [
  { key: 'status', label: 'Status', type: 'enum',
    options: STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
  { key: 'type', label: 'Type', type: 'enum',
    options: TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] })) },
  { key: 'priority', label: 'Priority', type: 'enum',
    options: PRIORITIES.map((p) => ({ value: p, label: p })) },
];

// Domain colors stay raw — per-type / per-status / per-priority coloring is
// intentional information density, not a design-token target.
const TYPE_COLOR = { bug: '#e74c3c', feature: '#3498db', usability: '#e67e22', other: '#95a5a6' };
const STATUS_COLOR = {
  new: '#d76c21', triaged: '#e67e22', 'in-progress': '#3498db',
  resolved: '#27ae60', 'wont-fix': '#7f8c8d', duplicate: '#7f8c8d',
};
const PRIORITY_COLOR = { low: '#7f8c8d', medium: '#3498db', high: '#e67e22', critical: '#e74c3c' };

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString() : '—');

export default function AdminFeedback() {
  const { isAuthenticated, loading, hasRole, user } = useAdmin();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ new: 0, triaged: 0, inProgress: 0, resolved: 0, total: 0 });
  const [loadingList, setLoadingList] = useState(false);
  const [filters, setFilters] = useState({ status: '', type: '', priority: '', q: '' });
  const [selected, setSelected] = useState(null);
  const [submitOpen, setSubmitOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const load = useCallback(async () => {
    setLoadingList(true);
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.type) params.set('type', filters.type);
    if (filters.priority) params.set('priority', filters.priority);
    if (filters.q) params.set('q', filters.q);
    const res = await fetch(`/api/admin/feedback?${params}`, { credentials: 'include', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setItems(data.items || []);
      setSummary(data.summary || {});
    }
    setLoadingList(false);
  }, [filters]);

  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  if (!isAuthenticated) return null;

  const isFiltered = Boolean(filters.status || filters.type || filters.priority || filters.q);

  return (
    <div style={pageWrap}>
      <AdminPageHeader
        title="Feedback"
        description="User-submitted bugs, feature requests, and usability reports."
        primaryAction={
          <button
            type="button"
            onClick={() => setSubmitOpen(true)}
            aria-label="Submit new feedback"
            title="Submit new feedback"
            style={plusBtn}
          >+</button>
        }
      />

      <div style={statsGrid}>
        <StatCard label="New" value={summary.new} accent onClick={() => setFilters({ ...filters, status: 'new' })} />
        <StatCard label="Triaged" value={summary.triaged} onClick={() => setFilters({ ...filters, status: 'triaged' })} />
        <StatCard label="In progress" value={summary.inProgress} onClick={() => setFilters({ ...filters, status: 'in-progress' })} />
        <StatCard label="Resolved" value={summary.resolved} onClick={() => setFilters({ ...filters, status: 'resolved' })} />
        <StatCard label="All time" value={summary.total} onClick={() => setFilters({ status: '', type: '', priority: '', q: '' })} />
      </div>

      <FilterBar
        schema={FEEDBACK_FILTER_SCHEMA}
        value={filters}
        onChange={setFilters}
        searchValue={filters.q}
        onSearchChange={(q) => setFilters({ ...filters, q })}
        searchPlaceholder="Search title / description / email…"
        resultCount={items.length}
        savedViewsKey="adminFeedback"
      />

      <section style={tableBox}>
        {loadingList && <EmptyState variant="loading" title="Loading feedback…" compact />}
        {!loadingList && items.length === 0 && (
          <EmptyState
            isFiltered={isFiltered}
            title={isFiltered ? 'No feedback matches these filters' : 'No feedback yet'}
            description={isFiltered
              ? 'Try clearing a filter or expanding the search.'
              : 'When users submit feedback, it will appear here.'}
          />
        )}
        {!loadingList && items.length > 0 && (
          <div className="admin-table-wrap">
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Received</th>
                  <th style={th}>Type</th>
                  <th style={th}>Title</th>
                  <th style={th}>From</th>
                  <th style={th}>Status</th>
                  <th style={th}>Priority</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((f) => (
                  <tr key={f.id} style={tr}>
                    <td style={tdSmall}>{fmtDate(f.createdAt)}</td>
                    <td style={td}><Pill color={TYPE_COLOR[f.type]}>{TYPE_LABEL[f.type]}</Pill></td>
                    <td style={tdTitle}>{f.title}</td>
                    <td style={tdMuted}>{f.email || <em style={{ color: 'var(--color-text-subtle)' }}>anonymous</em>}</td>
                    <td style={td}><Pill color={STATUS_COLOR[f.status]}>{STATUS_LABEL[f.status]}</Pill></td>
                    <td style={td}><Pill color={PRIORITY_COLOR[f.priority]}>{f.priority}</Pill></td>
                    <td style={td}>
                      <button type="button" style={subtleBtn} onClick={() => setSelected(f)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <FeedbackModal
        open={submitOpen}
        onClose={() => { setSubmitOpen(false); load(); }}
        defaultEmail={user?.email || ''}
      />

      {selected && (
        <FeedbackDetail
          feedback={selected}
          canDelete={hasRole('owner')}
          canEditStatus={hasRole('manager')}
          onClose={() => setSelected(null)}
          onUpdated={(updated) => {
            setItems((arr) => arr.map((x) => (x.id === updated.id ? updated : x)));
            setSelected(updated);
            load();
          }}
          onDeleted={(id) => {
            setItems((arr) => arr.filter((x) => x.id !== id));
            setSelected(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function FeedbackDetail({ feedback, canDelete, canEditStatus, onClose, onUpdated, onDeleted }) {
  const [status, setStatus] = useState(feedback.status);
  const [priority, setPriority] = useState(feedback.priority);
  const [adminNote, setAdminNote] = useState(feedback.adminNote || '');
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState('');
  const [err, setErr] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState('');

  const save = async () => {
    setSaving(true); setErr('');
    const res = await fetch(`/api/admin/feedback/${feedback.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, priority, adminNote }),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(data.error || 'Save failed'); return; }
    onUpdated(data.item);
  };

  const remove = async () => {
    if (!confirm('Delete this feedback permanently? This cannot be undone.')) return;
    const res = await fetch(`/api/admin/feedback/${feedback.id}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (res.ok) onDeleted(feedback.id);
  };

  const openNotifyPreview = async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreview(null);
    setPreviewErr('');
    setNotifyMsg('');
    setErr('');
    try {
      const res = await fetch(`/api/admin/feedback/${feedback.id}/notify-preview`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreviewErr(data.error || 'Preview failed');
      } else {
        setPreview(data);
      }
    } catch {
      setPreviewErr('Network error loading preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  const confirmNotify = async () => {
    setNotifying(true);
    setNotifyMsg('');
    setErr('');
    const res = await fetch(`/api/admin/feedback/${feedback.id}/notify-submitter`, {
      method: 'POST', credentials: 'include',
    });
    setNotifying(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPreviewErr(data.error || 'Notify failed');
      return;
    }
    setPreviewOpen(false);
    setPreview(null);
    setNotifyMsg(`Email sent to ${feedback.email}.`);
  };

  const mailto = feedback.email
    ? `mailto:${feedback.email}?subject=${encodeURIComponent(`Re: ${feedback.title}`)}&body=${encodeURIComponent(`\n\n---\nRegarding your ${TYPE_LABEL[feedback.type].toLowerCase()} submission:\n"${feedback.title}"`)}`
    : null;

  return (
    <div className="admin-modal-back" style={modalBg} onClick={onClose}>
      <div className="admin-modal-card" style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>Feedback detail</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={closeX}>×</button>
        </div>

        <div style={pillRow}>
          <Pill color={TYPE_COLOR[feedback.type]}>{TYPE_LABEL[feedback.type]}</Pill>
          <Pill color={STATUS_COLOR[feedback.status]}>{STATUS_LABEL[feedback.status]}</Pill>
          <Pill color={PRIORITY_COLOR[feedback.priority]}>{feedback.priority}</Pill>
          <span style={pillRowDate}>{fmtDate(feedback.createdAt)}</span>
        </div>

        <h2 style={detailH2}>{feedback.title}</h2>
        <div style={descriptionBox}>{feedback.description}</div>

        {(feedback.attachmentUrl || feedback.attachmentDeletedAt) && (
          <div style={{ marginTop: 'var(--space-12)' }}>
            <div style={fieldLabelText}>Screenshot</div>
            {feedback.attachmentUrl ? (
              <a href={feedback.attachmentUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block' }}>
                <img
                  src={feedback.attachmentUrl}
                  alt="Submitted screenshot"
                  style={screenshotImg}
                />
              </a>
            ) : (
              <div style={screenshotDeleted}>
                Screenshot was attached but has been deleted (retired {fmtDate(feedback.attachmentDeletedAt)}).
              </div>
            )}
          </div>
        )}

        <div style={{ ...metaGrid, marginTop: 'var(--space-16)' }}>
          <MetaRow label="From" value={feedback.email ? <a href={mailto} style={{ color: 'var(--color-accent)' }}>{feedback.email}</a> : <em>anonymous</em>} />
          <MetaRow label="Page" value={feedback.pageUrl ? <a href={feedback.pageUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)' }}>{feedback.pageUrl}</a> : '—'} />
          <MetaRow label="Browser" value={<span style={{ fontSize: 'var(--font-size-sm)' }}>{feedback.userAgent || '—'} {feedback.viewport ? `· ${feedback.viewport}` : ''}</span>} />
          <MetaRow label="ID" value={<code style={{ fontSize: 'var(--font-size-sm)' }}>{feedback.id}</code>} />
        </div>

        <div style={sectionLabel}>Triage</div>
        <div style={twoCol}>
          <label style={fieldLabel}>
            <div style={fieldLabelText}>Status</div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={input} disabled={!canEditStatus}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>
            <div style={fieldLabelText}>Priority</div>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} style={input} disabled={!canEditStatus}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>
        <label style={{ ...fieldLabel, marginTop: 'var(--space-12)' }}>
          <div style={fieldLabelText}>Admin note (private)</div>
          <textarea
            rows={3}
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            style={{ ...input, resize: 'vertical' }}
            placeholder="Internal triage notes…"
          />
        </label>

        {err && <div style={errorText}>{err}</div>}
        {notifyMsg && <div style={successText}>{notifyMsg}</div>}

        <div style={modalActions}>
          <button type="button" onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save changes'}</button>
          {feedback.email && canEditStatus && (
            <button type="button" onClick={openNotifyPreview} disabled={notifying} style={secondaryBtn}>
              {notifying ? 'Sending…' : 'Notify submitter…'}
            </button>
          )}
          {mailto && <a href={mailto} style={secondaryLink}>Reply via email</a>}
          {canDelete && <button type="button" onClick={remove} style={dangerBtn}>Delete</button>}
        </div>
      </div>

      {previewOpen && (
        <NotifyPreviewModal
          recipient={feedback.email}
          loading={previewLoading}
          preview={preview}
          err={previewErr}
          sending={notifying}
          onCancel={() => { setPreviewOpen(false); setPreview(null); setPreviewErr(''); }}
          onConfirm={confirmNotify}
        />
      )}
    </div>
  );
}

function NotifyPreviewModal({ recipient, loading, preview, err, sending, onCancel, onConfirm }) {
  return (
    <div style={{ ...modalBg, zIndex: 200 }} onClick={onCancel}>
      <div style={{ ...modal, maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>Preview email</h3>
          <button type="button" onClick={onCancel} aria-label="Close" style={closeX}>×</button>
        </div>

        <div style={previewIntro}>
          This is exactly what will be sent. Subject and body render with the
          ticket&rsquo;s current <strong>status</strong> and <strong>admin note</strong>.
          Edit those first if you want different copy.
        </div>

        {loading && <EmptyState variant="loading" title="Loading preview…" compact />}

        {err && (
          <div style={errBanner}>{err}</div>
        )}

        {preview && (
          <>
            <div style={previewMetaRow}>
              <div style={previewMetaLabel}>To</div>
              <div style={previewMetaValue}>{recipient}</div>
            </div>
            <div style={previewMetaRow}>
              <div style={previewMetaLabel}>Subject</div>
              <div style={previewMetaValue}>{preview.rendered.subject}</div>
            </div>

            <div style={{ ...fieldLabelText, margin: 'var(--space-12) 0 var(--space-4)' }}>Body</div>
            <iframe
              title="Email body preview"
              srcDoc={preview.rendered.html}
              sandbox=""
              style={previewIframe}
            />
          </>
        )}

        <div style={{ ...modalActions, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={secondaryBtn} disabled={sending}>Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!preview || sending || loading}
            style={primaryBtn}
          >
            {sending ? 'Sending…' : 'Send email'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{ ...statCard, cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ ...statCardLabel, color: accent ? 'var(--color-accent)' : 'var(--color-accent)' }}>{label}</div>
      <div style={statCardValue}>{value ?? 0}</div>
      {sub && <div style={statCardSub}>{sub}</div>}
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
const plusBtn = {
  width: 36, height: 36,
  background: 'var(--color-accent)', color: 'var(--color-accent-on-accent)',
  border: 'none', borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)', lineHeight: 1,
  cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: 0, flexShrink: 0,
};
const statsGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-12)' };
const statCard = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-16)',
  textAlign: 'left',
  color: 'inherit',
  fontFamily: 'inherit',
};
const statCardLabel = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-bold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  color: 'var(--color-accent)',
  textTransform: 'uppercase',
};
const statCardValue = {
  fontSize: 'var(--font-size-3xl)',
  fontWeight: 'var(--font-weight-extrabold)',
  color: 'var(--color-text)',
  margin: 'var(--space-4) 0',
};
const statCardSub = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' };
const tableBox = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-24)',
  marginTop: 'var(--space-16)',
};
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-base)' };
const th = {
  textAlign: 'left',
  padding: 'var(--space-8) var(--space-12)',
  borderBottom: '1px solid var(--color-border-strong)',
  color: 'var(--color-accent)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
};
const tr = { borderBottom: '1px solid var(--color-border-subtle)' };
const td = { padding: 'var(--space-8) var(--space-12)', color: 'var(--color-text)', verticalAlign: 'top' };
const tdSmall = { ...td, fontSize: 'var(--font-size-sm)' };
const tdMuted = { ...td, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' };
const tdTitle = { ...td, maxWidth: 360, fontWeight: 'var(--font-weight-semibold)' };
const input = {
  padding: 'var(--space-8) var(--space-12)',
  background: 'var(--color-bg-page)',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-base)',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};
const primaryBtn = {
  padding: 'var(--space-8) var(--space-16)',
  background: 'var(--color-accent)',
  color: 'var(--color-accent-on-accent)',
  border: 'none',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const subtleBtn = {
  padding: 'var(--space-4) var(--space-12)',
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const secondaryBtn = {
  padding: 'var(--space-8) var(--space-16)',
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const dangerBtn = {
  padding: 'var(--space-8) var(--space-16)',
  background: 'transparent',
  border: '1px solid var(--color-danger)',
  color: 'var(--color-danger)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const secondaryLink = {
  padding: 'var(--space-8) var(--space-16)',
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};
const modalBg = {
  position: 'fixed',
  inset: 0,
  background: 'var(--color-overlay-strong)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 'var(--space-16)',
};
const modal = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border-strong)',
  padding: 'var(--space-24)',
  width: '100%',
  maxWidth: 640,
  borderRadius: 'var(--radius-md)',
  maxHeight: '92vh',
  overflowY: 'auto',
};
const modalHeader = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 'var(--space-16)',
};
const modalTitle = {
  margin: 0,
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-md)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
};
const modalActions = {
  display: 'flex',
  gap: 'var(--space-8)',
  marginTop: 'var(--space-16)',
  flexWrap: 'wrap',
};
const closeX = {
  width: 32,
  height: 32,
  border: '1px solid var(--color-border-strong)',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-xl)',
  lineHeight: 1,
  cursor: 'pointer',
  borderRadius: 'var(--radius-md)',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const descriptionBox = {
  background: 'var(--color-bg-page)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-12)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-base)',
  lineHeight: 'var(--line-height-normal)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};
const detailH2 = {
  color: 'var(--color-text)',
  margin: '0 0 var(--space-8)',
  fontSize: 'var(--font-size-lg)',
  fontWeight: 'var(--font-weight-extrabold)',
};
const screenshotImg = {
  maxWidth: '100%',
  maxHeight: 320,
  border: '1px solid var(--color-border-strong)',
  borderRadius: 'var(--radius-sm)',
};
const screenshotDeleted = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-muted)',
  fontStyle: 'italic',
  padding: 'var(--space-12)',
  border: '1px dashed var(--color-border)',
  borderRadius: 'var(--radius-sm)',
};
const metaGrid = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' };
const metaRow = {
  display: 'grid',
  gridTemplateColumns: '80px 1fr',
  gap: 'var(--space-8)',
  padding: 'var(--space-4) 0',
  borderBottom: '1px solid var(--color-border-subtle)',
};
const metaRowLabel = {
  fontSize: 'var(--font-size-xs)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  fontWeight: 'var(--font-weight-bold)',
};
const metaRowValue = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-base)',
  wordBreak: 'break-word',
};
const sectionLabel = {
  fontSize: 'var(--font-size-sm)',
  letterSpacing: 'var(--letter-spacing-wider)',
  textTransform: 'uppercase',
  color: 'var(--color-accent)',
  fontWeight: 'var(--font-weight-extrabold)',
  margin: 'var(--space-24) 0 var(--space-8)',
  borderTop: '1px solid var(--color-border)',
  paddingTop: 'var(--space-16)',
};
const twoCol = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-8)' };
const fieldLabel = {
  display: 'block',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
};
const fieldLabelText = {
  fontSize: 'var(--font-size-sm)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  color: 'var(--color-accent)',
  fontWeight: 'var(--font-weight-bold)',
  marginBottom: 'var(--space-4)',
};
const pillRow = {
  display: 'flex',
  gap: 'var(--space-8)',
  marginBottom: 'var(--space-12)',
  flexWrap: 'wrap',
  alignItems: 'center',
};
const pillRowDate = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-xs)',
  marginLeft: 'auto',
};
const errorText = {
  color: 'var(--color-danger)',
  fontSize: 'var(--font-size-sm)',
  margin: 'var(--space-8) 0',
};
const successText = {
  color: 'var(--color-success)',
  fontSize: 'var(--font-size-sm)',
  margin: 'var(--space-8) 0',
};
const errBanner = {
  color: 'var(--color-danger)',
  fontSize: 'var(--font-size-sm)',
  padding: 'var(--space-8)',
  background: 'var(--color-danger-soft)',
  border: '1px solid var(--color-danger)',
  borderRadius: 'var(--radius-sm)',
  marginBottom: 'var(--space-12)',
};
const previewIntro = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-muted)',
  marginBottom: 'var(--space-12)',
};
const previewMetaRow = {
  display: 'flex',
  gap: 'var(--space-12)',
  alignItems: 'baseline',
  padding: 'var(--space-8) 0',
  borderBottom: '1px solid var(--color-border-subtle)',
};
const previewMetaLabel = {
  fontSize: 'var(--font-size-xs)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  color: 'var(--color-accent)',
  fontWeight: 'var(--font-weight-bold)',
  minWidth: 60,
};
const previewMetaValue = {
  fontSize: 'var(--font-size-base)',
  color: 'var(--color-text)',
  wordBreak: 'break-word',
  flex: 1,
};
const previewIframe = {
  width: '100%',
  height: 360,
  background: '#fff',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 'var(--radius-sm)',
};

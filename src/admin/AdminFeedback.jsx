import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import FeedbackModal from '../components/FeedbackModal';
import FilterBar from '../components/admin/FilterBar.jsx';

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

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
      <div style={headerRow}>
        <div>
          <h1 style={h1}>Feedback</h1>
          <div style={{ color: 'var(--olive-light)', fontSize: 13, marginTop: 4 }}>
            User-submitted bugs, feature requests, and usability reports.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSubmitOpen(true)}
          aria-label="Submit new feedback"
          title="Submit new feedback"
          style={plusBtn}
        >
          +
        </button>
      </div>

      <div style={statsGrid}>
        <StatCard label="New" value={summary.new} color="var(--orange)" onClick={() => setFilters({ ...filters, status: 'new' })} />
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

      <section style={{ ...tableBox, marginTop: 16 }}>
        {loadingList && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}
        {!loadingList && items.length === 0 && (
          <p style={{ color: 'var(--olive-light)' }}>No feedback matches these filters.</p>
        )}
        {items.length > 0 && (
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
                    <td style={td}>{fmtDate(f.createdAt)}</td>
                    <td style={td}><Pill color={TYPE_COLOR[f.type]}>{TYPE_LABEL[f.type]}</Pill></td>
                    <td style={{ ...td, maxWidth: 360, fontWeight: 600 }}>{f.title}</td>
                    <td style={{ ...td, fontSize: 12, color: 'var(--tan-light)' }}>{f.email || <em style={{ color: 'var(--olive-light)' }}>anonymous</em>}</td>
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
  // Preview-before-send modal state.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState(null); // { rendered: { subject, html, text }, recipient }
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

  // Open preview modal — fetches the rendered email with this ticket's
  // actual status + admin_note, so the user sees exactly what will be sent.
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

  // Actually send. Called from the modal's confirm button.
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: 'var(--cream)', fontSize: 14, letterSpacing: 1.5, textTransform: 'uppercase' }}>
            Feedback detail
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" style={closeX}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <Pill color={TYPE_COLOR[feedback.type]}>{TYPE_LABEL[feedback.type]}</Pill>
          <Pill color={STATUS_COLOR[feedback.status]}>{STATUS_LABEL[feedback.status]}</Pill>
          <Pill color={PRIORITY_COLOR[feedback.priority]}>{feedback.priority}</Pill>
          <span style={{ color: 'var(--olive-light)', fontSize: 11, marginLeft: 'auto' }}>{fmtDate(feedback.createdAt)}</span>
        </div>

        <h2 style={{ color: 'var(--cream)', margin: '0 0 8px', fontSize: 18 }}>{feedback.title}</h2>
        <div style={descriptionBox}>{feedback.description}</div>

        {(feedback.attachmentUrl || feedback.attachmentDeletedAt) && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 700, marginBottom: 6 }}>Screenshot</div>
            {feedback.attachmentUrl ? (
              <a href={feedback.attachmentUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block' }}>
                <img
                  src={feedback.attachmentUrl}
                  alt="Submitted screenshot"
                  style={{ maxWidth: '100%', maxHeight: 320, border: '1px solid var(--color-border-strong)', borderRadius: 3 }}
                />
              </a>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--olive-light)', fontStyle: 'italic', padding: 10, border: '1px dashed rgba(200,184,154,0.15)', borderRadius: 3 }}>
                Screenshot was attached but has been deleted (retired {fmtDate(feedback.attachmentDeletedAt)}).
              </div>
            )}
          </div>
        )}

        <div style={{ ...metaGrid, marginTop: 16 }}>
          <MetaRow label="From" value={feedback.email ? <a href={mailto} style={{ color: 'var(--orange)' }}>{feedback.email}</a> : <em>anonymous</em>} />
          <MetaRow label="Page" value={feedback.pageUrl ? <a href={feedback.pageUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--orange)' }}>{feedback.pageUrl}</a> : '—'} />
          <MetaRow label="Browser" value={<span style={{ fontSize: 11 }}>{feedback.userAgent || '—'} {feedback.viewport ? `· ${feedback.viewport}` : ''}</span>} />
          <MetaRow label="ID" value={<code style={{ fontSize: 11 }}>{feedback.id}</code>} />
        </div>

        <div style={sectionLabel}>Triage</div>
        <div style={twoCol}>
          <label style={fieldLabel}>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={input} disabled={!canEditStatus}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value)} style={input} disabled={!canEditStatus}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>
        <label style={{ ...fieldLabel, marginTop: 12 }}>
          Admin note (private)
          <textarea
            rows={3}
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            style={{ ...input, resize: 'vertical' }}
            placeholder="Internal triage notes…"
          />
        </label>

        {err && <div style={{ color: '#e74c3c', fontSize: 12, margin: '8px 0' }}>{err}</div>}
        {notifyMsg && <div style={{ color: '#27ae60', fontSize: 12, margin: '8px 0' }}>{notifyMsg}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
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
    <div
      style={{ ...modalBg, zIndex: 200 }}
      onClick={onCancel}
    >
      <div
        style={{ ...modal, maxWidth: 720 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: 'var(--cream)', fontSize: 14, letterSpacing: 1.5, textTransform: 'uppercase' }}>
            Preview email
          </h3>
          <button type="button" onClick={onCancel} aria-label="Close" style={closeX}>×</button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--olive-light)', marginBottom: 14 }}>
          This is exactly what will be sent. Subject and body render with the
          ticket&rsquo;s current <strong>status</strong> and <strong>admin note</strong>.
          Edit those first if you want different copy.
        </div>

        {loading && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--olive-light)', fontSize: 13 }}>
            Loading preview&hellip;
          </div>
        )}

        {err && (
          <div style={{ color: '#e74c3c', fontSize: 12, padding: 10, background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.2)', borderRadius: 3, marginBottom: 12 }}>
            {err}
          </div>
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

            <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 700, margin: '14px 0 6px' }}>
              Body
            </div>
            <iframe
              title="Email body preview"
              srcDoc={preview.rendered.html}
              sandbox=""
              style={{
                width: '100%',
                height: 360,
                background: '#fff',
                border: '1px solid var(--color-border-strong)',
                borderRadius: 3,
              }}
            />
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={secondaryBtn} disabled={sending}>
            Cancel
          </button>
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

const previewMetaRow = {
  display: 'flex', gap: 12, alignItems: 'baseline',
  padding: '8px 0',
  borderBottom: '1px solid rgba(200,184,154,0.08)',
};
const previewMetaLabel = {
  fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
  color: 'var(--orange)', fontWeight: 700, minWidth: 60,
};
const previewMetaValue = {
  fontSize: 13, color: 'var(--cream)', wordBreak: 'break-word', flex: 1,
};

function StatCard({ label, value, sub, color, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{ ...statCard, cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: color || 'var(--orange)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--cream)', margin: '4px 0' }}>{value ?? 0}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--olive-light)' }}>{sub}</div>}
    </button>
  );
}

function Pill({ children, color }) {
  return (
    <span style={{
      display: 'inline-block', padding: '3px 8px', borderRadius: 3,
      background: `${color}22`, color, fontSize: 10, fontWeight: 800,
      letterSpacing: 1, textTransform: 'uppercase',
    }}>
      {children}
    </span>
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

const headerRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 };
const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const plusBtn = {
  width: 36, height: 36,
  background: 'var(--orange)', color: '#fff',
  border: 'none', borderRadius: 3,
  fontSize: 24, fontWeight: 700, lineHeight: 1,
  cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: 0, flexShrink: 0,
};
const statsGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 };
const statCard = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.1rem', textAlign: 'left', color: 'inherit', fontFamily: 'inherit' };
const tableBox = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', color: 'var(--cream)', verticalAlign: 'top' };
const input = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const primaryBtn = { padding: '10px 18px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const subtleBtn = { padding: '6px 12px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };
const secondaryBtn = { padding: '10px 18px', background: 'transparent', border: '1px solid var(--olive-light)', color: 'var(--cream)', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const dangerBtn = { padding: '10px 18px', background: 'transparent', border: '1px solid rgba(231,76,60,0.4)', color: '#e74c3c', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const secondaryLink = { padding: '10px 18px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' };
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal = { background: 'var(--mid)', border: '1px solid var(--color-border-strong)', padding: '1.5rem', width: '100%', maxWidth: 640, borderRadius: 4, maxHeight: '92vh', overflowY: 'auto' };
const closeX = { width: 32, height: 32, border: '1px solid rgba(200,184,154,0.25)', background: 'transparent', color: 'var(--tan-light)', fontSize: 22, lineHeight: 1, cursor: 'pointer', borderRadius: 4, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const descriptionBox = { background: 'var(--dark)', border: '1px solid var(--color-border)', padding: 14, borderRadius: 3, color: 'var(--cream)', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const metaGrid = { display: 'flex', flexDirection: 'column', gap: 4 };
const metaRow = { display: 'grid', gridTemplateColumns: '80px 1fr', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(200,184,154,0.05)' };
const metaRowLabel = { fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--olive-light)', fontWeight: 700 };
const metaRowValue = { color: 'var(--tan-light)', fontSize: 13, wordBreak: 'break-word' };
const sectionLabel = { fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 800, margin: '20px 0 10px', borderTop: '1px solid rgba(200,184,154,0.12)', paddingTop: 16 };
const twoCol = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
const fieldLabel = { display: 'block', color: 'var(--tan-light)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700 };

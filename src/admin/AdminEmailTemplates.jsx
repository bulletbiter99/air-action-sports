import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';

const SLUG_LABELS = {
  booking_confirmation: 'Booking confirmation',
  admin_notify: 'Admin new-booking notification',
  waiver_request: 'Waiver request',
  event_reminder_24h: 'Event reminder — 24hr',
  event_reminder_1hr: 'Event reminder — 1hr',
  password_reset: 'Password reset',
  user_invite: 'Team invite',
};

// M6 B4 — slugs whose preview endpoint supports ?bookingId= for real-data
// rendering. Mirrors TEMPLATE_SPECS in worker/lib/emailTemplatePreview.js.
// When a template's slug is in this set, the editor shows the "preview
// with real data" controls in the preview tab; otherwise that section is
// hidden and the existing sample-vars preview is used.
const SUPPORTED_PREVIEW_SLUGS = new Set([
  'booking_confirmation',
  'admin_notify',
  'event_reminder_24h',
  'event_reminder_1hr',
]);

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'published', label: 'Published' },
  { id: 'draft', label: 'Drafts' },
];

export default function AdminEmailTemplates() {
  const { isAuthenticated, loading, hasRole } = useAdmin();
  const navigate = useNavigate();

  const [templates, setTemplates] = useState([]);
  const [editingSlug, setEditingSlug] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const load = useCallback(async () => {
    setLoadingList(true);
    const res = await fetch('/api/admin/email-templates', { credentials: 'include', cache: 'no-store' });
    if (res.ok) setTemplates((await res.json()).templates || []);
    setLoadingList(false);
  }, []);

  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  if (loading || !isAuthenticated) return null;

  const counts = {
    all: templates.length,
    published: templates.filter((t) => (t.status || 'published') === 'published').length,
    draft: templates.filter((t) => t.status === 'draft').length,
  };
  const visibleTemplates = statusFilter === 'all'
    ? templates
    : templates.filter((t) => (t.status || 'published') === statusFilter);

  return (
    <div style={pageWrap}>
      <AdminPageHeader
        title="Email Templates"
        description="Edit the subject and body of every transactional email. Owner only. Variables in {{double braces}} are substituted with real booking / attendee / user data at send time."
        breadcrumb={[{ label: 'Settings', to: '/admin/settings' }, { label: 'Email Templates' }]}
      />

      {!loadingList && templates.length > 0 && (
        <div style={filterChipsRow}>
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                aria-pressed={active}
                style={active ? filterChipActive : filterChipInactive}
              >
                {f.label} ({counts[f.id]})
              </button>
            );
          })}
        </div>
      )}

      <section style={tableBox}>
        {loadingList && <EmptyState variant="loading" title="Loading templates…" compact />}
        {!loadingList && templates.length === 0 && (
          <EmptyState
            title="No templates configured"
            description="The app should seed templates at install — if this list is empty, contact engineering."
          />
        )}
        {!loadingList && templates.length > 0 && visibleTemplates.length === 0 && (
          <EmptyState
            title={`No ${statusFilter} templates`}
            description="Switch the filter chip above to see other templates, or flip an existing template's status in its editor."
            compact
          />
        )}
        {!loadingList && visibleTemplates.length > 0 && (
          <div className="admin-table-wrap"><table style={table}>
            <thead>
              <tr>
                <th style={th}>Template</th>
                <th style={th}>Subject</th>
                <th style={th}>Status</th>
                <th style={th}>Variables</th>
                <th style={th}>Last updated</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {visibleTemplates.map((t) => (
                <tr key={t.slug} style={tr}>
                  <td style={td}>
                    <strong>{SLUG_LABELS[t.slug] || t.slug}</strong>
                    <div style={subRowMono}>{t.slug}</div>
                  </td>
                  <td style={tdSmall}>{t.subject}</td>
                  <td style={tdSmall}>
                    <StatusBadge status={t.status || 'published'} />
                  </td>
                  <td style={tdSmall}>
                    {(t.variables || []).map((v) => (
                      <code key={v} style={varChip}>{`{{${v}}}`}</code>
                    ))}
                  </td>
                  <td style={tdSmaller}>
                    {t.updatedAt ? new Date(t.updatedAt).toLocaleDateString() : '—'}
                  </td>
                  <td style={td}>
                    {hasRole('owner')
                      ? <button onClick={() => setEditingSlug(t.slug)} style={primaryBtn}>Edit</button>
                      : <button onClick={() => setEditingSlug(t.slug)} style={subtleBtn}>View</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      {editingSlug && (
        <TemplateEditor
          slug={editingSlug}
          readOnly={!hasRole('owner')}
          onClose={() => setEditingSlug(null)}
          onSaved={() => { setEditingSlug(null); load(); }}
        />
      )}
    </div>
  );
}

function TemplateEditor({ slug, readOnly, onClose, onSaved }) {
  const [template, setTemplate] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewSource, setPreviewSource] = useState('sample');
  const [previewEntityId, setPreviewEntityId] = useState('');
  const [previewError, setPreviewError] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [form, setForm] = useState({ subject: '', bodyHtml: '', bodyText: '', status: 'published' });
  const [tab, setTab] = useState('html');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  const supportsRealData = SUPPORTED_PREVIEW_SLUGS.has(slug);

  const load = useCallback(async () => {
    const [tRes, pRes] = await Promise.all([
      fetch(`/api/admin/email-templates/${slug}`, { credentials: 'include', cache: 'no-store' }),
      fetch(`/api/admin/email-templates/${slug}/preview`, { credentials: 'include', cache: 'no-store' }),
    ]);
    if (tRes.ok) {
      const { template } = await tRes.json();
      setTemplate(template);
      setForm({
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        bodyText: template.bodyText || '',
        status: template.status || 'published',
      });
    }
    if (pRes.ok) {
      const data = await pRes.json();
      setPreview(data.rendered);
      setPreviewSource(data.source || 'sample');
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  // Re-fetch preview against a real entity. Called from the "Preview with
  // real data" controls in the preview tab. Falls back to the sample-vars
  // path when the input is cleared via resetPreviewToSample below.
  const refreshPreviewWithData = async () => {
    const id = previewEntityId.trim();
    if (!id) { setPreviewError('Enter a booking ID first.'); return; }
    setPreviewError(null);
    setPreviewLoading(true);
    const url = `/api/admin/email-templates/${slug}/preview?bookingId=${encodeURIComponent(id)}`;
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    setPreviewLoading(false);
    if (res.ok) {
      setPreview(data.rendered);
      setPreviewSource(data.source || 'real');
    } else {
      setPreviewError(humanizePreviewError(data.error) || 'Preview failed.');
    }
  };

  const resetPreviewToSample = async () => {
    setPreviewEntityId('');
    setPreviewError(null);
    setPreviewLoading(true);
    const res = await fetch(`/api/admin/email-templates/${slug}/preview`, { credentials: 'include', cache: 'no-store' });
    setPreviewLoading(false);
    if (res.ok) {
      const data = await res.json();
      setPreview(data.rendered);
      setPreviewSource(data.source || 'sample');
    }
  };

  const flash = (kind, text) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 3500);
  };

  const save = async () => {
    setSaving(true);
    const res = await fetch(`/api/admin/email-templates/${slug}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) {
      const { template: updated } = await res.json().catch(() => ({}));
      if (updated) setTemplate(updated);
      flash('ok', form.status === 'draft' ? 'Saved as draft' : 'Saved');
      const p = await fetch(`/api/admin/email-templates/${slug}/preview`, { credentials: 'include', cache: 'no-store' });
      if (p.ok) {
        const pData = await p.json();
        setPreview(pData.rendered);
        setPreviewSource(pData.source || 'sample');
      }
      // Reset real-data state on save — operator typically wants a fresh
      // sample preview to confirm the template still looks right after edits.
      setPreviewEntityId('');
      onSaved?.();
    } else {
      const d = await res.json().catch(() => ({}));
      flash('err', d.error || 'Save failed');
    }
  };

  const sendTest = async () => {
    if (!testEmail.trim()) { flash('err', 'Enter an email first'); return; }
    setSendingTest(true);
    const res = await fetch(`/api/admin/email-templates/${slug}/send-test`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: testEmail.trim() }),
    });
    setSendingTest(false);
    if (res.ok) { const d = await res.json(); flash('ok', `Test sent to ${d.sentTo}`); }
    else { const d = await res.json().catch(() => ({})); flash('err', d.error || 'Send failed'); }
  };

  if (!template) {
    return (
      <div style={modalBg} onClick={onClose}>
        <div style={modal} onClick={(e) => e.stopPropagation()}>
          <EmptyState variant="loading" title="Loading template…" compact />
        </div>
      </div>
    );
  }

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div>
            <div style={modalEyebrow}>{readOnly ? 'View template' : 'Edit template'}</div>
            <h3 style={modalTitle}>{SLUG_LABELS[slug] || slug}</h3>
            <div style={subRowMono}>{slug}</div>
          </div>
          <button onClick={onClose} style={subtleBtn}>Close</button>
        </div>

        <div style={varsLine}>
          Available variables:{' '}
          {(template.variables || []).map((v) => (
            <code key={v} style={varChip}>{`{{${v}}}`}</code>
          ))}
        </div>

        <div style={statusToggleRow}>
          <span style={statusToggleLabel}>Status:</span>
          {!readOnly ? (
            <div style={statusToggleGroup}>
              <button
                type="button"
                onClick={() => setForm({ ...form, status: 'published' })}
                aria-pressed={form.status === 'published'}
                style={form.status === 'published' ? statusToggleBtnActive : statusToggleBtnInactive}
              >
                Published
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, status: 'draft' })}
                aria-pressed={form.status === 'draft'}
                style={form.status === 'draft' ? statusToggleBtnActive : statusToggleBtnInactive}
              >
                Draft
              </button>
            </div>
          ) : (
            <StatusBadge status={form.status || 'published'} />
          )}
        </div>

        {!readOnly && form.status === 'draft' && template.status === 'published' && (
          <div style={statusWarning}>
            ⚠ Moving to Draft — this template won't be sent or test-sent until you re-publish.
          </div>
        )}
        {!readOnly && form.status === 'published' && template.status === 'draft' && (
          <div style={statusInfo}>
            ✓ Publishing — once saved, this template becomes send-eligible immediately.
          </div>
        )}

        <Field label="Subject">
          <input
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            readOnly={readOnly}
            style={input}
          />
        </Field>

        <div style={tabRow}>
          {['html', 'text', 'preview'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                ...tabBtn,
                color: tab === t ? 'var(--color-accent)' : 'var(--color-text-muted)',
                borderBottom: tab === t ? '2px solid var(--color-accent)' : '2px solid transparent',
              }}
            >{t === 'html' ? 'HTML body' : t === 'text' ? 'Text body' : 'Preview'}</button>
          ))}
        </div>

        {tab === 'html' && (
          <textarea
            value={form.bodyHtml}
            onChange={(e) => setForm({ ...form, bodyHtml: e.target.value })}
            readOnly={readOnly}
            rows={16}
            style={{ ...input, fontFamily: 'monospace', fontSize: 'var(--font-size-sm)', resize: 'vertical', marginTop: 'var(--space-8)' }}
          />
        )}
        {tab === 'text' && (
          <textarea
            value={form.bodyText}
            onChange={(e) => setForm({ ...form, bodyText: e.target.value })}
            readOnly={readOnly}
            rows={16}
            placeholder="Plain-text fallback (optional)"
            style={{ ...input, fontFamily: 'monospace', fontSize: 'var(--font-size-sm)', resize: 'vertical', marginTop: 'var(--space-8)' }}
          />
        )}
        {tab === 'preview' && (
          <>
            {supportsRealData && (
              <div style={realDataSection}>
                <div style={realDataHeader}>
                  <span style={realDataLabel}>Preview source:</span>
                  <span style={previewSource === 'real' ? sourceChipReal : sourceChipSample}>
                    {previewSource === 'real' ? `Real: ${previewEntityId || 'entity'}` : 'Sample data'}
                  </span>
                </div>
                <div style={realDataRow}>
                  <input
                    placeholder="bk_..."
                    value={previewEntityId}
                    onChange={(e) => { setPreviewEntityId(e.target.value); setPreviewError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); refreshPreviewWithData(); } }}
                    aria-label="Booking ID for real-data preview"
                    style={{ ...input, flex: 1, minWidth: 220 }}
                  />
                  <button
                    type="button"
                    onClick={refreshPreviewWithData}
                    disabled={previewLoading || !previewEntityId.trim()}
                    style={secondaryBtn}
                  >
                    {previewLoading ? 'Loading…' : 'Preview real data'}
                  </button>
                  {previewSource === 'real' && (
                    <button
                      type="button"
                      onClick={resetPreviewToSample}
                      disabled={previewLoading}
                      style={subtleBtn}
                    >
                      Reset to sample
                    </button>
                  )}
                </div>
                {previewError && (
                  <div style={realDataError}>{previewError}</div>
                )}
                <div style={realDataHint}>
                  Renders the template against a real booking's data. Find a recent booking ID under{' '}
                  <a href="/admin/bookings" target="_blank" rel="noreferrer" style={inlineLink}>
                    /admin/bookings
                  </a>.
                </div>
              </div>
            )}
            <div style={previewWrap}>
              <div style={previewSubject}>
                <strong>Subject:</strong> {preview?.subject || '—'}
              </div>
              <iframe
                title="preview"
                srcDoc={preview?.html || ''}
                style={previewIframe}
              />
            </div>
          </>
        )}

        {msg && (
          <div style={{
            ...flashBanner,
            background: msg.kind === 'ok' ? 'var(--color-success-soft)' : 'var(--color-danger-soft)',
            color: msg.kind === 'ok' ? 'var(--color-success)' : 'var(--color-danger)',
          }}>{msg.text}</div>
        )}

        {!readOnly && (
          <>
            <div style={modalActions}>
              <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save changes'}</button>
              <button onClick={onClose} style={subtleBtn}>Close</button>
            </div>

            <div style={testSection}>
              <div style={testLabel}>Send a test</div>
              <div style={testRow}>
                <input
                  type="email" placeholder="you@example.com"
                  value={testEmail} onChange={(e) => setTestEmail(e.target.value)}
                  style={{ ...input, flex: 1, minWidth: 240 }}
                />
                <button onClick={sendTest} disabled={sendingTest || !testEmail} style={secondaryBtn}>
                  {sendingTest ? 'Sending…' : 'Send test email'}
                </button>
              </div>
              <div style={testHint}>
                Sends the rendered template with sample variable values to the address above. Subject is prefixed with{' '}
                <code style={{ color: 'var(--color-text-muted)' }}>[TEST]</code>.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={fieldLabel}>
      <div style={fieldLabelText}>{label}</div>
      {children}
    </label>
  );
}

function StatusBadge({ status }) {
  const isDraft = status === 'draft';
  return (
    <span style={isDraft ? statusBadgeDraft : statusBadgePublished}>
      <span style={statusBadgeDot} />
      {isDraft ? 'Draft' : 'Published'}
    </span>
  );
}

// Maps worker preview-route error codes to human-friendly UI copy.
function humanizePreviewError(code) {
  switch (code) {
    case 'booking_not_found':       return 'No booking found with that ID.';
    case 'event_not_found':         return 'The booking exists but its event is missing — contact engineering.';
    case 'missing_entity_id':       return 'Enter a booking ID first.';
    case 'unknown_template_slug':   return 'This template does not support real-data preview.';
    default:                        return null;
  }
}

const pageWrap = { maxWidth: 1100, margin: '0 auto', padding: 'var(--space-32)' };
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
const tableBox = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-24)',
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
const tdSmaller = { ...td, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' };
const subRowMono = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-muted)',
  fontFamily: 'monospace',
};
const varChip = {
  color: 'var(--color-text-muted)',
  marginRight: 'var(--space-4)',
  fontSize: 'var(--font-size-xs)',
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
const secondaryBtn = {
  padding: 'var(--space-8) var(--space-16)',
  background: 'var(--color-bg-sunken)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-strong)',
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
const tabBtn = {
  padding: 'var(--space-8) var(--space-16)',
  background: 'transparent',
  border: 'none',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const tabRow = {
  display: 'flex',
  gap: 'var(--space-4)',
  marginTop: 'var(--space-12)',
  borderBottom: '1px solid var(--color-border)',
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
  maxWidth: 820,
  borderRadius: 'var(--radius-md)',
  maxHeight: '92vh',
  overflowY: 'auto',
};
const modalHeader = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: 'var(--space-12)',
};
const modalEyebrow = {
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wider)',
  color: 'var(--color-accent)',
  textTransform: 'uppercase',
};
const modalTitle = {
  margin: 0,
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-lg)',
  fontWeight: 'var(--font-weight-extrabold)',
};
const modalActions = {
  display: 'flex',
  gap: 'var(--space-8)',
  marginTop: 'var(--space-16)',
  alignItems: 'center',
  flexWrap: 'wrap',
};
const varsLine = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-muted)',
  marginBottom: 'var(--space-12)',
};
const previewWrap = {
  marginTop: 'var(--space-8)',
  border: '1px solid var(--color-border)',
  background: '#fff',
};
const previewSubject = {
  padding: 'var(--space-8) var(--space-12)',
  background: 'rgba(0, 0, 0, 0.05)',
  borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
  color: '#222',
  fontSize: 'var(--font-size-sm)',
};
const previewIframe = { width: '100%', height: 420, border: 'none', background: '#fff' };
const flashBanner = {
  marginTop: 'var(--space-8)',
  padding: 'var(--space-8)',
  fontSize: 'var(--font-size-sm)',
};
const testSection = {
  marginTop: 'var(--space-16)',
  paddingTop: 'var(--space-16)',
  borderTop: '1px solid var(--color-border)',
};
const testLabel = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wider)',
  color: 'var(--color-accent)',
  textTransform: 'uppercase',
  marginBottom: 'var(--space-8)',
};
const testRow = {
  display: 'flex',
  gap: 'var(--space-8)',
  alignItems: 'center',
  flexWrap: 'wrap',
};
const testHint = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-muted)',
  marginTop: 'var(--space-4)',
};
const fieldLabel = { display: 'block', marginTop: 'var(--space-12)' };
const fieldLabelText = {
  fontSize: 'var(--font-size-sm)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  color: 'var(--color-accent)',
  fontWeight: 'var(--font-weight-bold)',
  marginBottom: 'var(--space-4)',
};

// ─── M6 B4 — filter chips above list ─────────────────────────────
const filterChipsRow = {
  display: 'flex',
  gap: 'var(--space-8)',
  marginBottom: 'var(--space-16)',
  flexWrap: 'wrap',
};
const filterChipBase = {
  padding: 'var(--space-4) var(--space-12)',
  border: '1px solid var(--color-border-strong)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const filterChipActive = {
  ...filterChipBase,
  background: 'var(--color-accent)',
  color: 'var(--color-accent-on-accent)',
};
const filterChipInactive = {
  ...filterChipBase,
  background: 'transparent',
  color: 'var(--color-text-muted)',
};

// ─── M6 B4 — status badge (list + read-only modal) ───────────────
const statusBadgeBase = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-4)',
  padding: '2px var(--space-8)',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  border: '1px solid currentColor',
  borderRadius: 'var(--radius-sm, 2px)',
};
const statusBadgePublished = {
  ...statusBadgeBase,
  color: 'var(--color-success, #22c55e)',
  background: 'var(--color-success-soft, rgba(34, 197, 94, 0.12))',
};
const statusBadgeDraft = {
  ...statusBadgeBase,
  color: 'var(--color-warning, #fb923c)',
  background: 'var(--color-warning-soft, rgba(251, 146, 60, 0.15))',
};
const statusBadgeDot = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'currentColor',
  display: 'inline-block',
};

// ─── M6 B4 — modal status toggle row ─────────────────────────────
const statusToggleRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-12)',
  marginBottom: 'var(--space-12)',
};
const statusToggleLabel = {
  fontSize: 'var(--font-size-sm)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  color: 'var(--color-accent)',
  fontWeight: 'var(--font-weight-bold)',
};
const statusToggleGroup = {
  display: 'inline-flex',
  border: '1px solid var(--color-border-strong)',
  overflow: 'hidden',
};
const statusToggleBtnBase = {
  padding: 'var(--space-4) var(--space-16)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
  border: 'none',
  fontFamily: 'inherit',
};
const statusToggleBtnActive = {
  ...statusToggleBtnBase,
  background: 'var(--color-accent)',
  color: 'var(--color-accent-on-accent)',
};
const statusToggleBtnInactive = {
  ...statusToggleBtnBase,
  background: 'transparent',
  color: 'var(--color-text-muted)',
};
const statusWarning = {
  padding: 'var(--space-8) var(--space-12)',
  background: 'var(--color-warning-soft, rgba(251, 146, 60, 0.15))',
  color: 'var(--color-warning, #fb923c)',
  border: '1px solid var(--color-warning, #fb923c)',
  fontSize: 'var(--font-size-sm)',
  marginBottom: 'var(--space-12)',
};
const statusInfo = {
  padding: 'var(--space-8) var(--space-12)',
  background: 'var(--color-success-soft, rgba(34, 197, 94, 0.12))',
  color: 'var(--color-success, #22c55e)',
  border: '1px solid var(--color-success, #22c55e)',
  fontSize: 'var(--font-size-sm)',
  marginBottom: 'var(--space-12)',
};

// ─── M6 B4 — real-data preview section ───────────────────────────
const realDataSection = {
  padding: 'var(--space-12)',
  background: 'var(--color-bg-sunken)',
  border: '1px solid var(--color-border)',
  marginTop: 'var(--space-8)',
  marginBottom: 'var(--space-8)',
};
const realDataHeader = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-8)',
  marginBottom: 'var(--space-8)',
};
const realDataLabel = {
  fontSize: 'var(--font-size-xs)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  fontWeight: 'var(--font-weight-bold)',
};
const sourceChipBase = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px var(--space-8)',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  border: '1px solid currentColor',
  borderRadius: 'var(--radius-sm, 2px)',
};
const sourceChipSample = {
  ...sourceChipBase,
  color: 'var(--color-text-muted)',
  background: 'transparent',
};
const sourceChipReal = {
  ...sourceChipBase,
  color: 'var(--color-accent)',
  background: 'var(--color-accent-soft, rgba(255, 153, 0, 0.12))',
};
const realDataRow = {
  display: 'flex',
  gap: 'var(--space-8)',
  alignItems: 'center',
  flexWrap: 'wrap',
};
const realDataError = {
  marginTop: 'var(--space-8)',
  padding: 'var(--space-4) var(--space-8)',
  background: 'var(--color-danger-soft)',
  color: 'var(--color-danger)',
  border: '1px solid var(--color-danger)',
  fontSize: 'var(--font-size-sm)',
};
const realDataHint = {
  marginTop: 'var(--space-8)',
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-muted)',
};
const inlineLink = {
  color: 'var(--color-accent)',
  textDecoration: 'underline',
};

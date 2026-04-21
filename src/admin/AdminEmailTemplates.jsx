import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';

const SLUG_LABELS = {
  booking_confirmation: 'Booking confirmation',
  admin_notify: 'Admin new-booking notification',
  waiver_request: 'Waiver request',
  event_reminder_24h: 'Event reminder — 24hr',
  event_reminder_1hr: 'Event reminder — 1hr',
  password_reset: 'Password reset',
  user_invite: 'Team invite',
};

export default function AdminEmailTemplates() {
  const { isAuthenticated, loading, hasRole } = useAdmin();
  const navigate = useNavigate();

  const [templates, setTemplates] = useState([]);
  const [editingSlug, setEditingSlug] = useState(null);
  const [loadingList, setLoadingList] = useState(false);

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

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Link to="/admin/settings" style={backLink}>← Settings</Link>
      </div>
      <h1 style={h1}>Email Templates</h1>
      <p style={{ color: 'var(--olive-light)', fontSize: 13, marginBottom: 24 }}>
        Edit the subject and body of every transactional email. Owner only.
        Variables inside <code style={{ color: 'var(--tan)' }}>{'{{double braces}}'}</code> are substituted with real booking / attendee / user data at send time.
      </p>

      <section style={tableBox}>
        {loadingList && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}
        {templates.length > 0 && (
          <div className="admin-table-wrap"><table style={table}>
            <thead>
              <tr>
                <th style={th}>Template</th>
                <th style={th}>Subject</th>
                <th style={th}>Variables</th>
                <th style={th}>Last updated</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.slug} style={tr}>
                  <td style={td}>
                    <strong>{SLUG_LABELS[t.slug] || t.slug}</strong>
                    <div style={{ fontSize: 10, color: 'var(--olive-light)', fontFamily: 'monospace' }}>{t.slug}</div>
                  </td>
                  <td style={{ ...td, fontSize: 12 }}>{t.subject}</td>
                  <td style={{ ...td, fontSize: 11 }}>
                    {(t.variables || []).map((v) => (
                      <code key={v} style={{ color: 'var(--tan)', marginRight: 6, fontSize: 10 }}>{`{{${v}}}`}</code>
                    ))}
                  </td>
                  <td style={{ ...td, fontSize: 11, color: 'var(--olive-light)' }}>
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
  const [form, setForm] = useState({ subject: '', bodyHtml: '', bodyText: '' });
  const [tab, setTab] = useState('html'); // html | text | preview
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

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
      });
    }
    if (pRes.ok) setPreview((await pRes.json()).rendered);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

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
      flash('ok', 'Saved');
      // Refresh preview with the new body
      const p = await fetch(`/api/admin/email-templates/${slug}/preview`, { credentials: 'include', cache: 'no-store' });
      if (p.ok) setPreview((await p.json()).rendered);
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
          <p style={{ color: 'var(--olive-light)' }}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: 'var(--orange)', textTransform: 'uppercase' }}>
              {readOnly ? 'View template' : 'Edit template'}
            </div>
            <h3 style={{ margin: 0, color: 'var(--cream)', fontSize: 18 }}>{SLUG_LABELS[slug] || slug}</h3>
            <div style={{ fontSize: 10, color: 'var(--olive-light)', fontFamily: 'monospace' }}>{slug}</div>
          </div>
          <button onClick={onClose} style={subtleBtn}>Close</button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--olive-light)', marginBottom: 10 }}>
          Available variables:{' '}
          {(template.variables || []).map((v) => (
            <code key={v} style={{ color: 'var(--tan)', marginRight: 6 }}>{`{{${v}}}`}</code>
          ))}
        </div>

        <Field label="Subject">
          <input
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            readOnly={readOnly}
            style={input}
          />
        </Field>

        <div style={{ display: 'flex', gap: 4, marginTop: 12, borderBottom: '1px solid rgba(200,184,154,0.12)' }}>
          {['html', 'text', 'preview'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                ...tabBtn,
                color: tab === t ? 'var(--orange)' : 'var(--tan-light)',
                borderBottom: tab === t ? '2px solid var(--orange)' : '2px solid transparent',
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
            style={{ ...input, fontFamily: 'monospace', fontSize: 12, resize: 'vertical', marginTop: 10 }}
          />
        )}
        {tab === 'text' && (
          <textarea
            value={form.bodyText}
            onChange={(e) => setForm({ ...form, bodyText: e.target.value })}
            readOnly={readOnly}
            rows={16}
            placeholder="Plain-text fallback (optional)"
            style={{ ...input, fontFamily: 'monospace', fontSize: 12, resize: 'vertical', marginTop: 10 }}
          />
        )}
        {tab === 'preview' && (
          <div style={{ marginTop: 10, border: '1px solid rgba(200,184,154,0.15)', background: '#fff' }}>
            <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.05)', borderBottom: '1px solid rgba(0,0,0,0.1)', color: '#222', fontSize: 12 }}>
              <strong>Subject:</strong> {preview?.subject || '—'}
            </div>
            <iframe
              title="preview"
              srcDoc={preview?.html || ''}
              style={{ width: '100%', height: 420, border: 'none', background: '#fff' }}
            />
          </div>
        )}

        {msg && (
          <div style={{
            marginTop: 10, padding: 8, fontSize: 12,
            background: msg.kind === 'ok' ? 'rgba(39,174,96,0.15)' : 'rgba(231,76,60,0.15)',
            color: msg.kind === 'ok' ? '#2ecc71' : '#ff8a7e',
          }}>{msg.text}</div>
        )}

        {!readOnly && (
          <>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save changes'}</button>
              <button onClick={onClose} style={subtleBtn}>Close</button>
            </div>

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(200,184,154,0.1)' }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: 'var(--orange)', textTransform: 'uppercase', marginBottom: 8 }}>
                Send a test
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="email" placeholder="you@example.com"
                  value={testEmail} onChange={(e) => setTestEmail(e.target.value)}
                  style={{ ...input, flex: 1, minWidth: 240 }}
                />
                <button onClick={sendTest} disabled={sendingTest || !testEmail} style={secondaryBtn}>
                  {sendingTest ? 'Sending…' : 'Send test email'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--olive-light)', marginTop: 6 }}>
                Sends the rendered template with sample variable values to the address above. Subject is prefixed with <code style={{ color: 'var(--tan)' }}>[TEST]</code>.
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
    <label style={{ display: 'block', marginTop: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const backLink = { color: 'var(--olive-light)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'none' };
const input = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const tableBox = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1.5rem' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', color: 'var(--cream)', verticalAlign: 'top' };
const primaryBtn = { padding: '10px 18px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const secondaryBtn = { padding: '10px 18px', background: 'var(--olive)', color: 'var(--cream)', border: '1px solid var(--olive-light)', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const subtleBtn = { padding: '6px 12px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };
const tabBtn = { padding: '10px 16px', background: 'transparent', border: 'none', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.2)', padding: '1.5rem', width: '100%', maxWidth: 820, borderRadius: 4, maxHeight: '92vh', overflowY: 'auto' };

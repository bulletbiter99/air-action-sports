import { useEffect, useState } from 'react';

const TYPES = [
  { value: 'bug', label: 'Bug', desc: 'Something is broken or behaving unexpectedly.' },
  { value: 'feature', label: 'Feature request', desc: 'Idea for something new.' },
  { value: 'usability', label: 'Usability', desc: 'Something is confusing or hard to use.' },
  { value: 'other', label: 'Other', desc: 'General comments.' },
];

const ATTACHMENT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ATTACHMENT_MAX = 5 * 1024 * 1024;

export default function FeedbackModal({ open, onClose, defaultEmail = '' }) {
  const [type, setType] = useState('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState(defaultEmail);
  const [website, setWebsite] = useState(''); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const [attachment, setAttachment] = useState(null); // { url, bytes, localPreview }
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setType('bug'); setTitle(''); setDescription(''); setEmail(defaultEmail);
      setWebsite(''); setSent(false); setErr('');
      setAttachment(null); setUploading(false);
    }
  }, [open, defaultEmail]);

  if (!open) return null;

  const uploadAttachment = async (file) => {
    setErr('');
    if (!ATTACHMENT_MIME.has(file.type)) {
      setErr('Screenshot must be JPEG, PNG, WebP, or GIF.');
      return;
    }
    if (file.size > ATTACHMENT_MAX) {
      setErr(`Screenshot is ${Math.round(file.size / 1024 / 1024 * 10) / 10} MB. Max 5 MB.`);
      return;
    }
    setUploading(true);
    try {
      const localPreview = URL.createObjectURL(file);
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/feedback/attachment', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        URL.revokeObjectURL(localPreview);
        setErr(data.error || 'Upload failed. Try again.');
        return;
      }
      setAttachment({ url: data.url, bytes: data.bytes, localPreview });
    } catch (_e) {
      setErr('Upload failed (network). Try again.');
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = () => {
    if (attachment?.localPreview) URL.revokeObjectURL(attachment.localPreview);
    setAttachment(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!title.trim()) { setErr('Title is required.'); return; }
    if (!description.trim()) { setErr('Description is required.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title: title.trim(),
          description: description.trim(),
          email: email.trim() || undefined,
          website, // honeypot
          attachmentUrl: attachment?.url || undefined,
          attachmentSize: attachment?.bytes || undefined,
          pageUrl: typeof window !== 'undefined' ? window.location.href : '',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || 'Submission failed. Try again.'); setSubmitting(false); return; }
      setSent(true);
    } catch (_e) {
      setErr('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 id="feedback-title" style={h2}>Share feedback</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={closeX}>&times;</button>
        </div>

        {sent ? (
          <div style={{ textAlign: 'center', padding: '24px 12px' }}>
            <div style={{ fontSize: 42, marginBottom: 8 }}>&#10003;</div>
            <h3 style={{ margin: '0 0 6px', color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: 1 }}>Thanks!</h3>
            <p style={{ color: 'var(--tan-light)', fontSize: 14, margin: '0 0 20px' }}>
              Your feedback was received. {email ? "We'll reply if needed." : ''}
            </p>
            <button type="button" onClick={onClose} style={primaryBtn}>Close</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div style={sectionLabel}>What kind of feedback?</div>
            <div style={typeGrid}>
              {TYPES.map((t) => (
                <label key={t.value} style={{ ...typeOption, ...(type === t.value ? typeOptionActive : {}) }}>
                  <input
                    type="radio"
                    name="feedback-type"
                    value={t.value}
                    checked={type === t.value}
                    onChange={() => setType(t.value)}
                    style={{ display: 'none' }}
                  />
                  <div style={{ fontWeight: 800, fontSize: 13, color: type === t.value ? 'var(--orange)' : 'var(--cream)', textTransform: 'uppercase', letterSpacing: 1 }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--olive-light)', marginTop: 2 }}>{t.desc}</div>
                </label>
              ))}
            </div>

            <label style={fieldLabel}>
              Title
              <input
                required
                type="text"
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="One-line summary"
                style={input}
              />
            </label>

            <label style={fieldLabel}>
              Details
              <textarea
                required
                rows={5}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What happened? What did you expect? Steps to reproduce are super helpful."
                style={{ ...input, resize: 'vertical' }}
              />
              <div style={charCounter}>{description.length}/2000</div>
            </label>

            <label style={fieldLabel}>
              Screenshot (optional)
              {!attachment && (
                <label style={uploadBtn}>
                  {uploading ? 'Uploading…' : '+ Attach image'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadAttachment(f);
                      e.target.value = '';
                    }}
                    disabled={uploading}
                    style={{ display: 'none' }}
                  />
                </label>
              )}
              {attachment && (
                <div style={attachmentPreviewWrap}>
                  <img src={attachment.localPreview} alt="Screenshot preview" style={attachmentThumb} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--tan-light)', textTransform: 'none', letterSpacing: 'normal' }}>
                      Attached · {Math.round(attachment.bytes / 1024)} KB
                    </div>
                  </div>
                  <button type="button" onClick={removeAttachment} style={removeBtn} aria-label="Remove attachment">×</button>
                </div>
              )}
            </label>

            <label style={fieldLabel}>
              Your email (optional, so we can follow up)
              <input
                type="email"
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={input}
              />
            </label>

            {/* Honeypot — hidden from users, filled by bots */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}>
              <label>
                Website
                <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
            </div>

            {err && <div style={{ color: '#e74c3c', fontSize: 13, margin: '10px 0' }}>{err}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button type="submit" disabled={submitting} style={primaryBtn}>
                {submitting ? 'Sending…' : '▶ Submit feedback'}
              </button>
              <button type="button" onClick={onClose} style={subtleBtn}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const backdrop = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 };
const card = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.2)', padding: '1.75rem', width: '100%', maxWidth: 560, borderRadius: 4, maxHeight: '92vh', overflowY: 'auto', position: 'relative' };
const h2 = { margin: 0, color: 'var(--cream)', fontSize: 18, textTransform: 'uppercase', letterSpacing: 2, fontWeight: 900 };
const closeX = { width: 32, height: 32, border: '1px solid rgba(200,184,154,0.25)', background: 'transparent', color: 'var(--tan-light)', fontSize: 22, lineHeight: 1, cursor: 'pointer', borderRadius: 4, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const sectionLabel = { fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 800, margin: '0 0 10px' };
const typeGrid = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 16 };
const typeOption = { border: '1px solid rgba(200,184,154,0.2)', padding: 10, cursor: 'pointer', borderRadius: 3, background: 'var(--dark)' };
const typeOptionActive = { borderColor: 'var(--orange)', background: 'rgba(215,108,33,0.08)' };
const fieldLabel = { display: 'block', color: 'var(--tan-light)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700, marginBottom: 12 };
const input = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', marginTop: 4, textTransform: 'none', letterSpacing: 'normal' };
const charCounter = { fontSize: 10, color: 'var(--olive-light)', textAlign: 'right', marginTop: 2 };
const uploadBtn = { display: 'inline-block', marginTop: 4, padding: '10px 14px', border: '1px dashed rgba(200,184,154,0.35)', color: 'var(--tan-light)', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', textAlign: 'center', background: 'var(--dark)' };
const attachmentPreviewWrap = { display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, padding: 8, background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', borderRadius: 3 };
const attachmentThumb = { width: 56, height: 56, objectFit: 'cover', border: '1px solid rgba(200,184,154,0.15)', borderRadius: 2, flexShrink: 0 };
const removeBtn = { width: 28, height: 28, background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 18, lineHeight: 1, cursor: 'pointer', borderRadius: 3, padding: 0, flexShrink: 0 };
const primaryBtn = { padding: '12px 22px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const subtleBtn = { padding: '12px 22px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };

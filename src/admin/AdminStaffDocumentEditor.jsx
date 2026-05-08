// M5 Batch 5 — Staff document detail / editor (Surface 4a part 3).
//
// Two modes:
//   /admin/staff/library/new  — create a brand-new document
//   /admin/staff/library/:id  — view existing; "+ New Version" creates
//                                 a new version + retires the previous

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';

export default function AdminStaffDocumentEditor() {
    const { id } = useParams();
    const isNew = !id;
    const navigate = useNavigate();
    const { isAuthenticated, hasRole } = useAdmin();

    const [doc, setDoc] = useState(null);
    const [loading, setLoading] = useState(!isNew);
    const [editorOpen, setEditorOpen] = useState(isNew);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const [kind, setKind] = useState('sop');
    const [slug, setSlug] = useState('');
    const [title, setTitle] = useState('');
    const [version, setVersion] = useState('v1.0');
    const [bodyHtml, setBodyHtml] = useState('');
    const [primaryRoleId, setPrimaryRoleId] = useState('');
    const [description, setDescription] = useState('');

    const load = useCallback(async () => {
        if (isNew) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/staff-documents/${id}`, { credentials: 'include', cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                setDoc(data);
                if (data.document) {
                    setKind(data.document.kind);
                    setSlug(data.document.slug);
                    setTitle(data.document.title);
                    setVersion(bumpVersion(data.document.version));
                    setBodyHtml(data.document.bodyHtml || '');
                    setPrimaryRoleId(data.document.primaryRoleId || '');
                    setDescription(data.document.description || '');
                }
            } else if (res.status === 404) {
                navigate('/admin/staff/library');
            }
        } finally {
            setLoading(false);
        }
    }, [id, isNew, navigate]);

    useEffect(() => { if (isAuthenticated && !isNew) load(); }, [isAuthenticated, isNew, load]);

    async function submit() {
        setError(null);
        setSubmitting(true);
        try {
            const res = await fetch('/api/admin/staff-documents', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind, slug, title, version, bodyHtml,
                    primaryRoleId: primaryRoleId || null,
                    description,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                navigate(`/admin/staff/library/${data.document.id}`);
            } else {
                setError(data.error || 'Save failed');
            }
        } catch (err) {
            setError(err?.message || 'Network error');
        } finally {
            setSubmitting(false);
        }
    }

    if (!isAuthenticated) return null;
    if (loading) return <div style={page}><p style={{ color: 'var(--olive-light)' }}>Loading…</p></div>;

    return (
        <div style={page}>
            <Link to="/admin/staff/library" style={breadcrumb}>← Library</Link>
            <h1 style={h1}>{isNew ? 'New document' : `${title} — ${doc?.document?.version}${doc?.document?.retiredAt ? ' (retired)' : ' (live)'}`}</h1>

            {!isNew && doc && !editorOpen && (
                <>
                    <div style={section}>
                        <h2 style={h2}>Body</h2>
                        <pre style={preBody}>{doc.document.bodyHtml}</pre>
                        <p style={{ color: 'var(--olive-light)', fontSize: 11, marginTop: 8 }}>
                            SHA-256: <code style={codeText}>{doc.document.bodySha256}</code>
                        </p>
                    </div>
                    <div style={section}>
                        <h2 style={h2}>Role tags ({(doc.roleTags || []).length})</h2>
                        {(doc.roleTags || []).length === 0 && <p style={{ color: 'var(--olive-light)' }}>No role tags. Manager+ can attach via API.</p>}
                        {(doc.roleTags || []).map((t) => (
                            <div key={t.id} style={tagRow}>
                                <strong style={{ color: 'var(--cream)' }}>{t.name}</strong>
                                {t.required && <span style={requiredPill}>Required</span>}
                            </div>
                        ))}
                    </div>
                    {hasRole?.('manager') && !doc.document.retiredAt && (
                        <button type="button" onClick={() => setEditorOpen(true)} style={primaryBtn}>+ New Version</button>
                    )}
                </>
            )}

            {(isNew || editorOpen) && (
                <div style={section}>
                    <h2 style={h2}>{isNew ? 'New document' : `New version — bumping from ${doc?.document?.version}`}</h2>

                    <label style={lbl}>Kind
                        <select value={kind} onChange={(e) => setKind(e.target.value)} style={input} disabled={!isNew}>
                            <option value="jd">JD</option>
                            <option value="sop">SOP</option>
                            <option value="checklist">Checklist</option>
                            <option value="policy">Policy</option>
                            <option value="training">Training</option>
                        </select>
                    </label>

                    <label style={lbl}>Slug
                        <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} style={input} disabled={!isNew} placeholder="event_director_jd" />
                    </label>

                    <label style={lbl}>Title
                        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
                    </label>

                    <label style={lbl}>Version
                        <input type="text" value={version} onChange={(e) => setVersion(e.target.value)} style={input} placeholder="v1.0" />
                    </label>

                    <label style={lbl}>Primary role ID (optional, for kind=jd)
                        <input type="text" value={primaryRoleId} onChange={(e) => setPrimaryRoleId(e.target.value)} style={input} placeholder="role_event_director" />
                    </label>

                    <label style={lbl}>Description
                        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={input} />
                    </label>

                    <label style={lbl}>Body (Markdown allowed; rendered with caution on read)
                        <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={20} style={{ ...input, fontFamily: 'ui-monospace, monospace' }} />
                    </label>

                    {error && <p style={errText}>{error}</p>}

                    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                        <button type="button" onClick={submit} disabled={submitting} style={primaryBtn}>
                            {submitting ? 'Saving…' : 'Save'}
                        </button>
                        {!isNew && <button type="button" onClick={() => setEditorOpen(false)} style={cancelBtn}>Cancel</button>}
                    </div>
                </div>
            )}
        </div>
    );
}

function bumpVersion(v) {
    const m = String(v).match(/^v(\d+)\.(\d+)$/);
    if (!m) return 'v1.0';
    return `v${m[1]}.${Number(m[2]) + 1}`;
}

const page = { maxWidth: 900, margin: '0 auto', padding: '2rem' };
const breadcrumb = { color: 'var(--orange)', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'none' };
const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: '8px 0 24px' };
const h2 = { fontSize: 16, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--cream)', margin: '0 0 16px' };
const section = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem', marginBottom: 16 };
const preBody = { whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit', background: 'var(--dark)', padding: 12, borderRadius: 3, maxHeight: 400, overflowY: 'auto' };
const codeText = { fontFamily: 'ui-monospace, monospace', fontSize: 10, color: 'var(--tan-light)' };
const tagRow = { padding: '8px 0', borderBottom: '1px solid var(--color-border-subtle)', display: 'flex', gap: 8, alignItems: 'center' };
const requiredPill = { padding: '2px 8px', background: 'var(--color-warning-soft)', color: 'var(--color-warning)', fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', borderRadius: 3 };
const lbl = { display: 'block', fontSize: 11, color: 'var(--tan-light)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 };
const input = { width: '100%', padding: '10px 14px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 13, marginTop: 6, fontFamily: 'inherit', boxSizing: 'border-box' };
const primaryBtn = { padding: '10px 20px', background: 'var(--orange)', color: 'white', border: 0, fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const cancelBtn = { padding: '10px 20px', background: 'transparent', color: 'var(--tan)', border: '1px solid var(--color-border-strong)', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const errText = { color: 'var(--color-danger)', fontSize: 13, marginTop: 8 };

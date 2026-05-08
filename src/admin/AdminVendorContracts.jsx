import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';

// Versioned contract document manager. Mirrors the pattern of waiver
// hardening (migration 0011): immutable rows, new version retires previous.
// Admins can view past versions but can't edit their body_html.

export default function AdminVendorContracts() {
    const { isAuthenticated, loading, hasRole } = useAdmin();
    const navigate = useNavigate();
    const [rows, setRows] = useState([]);
    const [loadingList, setLoadingList] = useState(false);
    const [creating, setCreating] = useState(false);
    const [viewing, setViewing] = useState(null);

    useEffect(() => {
        if (loading) return;
        if (!isAuthenticated) navigate('/admin/login');
    }, [loading, isAuthenticated, navigate]);

    const load = useCallback(async () => {
        setLoadingList(true);
        const res = await fetch('/api/admin/vendor-contracts', { credentials: 'include', cache: 'no-store' });
        if (res.ok) setRows((await res.json()).contracts || []);
        setLoadingList(false);
    }, []);

    useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

    const retire = async (r) => {
        if (!window.confirm(`Retire v${r.version} without a replacement? Packages that require a contract will have no live doc to attach until you create a new one.`)) return;
        const res = await fetch(`/api/admin/vendor-contracts/${r.id}/retire`, { method: 'POST', credentials: 'include' });
        if (res.ok) load();
    };

    if (loading || !isAuthenticated) return null;

    return (
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <h1 style={h1}>Vendor Contract Documents</h1>
                <div style={{ display: 'flex', gap: 8 }}>
                    <Link to="/admin/vendor-packages" style={subtleBtn}>Packages</Link>
                    {hasRole('owner') && <button onClick={() => setCreating(true)} style={primaryBtn}>+ New version</button>}
                </div>
            </div>

            <p style={{ color: 'var(--olive-light)', fontSize: 12, marginBottom: 16 }}>
                Each signed contract snapshots the exact body text it was signed against. Creating a new version retires the previous one.
                Past signers remain pinned to whichever version they signed.
            </p>

            <div style={tableBox}>
                {loadingList && <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>Loading…</p>}
                {!loadingList && rows.length === 0 && <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>No contracts yet. Create one to enable contract signing on vendor packages.</p>}
                {rows.length > 0 && (
                    <table style={table}>
                        <thead>
                            <tr>
                                <th style={th}>Version</th>
                                <th style={th}>Title</th>
                                <th style={th}>Status</th>
                                <th style={th}>Effective from</th>
                                <th style={th}>SHA-256</th>
                                <th style={th}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} style={tr}>
                                    <td style={td}>v{r.version}</td>
                                    <td style={td}>{r.title}</td>
                                    <td style={td}>
                                        {r.retiredAt
                                            ? <span style={{ color: '#888', fontSize: 11 }}>retired {new Date(r.retiredAt).toLocaleDateString()}</span>
                                            : <span style={{ color: '#78c493', fontWeight: 800, fontSize: 11 }}>LIVE</span>}
                                    </td>
                                    <td style={td}>{new Date(r.effectiveFrom).toLocaleString()}</td>
                                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.bodySha256.slice(0, 12)}…</td>
                                    <td style={{ ...td, textAlign: 'right' }}>
                                        <button onClick={() => setViewing(r)} style={subtleBtn}>View</button>
                                        {!r.retiredAt && hasRole('owner') && <button onClick={() => retire(r)} style={{ ...subtleBtn, marginLeft: 6 }}>Retire</button>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {creating && <ContractModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
            {viewing && <ViewModal contract={viewing} onClose={() => setViewing(null)} />}
        </div>
    );
}

function ContractModal({ onClose, onSaved }) {
    const [title, setTitle] = useState('Vendor Operating Agreement');
    const [bodyHtml, setBodyHtml] = useState('');
    const [err, setErr] = useState(''); const [saving, setSaving] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setErr(''); setSaving(true);
        const res = await fetch('/api/admin/vendor-contracts', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title.trim(), bodyHtml }),
        });
        setSaving(false);
        if (!res.ok) { setErr((await res.json()).error || 'Failed'); return; }
        onSaved();
    };

    return (
        <div style={modalBg} onClick={onClose}>
            <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ ...modal, maxWidth: 820 }}>
                <h2 style={{ ...h1, fontSize: 20, marginBottom: 14 }}>New Contract Version</h2>
                <Field label="Title *">
                    <input value={title} onChange={(e) => setTitle(e.target.value)} required style={input} />
                </Field>
                <Field label="Body HTML *">
                    <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} required rows={18}
                        placeholder="<h3>Vendor Operating Agreement</h3><p>This agreement…</p>"
                        style={{ ...input, minHeight: 360, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }} />
                </Field>
                <p style={{ color: 'var(--olive-light)', fontSize: 11, margin: '4px 0 12px' }}>
                    This text becomes immutable once saved. The previous live version will be retired at the same instant this one becomes effective.
                </p>
                {err && <div style={{ color: '#e74c3c', fontSize: 12, margin: '8px 0' }}>{err}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                    <button type="submit" disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Create version'}</button>
                    <button type="button" onClick={onClose} style={subtleBtn}>Cancel</button>
                </div>
            </form>
        </div>
    );
}

function ViewModal({ contract, onClose }) {
    return (
        <div style={modalBg} onClick={onClose}>
            <div onClick={(e) => e.stopPropagation()} style={{ ...modal, maxWidth: 820 }}>
                <h2 style={{ ...h1, fontSize: 20, marginBottom: 6 }}>v{contract.version} — {contract.title}</h2>
                <p style={{ color: 'var(--olive-light)', fontSize: 11, fontFamily: 'monospace', marginBottom: 16 }}>{contract.bodySha256}</p>
                <div style={{ background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.15)', padding: 16, maxHeight: 420, overflowY: 'auto' }}
                    dangerouslySetInnerHTML={{ __html: contract.bodyHtml }} />
                <div style={{ marginTop: 16 }}>
                    <button onClick={onClose} style={subtleBtn}>Close</button>
                </div>
            </div>
        </div>
    );
}

function Field({ label, children }) {
    return (
        <label style={{ display: 'block', marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
            {children}
        </label>
    );
}

const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const input = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const tableBox = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', color: 'var(--cream)', verticalAlign: 'top' };
const primaryBtn = { padding: '10px 18px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const subtleBtn = { padding: '6px 12px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' };
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal = { background: 'var(--mid)', border: '1px solid var(--color-border-strong)', padding: '1.5rem', width: '100%', maxWidth: 560, borderRadius: 4, maxHeight: '92vh', overflowY: 'auto' };

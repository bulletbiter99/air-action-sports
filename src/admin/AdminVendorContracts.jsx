import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';

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
        <div style={pageWrap}>
            <AdminPageHeader
                title="Vendor Contract Documents"
                description="Each signed contract snapshots the exact body text it was signed against. Creating a new version retires the previous one. Past signers remain pinned to whichever version they signed."
                breadcrumb={[
                    { label: 'Settings', to: '/admin/settings' },
                    { label: 'Vendor Contracts' },
                ]}
                secondaryActions={<Link to="/admin/vendor-packages" style={subtleBtn}>Packages</Link>}
                primaryAction={hasRole('owner') && (
                    <button onClick={() => setCreating(true)} style={primaryBtn}>+ New version</button>
                )}
            />

            <div style={tableBox}>
                {loadingList && (
                    <EmptyState variant="loading" title="Loading contracts…" />
                )}
                {!loadingList && rows.length === 0 && (
                    <EmptyState
                        title="No contracts yet"
                        description="Create one to enable contract signing on vendor packages."
                        action={hasRole('owner') && (
                            <button onClick={() => setCreating(true)} style={primaryBtn}>+ New version</button>
                        )}
                    />
                )}
                {!loadingList && rows.length > 0 && (
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
                                            ? <span style={retiredPill}>retired {new Date(r.retiredAt).toLocaleDateString()}</span>
                                            : <span style={livePill}>LIVE</span>}
                                    </td>
                                    <td style={td}>{new Date(r.effectiveFrom).toLocaleString()}</td>
                                    <td style={tdMonospace}>{r.bodySha256.slice(0, 12)}…</td>
                                    <td style={tdActions}>
                                        <button onClick={() => setViewing(r)} style={subtleBtn}>View</button>
                                        {!r.retiredAt && hasRole('owner') && <button onClick={() => retire(r)} style={{ ...subtleBtn, marginLeft: 'var(--space-4)' }}>Retire</button>}
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
                <h2 style={modalTitle}>New Contract Version</h2>
                <Field label="Title *">
                    <input value={title} onChange={(e) => setTitle(e.target.value)} required style={input} />
                </Field>
                <Field label="Body HTML *">
                    <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} required rows={18}
                        placeholder="<h3>Vendor Operating Agreement</h3><p>This agreement…</p>"
                        style={{ ...input, minHeight: 360, fontFamily: 'monospace', fontSize: 'var(--font-size-sm)', resize: 'vertical' }} />
                </Field>
                <p style={modalHint}>
                    This text becomes immutable once saved. The previous live version will be retired at the same instant this one becomes effective.
                </p>
                {err && <div style={errorText}>{err}</div>}
                <div style={modalActions}>
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
                <h2 style={modalTitle}>v{contract.version} — {contract.title}</h2>
                <p style={modalSha}>{contract.bodySha256}</p>
                <div style={contractBody}
                    dangerouslySetInnerHTML={{ __html: contract.bodyHtml }} />
                <div style={modalActions}>
                    <button onClick={onClose} style={subtleBtn}>Close</button>
                </div>
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

const pageWrap = { maxWidth: 1000, margin: '0 auto', padding: 'var(--space-32)' };
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
const td = {
    padding: 'var(--space-8) var(--space-12)',
    color: 'var(--color-text)',
    verticalAlign: 'top',
};
const tdMonospace = { ...td, fontFamily: 'monospace', fontSize: 'var(--font-size-sm)' };
const tdActions = { ...td, textAlign: 'right' };
const livePill = {
    color: 'var(--color-success)',
    fontWeight: 'var(--font-weight-extrabold)',
    fontSize: 'var(--font-size-sm)',
};
const retiredPill = {
    color: 'var(--color-text-subtle)',
    fontSize: 'var(--font-size-sm)',
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
    textDecoration: 'none',
    display: 'inline-block',
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
    maxWidth: 560,
    borderRadius: 'var(--radius-md)',
    maxHeight: '92vh',
    overflowY: 'auto',
};
const modalTitle = {
    fontSize: 'var(--font-size-xl)',
    fontWeight: 'var(--font-weight-extrabold)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
    color: 'var(--color-text)',
    margin: '0 0 var(--space-12) 0',
};
const modalSha = {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--font-size-sm)',
    fontFamily: 'monospace',
    marginBottom: 'var(--space-16)',
};
const modalActions = { display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-16)' };
const modalHint = {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--font-size-sm)',
    margin: 'var(--space-4) 0 var(--space-12)',
};
const errorText = {
    color: 'var(--color-danger)',
    fontSize: 'var(--font-size-sm)',
    margin: 'var(--space-8) 0',
};
const contractBody = {
    background: 'var(--color-bg-page)',
    border: '1px solid var(--color-border)',
    padding: 'var(--space-16)',
    maxHeight: 420,
    overflowY: 'auto',
};
const fieldLabel = { display: 'block', marginBottom: 'var(--space-12)' };
const fieldLabelText = {
    fontSize: 'var(--font-size-sm)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
    color: 'var(--color-accent)',
    fontWeight: 'var(--font-weight-bold)',
    marginBottom: 'var(--space-4)',
};

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';

// Versioned waiver document manager. Same pattern as vendor contracts —
// new version retires the previous; past signers stay pinned to whatever
// version they signed against (snapshot on the waivers row preserves the
// exact body + sha256 + version they saw).
//
// Owner-only writes. Editing in place is impossible by design — the public
// /api/waivers/:qrToken route does an integrity check on body_sha256 and
// refuses to serve a tampered row.

export default function AdminWaivers() {
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
        const res = await fetch('/api/admin/waiver-documents', { credentials: 'include', cache: 'no-store' });
        if (res.ok) setRows((await res.json()).waivers || []);
        setLoadingList(false);
    }, []);

    useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

    const retire = async (r) => {
        if (!window.confirm(
            `Retire v${r.version} without a replacement?\n\nIncoming waiver signers will see a 500 error until you create a new version. Use only in an emergency (e.g., legal-required text takedown).`
        )) return;
        const res = await fetch(`/api/admin/waiver-documents/${r.id}/retire`, { method: 'POST', credentials: 'include' });
        if (res.ok) load();
    };

    if (loading || !isAuthenticated) return null;

    const liveDoc = rows.find((r) => !r.retiredAt);

    return (
        <div style={pageWrap}>
            <AdminPageHeader
                title="Waiver Document"
                description="Each signed waiver snapshots the exact body text it was signed against. Creating a new version retires the previous one at the same instant — past signers stay pinned to whichever version they signed (legal defensibility under ESIGN §7001). Owner-only. There is always exactly one live version."
                breadcrumb={[
                    { label: 'Settings', to: '/admin/settings' },
                    { label: 'Waiver Document' },
                ]}
                secondaryActions={<Link to="/admin/settings" style={subtleBtn}>← Settings</Link>}
                primaryAction={hasRole('owner') && (
                    <button onClick={() => setCreating(true)} style={primaryBtn}>+ New version</button>
                )}
            />

            {liveDoc && (
                <div style={liveBanner}>
                    <strong style={liveBannerLabel}>LIVE:</strong> v{liveDoc.version} — effective since{' '}
                    {new Date(liveDoc.effectiveFrom).toLocaleString()}.{' '}
                    <button onClick={() => setViewing(liveDoc)} style={{ ...subtleBtn, marginLeft: 'var(--space-8)' }}>Preview</button>
                </div>
            )}

            <div style={tableBox}>
                {loadingList && (
                    <EmptyState variant="loading" title="Loading waiver versions…" compact />
                )}
                {!loadingList && rows.length === 0 && (
                    <EmptyState
                        title="No waiver documents yet"
                        description="This shouldn't happen — the app seeded wd_v1 at install. Create a new version to enable signing."
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
                                <th style={th}>Status</th>
                                <th style={th}>Effective from</th>
                                <th style={th}>Retired</th>
                                <th style={th}>SHA-256</th>
                                <th style={th}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} style={tr}>
                                    <td style={td}>v{r.version}</td>
                                    <td style={td}>
                                        {r.retiredAt
                                            ? <span style={retiredPill}>retired</span>
                                            : <span style={livePill}>LIVE</span>}
                                    </td>
                                    <td style={td}>{new Date(r.effectiveFrom).toLocaleString()}</td>
                                    <td style={td}>{r.retiredAt ? new Date(r.retiredAt).toLocaleString() : '—'}</td>
                                    <td style={tdMonospace}>{r.bodySha256.slice(0, 12)}…</td>
                                    <td style={tdActions}>
                                        <button onClick={() => setViewing(r)} style={subtleBtn}>View</button>
                                        {!r.retiredAt && hasRole('owner') && (
                                            <button onClick={() => retire(r)} style={{ ...subtleBtn, marginLeft: 'var(--space-4)' }}>Retire</button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {creating && (
                <WaiverModal
                    seedFromLive={liveDoc?.bodyHtml || ''}
                    onClose={() => setCreating(false)}
                    onSaved={() => { setCreating(false); load(); }}
                />
            )}
            {viewing && <ViewModal waiver={viewing} onClose={() => setViewing(null)} />}
        </div>
    );
}

function WaiverModal({ seedFromLive, onClose, onSaved }) {
    const [bodyHtml, setBodyHtml] = useState(seedFromLive);
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setErr(''); setSaving(true);
        const res = await fetch('/api/admin/waiver-documents', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bodyHtml }),
        });
        setSaving(false);
        if (!res.ok) { setErr((await res.json()).error || 'Failed'); return; }
        onSaved();
    };

    return (
        <div style={modalBg} onClick={onClose}>
            <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ ...modal, maxWidth: 900 }}>
                <h2 style={modalTitle}>New Waiver Version</h2>
                <p style={modalHint}>
                    Seeded from the current live version &mdash; edit below. The HTML is rendered to signers verbatim, so write clean,
                    semantic markup (<code>&lt;ol&gt;</code>, <code>&lt;p&gt;</code>, <code>&lt;strong&gt;</code>).
                </p>

                <Field label="Body HTML *">
                    <textarea
                        value={bodyHtml}
                        onChange={(e) => setBodyHtml(e.target.value)}
                        required
                        rows={20}
                        placeholder="<ol><li>I understand…</li><li>I confirm…</li></ol>"
                        style={{ ...input, minHeight: 420, fontFamily: 'monospace', fontSize: 'var(--font-size-sm)', resize: 'vertical' }}
                    />
                </Field>

                {bodyHtml && (
                    <details style={previewToggle}>
                        <summary style={previewToggleSummary}>Preview rendered</summary>
                        <div
                            style={previewBody}
                            dangerouslySetInnerHTML={{ __html: bodyHtml }}
                        />
                    </details>
                )}

                <p style={modalHint}>
                    Once saved, this text is immutable. The previous live version retires at the same instant this one takes effect.
                    Past signers stay pinned to their original version (audit-trail preserved).
                </p>
                {err && <div style={errorText}>{err}</div>}
                <div style={modalActions}>
                    <button type="submit" disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Publish new version'}</button>
                    <button type="button" onClick={onClose} style={subtleBtn}>Cancel</button>
                </div>
            </form>
        </div>
    );
}

function ViewModal({ waiver, onClose }) {
    return (
        <div style={modalBg} onClick={onClose}>
            <div onClick={(e) => e.stopPropagation()} style={{ ...modal, maxWidth: 820 }}>
                <h2 style={modalTitle}>
                    Waiver v{waiver.version}
                    {!waiver.retiredAt && <span style={liveLabelInline}>LIVE</span>}
                </h2>
                <p style={modalSha}>SHA-256 {waiver.bodySha256}</p>
                <div
                    style={previewBody}
                    dangerouslySetInnerHTML={{ __html: waiver.bodyHtml }}
                />
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
const liveBanner = {
    marginBottom: 'var(--space-16)',
    padding: 'var(--space-12) var(--space-16)',
    background: 'var(--color-success-soft)',
    borderLeft: '3px solid var(--color-success)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-muted)',
};
const liveBannerLabel = {
    color: 'var(--color-success)',
    letterSpacing: 'var(--letter-spacing-wide)',
};
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
const liveLabelInline = {
    marginLeft: 'var(--space-12)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-success)',
    letterSpacing: 'var(--letter-spacing-wide)',
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
    margin: '0 0 var(--space-8) 0',
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
    lineHeight: 'var(--line-height-relaxed)',
};
const errorText = {
    color: 'var(--color-danger)',
    fontSize: 'var(--font-size-sm)',
    margin: 'var(--space-8) 0',
};
const previewToggle = { margin: 'var(--space-8) 0 var(--space-12)' };
const previewToggleSummary = {
    cursor: 'pointer',
    fontSize: 'var(--font-size-sm)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
    color: 'var(--color-accent)',
    fontWeight: 'var(--font-weight-bold)',
    marginBottom: 'var(--space-4)',
};
const previewBody = {
    background: 'var(--color-bg-page)',
    border: '1px solid var(--color-border)',
    padding: 'var(--space-16)',
    maxHeight: 460,
    overflowY: 'auto',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-base)',
    lineHeight: 'var(--line-height-relaxed)',
    marginTop: 'var(--space-4)',
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

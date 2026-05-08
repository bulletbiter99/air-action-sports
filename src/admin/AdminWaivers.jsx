import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';

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
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <h1 style={h1}>Waiver Document</h1>
                <div style={{ display: 'flex', gap: 8 }}>
                    <Link to="/admin/settings" style={subtleBtn}>← Settings</Link>
                    {hasRole('owner') && (
                        <button onClick={() => setCreating(true)} style={primaryBtn}>
                            + New version
                        </button>
                    )}
                </div>
            </div>

            <p style={{ color: 'var(--olive-light)', fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
                Each signed waiver snapshots the exact body text it was signed against. Creating a new version retires the previous one
                at the same instant — past signers stay pinned to whichever version they signed (legal defensibility under ESIGN §7001).
                <br /><br />
                <strong style={{ color: 'var(--tan)' }}>Note:</strong> Owner-only. There is always exactly one live version.
            </p>

            {liveDoc && (
                <div style={{ marginBottom: 16, padding: '14px 16px', background: 'rgba(120,196,147,0.06)', borderLeft: '3px solid #78c493', fontSize: 12, color: 'var(--tan-light)' }}>
                    <strong style={{ color: '#78c493', letterSpacing: 1 }}>LIVE:</strong> v{liveDoc.version} — effective since{' '}
                    {new Date(liveDoc.effectiveFrom).toLocaleString()}.{' '}
                    <button onClick={() => setViewing(liveDoc)} style={{ ...subtleBtn, padding: '4px 8px', marginLeft: 8 }}>Preview</button>
                </div>
            )}

            <div style={tableBox}>
                {loadingList && <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>Loading…</p>}
                {!loadingList && rows.length === 0 && (
                    <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>
                        No waiver documents yet. (This shouldn&rsquo;t happen — the app seeded `wd_v1` at install.) Create one to enable signing.
                    </p>
                )}
                {rows.length > 0 && (
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
                                            ? <span style={{ color: '#888', fontSize: 11 }}>retired</span>
                                            : <span style={{ color: '#78c493', fontWeight: 800, fontSize: 11 }}>LIVE</span>}
                                    </td>
                                    <td style={td}>{new Date(r.effectiveFrom).toLocaleString()}</td>
                                    <td style={td}>{r.retiredAt ? new Date(r.retiredAt).toLocaleString() : '—'}</td>
                                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.bodySha256.slice(0, 12)}…</td>
                                    <td style={{ ...td, textAlign: 'right' }}>
                                        <button onClick={() => setViewing(r)} style={subtleBtn}>View</button>
                                        {!r.retiredAt && hasRole('owner') && (
                                            <button onClick={() => retire(r)} style={{ ...subtleBtn, marginLeft: 6 }}>Retire</button>
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
                <h2 style={{ ...h1, fontSize: 20, marginBottom: 6 }}>New Waiver Version</h2>
                <p style={{ color: 'var(--olive-light)', fontSize: 11, marginBottom: 14 }}>
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
                        style={{ ...input, minHeight: 420, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
                    />
                </Field>

                {bodyHtml && (
                    <details style={{ margin: '8px 0 14px' }}>
                        <summary style={{ cursor: 'pointer', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 700, marginBottom: 6 }}>
                            Preview rendered
                        </summary>
                        <div
                            style={{
                                background: 'var(--dark)',
                                border: '1px solid rgba(200,184,154,0.15)',
                                padding: 16,
                                maxHeight: 280,
                                overflowY: 'auto',
                                color: 'var(--cream)',
                                fontSize: 13,
                                lineHeight: 1.6,
                                marginTop: 6,
                            }}
                            dangerouslySetInnerHTML={{ __html: bodyHtml }}
                        />
                    </details>
                )}

                <p style={{ color: 'var(--olive-light)', fontSize: 11, margin: '4px 0 12px' }}>
                    Once saved, this text is immutable. The previous live version retires at the same instant this one takes effect.
                    Past signers stay pinned to their original version (audit-trail preserved).
                </p>
                {err && <div style={{ color: '#e74c3c', fontSize: 12, margin: '8px 0' }}>{err}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
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
                <h2 style={{ ...h1, fontSize: 20, marginBottom: 6 }}>
                    Waiver v{waiver.version}
                    {!waiver.retiredAt && <span style={{ marginLeft: 12, fontSize: 12, color: '#78c493', letterSpacing: 1 }}>LIVE</span>}
                </h2>
                <p style={{ color: 'var(--olive-light)', fontSize: 11, fontFamily: 'monospace', marginBottom: 16 }}>
                    SHA-256 {waiver.bodySha256}
                </p>
                <div
                    style={{
                        background: 'var(--dark)',
                        border: '1px solid rgba(200,184,154,0.15)',
                        padding: 16,
                        maxHeight: 460,
                        overflowY: 'auto',
                        color: 'var(--cream)',
                        fontSize: 13,
                        lineHeight: 1.6,
                    }}
                    dangerouslySetInnerHTML={{ __html: waiver.bodyHtml }}
                />
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

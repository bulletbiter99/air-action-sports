import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

// Public vendor-facing package view. Loaded via a tokenized magic link
// (/v/:token). The Worker sets noindex / no-referrer / no-store on the API
// response; we mirror the robots meta here for belt-and-suspenders.
export default function VendorPackage() {
    const { token } = useParams();
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);

    const reload = async () => {
        if (!token) return;
        const res = await fetch(`/api/vendor/${encodeURIComponent(token)}`, { cache: 'no-store' });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Invalid or expired link');
        setData(body.package);
    };

    useEffect(() => {
        if (!token) { setErr('Invalid link'); return; }
        const meta = document.createElement('meta');
        meta.name = 'robots';
        meta.content = 'noindex, nofollow, noarchive';
        document.head.appendChild(meta);

        let cancelled = false;
        reload().catch((e) => { if (!cancelled) setErr(e.message); });

        return () => { cancelled = true; meta.remove(); };
    }, [token]);

    if (err) {
        return (
            <div style={shell}>
                <div style={card}>
                    <h1 style={title}>Link Invalid</h1>
                    <p style={body}>{err}</p>
                    <p style={{ ...body, color: '#999', fontSize: 13 }}>
                        This vendor link is no longer active. It may have expired or been revoked.
                        Contact Air Action Sports to request a new one.
                    </p>
                </div>
            </div>
        );
    }
    if (!data) return <div style={shell}><div style={card}><p style={body}>Loading your package…</p></div></div>;

    const { vendor, event, primaryContactName, sections, documents, contract } = data;

    return (
        <div style={shell}>
            <header style={header}>
                <div style={brand}>▶ AIR ACTION SPORTS</div>
                <div style={{ color: '#c8b89a', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase' }}>Vendor Package</div>
            </header>

            <main style={main}>
                <div style={heroBlock}>
                    <div style={{ color: '#c65a2a', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 800 }}>
                        {vendor.companyName}
                    </div>
                    <h1 style={{ ...title, fontSize: 36, margin: '4px 0 8px' }}>{event.title}</h1>
                    <p style={{ ...body, color: '#c8b89a', fontSize: 15 }}>{event.displayDate} · {event.location}</p>
                    {primaryContactName && (
                        <p style={{ ...body, color: '#888', fontSize: 13, marginTop: 10 }}>
                            Hi {primaryContactName} — here's everything you need for this event.
                        </p>
                    )}
                </div>

                {sections.length === 0 && documents.length === 0 && !contract?.required && (
                    <p style={{ ...body, color: '#888' }}>
                        Your package is being prepared. Check back soon or reply to the email you received.
                    </p>
                )}

                {sections.map((s) => (
                    <section key={s.id} style={section}>
                        <div style={sectionKind}>{s.kind}</div>
                        <h2 style={sectionTitle}>{s.title}</h2>
                        {s.bodyHtml && <div style={sectionBody} dangerouslySetInnerHTML={{ __html: s.bodyHtml }} />}
                    </section>
                ))}

                {contract?.required && (
                    <ContractSection token={token} contract={contract} onSigned={reload} />
                )}

                {documents.length > 0 && (
                    <section style={section}>
                        <div style={sectionKind}>documents</div>
                        <h2 style={sectionTitle}>Files from us</h2>
                        {documents.map((d) => (
                            <a key={d.id} href={`/api/vendor/${encodeURIComponent(token)}/doc/${d.id}`}
                                rel="noreferrer nofollow" style={docLink}>
                                <span style={{ color: '#c65a2a', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 800 }}>{d.kind}</span>
                                <span style={{ color: '#fff', fontWeight: 700, fontSize: 14, display: 'block' }}>{d.filename}</span>
                                <span style={{ color: '#888', fontSize: 12 }}>{Math.round(d.byteSize / 1024)} KB · {d.contentType}</span>
                            </a>
                        ))}
                    </section>
                )}

                <UploadSection token={token} onUploaded={reload} />

                <PortalCta token={token} />
            </main>

            <footer style={footer}>
                <p style={{ fontSize: 11, color: '#888', margin: 0 }}>
                    This page is private to you. Please don't share the link. Questions? Reply to the email you
                    received from Air Action Sports.
                </p>
            </footer>
        </div>
    );
}

function ContractSection({ token, contract, onSigned }) {
    const sig = contract.signature;
    const doc = contract.document;
    const [typedName, setTypedName] = useState('');
    const [erecords, setErecords] = useState(false);
    const [intent, setIntent] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState('');

    if (sig) {
        return (
            <section style={{ ...section, borderLeft: '3px solid #2e7d4a', paddingLeft: 20 }}>
                <div style={{ ...sectionKind, color: '#78c493' }}>contract · signed</div>
                <h2 style={sectionTitle}>Operating Agreement — signed</h2>
                <p style={{ ...sectionBody, color: '#c8b89a' }}>
                    Signed as <strong style={{ color: '#fff' }}>{sig.typedName}</strong> on{' '}
                    {new Date(sig.signedAt).toLocaleString()}. Version {sig.version}.
                </p>
                {sig.countersignedAt ? (
                    <p style={{ ...sectionBody, color: '#78c493' }}>
                        ✓ Countersigned by Air Action Sports on {new Date(sig.countersignedAt).toLocaleString()}.
                    </p>
                ) : (
                    <p style={{ ...sectionBody, color: '#c8b89a', fontSize: 13 }}>
                        Awaiting countersignature. You'll get the fully-executed copy by email once it's in.
                    </p>
                )}
            </section>
        );
    }

    if (!doc) {
        return (
            <section style={section}>
                <div style={sectionKind}>contract</div>
                <h2 style={sectionTitle}>Agreement coming soon</h2>
                <p style={{ ...sectionBody, color: '#c8b89a' }}>We'll email you when the agreement is ready to sign.</p>
            </section>
        );
    }

    const submit = async (e) => {
        e.preventDefault();
        setErr('');
        if (!intent) { setErr('Please check the "I intend to sign" box'); return; }
        if (!erecords) { setErr('Electronic records consent is required'); return; }
        if (!typedName.trim()) { setErr('Type your full name to sign'); return; }
        setSubmitting(true);
        const res = await fetch(`/api/vendor/${encodeURIComponent(token)}/sign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ typedName: typedName.trim(), erecordsConsent: true }),
        });
        setSubmitting(false);
        if (!res.ok) { setErr((await res.json()).error || 'Sign failed'); return; }
        onSigned();
    };

    return (
        <section style={{ ...section, borderLeft: '3px solid #c65a2a', paddingLeft: 20 }}>
            <div style={sectionKind}>contract · signature required</div>
            <h2 style={sectionTitle}>{doc.title}</h2>
            <div style={{ ...sectionBody, background: '#111', border: '1px solid #333', padding: 16, maxHeight: 360, overflowY: 'auto', fontSize: 13, marginBottom: 16 }}
                dangerouslySetInnerHTML={{ __html: doc.bodyHtml }} />
            <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
                <label style={checkboxRow}>
                    <input type="checkbox" checked={intent} onChange={(e) => setIntent(e.target.checked)} />
                    <span>I have read and intend to sign the agreement above.</span>
                </label>
                <label style={checkboxRow}>
                    <input type="checkbox" checked={erecords} onChange={(e) => setErecords(e.target.checked)} />
                    <span>I consent to sign and receive records electronically. I may request a paper copy by contacting Air Action Sports.</span>
                </label>
                <div>
                    <label style={{ display: 'block', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#c65a2a', fontWeight: 800, marginBottom: 6 }}>Type your full name to sign *</label>
                    <input type="text" value={typedName} onChange={(e) => setTypedName(e.target.value)} required
                        style={{ padding: '12px 14px', background: '#111', border: '1px solid #333', color: '#fff', fontSize: 16, width: '100%', boxSizing: 'border-box', fontFamily: 'serif', fontStyle: 'italic' }} />
                </div>
                {err && <div style={{ color: '#e74c3c', fontSize: 13 }}>{err}</div>}
                <button type="submit" disabled={submitting}
                    style={{ padding: '12px 24px', background: '#c65a2a', color: '#fff', border: 'none', fontSize: 13, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer', justifySelf: 'start' }}>
                    {submitting ? 'Signing…' : '▶ Sign agreement'}
                </button>
            </form>
        </section>
    );
}

function UploadSection({ token, onUploaded }) {
    const [kind, setKind] = useState('coi');
    const [uploading, setUploading] = useState(false);
    const [msg, setMsg] = useState('');

    const onFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true); setMsg('');
        const fd = new FormData();
        fd.append('file', file);
        fd.append('kind', kind);
        const res = await fetch(`/api/vendor/${encodeURIComponent(token)}/upload`, { method: 'POST', body: fd });
        e.target.value = '';
        setUploading(false);
        if (!res.ok) { setMsg((await res.json()).error || 'Upload failed'); return; }
        setMsg(`Uploaded ${file.name}. Air Action Sports has been notified.`);
        onUploaded();
    };

    return (
        <section style={section}>
            <div style={sectionKind}>uploads</div>
            <h2 style={sectionTitle}>Send us a file</h2>
            <p style={{ ...sectionBody, color: '#c8b89a' }}>Insurance certificate (COI), W-9, or any other document we've asked for. PDF or image, 10 MB max.</p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
                <select value={kind} onChange={(e) => setKind(e.target.value)}
                    style={{ padding: '10px 14px', background: '#111', border: '1px solid #333', color: '#fff', fontSize: 13 }}>
                    <option value="coi">COI (insurance)</option>
                    <option value="w9">W-9</option>
                    <option value="vendor_return">Other</option>
                </select>
                <label style={{ padding: '10px 20px', background: '#c65a2a', color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: uploading ? 'wait' : 'pointer', display: 'inline-block' }}>
                    {uploading ? 'Uploading…' : 'Choose file'}
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,application/pdf,image/*" onChange={onFile} disabled={uploading} style={{ display: 'none' }} />
                </label>
            </div>
            {msg && <p style={{ ...sectionBody, color: '#78c493', fontSize: 13, marginTop: 10 }}>{msg}</p>}
        </section>
    );
}

function PortalCta({ token }) {
    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        setErr(''); setMsg('');
        if (password.length < 8) { setErr('Password must be at least 8 characters'); return; }
        setSaving(true);
        const res = await fetch('/api/vendor/auth/set-password', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ magicToken: token, password }),
        });
        setSaving(false);
        if (!res.ok) { setErr((await res.json()).error || 'Failed'); return; }
        setMsg('Password saved. You can log in at /vendor/login to see all your upcoming packages.');
        setPassword('');
    };

    return (
        <section style={{ ...section, borderBottom: 'none' }}>
            <div style={sectionKind}>optional</div>
            <h2 style={sectionTitle}>Save your login</h2>
            {!open ? (
                <div>
                    <p style={{ ...sectionBody, color: '#c8b89a' }}>Got multiple events with us? Set a password and see them all on one dashboard.</p>
                    <button onClick={() => setOpen(true)}
                        style={{ padding: '10px 20px', background: 'transparent', color: '#c8b89a', border: '1px solid #444', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' }}>
                        Set up a login
                    </button>
                </div>
            ) : (
                <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 8 characters" minLength={8} required
                        style={{ padding: '12px 14px', background: '#111', border: '1px solid #333', color: '#fff', fontSize: 14 }} />
                    {err && <div style={{ color: '#e74c3c', fontSize: 13 }}>{err}</div>}
                    {msg && <div style={{ color: '#78c493', fontSize: 13 }}>{msg} <Link to="/vendor/login" style={{ color: '#c65a2a' }}>Log in →</Link></div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button type="submit" disabled={saving}
                            style={{ padding: '10px 20px', background: '#c65a2a', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' }}>
                            {saving ? 'Saving…' : 'Save password'}
                        </button>
                        <button type="button" onClick={() => setOpen(false)}
                            style={{ padding: '10px 20px', background: 'transparent', color: '#c8b89a', border: '1px solid #444', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' }}>
                            Cancel
                        </button>
                    </div>
                </form>
            )}
        </section>
    );
}

const shell = { minHeight: '100vh', background: '#1a1a1a', color: '#fff', fontFamily: 'system-ui, sans-serif' };
const header = { padding: '20px 24px', borderBottom: '1px solid rgba(200,184,154,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 };
const brand = { color: '#c65a2a', fontWeight: 900, letterSpacing: 2, fontSize: 14 };
const main = { maxWidth: 780, margin: '0 auto', padding: '32px 24px 60px' };
const heroBlock = { padding: '24px 0 28px', borderBottom: '1px solid rgba(200,184,154,0.1)', marginBottom: 28 };
const title = { color: '#fff', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.5px', margin: 0 };
const body = { lineHeight: 1.6, margin: '8px 0' };
const card = { maxWidth: 560, margin: '60px auto', padding: '32px', background: '#252525', border: '1px solid rgba(200,184,154,0.15)' };
const section = { padding: '24px 0', borderBottom: '1px solid rgba(200,184,154,0.08)' };
const sectionKind = { color: '#c65a2a', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 800, marginBottom: 4 };
const sectionTitle = { fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 12px' };
const sectionBody = { color: '#d4c9ad', lineHeight: 1.7, fontSize: 15 };
const docLink = { display: 'block', padding: '12px 16px', background: '#252525', border: '1px solid rgba(200,184,154,0.15)', marginBottom: 10, textDecoration: 'none' };
const footer = { maxWidth: 780, margin: '0 auto', padding: '0 24px 40px', textAlign: 'center' };
const checkboxRow = { display: 'flex', gap: 10, alignItems: 'flex-start', color: '#d4c9ad', fontSize: 14, cursor: 'pointer', lineHeight: 1.5 };

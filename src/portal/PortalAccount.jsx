// M5 Batch 6b — Portal account page (own profile + edit limited fields).

import { useEffect, useState, useCallback } from 'react';

export default function PortalAccount() {
    const [account, setAccount] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState(null);

    const [fullName, setFullName] = useState('');
    const [phone, setPhone] = useState('');
    const [preferredName, setPreferredName] = useState('');
    const [pronouns, setPronouns] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/portal/account', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                setAccount(data.person);
                setFullName(data.person?.full_name || '');
                setPhone(data.person?.phone || '');
                setPreferredName(data.person?.preferred_name || '');
                setPronouns(data.person?.pronouns || '');
            }
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    async function save() {
        setMsg(null);
        setSaving(true);
        try {
            const res = await fetch('/api/portal/account', {
                method: 'PUT', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    full_name: fullName,
                    phone,
                    preferred_name: preferredName,
                    pronouns,
                }),
            });
            if (res.ok) {
                setMsg({ kind: 'ok', text: 'Saved.' });
                load();
            } else {
                const data = await res.json().catch(() => ({}));
                setMsg({ kind: 'err', text: data.error || 'Save failed' });
            }
        } finally { setSaving(false); }
    }

    if (loading) return <p style={{ color: 'var(--olive-light)' }}>Loading…</p>;
    if (!account) return <p>Account unavailable. Please sign in.</p>;

    return (
        <div>
            <h1 style={h1}>Your account</h1>
            <p style={subtitle}>Email is set by the admin who invited you. Contact them if it needs to change.</p>

            <div style={card}>
                <Field label="Email (read-only)" value={account.email || '—'} readOnly />
                <Field label="Status" value={account.status} readOnly />

                <label style={lbl}>Full name
                    <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} style={input} />
                </label>

                <label style={lbl}>Preferred name (optional)
                    <input type="text" value={preferredName} onChange={(e) => setPreferredName(e.target.value)} style={input} />
                </label>

                <label style={lbl}>Phone
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={input} />
                </label>

                <label style={lbl}>Pronouns
                    <input type="text" value={pronouns} onChange={(e) => setPronouns(e.target.value)} style={input} placeholder="they/them, she/her, etc." />
                </label>

                <div style={{ marginTop: 16 }}>
                    <button type="button" onClick={save} disabled={saving} style={primaryBtn}>
                        {saving ? 'Saving…' : 'Save changes'}
                    </button>
                </div>
                {msg && <p style={msg.kind === 'ok' ? okMsg : errMsg}>{msg.text}</p>}
            </div>
        </div>
    );
}

function Field({ label, value }) {
    return (
        <label style={lbl}>{label}
            <div style={readOnlyValue}>{value}</div>
        </label>
    );
}

const h1 = { fontSize: 28, fontWeight: 900, letterSpacing: '-1px', color: 'var(--cream)', margin: '0 0 8px' };
const subtitle = { color: 'var(--tan-light)', fontSize: 13, marginBottom: 24 };
const card = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem' };
const lbl = { display: 'block', fontSize: 11, color: 'var(--tan-light)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 };
const input = { width: '100%', padding: '10px 14px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 13, marginTop: 6, fontFamily: 'inherit', boxSizing: 'border-box' };
const readOnlyValue = { padding: '10px 14px', background: 'var(--color-bg-sunken)', color: 'var(--tan-light)', fontSize: 13, marginTop: 6, fontFamily: 'inherit' };
const primaryBtn = { padding: '12px 24px', background: 'var(--orange)', color: 'white', border: 0, fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const okMsg = { color: 'var(--color-success)', fontSize: 13, marginTop: 12 };
const errMsg = { color: 'var(--color-danger)', fontSize: 13, marginTop: 12 };

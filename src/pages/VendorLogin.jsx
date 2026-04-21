import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function VendorLogin() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [err, setErr] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setErr(''); setSubmitting(true);
        const res = await fetch('/api/vendor/auth/login', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        setSubmitting(false);
        if (!res.ok) { setErr((await res.json()).error || 'Login failed'); return; }
        navigate('/vendor/dashboard');
    };

    return (
        <div style={shell}>
            <div style={card}>
                <div style={{ color: '#c65a2a', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 800, marginBottom: 6 }}>
                    ▶ Air Action Sports
                </div>
                <h1 style={{ color: '#fff', fontWeight: 900, textTransform: 'uppercase', fontSize: 26, margin: '0 0 20px' }}>Vendor Login</h1>
                <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
                    <Field label="Email">
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email"
                            style={input} />
                    </Field>
                    <Field label="Password">
                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"
                            style={input} />
                    </Field>
                    {err && <div style={{ color: '#e74c3c', fontSize: 13 }}>{err}</div>}
                    <button type="submit" disabled={submitting}
                        style={{ padding: '12px 24px', background: '#c65a2a', color: '#fff', border: 'none', fontSize: 13, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' }}>
                        {submitting ? 'Logging in…' : '▶ Log in'}
                    </button>
                </form>
                <p style={{ color: '#888', fontSize: 12, marginTop: 24, lineHeight: 1.6 }}>
                    Don't have a password? Open the magic link Air Action Sports emailed you and click "Set up a login" at the bottom.
                </p>
                <p style={{ color: '#888', fontSize: 11, marginTop: 8 }}>
                    <Link to="/" style={{ color: '#c65a2a', textDecoration: 'none' }}>← Back to main site</Link>
                </p>
            </div>
        </div>
    );
}

function Field({ label, children }) {
    return (
        <label style={{ display: 'block' }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: '#c65a2a', fontWeight: 700, marginBottom: 4 }}>{label}</div>
            {children}
        </label>
    );
}

const shell = { minHeight: '100vh', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui, sans-serif' };
const card = { maxWidth: 420, width: '100%', padding: 32, background: '#252525', border: '1px solid rgba(200,184,154,0.15)' };
const input = { padding: '12px 14px', background: '#111', border: '1px solid #333', color: '#fff', fontSize: 14, width: '100%', boxSizing: 'border-box' };

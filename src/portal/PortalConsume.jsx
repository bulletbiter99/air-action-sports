// M5 Batch 6b — Magic-link consume landing page.
//
// The invite email links to /portal/auth/consume?token=...
// This component grabs the token from the URL, POSTs to
// /api/portal/auth/consume, and on success navigates to /portal home.
// On failure it surfaces the error and offers a "Request a new invite"
// link (resolves by reaching the operator off-platform).

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';

export default function PortalConsume() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const token = params.get('token');
    const [status, setStatus] = useState('verifying'); // verifying | invalid | expired | already-used | ok | error
    const [errorText, setErrorText] = useState(null);

    useEffect(() => {
        if (!token) {
            setStatus('invalid');
            return;
        }
        (async () => {
            try {
                const res = await fetch('/api/portal/auth/consume', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token }),
                });
                if (res.ok) {
                    setStatus('ok');
                    setTimeout(() => navigate('/portal'), 800);
                } else {
                    const data = await res.json().catch(() => ({}));
                    if (res.status === 410) {
                        if (data.error?.toLowerCase().includes('used')) setStatus('already-used');
                        else if (data.error?.toLowerCase().includes('expired')) setStatus('expired');
                        else setStatus('error');
                    } else {
                        setStatus('error');
                    }
                    setErrorText(data.error || 'Verification failed');
                }
            } catch (err) {
                setStatus('error');
                setErrorText(err?.message || 'Network error');
            }
        })();
    }, [token, navigate]);

    return (
        <div style={page}>
            <h1 style={h1}>AAS Portal</h1>
            {status === 'verifying' && <p style={muted}>Verifying your magic link…</p>}
            {status === 'ok' && <p style={ok}>✓ Signed in. Taking you to the portal…</p>}
            {status === 'invalid' && <p style={err}>Invalid link. Please use the URL from your invitation email.</p>}
            {status === 'already-used' && (
                <>
                    <p style={err}>This magic link has already been used.</p>
                    <p style={muted}>Each invitation token is single-use. Ask the admin who invited you for a fresh link.</p>
                </>
            )}
            {status === 'expired' && (
                <>
                    <p style={err}>This magic link has expired.</p>
                    <p style={muted}>Magic links are valid for 24 hours. Ask the admin who invited you for a fresh link.</p>
                </>
            )}
            {status === 'error' && (
                <>
                    <p style={err}>{errorText || 'Something went wrong.'}</p>
                    <p style={muted}>Try opening the link from your email again. If the problem persists, contact your admin.</p>
                </>
            )}
            <p style={{ marginTop: 24 }}>
                <Link to="/" style={backLink}>← Back to airactionsport.com</Link>
            </p>
        </div>
    );
}

const page = {
    minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    background: 'var(--dark)', color: 'var(--cream)', padding: 24, textAlign: 'center',
};
const h1 = { fontSize: 28, fontWeight: 900, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--orange)', marginBottom: 24 };
const muted = { color: 'var(--olive-light)', fontSize: 14 };
const ok = { color: 'var(--color-success)', fontSize: 16, fontWeight: 700 };
const err = { color: 'var(--color-danger)', fontSize: 15, fontWeight: 700 };
const backLink = { color: 'var(--orange)', textDecoration: 'none', fontSize: 13 };

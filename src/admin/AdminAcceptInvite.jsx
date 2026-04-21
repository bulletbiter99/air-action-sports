import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';

export default function AdminAcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { refresh } = useAdmin();
  const navigate = useNavigate();

  const [verifying, setVerifying] = useState(true);
  const [validity, setValidity] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { setVerifying(false); setValidity({ valid: false, reason: 'missing' }); return; }
    fetch(`/api/admin/auth/verify-invite/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setValidity(d))
      .catch(() => setValidity({ valid: false, reason: 'network' }))
      .finally(() => setVerifying(false));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!displayName.trim()) return setError('Display name is required.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password, displayName: displayName.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || 'Accept failed'); setSubmitting(false); return; }
      await refresh();
      navigate('/admin', { replace: true });
    } catch {
      setError('Network error. Try again.');
      setSubmitting(false);
    }
  };

  if (verifying) return <div style={shell}><p style={{ color: 'var(--olive-light)' }}>Checking invite…</p></div>;

  if (!validity?.valid) {
    const copy = {
      missing: 'No invite token provided.',
      not_found: "This invite link isn't valid.",
      accepted: 'This invite has already been used. Log in instead.',
      revoked: 'This invite has been revoked.',
      expired: 'This invite has expired. Ask your admin for a new one.',
      network: 'Could not verify the link. Check your connection.',
    };
    return (
      <div style={shell}>
        <div style={card}>
          <div style={{ color: '#ff8a7e', fontSize: 11, fontWeight: 800, letterSpacing: 2, marginBottom: 8 }}>⚠ Invite Not Valid</div>
          <h2 style={title}>We can't use this invite.</h2>
          <p style={{ color: 'var(--tan-light)', fontSize: 14, marginBottom: 20 }}>{copy[validity?.reason] || 'Invite is not valid.'}</p>
          <Link to="/admin/login" style={{ ...btn, display: 'inline-block', textAlign: 'center', textDecoration: 'none' }}>▶ Go to login</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <form onSubmit={handleSubmit} style={card}>
        <div style={{ color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 2, marginBottom: 8 }}>■ Accept Invite</div>
        <h2 style={title}>Create your admin account</h2>
        <p style={{ color: 'var(--olive-light)', fontSize: 13, marginBottom: 20 }}>
          <strong style={{ color: 'var(--tan)' }}>{validity.email}</strong> · joining as <strong style={{ color: 'var(--tan)', textTransform: 'uppercase' }}>{validity.role}</strong>
        </p>
        {error && <div style={errBanner}>{error}</div>}
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Display name</label>
          <input style={input} required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Password (min 8 chars)</label>
          <input style={input} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Confirm password</label>
          <input style={input} type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
        <button type="submit" style={btn} disabled={submitting}>
          {submitting ? 'Creating…' : '▶ Create account'}
        </button>
      </form>
    </div>
  );
}

const shell = { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 60px)', padding: '2rem' };
const card = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.15)', padding: '2.5rem', maxWidth: 420, width: '100%' };
const title = { fontSize: 22, fontWeight: 900, textTransform: 'uppercase', color: 'var(--cream)', margin: '0 0 0.75rem' };
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--tan)', marginBottom: 6 };
const input = { width: '100%', padding: '12px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 14, outline: 'none', boxSizing: 'border-box' };
const btn = { width: '100%', padding: 14, background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const errBanner = { background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', color: '#ff8a7e', padding: 12, marginBottom: 16, fontSize: 13 };

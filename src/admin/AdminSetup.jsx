import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';

export default function AdminSetup() {
  const { setup, setupNeeded, isAuthenticated, loading } = useAdmin();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (isAuthenticated) navigate('/admin', { replace: true });
    else if (!setupNeeded) navigate('/admin/login', { replace: true });
  }, [loading, isAuthenticated, setupNeeded, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setSubmitting(true);
    const res = await setup(email, password, displayName);
    setSubmitting(false);
    if (!res.ok) return setError(res.error);
    navigate('/admin', { replace: true });
  };

  if (loading) return null;

  return (
    <div style={shell}>
      <form onSubmit={handleSubmit} style={card}>
        <div style={{ color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 2, marginBottom: 8 }}>■ First-Time Setup</div>
        <h2 style={title}>Create Owner Account</h2>
        <p style={sub}>This is the first login for your admin panel. You'll be the owner; you can invite others later.</p>
        {error && <div style={errBanner}>{error}</div>}
        <Field label="Your Name">
          <input style={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </Field>
        <Field label="Email">
          <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        <Field label="Password (min 8 chars)">
          <input style={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
        </Field>
        <Field label="Confirm Password">
          <input style={input} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </Field>
        <button type="submit" style={btn} disabled={submitting}>
          {submitting ? 'Creating…' : '▶ Create Owner Account'}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={lbl}>{label}</label>
      {children}
    </div>
  );
}

const shell = { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 60px)', padding: '2rem' };
const card = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.15)', padding: '2.5rem', maxWidth: 460, width: '100%' };
const title = { fontSize: 22, fontWeight: 900, textTransform: 'uppercase', color: 'var(--cream)', margin: '0 0 0.5rem' };
const sub = { color: 'var(--olive-light)', fontSize: 13, marginBottom: '1.5rem' };
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--tan)', marginBottom: 6 };
const input = { width: '100%', padding: '12px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 14, outline: 'none', boxSizing: 'border-box' };
const btn = { width: '100%', padding: 14, background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', cursor: 'pointer', marginTop: 8 };
const errBanner = { background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', color: '#ff8a7e', padding: 12, marginBottom: 16, fontSize: 13 };

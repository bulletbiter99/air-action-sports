import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';

export default function AdminLogin() {
  const { login, isAuthenticated, setupNeeded, loading } = useAdmin();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (isAuthenticated) navigate('/admin', { replace: true });
    else if (setupNeeded) navigate('/admin/setup', { replace: true });
  }, [loading, isAuthenticated, setupNeeded, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const res = await login(email, password);
    setSubmitting(false);
    if (res.ok) navigate('/admin', { replace: true });
    else setError(res.error);
  };

  if (loading) return null;

  return (
    <div style={shell}>
      <form onSubmit={handleSubmit} style={card}>
        <div style={{ color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 2, marginBottom: 8 }}>■ Admin Access</div>
        <h2 style={title}>Log In</h2>
        {error && <div style={errBanner}>{error}</div>}
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Email</label>
          <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Password</label>
          <input style={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </div>
        <button type="submit" style={btn} disabled={submitting}>
          {submitting ? 'Logging in…' : '▶ Log In'}
        </button>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12 }}>
          <Link to="/admin/forgot-password" style={{ color: 'var(--orange)', textDecoration: 'none' }}>Forgot password?</Link>
        </div>
        <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12 }}>
          <Link to="/" style={{ color: 'var(--olive-light)', textDecoration: 'none' }}>← Back to site</Link>
        </div>
      </form>
    </div>
  );
}

const shell = { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 60px)', padding: '2rem' };
const card = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.15)', padding: '2.5rem', maxWidth: 400, width: '100%' };
const title = { fontSize: 22, fontWeight: 900, textTransform: 'uppercase', color: 'var(--cream)', margin: '0 0 1.25rem' };
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--tan)', marginBottom: 6 };
const input = { width: '100%', padding: '12px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 14, outline: 'none', boxSizing: 'border-box' };
const btn = { width: '100%', padding: 14, background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', cursor: 'pointer' };
const errBanner = { background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', color: '#ff8a7e', padding: 12, marginBottom: 16, fontSize: 13 };

import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function AdminForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Request failed');
      } else {
        setSubmitted(true);
      }
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div style={shell}>
        <div style={card}>
          <div style={{ color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 2, marginBottom: 8 }}>■ Check Your Inbox</div>
          <h2 style={title}>Reset link sent.</h2>
          <p style={{ color: 'var(--tan-light)', fontSize: 14, lineHeight: 1.6 }}>
            If <strong>{email}</strong> matches an admin account, a password reset link has been sent.
          </p>
          <p style={{ color: 'var(--olive-light)', fontSize: 13, marginTop: 12 }}>
            The link expires in <strong>1 hour</strong>. Check spam / promotions folders if you don't see it in a minute or two.
          </p>
          <Link to="/admin/login" style={{ ...btn, display: 'inline-block', textAlign: 'center', textDecoration: 'none', marginTop: 16 }}>
            ← Back to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <form onSubmit={handleSubmit} style={card}>
        <div style={{ color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 2, marginBottom: 8 }}>■ Forgot Password</div>
        <h2 style={title}>Reset your password</h2>
        <p style={{ color: 'var(--olive-light)', fontSize: 13, marginBottom: 20 }}>
          Enter the email for your admin account and we'll send you a reset link.
        </p>
        {error && <div style={errBanner}>{error}</div>}
        <label style={lbl}>Email</label>
        <input style={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <button type="submit" style={{ ...btn, marginTop: 16 }} disabled={submitting}>
          {submitting ? 'Sending…' : '▶ Send Reset Link'}
        </button>
        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12 }}>
          <Link to="/admin/login" style={{ color: 'var(--olive-light)', textDecoration: 'none' }}>← Back to login</Link>
        </div>
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

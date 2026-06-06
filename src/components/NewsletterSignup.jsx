import { useState } from 'react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Footer "Stay in the Loop" signup. Posts to POST /api/newsletter, which
// captures the email into customers (email_marketing = 1) so the subscriber
// is reachable by marketing campaigns. Replaces the old placeholder alert().
export default function NewsletterSignup() {
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  // 'idle' | 'submitting' | 'success' | 'error' | 'rate_limited'
  const [state, setState] = useState('idle');

  const submit = async (e) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setState('error');
      return;
    }
    setState('submitting');
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), website }),
      });
      if (res.status === 429) {
        setState('rate_limited');
        return;
      }
      if (!res.ok) {
        setState('error');
        return;
      }
      setEmail('');
      setState('success');
    } catch {
      setState('error');
    }
  };

  if (state === 'success') {
    return (
      <p role="status" style={{ fontSize: 13, color: 'var(--orange)', fontWeight: 600, margin: 0 }}>
        You&rsquo;re on the list — watch your inbox for event drops.
      </p>
    );
  }

  return (
    <form className="newsletter" onSubmit={submit} noValidate>
      {/* Honeypot — hidden from users; bots that fill it get a silent 200. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1 }}
      />
      <input
        type="email"
        placeholder="Your email..."
        aria-label="Email address for event alerts"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={state === 'submitting'}
      />
      <button type="submit" disabled={state === 'submitting'}>
        {state === 'submitting' ? '…' : 'Join'}
      </button>
      {state === 'error' && (
        <p style={{ fontSize: 12, color: '#ff8a7e', margin: '6px 0 0', width: '100%' }}>
          Enter a valid email and try again.
        </p>
      )}
      {state === 'rate_limited' && (
        <p style={{ fontSize: 12, color: '#f0b429', margin: '6px 0 0', width: '100%' }}>
          Too many tries — give it a minute.
        </p>
      )}
    </form>
  );
}

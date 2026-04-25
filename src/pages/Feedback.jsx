import { useState } from 'react';
import FeedbackModal from '../components/FeedbackModal';
import SEO from '../components/SEO';

export default function Feedback() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <SEO
        title="Share feedback — Air Action Sports"
        description="Tell us about bugs, feature ideas, or usability issues on the Air Action Sports site."
      />
      <section style={{ padding: '100px 20px 60px', maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: -1, textTransform: 'uppercase', color: 'var(--cream)', margin: 0 }}>
          Share feedback
        </h1>
        <p style={{ color: 'var(--tan-light)', fontSize: 15, marginTop: 12, lineHeight: 1.6 }}>
          Spotted a bug? Got an idea? Something confusing? Let us know — every submission lands in our triage
          queue and helps us make the site better for players and staff alike.
        </p>
        <button type="button" onClick={() => setOpen(true)} style={{
          marginTop: 24, padding: '14px 28px', background: 'var(--orange)', color: '#fff', border: 'none',
          fontSize: 13, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer',
        }}>
          ▶ Open feedback form
        </button>
      </section>
      <FeedbackModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

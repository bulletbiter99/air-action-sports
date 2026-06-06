// Reusable social-proof strip — drops onto any page (self-contained inline
// styles, no page-CSS dependency). Reads from src/data/testimonials.js.
// Used on high-intent pages (Event Detail, Locations) where a review near
// the booking decision lifts conversion.
import { testimonials } from '../data/testimonials';

export default function SocialProof({ limit, heading = 'What Players Say' }) {
  const items = limit ? testimonials.slice(0, limit) : testimonials;
  if (!items.length) return null;

  return (
    <section style={wrap}>
      <div style={inner}>
        <div style={label}>&#9632; In the Field</div>
        <h2 style={title}>{heading}</h2>
        <div style={grid}>
          {items.map((t) => (
            <figure key={t.initials} style={card}>
              <div style={stars}>&#9733;&#9733;&#9733;&#9733;&#9733;</div>
              <blockquote style={quote}>&ldquo;{t.text}&rdquo;</blockquote>
              <figcaption style={author}>
                <span style={avatar}>{t.initials}</span>
                <span>
                  <span style={nameLine}>{t.name}</span>
                  <span style={roleLine}>{t.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

const wrap = { background: 'var(--mid)', padding: '4rem 2rem', borderTop: '1px solid rgba(200,184,154,0.1)' };
const inner = { maxWidth: 1200, margin: '0 auto' };
const label = { color: 'var(--orange)', fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: '0.5rem' };
const title = { color: 'var(--cream)', fontSize: '1.75rem', margin: '0 0 1.75rem' };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' };
const card = { background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(200,184,154,0.12)', borderRadius: 4, padding: '1.5rem', margin: 0 };
const stars = { color: 'var(--orange)', letterSpacing: 2, marginBottom: '0.75rem' };
const quote = { color: 'var(--tan-light)', fontSize: 14, lineHeight: 1.6, margin: '0 0 1.25rem' };
const author = { display: 'flex', alignItems: 'center', gap: '0.75rem' };
const avatar = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', background: 'var(--orange)', color: 'var(--dark)', fontWeight: 800, fontSize: 13, flexShrink: 0 };
const nameLine = { display: 'block', color: 'var(--cream)', fontWeight: 700, fontSize: 14 };
const roleLine = { display: 'block', color: 'var(--olive-light)', fontSize: 12 };

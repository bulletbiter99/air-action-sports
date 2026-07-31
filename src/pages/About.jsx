import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import { siteConfig } from '../data/siteConfig';
import '../styles/pages/about.css';

// Safety copy mirrors /rules-of-engagement, which is the authoritative source.
// If the ROE changes, change it here too — or better, link rather than restate.
const safetyItems = [
  {
    icon: '\u{1F6E1}',
    title: 'Trained Marshals',
    desc: 'Every event has fully trained marshals on the field at all times. They enforce the rules, manage game flow, and keep everyone safe.',
  },
  {
    icon: '⚠',
    title: 'FPS Limits',
    desc: 'Strict chronograph testing on entry, measured with 0.20g BBs. 350 FPS for rifles, 450 for DMR and LMG, 550 for bolt-action snipers — each with its own minimum engagement distance.',
  },
  {
    icon: '\u{1F9F1}',
    title: 'Mandatory Protection',
    desc: 'ANSI Z87.1+ full-seal eye protection is required at all times in any active game zone. Players under 18 also wear a full-face mask; players 18 and over wear a mask, lower-face shield, or mouth guard.',
  },
  {
    icon: '\u{1F4D6}',
    title: 'Safety Briefings',
    desc: 'Comprehensive safety briefing before every game. All players must attend regardless of experience level.',
  },
];

export default function About() {
  return (
    <>
      <SEO
        title="About Us | Air Action Sports"
        description="The story behind Air Action Sports. Born in the field, built for the community — our mission, our sites, and our commitment to player safety."
        canonical="https://airactionsport.com/about"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      {/* About Hero */}
      <section className="about-hero">
        <div className="section-label">&#9632; About Us</div>
        <h1 className="section-title">Born in the Field.</h1>
        <div className="divider"></div>
        <p className="section-sub">
          We're airsoft players who built something for the community.
        </p>
      </section>

      {/* Origin Story */}
      <section className="origin-section">
        <div className="page-content">
          <div className="origin-grid">
            <div className="origin-text">
              <p>
                Air Action Sports started in 2024 with a group of friends, two
                acres of woodland, and a box of rental guns. We wanted airsoft
                events that didn't cut corners &mdash; proper marshaling, fair
                play, and sites that actually felt immersive.
              </p>
              <p>
                Within a year we'd outgrown our first site. Players kept coming
                back, bringing friends, asking for more. So we expanded &mdash;
                new locations, better gear, bigger games.
              </p>
              <p>
                Today we run events across multiple sites with hundreds of
                regular players. But the mission hasn't changed: deliver the best
                airsoft experience in the region, every single game day.
              </p>
            </div>
            <div className="origin-photo"></div>
          </div>

          {/* Mission Panel */}
          <div className="mission-panel">
            <h3>Our Mission</h3>
            <p>
              To build the best airsoft community in the region &mdash; where
              every player, from complete beginners to seasoned operators, gets a
              safe, intense, and unforgettable experience.
            </p>
          </div>
        </div>
      </section>

      {/* Safety Section */}
      <section style={{ background: 'var(--mid)', padding: '4rem 0' }}>
        <div className="page-content">
          <div className="section-label">&#9632; Safety First</div>
          <h2 className="section-title">Your Safety. Our Priority.</h2>
          <div className="divider"></div>
          <div className="safety-grid">
            {safetyItems.map((item) => (
              <div className="safety-item" key={item.title}>
                <div className="safety-icon">{item.icon}</div>
                <div className="safety-title">{item.title}</div>
                <div className="safety-desc">{item.desc}</div>
              </div>
            ))}
          </div>
          <p style={{ marginTop: '2rem', fontSize: 15, color: 'var(--olive-light)' }}>
            Full weapon classes, engagement distances, hit calling, and conduct
            are covered in the{' '}
            <Link
              to="/rules-of-engagement"
              style={{ color: 'var(--orange)', textDecoration: 'underline', fontWeight: 700 }}
            >
              Rules of Engagement
            </Link>
            {' '}and the{' '}
            <Link
              to="/safety"
              style={{ color: 'var(--orange)', textDecoration: 'underline', fontWeight: 700 }}
            >
              safety briefing
            </Link>
            .
          </p>
          <div className="badges-row">
            <div className="badge-item">Fully Insured</div>
            <div className="badge-item">Safety Certified</div>
            <div className="badge-item">First Aid Trained</div>
            <div className="badge-item">Ages 12+ Welcome</div>
          </div>
        </div>
      </section>

      {/* CTA Band */}
      <div className="about-cta-band">
        <h2>Ready to Join the Mission?</h2>
        <p>Book your first game and see what it's all about.</p>
        <Link to={siteConfig.bookingLink} className="btn-white">
          &#9658; Book Now
        </Link>
      </div>
    </>
  );
}

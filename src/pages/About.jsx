import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/about.css';

export default function About() {
  const team = [
    {
      name: 'Alex Morgan',
      callsign: 'GHOST',
      role: 'Founder & Lead Marshal',
    },
    {
      name: 'Jordan Hayes',
      callsign: 'VIPER',
      role: 'Operations Manager',
    },
    {
      name: 'Sam Chen',
      callsign: 'HAWK',
      role: 'Site Manager & Safety Lead',
    },
  ];

  const timeline = [
    { year: '2024', text: 'Founded Air Action Sports with our first woodland site' },
    { year: '2024', text: 'Hosted first public event \u2014 16 players turned up' },
    { year: '2025', text: 'Opened Echo Urban \u2014 our first indoor CQB site' },
    { year: '2025', text: 'Passed 1,000 total players deployed' },
    { year: '2026', text: 'Foxtrot Fields announced \u2014 our largest site yet' },
    { year: '2026', text: 'Growing the community every week' },
  ];

  const safetyItems = [
    {
      icon: '\u{1F6E1}',
      title: 'Trained Marshals',
      desc: 'Every event has fully trained marshals on the field at all times. They enforce the rules, manage game flow, and keep everyone safe.',
    },
    {
      icon: '\u26A0',
      title: 'FPS Limits',
      desc: 'Strict chronograph testing on entry. 350 FPS for AEGs, 500 for bolt-action with mandatory minimum engagement distances.',
    },
    {
      icon: '\u{1F9F1}',
      title: 'Mandatory Protection',
      desc: 'Full face masks required at all times in the game zone. No exceptions. Your safety comes first.',
    },
    {
      icon: '\u{1F4D6}',
      title: 'Safety Briefings',
      desc: 'Comprehensive safety briefing before every game. All players must attend regardless of experience level.',
    },
  ];

  return (
    <>
      <SEO
        title="About Us | Air Action Sports"
        description="Meet the team behind Air Action Sports. Born in the field, built for the community. Learn our story, mission, and commitment to safety."
        canonical="https://airactionsport.com/about"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      {/* About Hero */}
      <section className="about-hero">
        <div className="section-label">&#9632; About Us</div>
        <h1 className="section-title">Born in the Field.</h1>
        <div className="divider"></div>
        <p className="section-sub">
          We're not a corporate events company. We're airsoft players who built
          something for the community.
        </p>
      </section>

      {/* Origin Story */}
      <section className="origin-section">
        <div className="page-content">
          <div className="origin-grid">
            <div className="origin-text">
              {/* PLACEHOLDER: Update with real brand story */}
              <p>
                Air Action Sports started in 2024 with a group of friends, two
                acres of woodland, and a box of rental guns. We wanted airsoft
                events that didn't cut corners &mdash; proper marshalling, fair
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
            <div className="origin-photo">Photo placeholder</div>
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

      {/* The Team */}
      <section className="page-content">
        <div className="section-label">&#9632; The Team</div>
        <h2 className="section-title">Meet the Operators.</h2>
        <div className="divider"></div>
        {/* PLACEHOLDER: Replace with real team members */}
        <div className="team-grid">
          {team.map((member) => (
            <div className="team-card" key={member.callsign}>
              <div className="team-photo">Photo placeholder</div>
              <div className="team-info">
                <div className="team-name">{member.name}</div>
                <div className="team-callsign">
                  Callsign: {member.callsign}
                </div>
                <div className="team-role">{member.role}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Timeline */}
      <section className="page-content">
        <div className="section-label">&#9632; Our Story</div>
        <h2 className="section-title">Mission Log.</h2>
        <div className="divider"></div>
        {/* PLACEHOLDER: Update with real milestones */}
        <div className="timeline">
          {timeline.map((item, i) => (
            <div className="timeline-item" key={i}>
              <div className="timeline-year">{item.year}</div>
              <div className="timeline-text">{item.text}</div>
            </div>
          ))}
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
          <div className="badges-row">
            <div className="badge-item">Fully Insured</div>
            <div className="badge-item">Safety Certified</div>
            <div className="badge-item">First Aid Trained</div>
            <div className="badge-item">All Ages Welcome</div>
          </div>
        </div>
      </section>

      {/* CTA Band */}
      <div className="about-cta-band">
        <h2>Ready to Join the Mission?</h2>
        <p>Book your first game and see what it's all about.</p>
        <Link to="/booking" className="btn-white">
          &#9658; Book Now
        </Link>
      </div>
    </>
  );
}

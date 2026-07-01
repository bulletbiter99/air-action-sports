import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/new-players.css';
import '../styles/pages/rules-of-engagement.css';

// The AirActionSport LLC safety briefing, delivered at every event's check-in.
// Published so players can read it before they arrive. Faithful to the operator's
// safety-briefing document; framed for a player-facing read.
const SECTIONS = [
  {
    title: 'Welcome',
    subtitle: 'Safety is the top priority',
    items: [
      'Welcome to the event. Your staff and referees will introduce themselves at check-in.',
      'Safety is our number-one priority, before scores and before the mission.',
      "Referees' decisions are final. If you disagree, raise it with a marshal after the round.",
    ],
  },
  {
    title: 'Emergency Procedures',
    subtitle: 'Know these before the game starts',
    items: [
      'Know the location of the staging area and the first aid station.',
      'Know who the event medical personnel are and how to report an injury.',
    ],
    callout: {
      title: 'Real-World Emergency',
      body: 'In a genuine emergency, loudly call "REAL WORLD EMERGENCY!" Every player immediately stops shooting, puts their weapon on safe, and awaits instructions from staff.',
    },
  },
  {
    title: 'Eye Protection',
    subtitle: 'Never comes off on the field',
    items: [
      'ANSI Z87.1+ or MIL-PRF-32432-rated eye protection is required at all times in the play area.',
      'Eye protection may never be removed while on the field.',
      'If your eye protection fogs, return to a designated safe area before removing it.',
      'Anyone removing eye protection on the field will be immediately removed from play.',
    ],
  },
  {
    title: 'Barrel Covers & Safe Weapon Handling',
    subtitle: 'In every Green Zone',
    items: [
      'Barrel cover (or barrel sock) installed.',
      'Magazine removed and chamber cleared.',
      'Weapon on SAFE.',
      'No dry firing in the staging area.',
      'Treat every replica as if it is loaded.',
    ],
  },
  {
    title: 'Green Zone Rules',
    subtitle: 'Weapons cold, people safe',
    items: [
      'No loaded magazines in replicas.',
      'No firing under any circumstances.',
      'Barrel covers must remain on.',
      'Battery changes, maintenance, and reloads are allowed.',
      "Respect everyone's personal space and equipment.",
    ],
  },
  {
    title: 'Fire Safety',
    subtitle: 'Abandoned outdoor environment',
    items: [
      'No open flames.',
      'No fireworks, pyrotechnics, or smoke grenades. Our sites sit on fire-restricted land, so these are not permitted.',
      'No smoking inside buildings or near dry vegetation, and dispose of cigarette butts properly.',
      'Report any signs of smoke or fire immediately.',
      'If a fire is spotted, notify staff at once, do not attempt to fight a large fire yourself, and follow staff instructions.',
    ],
  },
  {
    title: 'Vehicle Safety',
    subtitle: 'Two pickup trucks operate during gameplay',
    items: [
      'Vehicles always have the right of way.',
      'Never stand in front of a moving vehicle and never intentionally block one.',
      'Stay a safe distance from moving vehicles.',
      'Drivers are responsible only for driving. Passengers may not jump on or off moving vehicles.',
      'Follow referee instructions around vehicles at all times.',
    ],
  },
  {
    title: 'Engagement Rules',
    subtitle: 'See your target',
    items: [
      'No blind firing. You must see your target before shooting.',
      'Watch your rate of fire in close quarters.',
      'Be aware of players who are not participating (staff, photographers, and others).',
    ],
  },
  {
    title: 'Hit Calling & Sportsmanship',
    subtitle: 'Honor system',
    items: [
      'Call your hits honestly and raise your dead rag immediately after being hit.',
      'Do not communicate enemy positions after being eliminated unless the game rules specifically allow it.',
      'Respect referees and other players. Unsportsmanlike conduct will not be tolerated.',
    ],
  },
  {
    title: 'Field Boundaries',
    subtitle: 'Stay in the play area',
    items: [
      'Know the field boundaries and any off-limits buildings or unsafe structures.',
      'Do not climb on roofs, unstable structures, or restricted areas.',
      'Stay within the designated play area.',
    ],
  },
  {
    title: 'Wildlife & Environmental Hazards',
    subtitle: 'Rugged, abandoned terrain',
    items: [
      'Be aware of uneven terrain, loose rocks, and abandoned structures.',
      'Watch for snakes, insects, and other wildlife.',
      'Stay hydrated throughout the day and night.',
      'Notify staff of any hazards you discover.',
    ],
  },
  {
    title: 'Chronograph & FPS Compliance',
    subtitle: 'Every replica, every event',
    items: [
      'All replicas must pass chrono before play.',
      'Do not swap springs or otherwise increase power after chrono without approval.',
      'Random chrono checks may be conducted during the event.',
      'Any replica found exceeding the event limits will be removed from play until corrected.',
    ],
  },
  {
    title: 'Radio Communication',
    subtitle: 'Keep the net clear',
    items: [
      'Use assigned radio channels and keep communications professional.',
      'In an emergency, give priority to staff traffic.',
    ],
  },
  {
    title: 'Questions',
    subtitle: 'Before you step on the field',
    items: [
      'Ask a marshal if anything is unclear before the event begins.',
      'Make sure you understand every safety rule before moving to the field.',
    ],
  },
  {
    title: 'Additional Site Reminders',
    subtitle: 'Aging buildings and uneven ground',
    items: [
      'Do not enter any building or area marked unsafe or off-limits.',
      'Do not climb onto roofs, elevated platforms, or unstable structures.',
      'Do not move or disturb old equipment, debris, or abandoned materials.',
      'If you notice a new hazard during gameplay, notify a referee immediately.',
    ],
  },
];

export default function Safety() {
  return (
    <>
      <SEO
        title="Safety Briefing | Air Action Sports"
        description="The Air Action Sports safety briefing every player receives at check-in: eye protection, green zones, fire and vehicle safety, engagement rules, chrono compliance, and emergency procedures. Read it before you arrive."
        canonical="https://airactionsport.com/safety"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      {/* Hero */}
      <div className="guide-hero">
        <div className="section-label">&#9632; Safety Briefing</div>
        <h1 className="section-title">Safety First. Always.</h1>
        <div className="divider"></div>
        <p className="section-sub">
          This is the safety briefing every player receives at check-in. Read it
          before you arrive &mdash; you&rsquo;ll be held to it on the field.
        </p>
      </div>

      <div className="page-content">
        {SECTIONS.map((s, i) => (
          <div className="step-section" key={s.title}>
            <div className="step-header">
              <div className="step-number">{String(i + 1).padStart(2, '0')}</div>
              <div>
                <div className="step-title">{s.title}</div>
                {s.subtitle && <div className="step-subtitle">{s.subtitle}</div>}
              </div>
            </div>
            <div className="step-content">
              <ul>
                {s.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
              {s.callout && (
                <div className="tip-box">
                  <strong>{s.callout.title}</strong>
                  <p>{s.callout.body}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* CTA Band */}
      <div className="newplayers-cta-band">
        <h2>Questions Before Game Day?</h2>
        <p>Reach out and we&rsquo;ll walk you through anything that&rsquo;s not clear.</p>
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link to="/rules-of-engagement" className="btn-white">
            &#9658; Rules of Engagement
          </Link>
          <Link to="/contact" className="btn-ghost" style={{ borderColor: 'white', color: 'white' }}>
            &#9658; Contact Us
          </Link>
        </div>
      </div>
    </>
  );
}

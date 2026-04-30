import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/new-players.css';
import '../styles/pages/rules-of-engagement.css';

const WEAPON_CLASSES = [
  {
    name: 'Rifle Class',
    fps: '350 FPS',
    energy: '1.14 J',
    fireMode: 'Full auto allowed',
    med: 'No minimum engagement distance',
    notes: 'Measured with 0.20g BBs.',
  },
  {
    name: 'DMR Class',
    fps: '450 FPS',
    energy: '1.88 J',
    fireMode: 'Semi-auto only',
    med: '50 ft minimum engagement distance',
    notes: 'Measured with 0.20g BBs.',
  },
  {
    name: 'LMG Class',
    fps: '450 FPS',
    energy: '1.88 J',
    fireMode: 'Full auto allowed (20 RPS max)',
    med: '50 ft minimum engagement distance',
    notes:
      'Must be a real LMG-style platform (RPK, M60, M249). No M4s with drum mags.',
  },
  {
    name: 'Sniper Class',
    fps: '550 FPS',
    energy: '2.81 J',
    fireMode: 'Bolt-action only',
    med: '100 ft minimum engagement distance',
    notes: 'Measured with 0.20g BBs.',
  },
];

export default function RulesOfEngagement() {
  return (
    <>
      <SEO
        title="Rules of Engagement | Air Action Sports"
        description="Air Action Sports rules of engagement: weapon class FPS limits, minimum engagement distances, safety requirements, hit calling, and conduct policies."
        canonical="https://airactionsport.com/rules-of-engagement"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      {/* Hero */}
      <div className="guide-hero">
        <div className="section-label">&#9632; Rules of Engagement</div>
        <h1 className="section-title">Play Hard. Play Fair. Play Safe.</h1>
        <div className="divider"></div>
        <p className="section-sub">
          Every player at Air Action Sports follows the same rules. Read these
          before you arrive &mdash; you&rsquo;ll be held to them on the field.
        </p>
      </div>

      <div className="page-content">
        {/* Weapon classes */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">01</div>
            <div>
              <div className="step-title">Weapon Classes &amp; FPS Limits</div>
              <div className="step-subtitle">
                Chrono on entry &mdash; every gun, every event
              </div>
            </div>
          </div>
          <div className="step-content">
            <div className="roe-class-grid">
              {WEAPON_CLASSES.map((c) => (
                <div className="roe-class-card" key={c.name}>
                  <div className="roe-class-name">{c.name}</div>
                  <div className="roe-class-stat">
                    <span className="roe-class-stat-label">Max FPS</span>
                    <span className="roe-class-stat-value">{c.fps}</span>
                  </div>
                  <div className="roe-class-stat">
                    <span className="roe-class-stat-label">Energy</span>
                    <span className="roe-class-stat-value">{c.energy}</span>
                  </div>
                  <div className="roe-class-stat">
                    <span className="roe-class-stat-label">Fire mode</span>
                    <span className="roe-class-stat-value">{c.fireMode}</span>
                  </div>
                  <div className="roe-class-stat">
                    <span className="roe-class-stat-label">MED</span>
                    <span className="roe-class-stat-value">{c.med}</span>
                  </div>
                  {c.notes && <div className="roe-class-notes">{c.notes}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Grenades */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">02</div>
            <div>
              <div className="step-title">Grenades</div>
              <div className="step-subtitle">Thunder B and similar</div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>10 ft kill radius &mdash; please respect this rule.</li>
              <li>
                Anyone inside the radius at detonation is out, regardless of
                cover.
              </li>
            </ul>
          </div>
        </div>

        {/* Training knives */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">03</div>
            <div>
              <div className="step-title">Training Knives</div>
              <div className="step-subtitle">Admin-approved only</div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>Admin-approved knives only &mdash; check in at registration.</li>
              <li>Light tap = elimination.</li>
              <li>No stabbing. No aggressive contact. No throwing.</li>
            </ul>
          </div>
        </div>

        {/* Hit calling */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">04</div>
            <div>
              <div className="step-title">Calling Your Hits</div>
              <div className="step-subtitle">Honor system &mdash; everyone wins</div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>
                Any BB strike on body, gear, or weapon = a hit. Ricochets count.
              </li>
              <li>
                When hit, raise your hand or weapon and yell{' '}
                <strong>&ldquo;HIT!&rdquo;</strong> loud enough to be heard.
              </li>
              <li>
                Stay quiet after calling out &mdash; no coaching teammates from
                the dead.
              </li>
              <li>
                Walk to your respawn or designated dead-zone with a hand or
                dead-rag visible.
              </li>
              <li>
                Respawn / medic / weapon-hit mechanics are set per event &mdash;
                listen for them in the safety briefing.
              </li>
            </ul>
            <div className="tip-box">
              <strong>Pro Tip</strong>
              <p>
                Calling a hit costs you 30 seconds. Not calling one costs you
                everyone&rsquo;s respect. Be the player you want on your team.
              </p>
            </div>
          </div>
        </div>

        {/* Eye and face protection */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">05</div>
            <div>
              <div className="step-title">Eye &amp; Face Protection</div>
              <div className="step-subtitle">
                Non-negotiable. Always. Everywhere.
              </div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>
                ANSI Z87.1+ rated full-seal eye protection required at all times
                in any active game zone.
              </li>
              <li>
                Prescription glasses alone do <strong>not</strong> meet this
                requirement &mdash; wear approved goggles over them.
              </li>
              <li>
                Players under 18 must wear a full-face mask covering mouth and
                teeth.
              </li>
              <li>
                Players 18+ must wear a mask, lower-face shield, or mouth guard.
              </li>
              <li>
                If your protection fogs, fails, or comes off &mdash; call a
                cease-fire by yelling <strong>&ldquo;BLIND MAN!&rdquo;</strong>{' '}
                and exit safely.
              </li>
            </ul>
          </div>
        </div>

        {/* Age policy */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">06</div>
            <div>
              <div className="step-title">Age &amp; Minor Policy</div>
              <div className="step-subtitle">
                12 and up &mdash; with the right paperwork
              </div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>Minimum age: 12 years old.</li>
              <li>
                Players ages 12&ndash;17 require a parent or legal guardian to
                sign the waiver.
              </li>
              <li>
                Minors must be accompanied on-site by a trusted adult with a
                vehicle available in case of emergency or early pickup.
              </li>
              <li>
                Marshals reserve the right to remove any minor who cannot follow
                safety rules &mdash; refunds are not guaranteed.
              </li>
            </ul>
          </div>
        </div>

        {/* Safe zone */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">07</div>
            <div>
              <div className="step-title">Safe Zone Procedures</div>
              <div className="step-subtitle">Mags out, action clear, safety on</div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>
                Before entering the safe zone, remove your magazine, fire one
                shot at the dirt, and engage the safety.
              </li>
              <li>
                No firing of any kind in or toward the safe zone, ever. Eye
                protection is the only thing optional in the safe zone &mdash;
                everyone, including spectators, must stay outside the active
                field.
              </li>
              <li>
                First violation: warning. Second violation: removal from the
                event.
              </li>
            </ul>
          </div>
        </div>

        {/* Chronograph */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">08</div>
            <div>
              <div className="step-title">Chronograph Policy</div>
              <div className="step-subtitle">Every gun, every event, no exceptions</div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>
                Every replica is chrono&rsquo;d at check-in using 0.20g BBs.
              </li>
              <li>
                Guns over the limit for their declared class will not be allowed
                on the field until brought into spec.
              </li>
              <li>
                Adjusting FPS after the chrono check is grounds for ejection
                from the event and a permanent ban.
              </li>
              <li>
                Marshals may re-chrono any weapon at any time. Refusal is an
                automatic ejection.
              </li>
            </ul>
          </div>
        </div>

        {/* Drugs and alcohol */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">09</div>
            <div>
              <div className="step-title">Drugs &amp; Alcohol</div>
              <div className="step-subtitle">Zero tolerance on the field</div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>
                No alcohol, marijuana, or recreational drugs on-site or before
                arrival. Showing up impaired = ejection without refund.
              </li>
              <li>
                Prescription medication that affects judgment, coordination, or
                reaction time disqualifies you from playing that day.
              </li>
              <li>
                If you suspect another player is impaired, notify a marshal
                immediately. We will pull them off the field &mdash; this is a
                safety issue.
              </li>
            </ul>
          </div>
        </div>

        {/* Sportsmanship */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">10</div>
            <div>
              <div className="step-title">Sportsmanship &amp; Cheating</div>
              <div className="step-subtitle">Call it &mdash; or pack it up</div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>
                Players who refuse to call hits will be warned, then ejected for
                the day.
              </li>
              <li>
                Repeat offenders are banned from future Air Action Sports
                events.
              </li>
              <li>
                Ghosting (pretending you weren&rsquo;t hit), wiping (brushing
                BBs off so you can keep playing), and overshooting all fall
                under cheating.
              </li>
              <li>
                Marshals have final say. If you disagree, talk to them after the
                game &mdash; not on the field, not on the radio.
              </li>
            </ul>
          </div>
        </div>

        {/* Disputes */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">11</div>
            <div>
              <div className="step-title">Disputes &amp; Marshals</div>
              <div className="step-subtitle">Refs settle it &mdash; not players</div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>
                Zero tolerance for arguing with another player on the field.
                Walk away and find a marshal.
              </li>
              <li>
                Marshal decisions are final at the moment of play. Appeals after
                the round are welcome.
              </li>
              <li>
                Players who escalate disputes will sit out the next round, and
                if it continues, the rest of the day.
              </li>
            </ul>
          </div>
        </div>

        {/* Physical violence */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">12</div>
            <div>
              <div className="step-title">Physical Contact &amp; Violence</div>
              <div className="step-subtitle">Permanent-ban territory</div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>No tackling, shoving, grappling, or strikes of any kind.</li>
              <li>
                No angry shooting (lighting up a player at point-blank range
                because you&rsquo;re mad). Use a verbal &ldquo;BANG&rdquo; or
                surrender call where the event allows it.
              </li>
              <li>
                Threats of violence on or off the field result in an immediate
                permanent ban and, where appropriate, involvement of law
                enforcement.
              </li>
            </ul>
          </div>
        </div>

        {/* Transport */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">13</div>
            <div>
              <div className="step-title">Transport &amp; Storage</div>
              <div className="step-subtitle">Bagged in, bagged out</div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>
                Replicas must be transported to and from your vehicle in a bag
                or hard case &mdash; never openly carried in the parking area.
              </li>
              <li>
                Magazines must be removed and weapons made safe before you leave
                the field.
              </li>
              <li>
                We share parking and access roads with neighbors. Treat the
                drive in and out as part of the event.
              </li>
            </ul>
          </div>
        </div>

        {/* Site rules */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">14</div>
            <div>
              <div className="step-title">Site Conduct</div>
              <div className="step-subtitle">Respect the field, respect the build</div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>
                Do not climb on structures, vehicles, scaffolding, or terrain
                features unless a marshal explicitly designates them as
                playable.
              </li>
              <li>
                Stay out of off-limits areas (marked with tape, signage, or
                briefed at start).
              </li>
              <li>
                Pack out what you pack in. Pick up your BB bags, snack
                wrappers, and water bottles before you leave.
              </li>
              <li>
                Vandalism, fire-starting, or damage to props or terrain results
                in ejection plus billing for damages.
              </li>
            </ul>
          </div>
        </div>

        {/* Ready band */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">15</div>
            <div>
              <div className="step-title">Ready to Play?</div>
              <div className="step-subtitle">
                Read it once. Live by it on game day.
              </div>
            </div>
          </div>
          <div className="step-content">
            <p>
              These rules exist because they keep the game safe and the day
              fun. Marshals enforce them consistently for everyone &mdash;
              first-timers, regulars, and staff.
            </p>
            <div
              style={{
                display: 'flex',
                gap: '1rem',
                flexWrap: 'wrap',
                marginTop: '1.5rem',
              }}
            >
              <Link to="/events" className="btn-white">
                &#9658; View Events
              </Link>
              <Link to="/new-players" className="btn-white">
                &#9658; New Players Guide
              </Link>
              <Link to="/faq" className="btn-white">
                &#9658; FAQ
              </Link>
            </div>
          </div>
        </div>
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
          <Link to="/contact" className="btn-white">
            &#9658; Contact Us
          </Link>
          <Link
            to="/faq"
            className="btn-ghost"
            style={{ borderColor: 'white', color: 'white' }}
          >
            &#9658; Read FAQ
          </Link>
        </div>
      </div>
    </>
  );
}

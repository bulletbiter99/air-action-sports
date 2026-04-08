import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/new-players.css';

export default function NewPlayers() {
  return (
    <>
      <SEO
        title="New Players Guide | Air Action Sports"
        description="Everything you need to know before your first airsoft game. Gear, rules, what to expect, and how to book."
        canonical="https://airactionsport.com/new-players"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      {/* Hero */}
      <div className="guide-hero">
        <div className="section-label">&#9632; New Players</div>
        <h1 className="section-title">Your First Mission Starts Here.</h1>
        <div className="divider"></div>
        <p className="section-sub">
          Never played airsoft before? No problem. Here's everything you need to
          know before your first game day.
        </p>
      </div>

      {/* Guide Content */}
      <div className="page-content">
        {/* Step 1 */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">01</div>
            <div>
              <div className="step-title">What is Airsoft?</div>
              <div className="step-subtitle">The basics in 30 seconds</div>
            </div>
          </div>
          <div className="step-content">
            <p>
              Airsoft is a team-based tactical sport using replica firearms that
              fire 6mm plastic BBs. It's safe, fun, and absolutely
              adrenaline-pumping. Games range from casual skirmish sessions to
              full military simulation (milsim) events. Suitable for ages 12 and
              up.
            </p>
            <div className="tip-box">
              <strong>Pro Tip</strong>
              <p>
                Think of it like paintball's tactical cousin &mdash; same thrill,
                more strategy, less mess.
              </p>
            </div>
          </div>
        </div>

        {/* Step 2 */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">02</div>
            <div>
              <div className="step-title">What to Wear</div>
              <div className="step-subtitle">
                Dress for the field, not the mall
              </div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>Long sleeves (t-shirt layer underneath)</li>
              <li>Sturdy boots or hiking shoes (no trainers)</li>
              <li>Long trousers (cargo pants ideal)</li>
              <li>Dark or neutral colors (no bright colors)</li>
              <li>Gloves recommended</li>
            </ul>
            <div className="do-dont">
              <div className="do-col">
                <h4>Do</h4>
                <ul>
                  <li>Layers you can remove</li>
                  <li>Sturdy ankle-covering boots</li>
                  <li>Clothes you don't mind getting dirty</li>
                </ul>
              </div>
              <div className="dont-col">
                <h4>Don't</h4>
                <ul>
                  <li>Shorts or bare skin</li>
                  <li>Sandals or open-toe shoes</li>
                  <li>Bright white or neon clothing</li>
                  <li>Expensive clothes</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Step 3 */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">03</div>
            <div>
              <div className="step-title">What Gear You Need</div>
              <div className="step-subtitle">
                Own gear or hire &mdash; your choice
              </div>
            </div>
          </div>
          <div className="step-content">
            <p>
              You don't need to own anything. We offer full gear hire at every
              event.
            </p>
            <div className="gear-grid">
              <div className="gear-card">
                <div className="gear-icon">&#128299;</div>
                <div className="gear-name">Airsoft Replica</div>
                <div className="gear-note">Hire available at all events</div>
              </div>
              <div className="gear-card">
                <div className="gear-icon">&#129405;</div>
                <div className="gear-name">Face Protection</div>
                <div className="gear-note">
                  Full face mask included with hire
                </div>
              </div>
              <div className="gear-card">
                <div className="gear-icon">&#129508;</div>
                <div className="gear-name">Gloves</div>
                <div className="gear-note">
                  Recommended &mdash; bring your own
                </div>
              </div>
              <div className="gear-card">
                <div className="gear-icon">&#128167;</div>
                <div className="gear-name">Water &amp; Snacks</div>
                <div className="gear-note">
                  Bring plenty &mdash; you'll need it
                </div>
              </div>
            </div>
            <div className="tip-box">
              <strong>Pro Tip</strong>
              <p>
                If you're hiring gear, arrive 30 minutes early so marshals can
                get you set up and fitted.
              </p>
            </div>
          </div>
        </div>

        {/* Step 4 */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">04</div>
            <div>
              <div className="step-title">Game Day</div>
              <div className="step-subtitle">
                A typical day at Air Action Sports
              </div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>
                Arrive 30 mins early &mdash; Registration, waiver, and gear hire
              </li>
              <li>
                Safety briefing &mdash; Rules, FPS limits, boundaries explained
                by marshals
              </li>
              <li>
                Team assignment &mdash; Squads formed, arm bands distributed
              </li>
              <li>
                Games begin &mdash; Multiple rounds, different game modes
                throughout the day
              </li>
              <li>Breaks &mdash; Reload, rehydrate, share war stories</li>
              <li>
                Pack up &mdash; Return hire gear, grab photos, book your next
                game
              </li>
            </ul>
          </div>
        </div>

        {/* Step 5 */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">05</div>
            <div>
              <div className="step-title">Safety Rules</div>
              <div className="step-subtitle">The non-negotiables</div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>
                Eye and face protection mandatory at ALL times in game zones
              </li>
              <li>Never blind fire (you must see your target)</li>
              <li>Call your hits honestly (honor system)</li>
              <li>No physical contact with other players</li>
              <li>Follow marshal instructions immediately</li>
              <li>FPS limits strictly enforced (chrono on entry)</li>
            </ul>
            <div className="tip-box">
              <strong>Pro Tip</strong>
              <p>
                Safety is why airsoft works. Everyone follows the rules, everyone
                has fun. Simple.
              </p>
            </div>
          </div>
        </div>

        {/* Step 6 */}
        <div className="step-section">
          <div className="step-header">
            <div className="step-number">06</div>
            <div>
              <div className="step-title">Ready to Book?</div>
              <div className="step-subtitle">Three easy steps</div>
            </div>
          </div>
          <div className="step-content">
            <ul>
              <li>Pick an event from our events calendar</li>
              <li>Fill out the booking form</li>
              <li>Complete your waiver before game day</li>
            </ul>
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
              <Link to="/booking" className="btn-white">
                &#9658; Book Now
              </Link>
              <Link to="/waiver" className="btn-white">
                &#9658; Complete Waiver
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* CTA Band */}
      <div className="newplayers-cta-band">
        <h2>Still Got Questions?</h2>
        <p>Check out our FAQ or drop us a message.</p>
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link to="/faq" className="btn-white">
            &#9658; Read FAQ
          </Link>
          <Link
            to="/contact"
            className="btn-ghost"
            style={{ borderColor: 'white', color: 'white' }}
          >
            &#9658; Contact Us
          </Link>
        </div>
      </div>
    </>
  );
}

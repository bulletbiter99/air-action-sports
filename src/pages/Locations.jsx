import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import { siteConfig } from '../data/siteConfig';
import { locations } from '../data/locations';
import '../styles/pages/locations.css';

export default function Locations() {
  return (
    <>
      <SEO
        title="Our Sites | Air Action Sports"
        description="Explore Air Action Sports airsoft locations. Woodland, CQB and open field sites across multiple elite venues."
        canonical="https://airactionsport.com/locations"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      <div className="page-content">
        <div className="section-label">&#9632; Our Sites</div>
        <h1 className="section-title">Multiple Theatres of War.</h1>
        <div className="divider"></div>
        <p className="section-sub">
          From dense woodland to tight urban quarters, each of our sites delivers a unique tactical experience. Explore the venues below and find the battlefield that suits your style.
        </p>

        {locations.map((site, index) => (
          <div className="site-section" id={site.id} key={site.id}>
            <div className="site-header">
              <div>
                <div className="site-name">{site.name}</div>
                <div className="site-meta">{site.address}</div>
              </div>
              <span className={`site-badge ${site.badge === 'open' ? 'open' : 'coming-soon'}`}>
                {site.badge === 'open' ? 'Open' : 'Coming Soon'}
              </span>
            </div>

            <div
              className="site-photo"
              style={site.photo ? {
                backgroundImage: `url('${site.photo}')`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              } : {}}
            >
              {/* Site photo */}
            </div>

            <div className="site-grid">
              <div>
                <div className="site-features-title">Site Features</div>
                <ul className="site-features">
                  {(site.fullFeatures || site.features).map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="site-features-title">Game Types Available</div>
                <ul className="site-features">
                  {site.gameTypes.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="site-cta">
              <a href={siteConfig.bookingLink} target="_blank" rel="noopener noreferrer" className="btn-primary">&#9658; {site.badge === 'open' ? 'Book This Site' : 'Register Interest'}</a>
            </div>
          </div>
        ))}
      </div>

      {/* CTA Band */}
      <div className="cta-band">
        <h2>Ready to Book?</h2>
        <p>Pick your site, pick your date, and get on the field.</p>
        <a href={siteConfig.bookingLink} target="_blank" rel="noopener noreferrer" className="btn-white">&#9658; Book Now</a>
      </div>
    </>
  );
}

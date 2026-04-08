import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import '../styles/pages/locations.css';

export default function Locations() {
  const siteData = [
    {
      name: 'Ghost Town',
      meta: 'Rural Neighborhood \u2014 19 Buildings \u00b7 Airsoft',
      status: 'open',
      photo: '/images/Ghost Town - Main Photo.jpg',
      photoPlaceholder: null,
      features: [
        'Bunkers & fortified objectives',
        'Multiple airsoft game modes',
      ],
      gameTypes: ['Milsim', 'Skirmish', 'Private Hire', 'Night Ops'],
      ctaText: 'Book This Site',
      ctaLink: '/booking',
    },
    {
      name: 'Echo Urban',
      meta: 'CQB Site \u2014 Indoor Warehouse \u00b7 Airsoft',
      status: 'open',
      photo: null,
      photoPlaceholder: 'SITE PHOTO \u2014 ECHO URBAN',
      features: [
        'Indoor close-quarters layout',
        'Multi-floor action zones',
        'Low-light scenario capability',
        'Climate-controlled environment',
        'Sound system for immersive ops',
        'Locker room facilities',
      ],
      gameTypes: ['CQB Skirmish', 'Milsim', 'Private Hire', 'Corporate Events'],
      ctaText: 'Book This Site',
      ctaLink: '/booking',
    },
    {
      name: 'Foxtrot Fields',
      meta: 'Open Field Site \u2014 25 acres \u00b7 Airsoft',
      status: 'coming-soon',
      photo: null,
      photoPlaceholder: 'SITE PHOTO \u2014 FOXTROT FIELDS',
      features: [
        'Open terrain skirmish zones',
        'Milsim-ready staging areas',
        'Large-scale team battles',
        'Vehicle access routes planned',
        'On-site catering planned',
        'Spectator viewing area',
      ],
      gameTypes: ['Large-scale Skirmish', 'Milsim', 'Private Hire'],
      ctaText: 'Register Interest',
      ctaLink: '/booking',
    },
  ];

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

        {siteData.map((site, index) => (
          <div className="site-section" key={index}>
            <div className="site-header">
              <div>
                <div className="site-name">{site.name}</div>
                <div className="site-meta">{site.meta}</div>
              </div>
              <span className={`site-badge ${site.status === 'open' ? 'open' : 'coming-soon'}`}>
                {site.status === 'open' ? 'Open' : 'Coming Soon'}
              </span>
            </div>

            {site.photo ? (
              <div
                className="site-photo"
                style={{
                  backgroundImage: `url('${site.photo}')`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {/* Site photo */}
              </div>
            ) : (
              <div className="site-photo">
                {site.photoPlaceholder}
              </div>
            )}

            <div className="site-grid">
              <div>
                <div className="site-features-title">Site Features</div>
                <ul className="site-features">
                  {site.features.map((f, i) => (
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
              <Link to={site.ctaLink} className="btn-primary">&#9658; {site.ctaText}</Link>
            </div>
          </div>
        ))}
      </div>

      {/* CTA Band */}
      <div className="cta-band">
        <h2>Ready to Book?</h2>
        <p>Pick your site, pick your date, and get on the field.</p>
        <Link to="/booking" className="btn-white">&#9658; Book Now</Link>
      </div>
    </>
  );
}

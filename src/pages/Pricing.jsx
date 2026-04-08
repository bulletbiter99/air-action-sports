import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import { pricingPlans, groupDiscounts, addOns } from '../data/pricing';
import '../styles/pages/pricing.css';

export default function Pricing() {
  return (
    <>
      <SEO
        title="Pricing | Air Action Sports"
        description="Transparent airsoft event pricing. Walk-in, group, and private hire rates. No hidden fees."
        canonical="https://airactionsport.com/pricing"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      {/* Pricing Hero */}
      <div className="pricing-hero">
        <div className="section-label">&#9632; Pricing</div>
        <h1 className="section-title">No Hidden Fees. No Surprises.</h1>
        <div className="divider"></div>
        <p className="section-sub">
          Transparent pricing for every type of player. Walk-in, group, or private hire &mdash; you know exactly what you're paying before you book.
        </p>
      </div>

      {/* Pricing Cards */}
      <div className="page-content">
        <div className="pricing-grid">
          {pricingPlans.map((plan) => (
            <div className={`price-card ${plan.featured ? 'featured' : ''}`} key={plan.id}>
              <div className="price-header">
                <div className="price-name">{plan.name}</div>
                <div className="price-amount">
                  {plan.price} <span>{plan.unit}</span>
                </div>
                <div className="price-desc">{plan.description}</div>
              </div>
              <ul className="price-features">
                {plan.features.map((feature, i) => (
                  <li key={i}>{feature}</li>
                ))}
              </ul>
              <div className="price-cta">
                <Link to={plan.cta.href}>{plan.cta.label}</Link>
              </div>
            </div>
          ))}
        </div>

        {/* Group Discounts */}
        <div className="addon-section">
          <div className="section-label">&#9632; Group Discounts</div>
          <h2 className="section-title">Bring Your Squad.</h2>
          <div className="divider"></div>
          <table className="group-table">
            <thead>
              <tr>
                <th>Group Size</th>
                <th>Price Per Head</th>
                <th>You Save</th>
              </tr>
            </thead>
            <tbody>
              {groupDiscounts.map((row, i) => (
                <tr key={i}>
                  <td>{row.size}</td>
                  <td>{row.pricePerHead}</td>
                  <td>{row.savings}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="note-box">
            <strong>Note</strong>
            <p>Group discounts apply to walk-in rate. Gear hire can be added for $15/head.</p>
          </div>
        </div>

        {/* Add-Ons */}
        <div className="addon-section">
          <div className="section-label">&#9632; Add-Ons</div>
          <h2 className="section-title">Upgrade Your Loadout.</h2>
          <div className="divider"></div>
          <div className="addon-grid">
            {addOns.map((addon, i) => (
              <div className="addon-item" key={i}>
                <div>
                  <div className="addon-name">{addon.name}</div>
                  <div className="addon-detail">{addon.detail}</div>
                </div>
                <div className="addon-price">{addon.price}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Note Box */}
        <div className="note-box">
          <strong>Please Note</strong>
          <p>All prices include full-day gameplay, safety briefing, and marshal support. Prices may vary for special milsim events. Under 16s must be accompanied by a paying adult.</p>
        </div>
      </div>

      {/* CTA Band */}
      <div className="cta-band">
        <h2>Ready to Book?</h2>
        <p>Pick your event and lock in your slot.</p>
        <Link to="/events" className="btn-white">&#9658; View Events</Link>
      </div>
    </>
  );
}

import { Link } from 'react-router-dom';
import { siteConfig } from '../data/siteConfig';

export default function PricingCard({ plan, featured }) {
  return (
    <div className={`price-card${featured ? ' featured' : ''}`}>
      <div className="price-header">
        <div className="price-name">{plan.name}</div>
        <div className="price-amount">
          {plan.amount} <span>/{plan.unit}</span>
        </div>
        <div className="price-desc">{plan.description}</div>
      </div>
      <ul className="price-features">
        {plan.features.map((feature, i) => (
          <li key={i}>{feature}</li>
        ))}
      </ul>
      <div className="price-cta">
        {plan.ctaLink ? (
          <Link to={plan.ctaLink}>{plan.ctaText || 'Book Now'}</Link>
        ) : (
          <Link to={siteConfig.bookingLink}>{plan.ctaText || 'Book Now'}</Link>
        )}
      </div>
    </div>
  );
}

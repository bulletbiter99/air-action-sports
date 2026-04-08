import { Link } from 'react-router-dom';

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
        <Link to={plan.ctaLink || '/booking'}>{plan.ctaText || 'Book Now'}</Link>
      </div>
    </div>
  );
}

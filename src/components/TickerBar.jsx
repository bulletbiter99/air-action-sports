import { Link } from 'react-router-dom';
import { siteConfig } from '../data/siteConfig';

export default function TickerBar() {
  return (
    <div className="ticker-bar">
      Next Mission: {siteConfig.nextEvent.name} &mdash; {siteConfig.nextEvent.location}, {siteConfig.nextEvent.shortDate}
      {' '}<Link to="/booking">Book Now &rarr;</Link>
    </div>
  );
}

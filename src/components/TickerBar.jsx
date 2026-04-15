import { siteConfig } from '../data/siteConfig';

export default function TickerBar() {
  return (
    <div className="ticker-bar">
      Next Mission: {siteConfig.nextEvent.name} &mdash; {siteConfig.nextEvent.location}, {siteConfig.nextEvent.shortDate}
      {' '}<a href={siteConfig.bookingLink} target="_blank" rel="noopener noreferrer">Book Now &rarr;</a>
    </div>
  );
}

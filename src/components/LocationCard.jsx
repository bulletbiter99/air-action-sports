export default function LocationCard({ location }) {
  const photoClass = location.id === 'trench-warfare'
    ? 'loc-photo-placeholder site2'
    : location.id === 'foxtrot-fields'
    ? 'loc-photo-placeholder site3'
    : 'loc-photo-placeholder';

  const isOpen = location.badge === 'open';

  return (
    <div className="loc-card">
      <div className="loc-photo">
        <div className={photoClass}></div>
        <div className="loc-photo-label">
          &#9632; Site {location.siteNumber} &mdash; {location.name}
        </div>
      </div>
      <div className="loc-body">
        <div className="loc-top">
          <div>
            <div className="loc-name">{location.name}</div>
            <div className="loc-address">{location.address}</div>
          </div>
          <span className={`loc-badge${isOpen ? ' open' : ''}`}>
            {isOpen ? 'Open' : 'Coming Soon'}
          </span>
        </div>
        <div className="loc-features">
          {location.features.map((feature, i) => (
            <div className="loc-feature" key={i}>{feature}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

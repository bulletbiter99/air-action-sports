import { Link } from 'react-router-dom';

export default function EventCard({ event }) {
  const slotsPercent = event.slots
    ? Math.round((event.slots.taken / event.slots.total) * 100)
    : 0;

  return (
    <div className="event-card">
      <div className="event-header">
        <div className="event-date">
          <div className="event-day">{event.date.day}</div>
          <div className="event-month">{event.date.month}</div>
        </div>
        <span className={`event-type ${event.type}`}>{event.type}</span>
      </div>
      <div className="event-body">
        <div className="event-title">{event.title}</div>
        <div className="event-loc">&#9679; {event.location}</div>
        <div className="event-meta">
          <div className="event-meta-item">
            <strong>Time</strong>{event.time}
          </div>
          <div className="event-meta-item">
            <strong>Slots</strong>{event.slots.total} Players
          </div>
          <div className="event-meta-item">
            <strong>From</strong>{event.price}
          </div>
        </div>
        {event.slots && (
          <>
            <div className="slots-bar">
              <div className="slots-fill" style={{ width: `${slotsPercent}%` }}></div>
            </div>
            <div className="slots-text">
              {event.slots.taken} of {event.slots.total} spots taken
            </div>
          </>
        )}
        <Link to="/booking" className="btn-book">&#9658; Book Slot</Link>
      </div>
    </div>
  );
}

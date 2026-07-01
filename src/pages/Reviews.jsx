import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import Stars from '../components/Stars';
import { useReviews } from '../hooks/useReviews';
import '../styles/pages/reviews.css';

export default function Reviews() {
  const { average, count, reviews, loading, error } = useReviews({ mode: 'all', limit: 50 });

  return (
    <div className="reviews-page">
      <SEO
        title="Player Reviews — Air Action Sports"
        description="Verified reviews from players at Air Action Sports airsoft events. Real ratings from attendees who booked and played."
        canonical="https://airactionsport.com/reviews"
      />

      <div className="reviews-inner">
        <div className="section-label fade-in">&#9632; In the Field</div>
        <h1 className="section-title">Player Reviews.</h1>
        <div className="divider"></div>
        <p className="section-sub" style={{ marginBottom: '2.5rem' }}>
          Every review here comes from a verified attendee &mdash; a player who booked, showed up, and rated their game.
        </p>

        {loading && (
          <p className="section-sub" style={{ textAlign: 'center', padding: '3rem 0' }}>Loading reviews…</p>
        )}

        {!loading && (error || count === 0) && (
          <div className="reviews-empty">
            <p className="section-sub">
              No player reviews yet &mdash; ours are on the way after our next event. Check back soon.
            </p>
            <p className="reviews-more">
              <Link to="/events" className="btn-primary">&#9658; See Upcoming Events</Link>
            </p>
          </div>
        )}

        {!loading && !error && count > 0 && (
          <>
            <div className="reviews-summary">
              <div className="reviews-avg-num">{average != null ? average.toFixed(1) : '—'}</div>
              <div className="reviews-avg-meta">
                <Stars rating={average} size={22} />
                <span className="reviews-avg-count">
                  {count} verified review{count === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            <div className="reviews-list">
              {reviews.map((r) => (
                <div className="review-item" key={r.id}>
                  <Stars rating={r.rating} size={16} />
                  {r.title && <p className="review-item-title">{r.title}</p>}
                  {r.comment && <p className="review-item-comment">{r.comment}</p>}
                  <div className="review-item-foot">
                    <span className="review-item-author">{r.authorName}</span>
                    {r.event?.slug && (
                      <Link to={`/events/${r.event.slug}`} className="review-item-event">
                        {r.event.title}
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SEO from '../components/SEO';
import Stars from '../components/Stars';
import '../styles/pages/review.css';

const MAX_TITLE = 120;
const MAX_COMMENT = 2000;
const MAX_AUTHOR = 60;

// Interactive 1-5 star picker. Keyboard + pointer accessible; hover previews.
function StarPicker({ value, onChange }) {
  const [hover, setHover] = useState(0);
  return (
    <div id="review-rating" className="review-stars" role="radiogroup" aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = (hover || value) >= n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            className={`review-star${on ? ' review-star--on' : ''}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            onClick={() => onChange(n)}
          >
            &#9733;
          </button>
        );
      })}
      <span className="review-star-value">{value ? `${value}/5` : ''}</span>
    </div>
  );
}

function scrollToRating() {
  const el = document.getElementById('review-rating');
  if (!el) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const reduce = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
}

export default function Review() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [company, setCompany] = useState(''); // honeypot — real users leave blank

  const [ratingError, setRatingError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [done, setDone] = useState(null); // { edited } after success

  useEffect(() => {
    if (!token) {
      setLoadError({ message: 'This review link is missing its token. Please open the link from your email.' });
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    fetch(`/api/reviews/context?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) {
          setLoadError({ message: body.error || 'This review link is not valid.' });
          setLoading(false);
          return;
        }
        setCtx(body);
        if (body.existingReview) {
          setRating(body.existingReview.rating || 0);
          setTitle(body.existingReview.title || '');
          setComment(body.existingReview.comment || '');
          setAuthorName(body.existingReview.authorName || body.suggestedAuthorName || '');
        } else {
          setAuthorName(body.suggestedAuthorName || '');
        }
        setLoading(false);
      })
      .catch(() => {
        if (alive) {
          setLoadError({ message: 'Could not load this review link. Please check your connection and try again.' });
          setLoading(false);
        }
      });
    return () => { alive = false; };
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    if (!rating) {
      setRatingError(true);
      scrollToRating();
      return;
    }
    setRatingError(false);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, rating, title, comment, authorName, company }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(body.error || 'Could not submit your review. Please try again.');
        setSubmitting(false);
        return;
      }
      setDone({ edited: !!body.edited });
      setSubmitting(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setSubmitError('Could not submit your review. Please try again.');
      setSubmitting(false);
    }
  }

  const eventTitle = ctx?.event?.title || 'your event';
  const readOnly = !!ctx && ctx.alreadyReviewed && !ctx.editable;

  return (
    <div className="review-page">
      <SEO
        title="Rate Your Game — Air Action Sports"
        description="Share how your Air Action Sports airsoft event went."
        canonical="https://airactionsport.com/review"
      >
        {/* Belt-and-suspenders alongside the X-Robots-Tag header (Batch 4). */}
        <meta name="robots" content="noindex, nofollow" />
      </SEO>

      <div className="review-shell">
        {loading && (
          <p className="section-sub" style={{ textAlign: 'center', padding: '4rem 0' }}>Loading…</p>
        )}

        {!loading && loadError && (
          <div className="review-status">
            <h1 className="review-heading">Review Link</h1>
            <div className="review-alert review-alert--error" style={{ textAlign: 'left' }}>
              {loadError.message}
            </div>
            <p className="section-sub" style={{ marginTop: '1.5rem' }}>
              <Link to="/reviews" className="btn-secondary">See player reviews</Link>
            </p>
          </div>
        )}

        {!loading && !loadError && done && (
          <div className="review-status">
            <div className="review-status-icon">&#9733;</div>
            <h1 className="review-heading">{done.edited ? 'Review Updated' : 'Thanks!'}</h1>
            <p className="section-sub">
              {done.edited
                ? `Your review of ${eventTitle} has been updated.`
                : `Thanks for rating ${eventTitle} — your review is now live and helps other players.`}
            </p>
            <p style={{ marginTop: '1.5rem' }}>
              <Link to="/reviews" className="btn-primary">Read all reviews</Link>
            </p>
          </div>
        )}

        {!loading && !loadError && !done && ctx && !ctx.eligible && (
          <div className="review-status">
            <h1 className="review-heading">Review</h1>
            <div className="review-alert review-alert--info" style={{ textAlign: 'left' }}>
              {ctx.reason || 'This booking is not eligible for a review.'}
            </div>
          </div>
        )}

        {!loading && !loadError && !done && ctx && ctx.eligible && readOnly && (
          <div className="review-status">
            <div className="review-status-icon">&#9733;</div>
            <h1 className="review-heading">Already Reviewed</h1>
            <p className="section-sub">You&rsquo;ve already reviewed {eventTitle}. Thanks for the feedback!</p>
            {ctx.existingReview && (
              <div className="review-existing">
                <Stars rating={ctx.existingReview.rating} size={18} />
                {ctx.existingReview.title && (
                  <p className="review-existing-title">{ctx.existingReview.title}</p>
                )}
                {ctx.existingReview.comment && (
                  <p className="review-existing-comment">{ctx.existingReview.comment}</p>
                )}
                <p className="review-existing-author">&mdash; {ctx.existingReview.authorName}</p>
              </div>
            )}
            <p style={{ marginTop: '1.5rem' }}>
              <Link to="/reviews" className="btn-secondary">Read all reviews</Link>
            </p>
          </div>
        )}

        {!loading && !loadError && !done && ctx && ctx.eligible && !readOnly && (
          <>
            <div className="review-eyebrow">&#9632; Rate Your Game</div>
            <h1 className="review-heading">How was it?</h1>
            <p className="review-event">
              {eventTitle}
              {ctx.event?.displayDate && <span> &middot; {ctx.event.displayDate}</span>}
            </p>

            <form className="review-card" onSubmit={handleSubmit} noValidate>
              {submitError && (
                <div className="review-alert review-alert--error" role="alert">{submitError}</div>
              )}
              {ctx.editable && ctx.alreadyReviewed && (
                <div className="review-alert review-alert--info">
                  You&rsquo;re editing your existing review. You can update it for a limited time.
                </div>
              )}

              <div className="review-field">
                <span className="review-label" id="review-rating-label">Your rating *</span>
                <StarPicker
                  value={rating}
                  onChange={(n) => { setRating(n); setRatingError(false); }}
                />
                {ratingError && (
                  <div className="review-field-error">Please pick a star rating.</div>
                )}
              </div>

              <div className="review-field">
                <label className="review-label" htmlFor="review-title">
                  Headline <span className="review-optional">(optional)</span>
                </label>
                <input
                  id="review-title"
                  name="title"
                  className="review-input"
                  type="text"
                  maxLength={MAX_TITLE}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Best day out this year"
                />
                <span className="review-char">{title.length}/{MAX_TITLE}</span>
              </div>

              <div className="review-field">
                <label className="review-label" htmlFor="review-comment">
                  Your review <span className="review-optional">(optional)</span>
                </label>
                <textarea
                  id="review-comment"
                  name="comment"
                  className="review-textarea"
                  maxLength={MAX_COMMENT}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="What did you think of the site, the marshals, the gameplay?"
                />
                <span className="review-char">{comment.length}/{MAX_COMMENT}</span>
              </div>

              <div className="review-field">
                <label className="review-label" htmlFor="review-author">
                  Display name <span className="review-optional">(shown publicly)</span>
                </label>
                <input
                  id="review-author"
                  name="authorName"
                  className="review-input"
                  type="text"
                  maxLength={MAX_AUTHOR}
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="Jane D."
                />
              </div>

              {/* Honeypot — hidden from users, tempting to bots. */}
              <div className="review-hp" aria-hidden="true">
                <label htmlFor="review-company">Company</label>
                <input
                  id="review-company"
                  name="company"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>

              <button type="submit" className="review-submit" disabled={submitting}>
                {submitting ? 'Submitting…' : ctx.alreadyReviewed ? 'Update review' : 'Submit review'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

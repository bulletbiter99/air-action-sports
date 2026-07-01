// Read-only star rating display (Batch 6). Renders 5 glyphs — filled = the
// rounded rating, the remainder dimmed — for the /reviews page, EventDetail's
// "Player Rating" row, and Home testimonials. The interactive star PICKER for
// submitting a review lives inline in src/pages/Review.jsx.
export default function Stars({ rating, size = 16, className = '' }) {
    const value = Number(rating) || 0;
    const filled = Math.max(0, Math.min(5, Math.round(value)));
    return (
        <span
            className={`stars ${className}`.trim()}
            role="img"
            aria-label={`${value || 0} out of 5 stars`}
            style={{ fontSize: size, letterSpacing: '2px', whiteSpace: 'nowrap', lineHeight: 1 }}
        >
            <span style={{ color: 'var(--orange)' }}>{'★'.repeat(filled)}</span>
            <span style={{ color: 'var(--olive-light)', opacity: 0.4 }}>{'★'.repeat(5 - filled)}</span>
        </span>
    );
}

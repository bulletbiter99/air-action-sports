import { useReviews } from './useReviews';

// Shared source for every "what players say" surface (Home, and the SocialProof
// strip on Locations + EventDetail).
//
// WHY THIS EXISTS: Home implemented a live-reviews swap inline while SocialProof
// read a hardcoded array of invented quotes, so the two surfaces disagreed about
// what the business's social proof was. With three real reviews live, Home showed
// them while /locations and every event page still showed fabricated ones —
// including a quote praising "Echo Urban", a site that has never existed.
//
// The fallback is deliberately GONE rather than shared. A curated fallback array
// is a fabrication with a delay fuse: it renders whenever real reviews dip below
// the threshold (one moderation hide is enough), silently replacing genuine
// social proof with invented social proof. An empty section is honest; an
// invented one is not. Callers render nothing when `items` is empty.
//
// Reviews carry an aggregateRating into crawler-visible JSON-LD, so fabricated
// quotes here are not merely bad copy — they sit alongside structured data that
// search engines treat as a factual claim about the business.

// A testimonial wall of one or two reads as thin rather than persuasive, so the
// surfaces stay silent until there are enough real quotes to be worth showing.
export const MIN_LIVE_TESTIMONIALS = 3;

// Public display name ("Jane D.") → avatar initials ("JD").
export function avatarInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '★';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Returns { items, loading, average, count }.
//
// `items` is a normalized, render-ready shape so each surface can style it
// without re-deriving the rules:
//   { key, rating, text, name, role, initials }
//
// It is EMPTY unless at least MIN_LIVE_TESTIMONIALS published reviews carry an
// actual comment — a 5-star rating with no words is a fine aggregate signal but
// not a testimonial.
export function useTestimonials({ limit = 3, recent = 6 } = {}) {
    const { reviews, average, count, loading } = useReviews({ mode: 'summary', recent });

    const withComments = (reviews || []).filter((r) => r.comment && r.comment.trim());
    const items = withComments.length >= MIN_LIVE_TESTIMONIALS
        ? withComments.slice(0, limit).map((r) => ({
            key: r.id,
            rating: r.rating,
            text: r.comment,
            name: r.authorName,
            // The event they actually attended is stronger provenance than a
            // self-described role, and unlike a role it cannot be invented.
            role: r.event?.title || 'Verified player',
            initials: avatarInitials(r.authorName),
        }))
        : [];

    return { items, loading, average, count };
}

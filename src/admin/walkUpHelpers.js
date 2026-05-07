// M4 B6 — pure helpers for the walk-up booking speed wins.
//
// Used by AdminNewBooking.jsx after the CustomerTypeahead selects a
// customer: pickRecallableBookings filters the customer's booking
// history to the most recent N paid/comp bookings (the ones BC staff
// actually want to "recall"); formatBookingHint returns a single
// human-readable line summarizing the most recent one.

/**
 * Filters and sorts a customer's bookings to the most recent N that
 * count as "recallable" — paid or comp status, with a created_at or
 * paid_at timestamp. Most recent first.
 *
 * @param {Array} bookings - From /api/admin/customers/:id response.
 * @param {number} max - Maximum count to return (default 3).
 * @returns {Array} Filtered + sorted subset; empty array if no input.
 */
export function pickRecallableBookings(bookings, max = 3) {
    if (!Array.isArray(bookings)) return [];
    const recallable = bookings.filter((b) => {
        if (!b || typeof b !== 'object') return false;
        if (b.status !== 'paid' && b.status !== 'comp') return false;
        const ts = b.paidAt || b.createdAt || b.paid_at || b.created_at;
        return Number.isFinite(Number(ts));
    });
    recallable.sort((a, b) => {
        const ta = Number(a.paidAt || a.createdAt || a.paid_at || a.created_at) || 0;
        const tb = Number(b.paidAt || b.createdAt || b.paid_at || b.created_at) || 0;
        return tb - ta;
    });
    return recallable.slice(0, Math.max(0, max));
}

/**
 * Formats a single booking into a one-line "recall hint" for the
 * recall UI on AdminNewBooking. Returns the event title plus a
 * human-readable relative timestamp ("Spring Showdown · 2 weeks ago").
 *
 * @param {Object} booking - A single booking row.
 * @param {Date} [now] - Reference now (testable; defaults to new Date()).
 * @returns {string} The hint string, or empty string when input is invalid.
 */
export function formatBookingHint(booking, now = new Date()) {
    if (!booking || typeof booking !== 'object') return '';
    const title = booking.eventTitle || booking.event_title || 'previous event';
    const ts = Number(
        booking.paidAt || booking.createdAt || booking.paid_at || booking.created_at,
    );
    if (!Number.isFinite(ts) || ts <= 0) return title;
    return `${title} · ${formatRelativeAge(ts, now)}`;
}

/**
 * Formats a millisecond timestamp into a relative age string suitable
 * for the recall hint. Goes from "just now" → "X minutes ago" → hours
 * → days → weeks → months → years. Exported for direct testing.
 *
 * @param {number} ts - Unix-millis timestamp.
 * @param {Date} [now] - Reference now (testable).
 * @returns {string}
 */
export function formatRelativeAge(ts, now = new Date()) {
    const t = Number(ts);
    if (!Number.isFinite(t) || t <= 0) return 'unknown';
    const diff = (now instanceof Date ? now.getTime() : Date.now()) - t;
    if (diff < 0) return 'just now';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
    const week = Math.floor(day / 7);
    if (week < 5) return `${week} week${week === 1 ? '' : 's'} ago`;
    const month = Math.floor(day / 30);
    if (month < 12) return `${month} month${month === 1 ? '' : 's'} ago`;
    const year = Math.floor(day / 365);
    return `${year} year${year === 1 ? '' : 's'} ago`;
}

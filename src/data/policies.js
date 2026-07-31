// Single source of truth for customer-facing policy copy.
//
// WHY THIS FILE EXISTS: until 2026-07-31 the cancellation policy was stated in
// two places that disagreed with each other in production. src/data/faq.js
// promised "Cancellations made with less than 48 hours notice will receive 50%
// credit", while src/pages/Booking.jsx stated only the 48h+ full-credit rule
// and stopped — implying nothing was recoverable. Both shipped. One of them was
// necessarily wrong, and the FAQ was the wrong one: the operator confirmed
// there is NO credit inside 48 hours, so the site was advertising a 50% credit
// the business does not honor.
//
// Verified against the email_templates table: no customer email states the
// cancellation policy, so these constants are the ENTIRE surface. Keep it that
// way — import from here instead of retyping the sentence, so the next edit
// cannot reintroduce the drift.

export const CANCELLATION_WINDOW_HOURS = 48;

export const cancellationPolicy = {
    // One-line version for the point of payment, where the customer is deciding.
    // States both halves deliberately: a customer who only reads the good half
    // and is later refused is the exact complaint this copy exists to prevent.
    short: `Cancel ${CANCELLATION_WINDOW_HOURS}h+ before game day for full event credit. Inside ${CANCELLATION_WINDOW_HOURS} hours, bookings are non-refundable.`,

    // FAQ: "How do I cancel or reschedule?"
    faqCancel: `Contact us at least ${CANCELLATION_WINDOW_HOURS} hours before your event and we'll issue full credit towards a future booking. Inside ${CANCELLATION_WINDOW_HOURS} hours we can't offer credit — the slot is already committed — so please let us know as early as you can.`,

    // FAQ: "Do you offer refunds?"
    faqRefund: `We don't offer cash refunds. Cancel with ${CANCELLATION_WINDOW_HOURS} or more hours notice and you'll get full event credit, usable on any future event. Inside ${CANCELLATION_WINDOW_HOURS} hours the booking is non-refundable.`,
};

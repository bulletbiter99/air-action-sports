// Test fixtures + D1 mock bindings for handleCheckoutCompleted scenarios.
//
// The webhook handler in worker/routes/webhooks.js issues these queries:
//   1. SELECT * FROM bookings WHERE stripe_session_id = ?         → booking
//   2. (per attendee) SELECT id FROM waivers WHERE …              → null or {id}
//   3. (per attendee) INSERT INTO attendees …                     → run
//   4. (per linked attendee) INSERT INTO audit_log 'waiver.auto_linked' → run
//   5. (per ticket type in line items) UPDATE ticket_types SET sold = sold+? → run
//   6. (if promo_code_id) UPDATE promo_codes SET uses_count = uses_count+1 → run
//   7. INSERT INTO audit_log 'booking.paid'                       → run
//   8. SELECT * FROM events WHERE id = ?                          → event
//   9. SELECT * FROM attendees WHERE booking_id = ?               → attendees
//
// After the response, ctx.waitUntil(sendBookingEmails) runs which calls
// loadTemplate(db, slug) repeatedly for booking_confirmation /
// admin_notify / waiver_request:
//   10. SELECT * FROM email_templates WHERE slug = ?              → template
//
// bindWebhookFixture registers handlers 1, 2, 8, 9 by default. Pass
// `withEmailTemplates: true` to also register handler 10 with a generic
// stub. Pass `waiverMatch: 'wv_xxx'` to make handler 2 return a hit
// (auto-link path). Other handlers (3, 4, 5, 6, 7) hit the mock D1's
// default `run` response — `{ meta: { changes: 0, last_row_id: null }, success: true }`.

export function createWebhookFixture(overrides = {}) {
    const sessionId = overrides.sessionId || 'cs_test_123';
    const bookingId = overrides.bookingId || 'bk_test_xyz';
    const eventId = overrides.eventId || 'ev_test';
    const ticketTypeId = overrides.ticketTypeId || 'tt_std';
    const paymentIntent = overrides.paymentIntent || 'pi_test_abc';

    const pendingAttendees = overrides.pendingAttendees ?? [
        {
            firstName: 'Alice',
            lastName: 'Smith',
            email: 'alice@example.com',
            phone: '5551234567',
            ticketTypeId,
            customAnswers: null,
        },
    ];

    const lineItems = overrides.lineItems ?? [
        {
            type: 'ticket',
            ticket_type_id: ticketTypeId,
            name: 'Standard',
            qty: pendingAttendees.length,
            unit_price_cents: 8000,
            line_total_cents: 8000 * pendingAttendees.length,
        },
    ];

    const booking = {
        id: bookingId,
        event_id: eventId,
        status: overrides.bookingStatus ?? 'pending',
        stripe_session_id: sessionId,
        stripe_payment_intent: null,
        full_name: 'Alice Smith',
        email: 'alice@example.com',
        phone: '5551234567',
        player_count: pendingAttendees.length,
        line_items_json: JSON.stringify(lineItems),
        pending_attendees_json: JSON.stringify(pendingAttendees),
        subtotal_cents: lineItems.reduce((s, l) => s + (l.line_total_cents || 0), 0),
        discount_cents: 0,
        tax_cents: 0,
        fee_cents: 0,
        total_cents: lineItems.reduce((s, l) => s + (l.line_total_cents || 0), 0),
        promo_code_id: overrides.promoCodeId ?? null,
        notes: null,
        created_at: Date.now(),
        paid_at: null,
        ...(overrides.bookingFields || {}),
    };

    const event = {
        id: eventId,
        title: 'Operation Nightfall',
        date_iso: '2026-05-09T08:00:00-06:00',
        display_date: 'May 9, 2026',
        location: 'Ghost Town',
        check_in: '6:30 AM',
        first_game: '8:00 AM',
        published: 1,
        ...(overrides.eventFields || {}),
    };

    const stripeEvent = {
        id: 'evt_test_123',
        type: overrides.eventType ?? 'checkout.session.completed',
        data: {
            object: {
                id: sessionId,
                payment_intent: paymentIntent,
                amount_total: booking.total_cents,
                ...(overrides.sessionFields || {}),
            },
        },
    };

    return {
        sessionId, bookingId, eventId, ticketTypeId, paymentIntent,
        pendingAttendees, lineItems, booking, event, stripeEvent,
    };
}

export function bindWebhookFixture(db, fixture, opts = {}) {
    const { booking, event } = fixture;

    // (1) Booking lookup by session_id
    db.__on(/SELECT \* FROM bookings WHERE stripe_session_id/, booking, 'first');

    // (2) findExistingValidWaiver — defaults to no match (returns null,
    //     handler treats null .id as no match)
    db.__on(
        /SELECT id FROM waivers/,
        opts.waiverMatch ? { id: opts.waiverMatch } : null,
        'first',
    );

    // (8) Event lookup at end of handler (for emailContext)
    db.__on(/SELECT \* FROM events WHERE id/, event, 'first');

    // (9) Attendees post-insert (used by sendBookingEmails for waiver_summary)
    db.__on(
        /SELECT \* FROM attendees WHERE booking_id/,
        { results: opts.attendeesAfter ?? [] },
        'all',
    );

    // (10) Optional: email templates (only when test exercises email pipeline)
    if (opts.withEmailTemplates) {
        db.__on(
            /SELECT \* FROM email_templates WHERE slug/,
            (sql, args) => ({
                id: `tpl_${args[0]}`,
                slug: args[0],
                subject: `Test ${args[0]} {{event_name}}`,
                body_html: '<p>{{player_name}}</p>',
                body_text: '{{player_name}}',
                variables_json: '["player_name","event_name","event_date","event_location","check_in","first_game","waiver_link","booking_id"]',
            }),
            'first',
        );
    }
}

// Capture ctx.waitUntil promises so tests can await them before assertions.
export function createCapturedCtx() {
    const captured = [];
    return {
        ctx: {
            waitUntil: (p) => { captured.push(p); },
            passThroughOnException: () => {},
        },
        captured,
        flush: () => Promise.allSettled(captured),
    };
}

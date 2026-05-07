// Reusable fixture for /api/admin/bookings/manual + /:id/refund tests.
//
// Shapes the SELECTs the admin handler issues:
//   - SELECT * FROM events WHERE id = ?                               → event row
//   - SELECT id, name, price_cents, capacity, sold FROM ticket_types
//     WHERE event_id = ? AND active = 1                                → ticket_types[]
//   - SELECT * FROM taxes_fees WHERE active = 1 ORDER BY ...           → taxes_fees[]
//   - findExistingValidWaiver: SELECT id FROM waivers WHERE ...        → null or { id }
//   - SELECT * FROM bookings WHERE id = ?                              → booking (refund path)
//
// Default values mirror the seeded production config:
//   - 1 ticket type at $80 (8000 cents), capacity 100
//   - 0 add-ons
//   - 3 taxes/fees: City Tax 1% / State Tax 2% / Processing Fees 2.9% + 30¢

export function createAdminBookingFixture(overrides = {}) {
    const eventId = overrides.eventId || 'ev_test';
    const ticketTypes = overrides.ticketTypes || [
        {
            id: 'tt_std',
            name: 'Standard Ticket',
            price_cents: 8000,
            capacity: 100,
            sold: 0,
            active: 1,
            event_id: eventId,
        },
    ];
    const addons = overrides.addons || [];
    const taxesFees = overrides.taxesFees || [
        {
            id: 1,
            name: 'City Tax',
            category: 'tax',
            percent_bps: 100,
            fixed_cents: 0,
            applies_to: 'all',
            per_unit: 'order',
            sort_order: 1,
            active: 1,
        },
        {
            id: 2,
            name: 'State Tax',
            category: 'tax',
            percent_bps: 200,
            fixed_cents: 0,
            applies_to: 'all',
            per_unit: 'order',
            sort_order: 2,
            active: 1,
        },
        {
            id: 3,
            name: 'Processing Fees',
            category: 'fee',
            percent_bps: 290,
            fixed_cents: 30,
            applies_to: 'all',
            per_unit: 'order',
            sort_order: 3,
            active: 1,
        },
    ];

    const event = {
        id: eventId,
        title: 'Operation Nightfall',
        date_iso: '2026-05-09T08:00:00-06:00',
        location: 'Ghost Town',
        published: 1,
        addons_json: JSON.stringify(addons),
        ...(overrides.eventFields || {}),
    };

    return { eventId, ticketTypes, addons, taxesFees, event };
}

export function bindAdminBookingFixture(env, fixture, opts = {}) {
    const { event, ticketTypes, taxesFees } = fixture;

    env.DB.__on(/SELECT \* FROM events WHERE id = \?/, event, 'first');
    env.DB.__on(
        /FROM ticket_types WHERE event_id = \? AND active = 1/,
        { results: ticketTypes },
        'all',
    );
    env.DB.__on(/FROM taxes_fees/, { results: taxesFees }, 'all');

    // findExistingValidWaiver — defaults to no match (returns null)
    env.DB.__on(
        /SELECT id FROM waivers/,
        opts.waiverMatch ? { id: opts.waiverMatch } : null,
        'first',
    );
}

// Build a baseline POST /manual body. Override any field via opts.
export function buildManualBody(opts = {}) {
    return {
        eventId: opts.eventId || 'ev_test',
        paymentMethod: opts.paymentMethod || 'cash',
        buyer: opts.buyer || {
            fullName: 'Alice Smith',
            email: 'alice@example.com',
            phone: '5551234567',
        },
        attendees: opts.attendees || [
            {
                firstName: 'Alice',
                lastName: 'Smith',
                email: 'alice@example.com',
                ticketTypeId: opts.ticketTypeId || 'tt_std',
            },
        ],
        addonSelections: opts.addonSelections || [],
        notes: opts.notes,
    };
}

// Bind a paid booking row for refund-path tests.
export function bindBookingRow(env, opts = {}) {
    const booking = {
        id: opts.id || 'bk_test',
        event_id: opts.eventId || 'ev_test',
        status: opts.status || 'paid',
        stripe_payment_intent: opts.stripePaymentIntent || 'pi_test_123',
        total_cents: opts.totalCents ?? 8000,
        line_items_json: opts.lineItemsJson || JSON.stringify([
            { type: 'ticket', ticket_type_id: 'tt_std', qty: 1 },
        ]),
        ...(opts.extraFields || {}),
    };
    env.DB.__on(/SELECT \* FROM bookings WHERE id = \?/, booking, 'first');
    return booking;
}

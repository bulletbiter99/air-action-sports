import { Hono } from 'hono';
import { formatEvent, formatTicketType } from '../lib/formatters.js';

const events = new Hono();

events.get('/', async (c) => {
    const url = new URL(c.req.url);
    const includePast = url.searchParams.get('include_past') === '1';
    const pastClause = includePast ? '' : 'AND past = 0';

    // Sort: featured first (so admin-picked headliner wins ties), then by date.
    // For upcoming-only: nearest date wins among same featured-rank.
    // When include_past is on: featured first within each rank, latest first by date.
    const eventsResult = await c.env.DB.prepare(
        `SELECT * FROM events
         WHERE published = 1 ${pastClause}
         ORDER BY featured DESC, date_iso ${includePast ? 'DESC' : 'ASC'}`
    ).all();

    const eventRows = eventsResult.results || [];
    if (eventRows.length === 0) return c.json({ events: [] });

    const placeholders = eventRows.map(() => '?').join(',');
    const ids = eventRows.map((e) => e.id);
    const [ticketTypesResult, seatsResult] = await Promise.all([
        c.env.DB.prepare(
            `SELECT * FROM ticket_types
             WHERE event_id IN (${placeholders}) AND active = 1
             ORDER BY event_id, sort_order ASC`
        ).bind(...ids).all(),
        c.env.DB.prepare(
            `SELECT event_id, COALESCE(SUM(player_count), 0) AS seats_sold
             FROM bookings WHERE event_id IN (${placeholders}) AND status IN ('paid', 'comp')
             GROUP BY event_id`
        ).bind(...ids).all(),
    ]);

    const typesByEvent = {};
    for (const tt of (ticketTypesResult.results || [])) {
        (typesByEvent[tt.event_id] ||= []).push(formatTicketType(tt));
    }
    const seatsByEvent = {};
    for (const s of (seatsResult.results || [])) seatsByEvent[s.event_id] = s.seats_sold;

    return c.json({
        events: eventRows.map((row) => ({
            ...formatEvent(row),
            ticketTypes: typesByEvent[row.id] || [],
            seatsSold: seatsByEvent[row.id] || 0,
        })),
    });
});

events.get('/:id', async (c) => {
    const idOrSlug = c.req.param('id');
    // Match on either id or slug so URLs can switch between the two.
    const eventRow = await c.env.DB.prepare(
        `SELECT * FROM events WHERE (id = ? OR slug = ?) AND published = 1 LIMIT 1`
    ).bind(idOrSlug, idOrSlug).first();
    if (!eventRow) return c.json({ error: 'Event not found' }, 404);

    const [ticketTypesResult, seatsRow] = await Promise.all([
        c.env.DB.prepare(
            `SELECT * FROM ticket_types
             WHERE event_id = ? AND active = 1
             ORDER BY sort_order ASC`
        ).bind(eventRow.id).all(),
        c.env.DB.prepare(
            `SELECT COALESCE(SUM(player_count), 0) AS seats_sold
             FROM bookings WHERE event_id = ? AND status IN ('paid', 'comp')`
        ).bind(eventRow.id).first(),
    ]);

    return c.json({
        event: {
            ...formatEvent(eventRow),
            ticketTypes: (ticketTypesResult.results || []).map(formatTicketType),
            seatsSold: seatsRow?.seats_sold || 0,
        },
    });
});

events.get('/:id/ticket-types', async (c) => {
    const result = await c.env.DB.prepare(
        `SELECT * FROM ticket_types
         WHERE event_id = ? AND active = 1
         ORDER BY sort_order ASC`
    ).bind(c.req.param('id')).all();
    return c.json({ ticketTypes: (result.results || []).map(formatTicketType) });
});

export default events;

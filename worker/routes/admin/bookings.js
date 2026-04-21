import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { formatBooking, formatEvent, safeJson } from '../../lib/formatters.js';
import { issueRefund } from '../../lib/stripe.js';
import { bookingId, attendeeId, qrToken } from '../../lib/ids.js';
import { sendBookingConfirmation } from '../../lib/emailSender.js';

const adminBookings = new Hono();

adminBookings.use('*', requireAuth);

adminBookings.get('/', async (c) => {
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const eventId = params.get('event_id');
    const status = params.get('status');
    const q = params.get('q');
    const from = params.get('from');
    const to = params.get('to');
    const limit = Math.min(Number(params.get('limit') || 50), 200);
    const offset = Math.max(0, Number(params.get('offset') || 0));

    const where = [];
    const binds = [];
    if (eventId) { where.push('event_id = ?'); binds.push(eventId); }
    if (status)  { where.push('status = ?');   binds.push(status); }
    if (q)       { where.push('(LOWER(full_name) LIKE ? OR LOWER(email) LIKE ?)'); binds.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`); }
    if (from)    { where.push('created_at >= ?'); binds.push(Number(from)); }
    if (to)      { where.push('created_at <= ?'); binds.push(Number(to)); }
    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM bookings ${whereSQL}`
    ).bind(...binds).first();

    const rows = await c.env.DB.prepare(
        `SELECT * FROM bookings ${whereSQL} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all();

    return c.json({
        total: countRow?.n ?? 0,
        limit,
        offset,
        bookings: (rows.results || []).map((b) => formatBooking(b, { includeInternal: true })),
    });
});

adminBookings.get('/:id', async (c) => {
    const row = await c.env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`)
        .bind(c.req.param('id')).first();
    if (!row) return c.json({ error: 'Not found' }, 404);

    const eventRow = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`)
        .bind(row.event_id).first();
    const attendeesResult = await c.env.DB.prepare(
        `SELECT a.*, w.signed_at FROM attendees a
         LEFT JOIN waivers w ON w.id = a.waiver_id
         WHERE a.booking_id = ? ORDER BY a.created_at ASC`
    ).bind(row.id).all();

    return c.json({
        booking: formatBooking(row, { includeInternal: true }),
        event: eventRow ? formatEvent(eventRow) : null,
        attendees: (attendeesResult.results || []).map((a) => ({
            id: a.id,
            firstName: a.first_name,
            lastName: a.last_name,
            email: a.email,
            phone: a.phone,
            qrToken: a.qr_token,
            waiverSigned: !!a.waiver_id,
            signedAt: a.signed_at,
            checkedIn: !!a.checked_in_at,
            customAnswers: a.custom_answers_json ? JSON.parse(a.custom_answers_json) : {},
        })),
    });
});

// POST /api/admin/bookings/manual
// Creates a booking entered by staff (walk-in, comp, or cash-paid).
// paymentMethod: 'comp' | 'cash'
//   comp → status=comp, totals=0 (free for staff, contest winners, etc.)
//   cash → status=paid, totals=actual prices, stripe_payment_intent=null (cash collected at venue)
adminBookings.post('/manual', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body?.eventId) return c.json({ error: 'eventId required' }, 400);

    const paymentMethod = body.paymentMethod || 'comp';
    if (!['comp', 'cash'].includes(paymentMethod)) {
        return c.json({ error: 'paymentMethod must be "comp" or "cash"' }, 400);
    }

    const buyer = body.buyer || {};
    if (!buyer.fullName?.trim() || !buyer.email?.trim()) {
        return c.json({ error: 'Buyer name and email required' }, 400);
    }
    const attendees = Array.isArray(body.attendees) ? body.attendees : [];
    if (attendees.length === 0) return c.json({ error: 'At least one attendee required' }, 400);

    const eventRow = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(body.eventId).first();
    if (!eventRow) return c.json({ error: 'Event not found' }, 404);
    const typesResult = await c.env.DB.prepare(
        `SELECT id, name, price_cents FROM ticket_types WHERE event_id = ? AND active = 1`
    ).bind(body.eventId).all();
    const typesById = new Map((typesResult.results || []).map((t) => [t.id, t]));
    const addons = safeJson(eventRow.addons_json, []);
    const addonsBySku = new Map(addons.map((a) => [a.sku, a]));

    // Group tickets by type
    const perTypeQty = new Map();
    for (const a of attendees) {
        if (!a.firstName?.trim() || !a.ticketTypeId || !typesById.has(a.ticketTypeId)) {
            return c.json({ error: 'Each attendee needs firstName and valid ticketTypeId' }, 400);
        }
        perTypeQty.set(a.ticketTypeId, (perTypeQty.get(a.ticketTypeId) || 0) + 1);
    }

    const lineItems = [];
    let subtotal = 0;
    for (const [ttId, qty] of perTypeQty.entries()) {
        const tt = typesById.get(ttId);
        const unit = paymentMethod === 'comp' ? 0 : tt.price_cents;
        const lineTotal = unit * qty;
        subtotal += lineTotal;
        lineItems.push({
            type: 'ticket',
            ticket_type_id: ttId,
            name: paymentMethod === 'comp' ? `${tt.name} (comp)` : tt.name,
            qty,
            unit_price_cents: unit,
            line_total_cents: lineTotal,
        });
    }

    // Optional add-ons (rentals, BBs, camping)
    const addonSelections = Array.isArray(body.addonSelections) ? body.addonSelections : [];
    for (const sel of addonSelections) {
        if (!sel.qty || sel.qty <= 0) continue;
        const addon = addonsBySku.get(sel.sku);
        if (!addon) return c.json({ error: `Unknown add-on: ${sel.sku}` }, 400);
        const unit = paymentMethod === 'comp' ? 0 : addon.price_cents;
        const lineTotal = unit * sel.qty;
        subtotal += lineTotal;
        lineItems.push({
            type: 'addon',
            sku: addon.sku,
            name: addon.name,
            addon_type: addon.type || 'consumable',
            qty: sel.qty,
            unit_price_cents: unit,
            line_total_cents: lineTotal,
        });
    }

    const tax = paymentMethod === 'comp' ? 0 : Math.floor((subtotal * (eventRow.tax_rate_bps || 0)) / 10000);
    const total = subtotal + tax;

    const id = bookingId();
    const now = Date.now();
    const status = paymentMethod === 'comp' ? 'comp' : 'paid';
    const paidAt = now;
    const stripePi = paymentMethod === 'cash' ? `cash_${id}` : null;

    const methodTag = paymentMethod === 'cash' ? '[CASH]' : '[COMP]';
    const combinedNotes = [methodTag, body.notes?.trim()].filter(Boolean).join(' ');

    await c.env.DB.prepare(
        `INSERT INTO bookings (
            id, event_id, full_name, email, phone, player_count,
            line_items_json, subtotal_cents, discount_cents, tax_cents, fee_cents, total_cents,
            status, notes, stripe_payment_intent, created_at, paid_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?)`
    ).bind(
        id, body.eventId, buyer.fullName.trim(), buyer.email.trim(), buyer.phone?.trim() || '',
        attendees.length,
        JSON.stringify(lineItems), subtotal, tax, total,
        status, combinedNotes || null, stripePi,
        now, paidAt,
    ).run();

    for (const a of attendees) {
        await c.env.DB.prepare(
            `INSERT INTO attendees (
                id, booking_id, ticket_type_id, first_name, last_name, email, phone,
                qr_token, created_at, custom_answers_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            attendeeId(), id, a.ticketTypeId,
            a.firstName.trim(), a.lastName?.trim() || null,
            a.email?.trim() || null, a.phone?.trim() || null,
            qrToken(), now,
            a.customAnswers && Object.keys(a.customAnswers).length ? JSON.stringify(a.customAnswers) : null,
        ).run();
    }

    for (const [ttId, qty] of perTypeQty.entries()) {
        await c.env.DB.prepare(
            `UPDATE ticket_types SET sold = sold + ?, updated_at = ? WHERE id = ?`
        ).bind(qty, now, ttId).run();
    }

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, ?, 'booking', ?, ?, ?)`
    ).bind(
        user.id,
        paymentMethod === 'cash' ? 'booking.manual_cash' : 'booking.manual_comp',
        id,
        JSON.stringify({ event_id: body.eventId, attendees: attendees.length, total_cents: total, payment_method: paymentMethod }),
        now,
    ).run();

    return c.json({ bookingId: id, totalCents: total, status });
});

// POST /api/admin/bookings/:id/refund — refund a paid booking via Stripe
// Manager or owner.
adminBookings.post('/:id/refund', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const reason = body?.reason || 'requested_by_customer';

    const booking = await c.env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(id).first();
    if (!booking) return c.json({ error: 'Booking not found' }, 404);
    if (booking.status !== 'paid') return c.json({ error: `Cannot refund booking with status: ${booking.status}` }, 409);
    if (!booking.stripe_payment_intent) return c.json({ error: 'No payment intent on booking' }, 400);

    let refund;
    try {
        refund = await issueRefund({
            apiKey: c.env.STRIPE_SECRET_KEY,
            paymentIntent: booking.stripe_payment_intent,
            reason,
        });
    } catch (err) {
        console.error('Refund failed:', err.message);
        return c.json({ error: `Stripe refund failed: ${err.message}` }, 502);
    }

    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE bookings SET status = 'refunded', refunded_at = ? WHERE id = ?`
    ).bind(now, id).run();

    // Decrement sold counts on ticket types (release inventory)
    const lineItems = safeJson(booking.line_items_json, []);
    for (const item of lineItems) {
        if (item.type === 'ticket') {
            await c.env.DB.prepare(
                `UPDATE ticket_types SET sold = MAX(0, sold - ?), updated_at = ? WHERE id = ?`
            ).bind(item.qty, now, item.ticket_type_id).run();
        }
    }

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'booking.refunded', 'booking', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ stripe_refund_id: refund?.id, reason, amount_cents: booking.total_cents }), now).run();

    return c.json({ refund: { id: refund?.id, amountCents: booking.total_cents, status: refund?.status } });
});

// POST /api/admin/bookings/:id/resend-confirmation — re-email the confirmation
// Useful when a customer says "I never got my booking email". Idempotent.
adminBookings.post('/:id/resend-confirmation', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const booking = await c.env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(id).first();
    if (!booking) return c.json({ error: 'Booking not found' }, 404);
    if (!['paid', 'comp'].includes(booking.status)) {
        return c.json({ error: `Cannot resend for booking with status: ${booking.status}` }, 409);
    }
    const event = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(booking.event_id).first();
    if (!event) return c.json({ error: 'Event not found' }, 404);

    try {
        const result = await sendBookingConfirmation(c.env, { booking, event });
        if (result?.skipped) return c.json({ error: `Not sent: ${result.skipped}` }, 500);
    } catch (err) {
        console.error('resend-confirmation failed', err);
        return c.json({ error: 'Email send failed' }, 502);
    }

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'booking.confirmation_resent', 'booking', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ to: booking.email }), Date.now()).run();

    return c.json({ success: true, sentTo: booking.email });
});

adminBookings.get('/stats/summary', async (c) => {
    const stats = await c.env.DB.prepare(
        `SELECT status, COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS gross_cents
         FROM bookings GROUP BY status`
    ).all();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const today = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS gross_cents
         FROM bookings WHERE status = 'paid' AND paid_at >= ?`
    ).bind(todayStart.getTime()).first();
    return c.json({
        byStatus: (stats.results || []),
        today: { count: today?.n ?? 0, grossCents: today?.gross_cents ?? 0 },
    });
});

export default adminBookings;

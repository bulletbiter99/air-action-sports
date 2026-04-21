import { Hono } from 'hono';
import { formatEvent, formatTicketType, formatBooking, safeJson } from '../lib/formatters.js';
import { calculateQuote, centsToDollars, loadActiveTaxesFees } from '../lib/pricing.js';
import { bookingId } from '../lib/ids.js';
import { createCheckoutSession } from '../lib/stripe.js';
import { rateLimit } from '../lib/rateLimit.js';

const bookings = new Hono();

const PENDING_HOLD_MS = 30 * 60 * 1000; // 30 minutes

async function loadEventAndTypes(db, eventId) {
    const [eventRow, typesResult] = await Promise.all([
        db.prepare(`SELECT * FROM events WHERE id = ? AND published = 1`).bind(eventId).first(),
        db.prepare(
            `SELECT * FROM ticket_types WHERE event_id = ? AND active = 1 ORDER BY sort_order ASC`
        ).bind(eventId).all(),
    ]);
    if (!eventRow) return null;
    return {
        event: formatEvent(eventRow),
        ticketTypes: (typesResult.results || []).map(formatTicketType),
    };
}

async function checkTicketInventory(db, eventId, ticketSelections) {
    // Count paid + recent-pending bookings' ticket counts per ticket type.
    const holdCutoff = Date.now() - PENDING_HOLD_MS;
    const counts = await db.prepare(
        `SELECT line_items_json FROM bookings
         WHERE event_id = ?
           AND (status = 'paid' OR (status = 'pending' AND created_at > ?))`
    ).bind(eventId, holdCutoff).all();

    const reserved = new Map();
    for (const row of (counts.results || [])) {
        const items = safeJson(row.line_items_json, []);
        for (const item of items) {
            if (item.type === 'ticket') {
                reserved.set(item.ticket_type_id, (reserved.get(item.ticket_type_id) || 0) + item.qty);
            }
        }
    }

    const typesResult = await db.prepare(
        `SELECT id, name, capacity FROM ticket_types WHERE event_id = ?`
    ).bind(eventId).all();
    const capacityById = new Map((typesResult.results || []).map((t) => [t.id, t]));

    const errors = [];
    for (const sel of ticketSelections) {
        const tt = capacityById.get(sel.ticketTypeId);
        if (!tt || tt.capacity == null) continue;
        const already = reserved.get(sel.ticketTypeId) || 0;
        if (already + sel.qty > tt.capacity) {
            const remaining = Math.max(0, tt.capacity - already);
            errors.push(`${tt.name}: only ${remaining} remaining`);
        }
    }
    return errors;
}

async function resolvePromoCode(db, code, eventId, subtotalCents) {
    if (!code) return null;
    const row = await db.prepare(
        `SELECT * FROM promo_codes
         WHERE code = ? AND active = 1
           AND (event_id IS NULL OR event_id = ?)`
    ).bind(code.trim().toUpperCase(), eventId).first();
    if (!row) return { error: 'Invalid promo code' };
    const now = Date.now();
    if (row.starts_at && now < row.starts_at) return { error: 'Promo code not yet active' };
    if (row.expires_at && now > row.expires_at) return { error: 'Promo code expired' };
    if (row.max_uses != null && row.uses_count >= row.max_uses) return { error: 'Promo code used up' };
    if (row.min_order_cents && subtotalCents < row.min_order_cents) {
        return { error: `Promo code requires order ≥ $${centsToDollars(row.min_order_cents)}` };
    }
    return {
        id: row.id,
        discountType: row.discount_type,
        discountValue: row.discount_value,
    };
}

// POST /api/bookings/quote — preview total without committing
bookings.post('/quote', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.eventId) return c.json({ error: 'eventId required' }, 400);

    const ctx = await loadEventAndTypes(c.env.DB, body.eventId);
    if (!ctx) return c.json({ error: 'Event not found' }, 404);

    const ticketSelections = Array.isArray(body.ticketSelections) ? body.ticketSelections : [];
    const addonSelections = Array.isArray(body.addonSelections) ? body.addonSelections : [];

    const taxesFees = await loadActiveTaxesFees(c.env.DB);
    const preQuote = calculateQuote({
        event: ctx.event,
        ticketTypes: ctx.ticketTypes,
        ticketSelections,
        addonSelections,
        promo: null,
        taxesFees,
    });

    let promo = null;
    let promoError = null;
    if (body.promoCode && preQuote.subtotalCents > 0) {
        const resolved = await resolvePromoCode(c.env.DB, body.promoCode, body.eventId, preQuote.subtotalCents);
        if (resolved?.error) promoError = resolved.error;
        else promo = resolved;
    }

    const quote = calculateQuote({
        event: ctx.event,
        ticketTypes: ctx.ticketTypes,
        ticketSelections,
        addonSelections,
        promo,
        taxesFees,
    });

    const invErrors = await checkTicketInventory(c.env.DB, body.eventId, ticketSelections);

    return c.json({
        ...quote,
        errors: [...quote.errors, ...invErrors, ...(promoError ? [promoError] : [])],
        promoApplied: promo ? { discountType: promo.discountType, discountValue: promo.discountValue } : null,
    });
});

// POST /api/bookings/checkout — create pending booking + Stripe Checkout session
bookings.post('/checkout', rateLimit('RL_CHECKOUT'), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.eventId) return c.json({ error: 'eventId required' }, 400);

    const buyer = body.buyer || {};
    if (!buyer.fullName?.trim() || !buyer.email?.trim() || !buyer.phone?.trim()) {
        return c.json({ error: 'Buyer name, email, and phone are required' }, 400);
    }

    const attendees = Array.isArray(body.attendees) ? body.attendees : [];
    if (attendees.length === 0) {
        return c.json({ error: 'At least one attendee is required' }, 400);
    }
    for (const a of attendees) {
        if (!a.firstName?.trim() || !a.ticketTypeId) {
            return c.json({ error: 'Each attendee needs a first name and ticket type' }, 400);
        }
    }

    // Server-side enforcement of required custom questions. Event schema is authoritative.
    const ctxEvent = await c.env.DB.prepare(`SELECT custom_questions_json FROM events WHERE id = ?`).bind(body.eventId).first();
    const customQuestions = ctxEvent?.custom_questions_json ? safeJson(ctxEvent.custom_questions_json, []) : [];
    const requiredKeys = customQuestions.filter((q) => q.required).map((q) => q.key);
    if (requiredKeys.length) {
        for (let i = 0; i < attendees.length; i++) {
            const ans = attendees[i].customAnswers || {};
            for (const k of requiredKeys) {
                const v = ans[k];
                if (v === undefined || v === null || String(v).trim() === '') {
                    return c.json({ error: `Player ${i + 1}: "${customQuestions.find((q) => q.key === k).label}" is required` }, 400);
                }
            }
        }
    }

    const ctx = await loadEventAndTypes(c.env.DB, body.eventId);
    if (!ctx) return c.json({ error: 'Event not found' }, 404);

    // Derive ticket selections from attendees (group by ticket type)
    const ticketSelectionMap = new Map();
    for (const a of attendees) {
        ticketSelectionMap.set(a.ticketTypeId, (ticketSelectionMap.get(a.ticketTypeId) || 0) + 1);
    }
    const ticketSelections = [...ticketSelectionMap.entries()].map(([ticketTypeId, qty]) => ({ ticketTypeId, qty }));
    const addonSelections = Array.isArray(body.addonSelections) ? body.addonSelections : [];

    const taxesFees = await loadActiveTaxesFees(c.env.DB);
    const preQuote = calculateQuote({
        event: ctx.event,
        ticketTypes: ctx.ticketTypes,
        ticketSelections,
        addonSelections,
        promo: null,
        taxesFees,
    });

    let promo = null;
    if (body.promoCode && preQuote.subtotalCents > 0) {
        const resolved = await resolvePromoCode(c.env.DB, body.promoCode, body.eventId, preQuote.subtotalCents);
        if (resolved?.error) return c.json({ error: resolved.error }, 400);
        promo = resolved;
    }

    const quote = calculateQuote({
        event: ctx.event,
        ticketTypes: ctx.ticketTypes,
        ticketSelections,
        addonSelections,
        promo,
        taxesFees,
    });
    if (quote.errors.length) {
        return c.json({ error: quote.errors.join('; '), errors: quote.errors }, 400);
    }

    const invErrors = await checkTicketInventory(c.env.DB, body.eventId, ticketSelections);
    if (invErrors.length) {
        return c.json({ error: invErrors.join('; '), errors: invErrors }, 409);
    }

    const id = bookingId();
    const now = Date.now();

    await c.env.DB.prepare(
        `INSERT INTO bookings (
            id, event_id, full_name, email, phone, player_count,
            line_items_json, subtotal_cents, discount_cents, tax_cents, fee_cents, total_cents,
            status, notes, referral, promo_code_id,
            pending_attendees_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
    ).bind(
        id, body.eventId, buyer.fullName.trim(), buyer.email.trim(), buyer.phone.trim(),
        quote.totalAttendees,
        JSON.stringify(quote.lineItems), quote.subtotalCents, quote.discountCents,
        quote.taxCents, quote.feeCents, quote.totalCents,
        body.message || null, buyer.referral || null, promo?.id || null,
        JSON.stringify(attendees),
        now,
    ).run();

    // Build Stripe line items from our authoritative line items
    const stripeLineItems = quote.lineItems.map((li) => ({
        name: li.name + (li.type === 'ticket' ? '' : ''),
        qty: li.qty,
        unit_price_cents: li.unit_price_cents,
    }));
    if (quote.discountCents > 0) {
        stripeLineItems.push({
            name: `Promo: ${body.promoCode.toUpperCase()}`,
            qty: 1,
            unit_price_cents: -quote.discountCents,
        });
    }
    if (quote.taxCents > 0) {
        stripeLineItems.push({
            name: 'Sales tax',
            qty: 1,
            unit_price_cents: quote.taxCents,
        });
    }
    if (quote.feeCents > 0) {
        stripeLineItems.push({
            name: 'Processing fee',
            qty: 1,
            unit_price_cents: quote.feeCents,
        });
    }

    // Stripe doesn't allow negative line items in Checkout; collapse discount into tickets if present.
    // Simpler workaround: don't pass promo as a negative line; absorb into a single aggregated line.
    // For MVP we'll keep tickets/addons as separate lines and list discount/tax/fee as separate lines,
    // but if there's a discount we must instead send a single aggregated line (negative not supported).
    const finalLineItems = quote.discountCents > 0
        ? [{
            name: `${ctx.event.title} — ${quote.totalAttendees} player${quote.totalAttendees > 1 ? 's' : ''}`,
            qty: 1,
            unit_price_cents: quote.totalCents,
        }]
        : stripeLineItems;

    let session;
    try {
        session = await createCheckoutSession({
            apiKey: c.env.STRIPE_SECRET_KEY,
            lineItems: finalLineItems,
            successUrl: `${c.env.SITE_URL}/booking/success?token=${id}`,
            cancelUrl: `${c.env.SITE_URL}/booking/cancelled?token=${id}`,
            customerEmail: buyer.email.trim(),
            metadata: { booking_id: id, event_id: body.eventId },
        });
    } catch (err) {
        // Mark the booking as failed so it doesn't hold inventory
        await c.env.DB.prepare(
            `UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ?`
        ).bind(Date.now(), id).run();
        console.error('Stripe session creation failed', err);
        return c.json({ error: 'Payment setup failed. Please try again.' }, 502);
    }

    await c.env.DB.prepare(
        `UPDATE bookings SET stripe_session_id = ? WHERE id = ?`
    ).bind(session.id, id).run();

    return c.json({
        bookingId: id,
        stripeUrl: session.url,
    });
});

// GET /api/bookings/:token — public confirmation lookup (no auth; id is unguessable)
bookings.get('/:token', rateLimit('RL_TOKEN_LOOKUP'), async (c) => {
    const row = await c.env.DB.prepare(
        `SELECT * FROM bookings WHERE id = ?`
    ).bind(c.req.param('token')).first();
    if (!row) return c.json({ error: 'Booking not found' }, 404);

    const eventRow = await c.env.DB.prepare(
        `SELECT * FROM events WHERE id = ?`
    ).bind(row.event_id).first();

    const attendeesResult = await c.env.DB.prepare(
        `SELECT id, first_name, last_name, email, qr_token, waiver_id, checked_in_at
         FROM attendees WHERE booking_id = ? ORDER BY created_at ASC`
    ).bind(row.id).all();

    return c.json({
        booking: formatBooking(row),
        event: eventRow ? formatEvent(eventRow) : null,
        attendees: (attendeesResult.results || []).map((a) => ({
            id: a.id,
            firstName: a.first_name,
            lastName: a.last_name,
            email: a.email,
            qrToken: a.qr_token,
            waiverSigned: !!a.waiver_id,
            checkedIn: !!a.checked_in_at,
        })),
    });
});

export default bookings;

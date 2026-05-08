// M5 R13 — Event-day walk-up booking endpoint (Surface 5).
//
// Mounted at /api/event-day/walkup. Streamlined fast-path for at-event
// bookings. Smaller scope than /api/admin/bookings/manual:
//
//   - No card path (cash / venmo / paypal / comp only). The M5 prompt
//     called out card payment as "Option B fallback" via the admin
//     desktop — the kiosk path stays card-free for the fast lane.
//   - Single event scope: the active event is locked in via the
//     event-day session (c.get('event').id). Body cannot override.
//   - No confirmation email — the in-person walk-up gets a verbal /
//     printed receipt, not an inbox notification.
//   - Bumps walkups_created on the event_day_sessions counter.
//
// All other behaviors mirror admin manual: capacity enforcement,
// taxes + fees identical to public checkout, customer auto-link,
// existing-waiver auto-link via R6's waiverLookup, audit row.

import { Hono } from 'hono';
import {
    requireEventDayAuth,
    bumpActivityCounter,
} from '../../lib/eventDaySession.js';
import { writeAudit } from '../../lib/auditLog.js';
import { bookingId, attendeeId, qrToken } from '../../lib/ids.js';
import { findExistingValidWaiver } from '../../lib/waiverLookup.js';
import { loadActiveTaxesFees } from '../../lib/pricing.js';
import {
    findOrCreateCustomerForBooking,
    recomputeCustomerDenormalizedFields,
} from '../../lib/customers.js';
import { safeJson } from '../../lib/formatters.js';

const eventDayWalkup = new Hono();
eventDayWalkup.use('*', requireEventDayAuth);

const ALLOWED_METHODS = new Set(['cash', 'venmo', 'paypal', 'comp']);

eventDayWalkup.post('/', async (c) => {
    const event = c.get('event');
    const session = c.get('eventDaySession');
    const person = c.get('person');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'invalid_body' }, 400);

    const paymentMethod = String(body.paymentMethod || '').trim();
    if (!ALLOWED_METHODS.has(paymentMethod)) {
        return c.json({
            error: 'invalid_payment_method',
            allowed: [...ALLOWED_METHODS],
        }, 400);
    }

    const buyer = body.buyer || {};
    const buyerName = String(buyer.fullName || '').trim();
    const buyerEmail = String(buyer.email || '').trim();
    const buyerPhone = String(buyer.phone || '').trim();
    if (!buyerName || !buyerEmail) {
        return c.json({ error: 'buyer_required', message: 'Buyer name and email required' }, 400);
    }

    const attendees = Array.isArray(body.attendees) ? body.attendees : [];
    if (attendees.length === 0) {
        return c.json({ error: 'attendees_required', message: 'At least one attendee required' }, 400);
    }

    // ─── Load full event row (for addons_json) — c.get('event') is the
    //     stripped row from requireEventDayAuth (id/date_iso/past only).
    const eventRow = await c.env.DB.prepare(
        'SELECT * FROM events WHERE id = ?',
    ).bind(event.id).first();
    if (!eventRow) return c.json({ error: 'event_not_found' }, 404);

    const typesResult = await c.env.DB.prepare(
        'SELECT id, name, price_cents, capacity, sold FROM ticket_types WHERE event_id = ? AND active = 1',
    ).bind(event.id).all();
    const typesById = new Map((typesResult.results || []).map((t) => [t.id, t]));
    const addonsList = safeJson(eventRow.addons_json, []);
    const addonsBySku = new Map(addonsList.map((a) => [a.sku, a]));

    // Group + validate attendees.
    const perTypeQty = new Map();
    for (const a of attendees) {
        const fn = String(a.firstName || '').trim();
        if (!fn || !a.ticketTypeId || !typesById.has(a.ticketTypeId)) {
            return c.json({
                error: 'attendee_invalid',
                message: 'Each attendee needs firstName and a valid ticketTypeId',
            }, 400);
        }
        perTypeQty.set(a.ticketTypeId, (perTypeQty.get(a.ticketTypeId) || 0) + 1);
    }

    // Capacity enforcement — finite ticket_types.capacity cannot be oversold.
    for (const [ttId, qty] of perTypeQty.entries()) {
        const tt = typesById.get(ttId);
        if (tt.capacity != null && tt.sold + qty > tt.capacity) {
            const remaining = Math.max(0, tt.capacity - tt.sold);
            return c.json({
                error: 'capacity_exceeded',
                ticketTypeId: ttId,
                ticketTypeName: tt.name,
                remaining,
                requested: qty,
            }, 409);
        }
    }

    // ─── Pricing — mirrors admin manual exactly (taxes + fees against
    //     subtotal + Stripe-style fee on gross-with-tax for applies_to='all').
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

    const addonSelections = Array.isArray(body.addonSelections) ? body.addonSelections : [];
    for (const sel of addonSelections) {
        if (!sel.qty || sel.qty <= 0) continue;
        const addon = addonsBySku.get(sel.sku);
        if (!addon) {
            return c.json({ error: 'unknown_addon', sku: sel.sku }, 400);
        }
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

    let tax = 0;
    let fee = 0;
    if (paymentMethod !== 'comp') {
        const taxesFees = await loadActiveTaxesFees(c.env.DB);
        const totalAttendees = attendees.length;
        const unitMultiplier = (per_unit) =>
            per_unit === 'ticket' || per_unit === 'attendee' ? totalAttendees : 1;
        const ticketsSubtotal = lineItems.filter((li) => li.type === 'ticket').reduce((s, li) => s + li.line_total_cents, 0);
        const addonsSubtotal = lineItems.filter((li) => li.type === 'addon').reduce((s, li) => s + li.line_total_cents, 0);
        const activeTaxes = taxesFees.filter((tf) => tf.active && tf.category === 'tax').sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        const activeFees = taxesFees.filter((tf) => tf.active && tf.category === 'fee').sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

        for (const t of activeTaxes) {
            const base = t.applies_to === 'tickets' ? ticketsSubtotal
                : t.applies_to === 'addons' ? addonsSubtotal
                : subtotal;
            const percentAmt = Math.floor((base * (t.percent_bps || 0)) / 10000);
            const fixedAmt = (t.fixed_cents || 0) * unitMultiplier(t.per_unit);
            tax += percentAmt + fixedAmt;
        }
        for (const f of activeFees) {
            const base = f.applies_to === 'tickets' ? ticketsSubtotal
                : f.applies_to === 'addons' ? addonsSubtotal
                : subtotal + tax;
            const percentAmt = Math.floor((base * (f.percent_bps || 0)) / 10000);
            const fixedAmt = (f.fixed_cents || 0) * unitMultiplier(f.per_unit);
            fee += percentAmt + fixedAmt;
        }
    }
    const total = subtotal + tax + fee;

    // M3 B6: customer_id NOT NULL — resolve before INSERT.
    const resolvedCustomerId = await findOrCreateCustomerForBooking(c.env.DB, {
        email: buyerEmail,
        name: buyerName,
        phone: buyerPhone || null,
        actorUserId: null, // event-day actor is a person, not a user
    });
    if (!resolvedCustomerId) {
        return c.json({ error: 'buyer_email_invalid' }, 400);
    }

    const id = bookingId();
    const now = Date.now();
    const status = paymentMethod === 'comp' ? 'comp' : 'paid';
    const stripePi = paymentMethod === 'comp' ? null : `${paymentMethod}_${id}`;
    const noteTag = `[walk-up by ${person?.full_name || 'event-day staff'}]`;
    const combinedNotes = [noteTag, body.notes?.trim()].filter(Boolean).join(' ');

    await c.env.DB.prepare(
        `INSERT INTO bookings (
            id, event_id, full_name, email, phone, player_count,
            line_items_json, subtotal_cents, discount_cents, tax_cents, fee_cents, total_cents,
            status, notes, payment_method, stripe_payment_intent, created_at, paid_at, customer_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
        id, event.id, buyerName, buyerEmail, buyerPhone,
        attendees.length,
        JSON.stringify(lineItems), subtotal, tax, fee, total,
        status, combinedNotes || null, paymentMethod, stripePi,
        now, now,
        resolvedCustomerId,
    ).run();

    // Insert attendees with auto-linked waiver where present.
    const attendeeIds = [];
    const firstAttendeeQrToken = qrToken();
    for (const [idx, a] of attendees.entries()) {
        const newAttendeeId = attendeeId();
        const fn = String(a.firstName || '').trim();
        const ln = a.lastName ? String(a.lastName).trim() : null;
        const em = a.email ? String(a.email).trim() : null;
        const ph = a.phone ? String(a.phone).trim() : null;
        const linkedWaiverId = await findExistingValidWaiver(c.env.DB, em, fn, ln, now);
        const tok = idx === 0 ? firstAttendeeQrToken : qrToken();

        await c.env.DB.prepare(
            `INSERT INTO attendees (
                id, booking_id, ticket_type_id, first_name, last_name, email, phone,
                qr_token, created_at, custom_answers_json, waiver_id, customer_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
            newAttendeeId, id, a.ticketTypeId,
            fn, ln, em, ph,
            tok, now,
            a.customAnswers && Object.keys(a.customAnswers).length ? JSON.stringify(a.customAnswers) : null,
            linkedWaiverId,
            resolvedCustomerId,
        ).run();
        attendeeIds.push(newAttendeeId);

        if (linkedWaiverId) {
            await c.env.DB.prepare(
                `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
                 VALUES (NULL, 'waiver.auto_linked', 'attendee', ?, ?, ?)`,
            ).bind(newAttendeeId, JSON.stringify({ waiver_id: linkedWaiverId, booking_id: id }), now).run();
        }
    }

    // Bump ticket_types.sold for capacity tracking.
    for (const [ttId, qty] of perTypeQty.entries()) {
        await c.env.DB.prepare(
            'UPDATE ticket_types SET sold = sold + ?, updated_at = ? WHERE id = ?',
        ).bind(qty, now, ttId).run();
    }

    // Audit row — distinct action so investigators can filter event-day
    // walk-ups separately from admin desktop manual bookings.
    await writeAudit(c.env, {
        userId: null,
        action: `event_day.walkup_${paymentMethod}`,
        targetType: 'booking',
        targetId: id,
        meta: {
            event_id: event.id,
            attendees: attendees.length,
            total_cents: total,
            payment_method: paymentMethod,
            person_id: person?.id || null,
            session_id: session.id,
        },
    });

    // Bump the event-day session counter (R12 lib).
    await bumpActivityCounter(c.env, session.id, 'walkup');

    // Refresh customer denormalized aggregates (M3 B5/6 contract).
    await recomputeCustomerDenormalizedFields(c.env.DB, resolvedCustomerId);

    return c.json({
        ok: true,
        bookingId: id,
        attendeeIds,
        firstQrToken: firstAttendeeQrToken,
        totalCents: total,
        status,
        paymentMethod,
    });
});

export default eventDayWalkup;

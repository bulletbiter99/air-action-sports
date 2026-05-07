import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { formatBooking, formatEvent, safeJson } from '../../lib/formatters.js';
import { issueRefund, createCheckoutSession } from '../../lib/stripe.js';
import { bookingId, attendeeId, qrToken } from '../../lib/ids.js';
import { sendBookingConfirmation, sendWaiverRequest } from '../../lib/emailSender.js';
import { findExistingValidWaiver } from '../../lib/waiverLookup.js';
import { loadActiveTaxesFees } from '../../lib/pricing.js';
import { findOrCreateCustomerForBooking, recomputeCustomerDenormalizedFields } from '../../lib/customers.js';

// Allowed manual booking payment methods.
//   card   → admin creates pending booking + Stripe Checkout URL;
//            customer scans QR / taps URL to pay; webhook flips status to paid.
//   cash   → in-person cash; status=paid immediately.
//   venmo  → external app payment recorded; status=paid immediately.
//   paypal → external PayPal received; status=paid immediately.
//   comp   → free; status=comp; totals=0.
const MANUAL_METHODS = new Set(['card', 'cash', 'venmo', 'paypal', 'comp']);
const EXTERNAL_PAID_METHODS = new Set(['cash', 'venmo', 'paypal']); // immediate paid + admin-friendly tag
const METHOD_TAG = { cash: '[CASH]', venmo: '[VENMO]', paypal: '[PAYPAL]', comp: '[COMP]', card: '[CARD]' };

const adminBookings = new Hono();

adminBookings.use('*', requireAuth);

// Build the WHERE clause + binds shared by GET / and GET /export.csv.
// Existing parameters (event_id, status, q, from, to) preserved verbatim
// — Group E tests against POST /manual and POST /:id/refund are unaffected
// since they don't exercise the list endpoint, but downstream consumers
// may rely on the existing param names.
//
// New parameters added in M4 B2b:
//   payment_method  → exact match against bookings.payment_method
//   has_refund      → 'true' (refunded_at IS NOT NULL) | 'false' (IS NULL)
//   waiver_status   → 'complete' | 'missing' | 'partial' against attendees
//                      (subquery on attendees.waiver_id null-count)
//   min_amount      → total_cents >= ?
//   max_amount      → total_cents <= ?
//   customer_id     → exact match against bookings.customer_id (M3 B6 column)
function buildBookingsListFilter(params) {
    const where = [];
    const binds = [];

    const eventId = params.get('event_id');
    const status = params.get('status');
    const q = params.get('q');
    const from = params.get('from');
    const to = params.get('to');
    const paymentMethod = params.get('payment_method');
    const hasRefund = params.get('has_refund');
    const waiverStatus = params.get('waiver_status');
    const minAmount = params.get('min_amount');
    const maxAmount = params.get('max_amount');
    const customerId = params.get('customer_id');

    if (eventId) { where.push('event_id = ?'); binds.push(eventId); }
    if (status)  { where.push('status = ?');   binds.push(status); }
    if (q)       { where.push('(LOWER(full_name) LIKE ? OR LOWER(email) LIKE ?)'); binds.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`); }
    if (from)    { where.push('created_at >= ?'); binds.push(Number(from)); }
    if (to)      { where.push('created_at <= ?'); binds.push(Number(to)); }
    if (paymentMethod) { where.push('payment_method = ?'); binds.push(paymentMethod); }
    if (hasRefund === 'true')  { where.push('refunded_at IS NOT NULL'); }
    if (hasRefund === 'false') { where.push('refunded_at IS NULL'); }
    if (minAmount) { where.push('total_cents >= ?'); binds.push(Number(minAmount)); }
    if (maxAmount) { where.push('total_cents <= ?'); binds.push(Number(maxAmount)); }
    if (customerId) { where.push('customer_id = ?'); binds.push(customerId); }

    // Waiver-status subquery — booking matches when its attendees' waiver_id
    // null-count satisfies the predicate. complete=0, missing=COUNT(*),
    // partial=between 1 and COUNT(*)-1. Booking with zero attendees is
    // considered 'missing' (no waivers signed because no attendees).
    if (waiverStatus === 'complete') {
        where.push('id IN (SELECT booking_id FROM attendees GROUP BY booking_id HAVING SUM(CASE WHEN waiver_id IS NULL THEN 1 ELSE 0 END) = 0 AND COUNT(*) > 0)');
    } else if (waiverStatus === 'missing') {
        where.push('id IN (SELECT booking_id FROM attendees GROUP BY booking_id HAVING SUM(CASE WHEN waiver_id IS NULL THEN 1 ELSE 0 END) = COUNT(*))');
    } else if (waiverStatus === 'partial') {
        where.push('id IN (SELECT booking_id FROM attendees GROUP BY booking_id HAVING SUM(CASE WHEN waiver_id IS NULL THEN 1 ELSE 0 END) BETWEEN 1 AND COUNT(*) - 1)');
    }

    return {
        whereSQL: where.length ? `WHERE ${where.join(' AND ')}` : '',
        binds,
    };
}

adminBookings.get('/', async (c) => {
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const limit = Math.min(Number(params.get('limit') || 50), 200);
    const offset = Math.max(0, Number(params.get('offset') || 0));
    const { whereSQL, binds } = buildBookingsListFilter(params);

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

// ────────────────────────────────────────────────────────────────────
// Bulk + export endpoints (M4 B2b)
//
// Mounted BEFORE the dynamic /:id routes so Hono's router resolves the
// static segments first. requireRole('owner','manager') gates all three —
// staff cannot bulk-email customers or export PII. M4 plan defers the
// formal capabilities `bookings.email` / `bookings.export` to M5's role
// hierarchy expansion (per docs/decisions.md D05 nearby context).
// ────────────────────────────────────────────────────────────────────

const BULK_MAX = 100;

function csvField(val) {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

// POST /api/admin/bookings/bulk/resend-confirmation
// Body: { bookingIds: string[] }
// Per-booking outcomes: sent | skipped (status not paid/comp) | failed.
// Audit row written per successful send.
adminBookings.post('/bulk/resend-confirmation', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.bookingIds) || body.bookingIds.length === 0) {
        return c.json({ error: 'bookingIds array is required' }, 400);
    }
    if (!body.bookingIds.every((id) => typeof id === 'string' && id.length > 0)) {
        return c.json({ error: 'bookingIds must contain non-empty strings' }, 400);
    }
    if (body.bookingIds.length > BULK_MAX) {
        return c.json({ error: `Max ${BULK_MAX} bookings per bulk action` }, 400);
    }

    const results = { sent: 0, skipped: 0, failed: 0, errors: [] };
    const now = Date.now();

    for (const id of body.bookingIds) {
        const booking = await c.env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(id).first();
        if (!booking) {
            results.failed++;
            results.errors.push({ id, reason: 'not_found' });
            continue;
        }
        if (!['paid', 'comp'].includes(booking.status)) {
            results.skipped++;
            continue;
        }

        const event = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(booking.event_id).first();
        if (!event) {
            results.failed++;
            results.errors.push({ id, reason: 'event_not_found' });
            continue;
        }

        const attendeesRes = await c.env.DB.prepare(
            `SELECT id, waiver_id FROM attendees WHERE booking_id = ?`
        ).bind(id).all();

        try {
            const result = await sendBookingConfirmation(c.env, {
                booking,
                event,
                attendees: attendeesRes.results || [],
            });
            if (result?.skipped) {
                results.skipped++;
            } else {
                results.sent++;
                await c.env.DB.prepare(
                    `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
                     VALUES (?, 'booking.confirmation_resent_bulk', 'booking', ?, ?, ?)`
                ).bind(user.id, id, JSON.stringify({ to: booking.email }), now).run();
            }
        } catch (err) {
            console.error('bulk resend-confirmation failed for', id, err);
            results.failed++;
            results.errors.push({ id, reason: err?.message || 'send_failed' });
        }
    }

    return c.json(results);
});

// POST /api/admin/bookings/bulk/resend-waiver-request
// Body: { bookingIds: string[] }
// Sends sendWaiverRequest per attendee in the named bookings whose
// waiver_id IS NULL. Bookings with all-signed attendees are 'skipped';
// per-attendee send is the unit of action and counted in `sent`.
adminBookings.post('/bulk/resend-waiver-request', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.bookingIds) || body.bookingIds.length === 0) {
        return c.json({ error: 'bookingIds array is required' }, 400);
    }
    if (!body.bookingIds.every((id) => typeof id === 'string' && id.length > 0)) {
        return c.json({ error: 'bookingIds must contain non-empty strings' }, 400);
    }
    if (body.bookingIds.length > BULK_MAX) {
        return c.json({ error: `Max ${BULK_MAX} bookings per bulk action` }, 400);
    }

    const results = { sent: 0, skipped: 0, failed: 0, errors: [] };
    const now = Date.now();

    for (const bid of body.bookingIds) {
        const attendeesRes = await c.env.DB.prepare(
            `SELECT a.*, b.event_id AS booking_event_id FROM attendees a
             JOIN bookings b ON b.id = a.booking_id
             WHERE a.booking_id = ? AND a.waiver_id IS NULL`
        ).bind(bid).all();

        const attendees = attendeesRes.results || [];
        if (attendees.length === 0) {
            results.skipped++;
            continue;
        }

        const eventId = attendees[0].booking_event_id;
        const event = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(eventId).first();
        if (!event) {
            results.failed++;
            results.errors.push({ id: bid, reason: 'event_not_found' });
            continue;
        }

        for (const attendee of attendees) {
            try {
                const result = await sendWaiverRequest(c.env, { attendee, event });
                if (result?.skipped) {
                    results.skipped++;
                } else {
                    results.sent++;
                    await c.env.DB.prepare(
                        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
                         VALUES (?, 'attendee.waiver_request_resent_bulk', 'attendee', ?, ?, ?)`
                    ).bind(user.id, attendee.id, JSON.stringify({ booking_id: bid, to: attendee.email }), now).run();
                }
            } catch (err) {
                console.error('bulk resend-waiver-request failed for attendee', attendee.id, err);
                results.failed++;
                results.errors.push({ id: attendee.id, reason: err?.message || 'send_failed' });
            }
        }
    }

    return c.json(results);
});

// GET /api/admin/bookings/export.csv
// Same query params as GET / (uses buildBookingsListFilter). Streams a
// CSV with one header row + one row per matched booking. Hard cap of
// 10k rows; operator refines the filter for larger sets. Audit-logged.
adminBookings.get('/export.csv', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const { whereSQL, binds } = buildBookingsListFilter(params);

    const EXPORT_LIMIT = 10_000;
    const rows = await c.env.DB.prepare(
        `SELECT b.*, e.title AS event_title, e.date_iso AS event_date_iso
         FROM bookings b
         LEFT JOIN events e ON e.id = b.event_id
         ${whereSQL}
         ORDER BY b.created_at DESC
         LIMIT ?`
    ).bind(...binds, EXPORT_LIMIT).all();

    const HEADER = [
        'id', 'event_id', 'event_title', 'event_date_iso',
        'full_name', 'email', 'phone', 'player_count',
        'status', 'payment_method',
        'subtotal_cents', 'tax_cents', 'fee_cents', 'total_cents',
        'created_at', 'paid_at', 'refunded_at',
        'customer_id', 'notes',
    ];

    const csvLines = [HEADER.join(',')];
    for (const r of (rows.results || [])) {
        csvLines.push(HEADER.map((col) => csvField(r[col])).join(','));
    }

    // PII access trace. target_id='export-csv' is a sentinel since the
    // export targets a filter result, not a single booking. meta_json
    // captures the row count and the active filters for forensic recall.
    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'booking.exported_csv', 'booking', 'export-csv', ?, ?)`
    ).bind(
        user.id,
        JSON.stringify({ row_count: rows.results?.length ?? 0, filters: Object.fromEntries(params) }),
        Date.now(),
    ).run();

    const filename = `bookings-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csvLines.join('\n'), {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
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
// Creates a booking entered by staff. Accepts:
//   card   → status=pending; returns paymentUrl + sessionId for the admin to
//            show the customer (QR or tablet). Webhook flips status to paid.
//   cash | venmo | paypal → status=paid immediately, payment recorded as external.
//   comp   → status=comp; totals=0.
adminBookings.post('/manual', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body?.eventId) return c.json({ error: 'eventId required' }, 400);

    const paymentMethod = body.paymentMethod || 'comp';
    if (!MANUAL_METHODS.has(paymentMethod)) {
        return c.json({ error: `paymentMethod must be one of ${[...MANUAL_METHODS].join(', ')}` }, 400);
    }

    const buyer = body.buyer || {};
    if (!buyer.fullName?.trim() || !buyer.email?.trim()) {
        return c.json({ error: 'Buyer name and email required' }, 400);
    }
    const attendees = Array.isArray(body.attendees) ? body.attendees : [];
    if (attendees.length === 0) return c.json({ error: 'At least one attendee required' }, 400);

    const eventRow = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(body.eventId).first();
    if (!eventRow) return c.json({ error: 'Event not found' }, 404);
    // Select capacity + sold too so we can enforce capacity on manual bookings.
    // Without this, a manager can oversell beyond ticket_types.capacity.
    const typesResult = await c.env.DB.prepare(
        `SELECT id, name, price_cents, capacity, sold FROM ticket_types WHERE event_id = ? AND active = 1`
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

    // Capacity check. Ticket types with a finite capacity cannot be oversold.
    // capacity === null is treated as unlimited.
    for (const [ttId, qty] of perTypeQty.entries()) {
        const tt = typesById.get(ttId);
        if (tt.capacity != null && tt.sold + qty > tt.capacity) {
            const remaining = Math.max(0, tt.capacity - tt.sold);
            return c.json({
                error: `Not enough capacity for ${tt.name}: ${remaining} left, ${qty} requested`,
                ticketTypeId: ttId,
                remaining,
                requested: qty,
            }, 409);
        }
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

    // Apply global taxes & fees — must match customer checkout exactly so
    // the admin preview ($/api/bookings/quote) and the booking row stored
    // here always agree. Specifically: for applies_to='all', taxes are
    // computed against subtotal, then fees against subtotal+tax (Stripe-
    // style fee on gross). Earlier version computed both against subtotal
    // only, which diverged from the customer flow by ~15¢ per booking.
    // Comp bookings skip taxes/fees entirely — the booking is recorded as $0.
    let tax = 0;
    let fee = 0;
    if (paymentMethod !== 'comp') {
        const taxesFees = await loadActiveTaxesFees(c.env.DB);
        const totalAttendees = attendees.length;
        const unitMultiplier = (per_unit) =>
            per_unit === 'ticket' || per_unit === 'attendee' ? totalAttendees : 1;

        // Mirrors pricing.js calculateQuote(): split tickets vs addons subtotals
        // for applies_to='tickets' / 'addons' (currently unused — all our
        // configured rows are applies_to='all' — but keeps parity for future).
        const ticketsSubtotal = lineItems
            .filter((li) => li.type === 'ticket')
            .reduce((s, li) => s + li.line_total_cents, 0);
        const addonsSubtotal = lineItems
            .filter((li) => li.type === 'addon')
            .reduce((s, li) => s + li.line_total_cents, 0);

        const activeTaxes = taxesFees
            .filter((tf) => tf.active && tf.category === 'tax')
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        const activeFees = taxesFees
            .filter((tf) => tf.active && tf.category === 'fee')
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

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
                : subtotal + tax;  // fee on gross including taxes
            const percentAmt = Math.floor((base * (f.percent_bps || 0)) / 10000);
            const fixedAmt = (f.fixed_cents || 0) * unitMultiplier(f.per_unit);
            fee += percentAmt + fixedAmt;
        }
    }
    const total = subtotal + tax + fee;

    const id = bookingId();
    const now = Date.now();
    const methodTag = METHOD_TAG[paymentMethod] || '';
    const combinedNotes = [methodTag, body.notes?.trim()].filter(Boolean).join(' ');

    // M3 B6: bookings.customer_id is NOT NULL. Resolve customer_id from buyer
    // email/name and reject the booking if the email is malformed (returning
    // null from findOrCreateCustomerForBooking would otherwise cascade into
    // a constraint violation on the bookings INSERT). Card branch defers the
    // recompute to the webhook (LTV only counts paid bookings); other
    // branches recompute after attendees insert.
    const resolvedCustomerId = await findOrCreateCustomerForBooking(c.env.DB, {
        email: buyer.email,
        name: buyer.fullName,
        phone: buyer.phone,
        actorUserId: user.id,
    });
    if (!resolvedCustomerId) {
        return c.json({ error: 'Buyer email format is invalid' }, 400);
    }

    // ─── Card branch: pending row + Stripe Checkout link, webhook completes ───
    if (paymentMethod === 'card') {
        // Tag attendees with their selected ticketTypeId so the webhook can fan
        // them out into the attendees table (mirrors the public checkout shape).
        const pendingAttendees = attendees.map((a) => ({
            ticketTypeId: a.ticketTypeId,
            firstName: a.firstName.trim(),
            lastName: a.lastName?.trim() || null,
            email: a.email?.trim() || null,
            phone: a.phone?.trim() || null,
            customAnswers: a.customAnswers || {},
        }));

        await c.env.DB.prepare(
            `INSERT INTO bookings (
                id, event_id, full_name, email, phone, player_count,
                line_items_json, subtotal_cents, discount_cents, tax_cents, fee_cents, total_cents,
                status, notes, payment_method, pending_attendees_json, created_at, customer_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'pending', ?, 'card', ?, ?, ?)`
        ).bind(
            id, body.eventId, buyer.fullName.trim(), buyer.email.trim(), buyer.phone?.trim() || '',
            attendees.length,
            JSON.stringify(lineItems), subtotal, tax, fee, total,
            combinedNotes || null,
            JSON.stringify(pendingAttendees),
            now,
            resolvedCustomerId,
        ).run();

        // Build Stripe line items from our authoritative line items (mirrors public flow).
        const stripeLineItems = lineItems.map((li) => ({
            name: li.name,
            qty: li.qty,
            unit_price_cents: li.unit_price_cents,
        }));
        if (tax > 0) stripeLineItems.push({ name: 'Sales tax', qty: 1, unit_price_cents: tax });
        if (fee > 0) stripeLineItems.push({ name: 'Processing fee', qty: 1, unit_price_cents: fee });

        let session;
        try {
            session = await createCheckoutSession({
                apiKey: c.env.STRIPE_SECRET_KEY,
                lineItems: stripeLineItems,
                successUrl: `${c.env.SITE_URL}/booking/success?token=${id}`,
                cancelUrl: `${c.env.SITE_URL}/booking/cancelled?token=${id}`,
                customerEmail: buyer.email.trim(),
                metadata: { booking_id: id, event_id: body.eventId, source: 'admin_manual', admin_user_id: user.id },
            });
        } catch (err) {
            await c.env.DB.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ?`)
                .bind(Date.now(), id).run();
            console.error('Admin manual card: Stripe session creation failed', err);
            return c.json({ error: 'Payment setup failed. Try again or pick a different method.' }, 502);
        }

        await c.env.DB.prepare(`UPDATE bookings SET stripe_session_id = ? WHERE id = ?`)
            .bind(session.id, id).run();

        await c.env.DB.prepare(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
             VALUES (?, 'booking.manual_card_pending', 'booking', ?, ?, ?)`
        ).bind(user.id, id, JSON.stringify({
            event_id: body.eventId, attendees: attendees.length, total_cents: total,
            payment_method: 'card', stripe_session_id: session.id,
        }), now).run();

        return c.json({
            bookingId: id,
            totalCents: total,
            status: 'pending',
            paymentMethod: 'card',
            paymentUrl: session.url,
            sessionId: session.id,
        });
    }

    // ─── Immediate-paid branch: cash / venmo / paypal / comp ───
    const status = paymentMethod === 'comp' ? 'comp' : 'paid';
    // Non-Stripe payments use a synthetic intent ID so refunds-via-Stripe
    // know to skip the API and treat the booking as out-of-band paid.
    const stripePi = paymentMethod === 'comp' ? null : `${paymentMethod}_${id}`;

    await c.env.DB.prepare(
        `INSERT INTO bookings (
            id, event_id, full_name, email, phone, player_count,
            line_items_json, subtotal_cents, discount_cents, tax_cents, fee_cents, total_cents,
            status, notes, payment_method, stripe_payment_intent, created_at, paid_at, customer_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        id, body.eventId, buyer.fullName.trim(), buyer.email.trim(), buyer.phone?.trim() || '',
        attendees.length,
        JSON.stringify(lineItems), subtotal, tax, fee, total,
        status, combinedNotes || null, paymentMethod, stripePi,
        now, now,
        resolvedCustomerId,
    ).run();

    // Phase C annual-renewal: auto-link to existing valid waivers when present.
    for (const a of attendees) {
        const newAttendeeId = attendeeId();
        const firstName = a.firstName.trim();
        const lastName = a.lastName?.trim() || null;
        const email = a.email?.trim() || null;
        const linkedWaiverId = await findExistingValidWaiver(c.env.DB, email, firstName, lastName, now);

        await c.env.DB.prepare(
            `INSERT INTO attendees (
                id, booking_id, ticket_type_id, first_name, last_name, email, phone,
                qr_token, created_at, custom_answers_json, waiver_id, customer_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            newAttendeeId, id, a.ticketTypeId,
            firstName, lastName,
            email, a.phone?.trim() || null,
            qrToken(), now,
            a.customAnswers && Object.keys(a.customAnswers).length ? JSON.stringify(a.customAnswers) : null,
            linkedWaiverId,
            resolvedCustomerId,
        ).run();

        if (linkedWaiverId) {
            await c.env.DB.prepare(
                `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
                 VALUES (?, 'waiver.auto_linked', 'attendee', ?, ?, ?)`
            ).bind(user.id, newAttendeeId, JSON.stringify({ waiver_id: linkedWaiverId, booking_id: id }), now).run();
        }
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
        paymentMethod === 'comp' ? 'booking.manual_comp' : `booking.manual_${paymentMethod}`,
        id,
        JSON.stringify({ event_id: body.eventId, attendees: attendees.length, total_cents: total, payment_method: paymentMethod }),
        now,
    ).run();

    // M3 B6: refresh denormalized aggregates. resolvedCustomerId is
    // guaranteed non-null here (early return above on malformed email).
    await recomputeCustomerDenormalizedFields(c.env.DB, resolvedCustomerId);

    return c.json({ bookingId: id, totalCents: total, status, paymentMethod });
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
    // Cash bookings carry synthetic payment intents — don't round-trip to Stripe.
    if (booking.stripe_payment_intent.startsWith('cash_')) {
        return c.json({ error: 'Cash booking — refund handled out of band, not via Stripe' }, 400);
    }

    let refund;
    try {
        refund = await issueRefund({
            apiKey: c.env.STRIPE_SECRET_KEY,
            paymentIntent: booking.stripe_payment_intent,
            reason,
            // Idempotency-Key dedupes concurrent clicks / browser retries.
            // Stripe holds the key for 24h; any repeat returns the same refund.
            idempotencyKey: `refund_${id}`,
        });
    } catch (err) {
        console.error('Refund failed:', err);
        return c.json({ error: 'Stripe refund failed' }, 502);
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

    // M3 B6: refresh denormalized aggregates so refund_count increments
    // and lifetime_value_cents drops to reflect the refund. Post-B6
    // booking.customer_id is NOT NULL — guaranteed non-empty here.
    await recomputeCustomerDenormalizedFields(c.env.DB, booking.customer_id);

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

    // Pull attendees so the resent email gets the same waiver-status summary
    // as the initial send.
    const attendeesRes = await c.env.DB.prepare(
        `SELECT id, waiver_id FROM attendees WHERE booking_id = ?`
    ).bind(id).all();
    const attendees = attendeesRes.results || [];

    try {
        const result = await sendBookingConfirmation(c.env, { booking, event, attendees });
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

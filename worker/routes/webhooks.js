import { Hono } from 'hono';
import { verifyWebhookSignature } from '../lib/stripe.js';
import { attendeeId, qrToken } from '../lib/ids.js';
import { safeJson } from '../lib/formatters.js';
import { sendBookingConfirmation, sendAdminNotify, sendWaiverRequest } from '../lib/emailSender.js';

const webhooks = new Hono();

webhooks.post('/stripe', async (c) => {
    const secret = c.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
        console.error('STRIPE_WEBHOOK_SECRET not configured');
        return c.json({ error: 'Webhook not configured' }, 500);
    }

    const rawBody = await c.req.text();
    const signatureHeader = c.req.header('stripe-signature');

    let event;
    try {
        event = await verifyWebhookSignature({
            body: rawBody,
            signatureHeader,
            secret,
        });
    } catch (err) {
        console.error('Webhook verification failed:', err.message);
        return c.json({ error: 'Signature verification failed' }, 400);
    }

    if (event.type === 'checkout.session.completed') {
        const result = await handleCheckoutCompleted(c.env.DB, event.data.object);
        if (result?.emailContext && c.executionCtx?.waitUntil) {
            c.executionCtx.waitUntil(sendBookingEmails(c.env, result.emailContext));
        }
    }

    return c.json({ received: true });
});

async function sendBookingEmails(env, { booking, event, attendees }) {
    const out = { confirmation: null, admin: null, waivers: [] };
    try {
        out.confirmation = await sendBookingConfirmation(env, { booking, event });
    } catch (err) {
        console.error('booking_confirmation failed:', err.message);
        out.confirmation = { error: err.message };
    }
    try {
        out.admin = await sendAdminNotify(env, { booking, event });
    } catch (err) {
        console.error('admin_notify failed:', err.message);
        out.admin = { error: err.message };
    }
    for (const attendee of attendees) {
        try {
            const r = await sendWaiverRequest(env, { attendee, event });
            out.waivers.push({ attendee_id: attendee.id, ...r });
        } catch (err) {
            console.error(`waiver_request failed for ${attendee.id}:`, err.message);
            out.waivers.push({ attendee_id: attendee.id, error: err.message });
        }
    }
    console.log('Booking emails sent:', JSON.stringify(out));
    return out;
}

async function handleCheckoutCompleted(db, session) {
    const sessionId = session.id;
    const bookingRow = await db.prepare(
        `SELECT * FROM bookings WHERE stripe_session_id = ?`
    ).bind(sessionId).first();

    if (!bookingRow) {
        console.error(`Webhook: no booking found for session ${sessionId}`);
        return;
    }

    // Idempotency — ignore if already paid
    if (bookingRow.status === 'paid') return;

    const now = Date.now();
    const pendingAttendees = safeJson(bookingRow.pending_attendees_json, []);
    const lineItems = safeJson(bookingRow.line_items_json, []);

    // Flip booking to paid
    await db.prepare(
        `UPDATE bookings SET
            status = 'paid',
            paid_at = ?,
            stripe_payment_intent = ?
         WHERE id = ?`
    ).bind(now, session.payment_intent || null, bookingRow.id).run();

    // Insert attendee rows
    for (const a of pendingAttendees) {
        await db.prepare(
            `INSERT INTO attendees (
                id, booking_id, ticket_type_id,
                first_name, last_name, email, phone,
                qr_token, created_at, custom_answers_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            attendeeId(),
            bookingRow.id,
            a.ticketTypeId,
            a.firstName?.trim() || '',
            a.lastName?.trim() || null,
            a.email?.trim() || null,
            a.phone?.trim() || null,
            qrToken(),
            now,
            a.customAnswers && Object.keys(a.customAnswers).length ? JSON.stringify(a.customAnswers) : null,
        ).run();
    }

    // Increment sold counters per ticket type
    const soldByType = new Map();
    for (const item of lineItems) {
        if (item.type === 'ticket') {
            soldByType.set(item.ticket_type_id, (soldByType.get(item.ticket_type_id) || 0) + item.qty);
        }
    }
    for (const [ttId, qty] of soldByType.entries()) {
        await db.prepare(
            `UPDATE ticket_types SET sold = sold + ?, updated_at = ? WHERE id = ?`
        ).bind(qty, now, ttId).run();
    }

    // Increment promo code usage
    if (bookingRow.promo_code_id) {
        await db.prepare(
            `UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id = ?`
        ).bind(bookingRow.promo_code_id).run();
    }

    // Audit log
    await db.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (NULL, 'booking.paid', 'booking', ?, ?, ?)`
    ).bind(
        bookingRow.id,
        JSON.stringify({ stripe_session_id: sessionId, total_cents: bookingRow.total_cents }),
        now,
    ).run();

    console.log(`Booking ${bookingRow.id} marked paid (${pendingAttendees.length} attendees)`);

    // Collect context needed for email sending (done via waitUntil after response)
    const eventRow = await db.prepare(
        `SELECT * FROM events WHERE id = ?`
    ).bind(bookingRow.event_id).first();
    const attendeeRows = await db.prepare(
        `SELECT * FROM attendees WHERE booking_id = ?`
    ).bind(bookingRow.id).all();

    return {
        emailContext: {
            booking: bookingRow,
            event: eventRow,
            attendees: attendeeRows.results || [],
        },
    };
}

export default webhooks;

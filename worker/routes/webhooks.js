import { Hono } from 'hono';
import { verifyWebhookSignature } from '../lib/stripe.js';
import { attendeeId, qrToken } from '../lib/ids.js';
import { safeJson } from '../lib/formatters.js';
import { sendBookingConfirmation, sendAdminNotify, sendWaiverRequest, sendDisputeAlert, sendBounceAlert, sendComplaintAlert } from '../lib/emailSender.js';
import { findExistingValidWaiver } from '../lib/waiverLookup.js';
import { findOrCreateCustomerForBooking, recomputeCustomerDenormalizedFields } from '../lib/customers.js';
import { verifyResendWebhook } from '../lib/resendWebhook.js';
import { classifyResendEvent, shouldSuppressMarketing, eventActionName, emailEventId } from '../lib/emailEvents.js';
import { CAMPAIGN_TRACKED_EVENTS, correlateCampaignEvent } from '../lib/campaignTracking.js';
import { normalizeEmail } from '../lib/email.js';

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
    } else if (event.type === 'charge.dispute.created') {
        // M6 B6 — dispute consumer. Records the dispute against the booking
        // (via stripe_payment_intent join) and notifies admin. Critical-DNT
        // additive surface; the existing checkout.session.completed handler
        // above is byte-equivalent to pre-B6.
        const result = await handleDisputeCreated(c.env.DB, event.data.object);
        if (result?.emailContext && c.executionCtx?.waitUntil) {
            c.executionCtx.waitUntil(sendDisputeEmail(c.env, result.emailContext));
        }
    }

    return c.json({ received: true });
});

// M7 B8 — Resend (Svix) webhook consumer. A SIBLING route to /stripe above:
// Resend events cannot flow through the Stripe-signed handler (it 400s anything
// without a valid Stripe signature), so they get their own signed endpoint.
// Records bounces/complaints + auto-suppresses marketing email. Fully additive —
// the /stripe handler + verifyWebhookSignature are untouched.
webhooks.post('/resend', async (c) => {
    const secret = c.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
        console.error('RESEND_WEBHOOK_SECRET not configured');
        return c.json({ error: 'Webhook not configured' }, 500);
    }

    const rawBody = await c.req.text();
    const svixId = c.req.header('svix-id');

    let event;
    try {
        event = await verifyResendWebhook({
            body: rawBody,
            svixId,
            svixTimestamp: c.req.header('svix-timestamp'),
            svixSignature: c.req.header('svix-signature'),
            secret,
        });
    } catch (err) {
        console.error('Resend webhook verification failed:', err.message);
        return c.json({ error: 'Signature verification failed' }, 400);
    }

    if (event.type === 'email.bounced' || event.type === 'email.complained') {
        const result = await handleResendEmailEvent(c.env.DB, event, svixId);
        // M7 B10 — queue an admin alert for actionable events (hard bounce /
        // complaint). handleResendEmailEvent returns emailContext only then.
        if (result?.emailContext && c.executionCtx?.waitUntil) {
            c.executionCtx.waitUntil(sendResendAlert(c.env, result.emailContext));
        }
    }

    // Marketing B4 — project any tracked Resend event onto its campaign
    // recipient (delivered/opened/clicked/bounced/complained). Additive +
    // independent of the bounce/complaint suppression above; failures are
    // swallowed so a tracking miss never makes Resend retry the webhook.
    if (CAMPAIGN_TRACKED_EVENTS.has(event.type)) {
        await correlateCampaignEvent(c.env.DB, event).catch((e) => console.error('campaign event correlate failed', e));
    }

    return c.json({ received: true });
});

// M6 B6 — dispute event handler. Logs the dispute against the related
// booking (resolved via stripe_payment_intent) and queues admin email.
//
// Idempotency: Stripe may redeliver any webhook (delivery retries on 5xx,
// or operator-initiated resends). To avoid duplicate audit rows + duplicate
// admin emails, we check the audit_log for an existing 'dispute.received'
// row with the same dispute.id in meta_json. If found, return without
// re-recording.
//
// Orphan disputes (no booking for that payment_intent): log to console,
// still write an audit row with target_type='unknown'/target_id=dispute.id
// so the operator sees it, but no email is queued (no booking context to
// render). This handles the edge case where a payment_intent existed in
// our system briefly (e.g., abandoned) and we don't have full booking
// context anymore.
async function handleDisputeCreated(db, dispute) {
    const disputeId = dispute.id;
    const paymentIntent = dispute.payment_intent || null;

    // Idempotency check first — Stripe redeliveries are common.
    const existingAudit = await db.prepare(
        `SELECT id FROM audit_log
         WHERE action = 'dispute.received'
           AND meta_json LIKE ?
         LIMIT 1`
    ).bind(`%"dispute_id":"${disputeId}"%`).first();
    if (existingAudit) {
        console.log(`Webhook: dispute ${disputeId} already recorded — skipping (idempotent)`);
        return;
    }

    const bookingRow = paymentIntent
        ? await db.prepare(
            `SELECT * FROM bookings WHERE stripe_payment_intent = ?`
        ).bind(paymentIntent).first()
        : null;

    const now = Date.now();
    const meta = {
        dispute_id: disputeId,
        amount_cents: dispute.amount || 0,
        reason: dispute.reason || null,
        status: dispute.status || null,
        currency: dispute.currency || 'usd',
        evidence_due_by: dispute.evidence_details?.due_by || null,
        charge_id: dispute.charge || null,
        payment_intent: paymentIntent,
    };

    if (!bookingRow) {
        console.error(`Webhook: dispute ${disputeId} arrived without a matching booking (payment_intent=${paymentIntent})`);
        // Still record an audit row so the operator sees the event even
        // when we can't link to a booking — keeps the dispute log complete.
        // Direct INSERT matches the existing `booking.paid` pattern below;
        // raw-db handlers don't have env available for the M2 writeAudit helper.
        await db.prepare(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
             VALUES (NULL, 'dispute.received', 'unknown', ?, ?, ?)`
        ).bind(disputeId, JSON.stringify(meta), now).run();
        return;
    }

    // Linked dispute — audit + queue admin email.
    await db.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (NULL, 'dispute.received', 'booking', ?, ?, ?)`
    ).bind(bookingRow.id, JSON.stringify(meta), now).run();

    console.log(`Booking ${bookingRow.id}: dispute ${disputeId} recorded (reason=${dispute.reason}, amount=${dispute.amount}c)`);

    return {
        emailContext: { booking: bookingRow, event: null, dispute },
    };
}

async function sendDisputeEmail(env, { booking, event, dispute }) {
    try {
        const r = await sendDisputeAlert(env, { booking, event, dispute });
        console.log('Dispute email sent:', JSON.stringify(r));
        return r;
    } catch (err) {
        console.error('sendDisputeAlert failed:', err.message);
        return { error: err.message };
    }
}

// M7 B8 — Resend bounce/complaint handler. Mirrors handleDisputeCreated:
// idempotent (by svix message id), orphan-safe (records even when no customer
// matches), and writes an audit_log row so events surface in the admin audit
// log + Batch 6 FTS search. On a hard bounce or any complaint that matches a
// known active customer, suppresses marketing email (NEVER transactional, so
// booking confirmations keep sending). On a hard bounce or complaint it returns
// an emailContext; the /resend route then queues an admin alert via waitUntil
// (M7 B10 — sendResendAlert). Soft bounces + the idempotent-skip path return
// nothing, so no alert fires.
//
// Idempotency: Svix redelivers the same message on our 5xx or a manual resend.
// We short-circuit if an email_events row already carries this svix-id (the
// UNIQUE partial index on svix_message_id is the backstop under a race).
async function handleResendEmailEvent(db, event, svixId) {
    if (svixId) {
        const existing = await db.prepare(
            `SELECT id FROM email_events WHERE svix_message_id = ? LIMIT 1`
        ).bind(svixId).first();
        if (existing) {
            console.log(`Resend webhook: event ${svixId} already recorded — skipping (idempotent)`);
            return;
        }
    }

    const { type, bounceType, recipient, resendEmailId } = classifyResendEvent(event);
    const normalized = recipient ? normalizeEmail(recipient) : null;

    // Resolve the active customer row by normalized email, if any.
    const customer = normalized
        ? await db.prepare(
            `SELECT id, email_marketing FROM customers
             WHERE email_normalized = ? AND archived_at IS NULL
             LIMIT 1`
        ).bind(normalized).first()
        : null;

    const suppress = !!customer && shouldSuppressMarketing({ type, bounceType });
    const now = Date.now();

    // recipient_email is NOT NULL. Resend always includes a recipient, but a
    // malformed payload must not 500 the INSERT (that would make Resend retry
    // forever) — coerce to a sentinel so the junk event still records + 200s.
    const recipientEmail = recipient || '(unknown)';

    await db.prepare(
        `INSERT INTO email_events (
            id, type, bounce_type, recipient_email, recipient_normalized,
            customer_id, resend_email_id, svix_message_id, suppressed_marketing,
            payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        emailEventId(),
        type,
        bounceType,
        recipientEmail,
        normalized,
        customer?.id || null,
        resendEmailId,
        svixId || null,
        suppress ? 1 : 0,
        JSON.stringify(event.data || {}),
        now,
    ).run();

    if (suppress) {
        // Only flip when currently on — keeps the UPDATE idempotent + cheap.
        await db.prepare(
            `UPDATE customers SET email_marketing = 0, updated_at = ?
             WHERE id = ? AND email_marketing = 1`
        ).bind(now, customer.id).run();
    }

    // Audit row — raw INSERT matches the dispute handler (raw-db handlers don't
    // have env for the M2 writeAudit helper). 6-col shape (no ip_address).
    const meta = {
        recipient,
        bounce_type: bounceType,
        resend_email_id: resendEmailId,
        svix_message_id: svixId || null,
        suppressed_marketing: suppress,
    };
    await db.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (NULL, ?, ?, ?, ?, ?)`
    ).bind(
        eventActionName(type),
        customer ? 'customer' : 'unknown',
        customer?.id || recipient || 'unknown',
        JSON.stringify(meta),
        now,
    ).run();

    console.log(`Resend webhook: ${type}${bounceType ? ` (${bounceType})` : ''} for ${recipient} — customer=${customer?.id || 'none'} suppressed=${suppress}`);

    // M7 B10 — alert on actionable events (hard bounce / complaint), regardless
    // of customer match (an orphan dead address is still worth knowing about).
    // Reuses shouldSuppressMarketing as the actionable predicate; it's NOT
    // customer-gated, unlike `suppress` above.
    if (shouldSuppressMarketing({ type, bounceType })) {
        return {
            emailContext: {
                type,
                bounceType,
                recipient,
                resendEmailId,
                customerId: customer?.id || null,
                suppressed: suppress,
            },
        };
    }
}

// M7 B10 — admin-alert dispatcher for the Resend consumer. Mirrors
// sendDisputeEmail. Self-alert guard: if the bounced/complained recipient IS our
// own ADMIN_NOTIFY_EMAIL, skip — otherwise an admin alert that itself bounces
// would loop back through this handler.
async function sendResendAlert(env, ctx) {
    try {
        const adminNorm = normalizeEmail(env.ADMIN_NOTIFY_EMAIL || '');
        const recipNorm = ctx.recipient ? normalizeEmail(ctx.recipient) : null;
        if (adminNorm && recipNorm && adminNorm === recipNorm) {
            console.log('Resend alert: recipient is ADMIN_NOTIFY_EMAIL — skipping self-alert');
            return { skipped: 'self_alert' };
        }
        const r = ctx.type === 'complaint'
            ? await sendComplaintAlert(env, { emailEvent: ctx })
            : await sendBounceAlert(env, { emailEvent: ctx });
        console.log('Resend alert sent:', JSON.stringify(r));
        return r;
    } catch (err) {
        console.error('sendResendAlert failed:', err.message);
        return { error: err.message };
    }
}

async function sendBookingEmails(env, { booking, event, attendees }) {
    const out = { confirmation: null, admin: null, waivers: [] };
    try {
        out.confirmation = await sendBookingConfirmation(env, { booking, event, attendees });
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
        // Phase C: don't send a waiver-request email to attendees who were
        // auto-linked to an existing valid waiver at booking time. They have
        // nothing to sign — emailing them a "sign your waiver" link would
        // either confuse them or land them on the friendly "already on file"
        // page anyway.
        if (attendee.waiver_id || attendee.waiverId) {
            out.waivers.push({ attendee_id: attendee.id, skipped: 'already_on_file' });
            continue;
        }
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

    // M3 B6: resolve customer_id from buyer email/name. Post-B6
    // bookings.customer_id is NOT NULL, so findOrCreateCustomerForBooking
    // returning null would cascade into a constraint violation on the
    // UPDATE bookings below. In practice this can't happen via the public
    // checkout (Stripe validates email format upstream) or admin manual
    // (the manual handler now rejects malformed email at the API boundary).
    // If it ever does, the UPDATE fails, the webhook returns 500, and
    // Stripe retries — letting the operator notice via Stripe's
    // delivery-failure dashboard. Better to fail loudly than silently
    // corrupt state.
    const resolvedCustomerId = await findOrCreateCustomerForBooking(db, {
        email: bookingRow.email,
        name: bookingRow.full_name,
        phone: bookingRow.phone,
        actorUserId: null,
    });
    if (!resolvedCustomerId) {
        console.error(`Webhook: booking ${bookingRow.id} has malformed email '${bookingRow.email}'; dual-write will fail NOT NULL constraint`);
    }

    // Flip booking to paid (now also sets customer_id from dual-write resolution)
    await db.prepare(
        `UPDATE bookings SET
            status = 'paid',
            paid_at = ?,
            stripe_payment_intent = ?,
            customer_id = ?
         WHERE id = ?`
    ).bind(now, session.payment_intent || null, resolvedCustomerId, bookingRow.id).run();

    // Insert attendee rows. Phase C annual-renewal: for each new attendee,
    // check for an existing non-expired waiver matching by (email, full name).
    // If found, link it directly so the player skips the waiver step entirely.
    let autoLinkedCount = 0;
    for (const a of pendingAttendees) {
        const newAttendeeId = attendeeId();
        const firstName = a.firstName?.trim() || '';
        const lastName = a.lastName?.trim() || null;
        const email = a.email?.trim() || null;

        const linkedWaiverId = await findExistingValidWaiver(db, email, firstName, lastName, now);

        await db.prepare(
            `INSERT INTO attendees (
                id, booking_id, ticket_type_id,
                first_name, last_name, email, phone,
                qr_token, created_at, custom_answers_json, waiver_id, customer_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            newAttendeeId,
            bookingRow.id,
            a.ticketTypeId,
            firstName,
            lastName,
            email,
            a.phone?.trim() || null,
            qrToken(),
            now,
            a.customAnswers && Object.keys(a.customAnswers).length ? JSON.stringify(a.customAnswers) : null,
            linkedWaiverId,
            resolvedCustomerId,
        ).run();

        if (linkedWaiverId) {
            autoLinkedCount++;
            await db.prepare(
                `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
                 VALUES (NULL, 'waiver.auto_linked', 'attendee', ?, ?, ?)`
            ).bind(
                newAttendeeId,
                JSON.stringify({ waiver_id: linkedWaiverId, booking_id: bookingRow.id }),
                now,
            ).run();
        }
    }
    if (autoLinkedCount > 0) {
        console.log(`Booking ${bookingRow.id}: ${autoLinkedCount}/${pendingAttendees.length} attendees auto-linked to existing valid waivers (annual-renewal Claim Period).`);
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

    // M3 B6: refresh denormalized aggregates (LTV, totals,
    // first/last_booking_at). resolvedCustomerId is non-null in the
    // happy path; the malformed-email log above warns if not.
    await recomputeCustomerDenormalizedFields(db, resolvedCustomerId);

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
            // attendees here include the auto-linked waiver_id where present,
            // so sendBookingConfirmation can compute the per-booking summary.
            attendees: attendeeRows.results || [],
        },
    };
}

export default webhooks;

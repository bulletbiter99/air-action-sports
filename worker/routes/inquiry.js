// M5.5 Batch 11 — public inquiry pipeline.
//
// POST /api/inquiry — the /contact form submission target (replaces the
// SPA's placeholder alert()). Behavior branches on `subject`:
//
//   private-hire / corporate → "field-rental lead":
//     1. Lookup OR create a customer row keyed by normalized email.
//     2. Insert a field_rentals row with status='lead', the message as
//        notes, NULL schedule, NULL site (operator triages later).
//     3. Write inquiry.submitted + field_rental.lead_created audit rows.
//     4. Send inquiry_notification email with [Field Rental Inquiry] prefix.
//
//   anything else (general / booking / feedback / other):
//     1. Write inquiry.submitted audit row.
//     2. Send inquiry_notification email with [General Inquiry] prefix.
//     No D1 customer/lead writes.
//
// All paths:
//   - Honeypot ('website' field) → silent 200 OK (don't tip off the bot).
//   - Rate-limited via RL_FEEDBACK (existing public-form binding).
//   - 200 OK on success; 400 on validation; 429 on rate limit.
//   - On email send failure: STILL returns 200 (don't fail the public
//     submission because the operator notification hiccupped); writes
//     inquiry.email_failed audit so ops can investigate.
//
// Customer-create logic is inlined here (per B11 plan-mode decision #1)
// rather than calling worker/lib/customers.js findOrCreateCustomerForBooking
// — that's a gated path and its audit_log meta source is 'dual_write'
// (booking-specific). We want source='inquiry' for the audit trail.

import { Hono } from 'hono';
import { writeAudit } from '../lib/auditLog.js';
import { rateLimit, clientIp } from '../lib/rateLimit.js';
import { sendEmail } from '../lib/email.js';
import { loadTemplate, renderTemplate } from '../lib/templates.js';
import { customerId as newCustomerId, fieldRentalId as newFieldRentalId } from '../lib/ids.js';

const inquiry = new Hono();

const FIELD_RENTAL_SUBJECTS = new Set(['private-hire', 'corporate']);
const VALID_SUBJECTS = new Set([
    'general', 'booking', 'private-hire', 'corporate', 'feedback', 'other',
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LEN = 200;
const MAX_EMAIL_LEN = 254;
const MAX_PHONE_LEN = 50;
const MAX_MESSAGE_LEN = 5000;

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function normalizeEmail(email) {
    if (typeof email !== 'string') return null;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !EMAIL_RE.test(trimmed)) return null;
    return trimmed;
}

function senderFrom(env) {
    return env.FROM_EMAIL || 'Air Action Sports <noreply@airactionsport.com>';
}

function formatNow(now) {
    return new Date(now).toLocaleString('en-US', {
        timeZone: 'America/Denver',
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
    });
}

// Lookup-or-create a customer keyed by normalized email. Returns the
// customer id (string). Writes a customer.created audit with
// source='inquiry' when a new row is inserted.
async function lookupOrCreateCustomer(env, { name, email, phone, normalizedEmail, ip, now }) {
    const existing = await env.DB.prepare(
        `SELECT id FROM customers WHERE email_normalized = ? AND archived_at IS NULL`,
    ).bind(normalizedEmail).first();
    if (existing?.id) return existing.id;

    const id = newCustomerId();
    await env.DB.prepare(
        `INSERT INTO customers (
            id, email, email_normalized, name, phone,
            total_bookings, total_attendees, lifetime_value_cents, refund_count,
            first_booking_at, last_booking_at,
            email_transactional, email_marketing, sms_transactional, sms_marketing,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, NULL, 1, 1, 0, 0, ?, ?)`,
    ).bind(id, email.trim(), normalizedEmail, name.trim(), phone || null, now, now).run();

    await writeAudit(env, {
        userId: null,
        action: 'customer.created',
        targetType: 'customer',
        targetId: id,
        meta: { source: 'inquiry', normalized_email: normalizedEmail, ip_address: ip },
    }).catch(() => {});

    return id;
}

// Create a field_rentals lead row. site_id is NULL (operator picks at
// triage), so site_field_ids is the empty string. engagement_type derived
// from subject (private-hire = private_skirmish bucket; corporate =
// corporate). status='lead'. Returns the rental id.
async function createLeadRental(env, { customerId, subject, message, now, ip }) {
    const engagementType = subject === 'corporate' ? 'corporate' : 'private_skirmish';
    const id = newFieldRentalId();

    await env.DB.prepare(
        `INSERT INTO field_rentals (
            id, customer_id, site_id, site_field_ids,
            engagement_type, lead_source,
            scheduled_starts_at, scheduled_ends_at,
            status, status_changed_at, status_change_reason,
            site_fee_cents, addon_fees_json, discount_cents, tax_cents, total_cents,
            coi_status, special_permissions_json,
            requirements_coi_received, requirements_agreement_signed,
            requirements_deposit_received, requirements_briefing_scheduled,
            requirements_walkthrough_completed,
            cancellation_deposit_retained,
            notes,
            created_by, created_at, updated_at
         ) VALUES (
            ?, ?, NULL, '',
            ?, 'inquiry_form',
            0, 0,
            'lead', ?, 'Created from /contact form submission',
            0, '[]', 0, 0, 0,
            'not_required', '{}',
            0, 0, 0, 0, 0,
            0,
            ?,
            NULL, ?, ?
         )`,
    ).bind(id, customerId, engagementType, now, message || null, now, now).run();

    await writeAudit(env, {
        userId: null,
        action: 'field_rental.lead_created',
        targetType: 'field_rental',
        targetId: id,
        meta: { customer_id: customerId, subject, source: 'inquiry_form', ip_address: ip },
    }).catch(() => {});

    return id;
}

// Send the operator notification. Always called regardless of subject
// — subject prefix differs. On failure (template missing, Resend error)
// we log an audit row but DO NOT propagate the error; the public
// submission still returns 200 OK.
async function sendInquiryNotification(env, { name, email, phone, subject, message, customerId, rentalId, now, isFieldRentalLead }) {
    const adminEmail = env.ADMIN_NOTIFY_EMAIL;
    if (!adminEmail) return { skipped: 'no_admin_email' };

    const template = await loadTemplate(env.DB, 'inquiry_notification');
    if (!template) return { skipped: 'template_missing' };

    const subjectPrefix = isFieldRentalLead
        ? '[Field Rental Inquiry]'
        : '[General Inquiry]';
    const detailUrl = rentalId
        ? `${env.SITE_URL || ''}/admin/field-rentals/${rentalId}`
        : '';

    const vars = {
        subject_prefix: subjectPrefix,
        name,
        email,
        phone: phone || 'not provided',
        subject,
        message,
        customer_id: customerId || '—',
        rental_id: rentalId || '—',
        detail_url: detailUrl,
        submitted_at: formatNow(now),
    };
    const rendered = renderTemplate(template, vars);

    try {
        return await sendEmail({
            apiKey: env.RESEND_API_KEY,
            from: senderFrom(env),
            to: adminEmail,
            replyTo: email, // operator can reply directly to the submitter
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            tags: [
                { name: 'type', value: 'inquiry_notification' },
                { name: 'is_field_rental_lead', value: String(isFieldRentalLead) },
            ],
        });
    } catch (err) {
        return { skipped: 'send_failed', error: String(err?.message || err) };
    }
}

// ────────────────────────────────────────────────────────────────────
// POST /api/inquiry — the route
// ────────────────────────────────────────────────────────────────────

inquiry.post('/', rateLimit('RL_FEEDBACK'), async (c) => {
    let body;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: 'Invalid JSON' }, 400);
    }
    if (!body || typeof body !== 'object') {
        return c.json({ error: 'Invalid body' }, 400);
    }

    // Honeypot: if the hidden `website` field is filled, a bot tripped it.
    // Return 200 OK so the bot doesn't learn it was blocked.
    if (typeof body.website === 'string' && body.website.trim().length > 0) {
        return c.json({ ok: true });
    }

    // Validation
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : '';
    const subjectRaw = typeof body.subject === 'string' ? body.subject.trim() : '';

    if (!name) return c.json({ error: 'Name is required' }, 400);
    if (name.length > MAX_NAME_LEN) return c.json({ error: 'Name too long' }, 400);
    if (!email) return c.json({ error: 'Email is required' }, 400);
    if (email.length > MAX_EMAIL_LEN) return c.json({ error: 'Email too long' }, 400);
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return c.json({ error: 'Please enter a valid email' }, 400);
    if (phoneRaw.length > MAX_PHONE_LEN) return c.json({ error: 'Phone too long' }, 400);
    if (!message) return c.json({ error: 'Message is required' }, 400);
    if (message.length > MAX_MESSAGE_LEN) return c.json({ error: 'Message too long' }, 400);

    // Subject — accept any of the known values; '' or unknown → 'general'
    const subject = VALID_SUBJECTS.has(subjectRaw) ? subjectRaw : 'general';
    const isFieldRentalLead = FIELD_RENTAL_SUBJECTS.has(subject);

    const now = Date.now();
    const ip = clientIp(c) || null;

    // ────────────────────────────────────────────────────────────────
    // Branch: field-rental lead path
    // ────────────────────────────────────────────────────────────────
    let customerId = null;
    let rentalId = null;
    if (isFieldRentalLead) {
        try {
            customerId = await lookupOrCreateCustomer(c.env, {
                name, email, phone: phoneRaw || null,
                normalizedEmail, ip, now,
            });
        } catch (err) {
            await writeAudit(c.env, {
                userId: null,
                action: 'inquiry.customer_create_failed',
                targetType: 'inquiry',
                targetId: null,
                meta: { email: normalizedEmail, error: String(err?.message || err), ip_address: ip },
            }).catch(() => {});
            return c.json({ error: 'Server error processing your inquiry. Please email us directly.' }, 500);
        }

        try {
            rentalId = await createLeadRental(c.env, {
                customerId, subject, message, now, ip,
            });
        } catch (err) {
            // Customer was created/looked-up; lead INSERT failed. Audit but
            // still return success — the operator notification email below
            // will still go out, and they can manually create the lead.
            await writeAudit(c.env, {
                userId: null,
                action: 'inquiry.lead_create_failed',
                targetType: 'inquiry',
                targetId: customerId,
                meta: { error: String(err?.message || err), ip_address: ip },
            }).catch(() => {});
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Audit the submission (always)
    // ────────────────────────────────────────────────────────────────
    await writeAudit(c.env, {
        userId: null,
        action: 'inquiry.submitted',
        targetType: rentalId ? 'field_rental' : 'inquiry',
        targetId: rentalId || customerId || null,
        meta: {
            name, email: normalizedEmail, phone: phoneRaw || null,
            subject, customer_id: customerId, rental_id: rentalId,
            is_field_rental_lead: isFieldRentalLead,
            ip_address: ip,
        },
    }).catch(() => {});

    // ────────────────────────────────────────────────────────────────
    // Operator notification email (best-effort)
    // ────────────────────────────────────────────────────────────────
    const sendResult = await sendInquiryNotification(c.env, {
        name, email, phone: phoneRaw, subject, message,
        customerId, rentalId, now, isFieldRentalLead,
    });
    if (sendResult?.skipped) {
        await writeAudit(c.env, {
            userId: null,
            action: 'inquiry.email_failed',
            targetType: rentalId ? 'field_rental' : 'inquiry',
            targetId: rentalId || customerId || null,
            meta: { reason: sendResult.skipped, error: sendResult.error || null, ip_address: ip },
        }).catch(() => {});
    }

    return c.json({ ok: true });
});

export default inquiry;

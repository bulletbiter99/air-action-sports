// Business-logic-aware email senders. One function per template.
// All receive (env, context) — use env for secrets/config.

import { sendEmail } from './email.js';
import { loadTemplate, renderTemplate } from './templates.js';

function money(cents) {
    return (cents / 100).toFixed(2);
}

function senderFrom(env) {
    return env.FROM_EMAIL || 'Air Action Sports <noreply@airactionsport.com>';
}

export async function sendBookingConfirmation(env, { booking, event, attendees = [] }) {
    const template = await loadTemplate(env.DB, 'booking_confirmation');
    if (!template) return { skipped: 'template_missing' };

    // Phase C: surface a waiver-status summary so the buyer knows whether
    // they (or some attendees) need to sign or are already covered.
    const totalAttendees = attendees.length;
    const signedCount = attendees.filter((a) => a.waiver_id || a.waiverId).length;
    let waiverSummary = '';
    if (totalAttendees > 0) {
        if (signedCount === totalAttendees) {
            waiverSummary = `All ${totalAttendees} ${totalAttendees === 1 ? 'player' : 'players'} already have a valid waiver on file — you're cleared for game day, nothing to sign.`;
        } else if (signedCount > 0) {
            waiverSummary = `${signedCount} of ${totalAttendees} players already have a valid waiver on file. The remaining ${totalAttendees - signedCount} ${totalAttendees - signedCount === 1 ? 'player needs' : 'players need'} to sign before game day.`;
        } else {
            waiverSummary = `Every player needs to sign a waiver before gameplay.`;
        }
    } else {
        // Fallback when attendees aren't passed (older callers).
        waiverSummary = `Every player needs to sign a waiver before gameplay.`;
    }

    const vars = {
        player_name: booking.full_name || booking.fullName,
        event_name: event.title,
        event_date: event.display_date || event.displayDate,
        event_location: event.location,
        player_count: booking.player_count ?? booking.playerCount,
        total_paid: money(booking.total_cents ?? booking.totalCents),
        booking_id: booking.id,
        waiver_link: `${env.SITE_URL}/booking/success?token=${booking.id}`,
        waiver_summary: waiverSummary,
    };
    const rendered = renderTemplate(template, vars);

    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: senderFrom(env),
        to: booking.email,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: 'booking_confirmation' },
            { name: 'booking_id', value: booking.id },
        ],
    });
}

export async function sendAdminNotify(env, { booking, event }) {
    const adminEmail = env.ADMIN_NOTIFY_EMAIL;
    if (!adminEmail) return { skipped: 'no_admin_email' };

    const template = await loadTemplate(env.DB, 'admin_notify');
    if (!template) return { skipped: 'template_missing' };

    const vars = {
        event_name: event.title,
        player_name: booking.full_name || booking.fullName,
        player_email: booking.email,
        player_phone: booking.phone,
        player_count: booking.player_count ?? booking.playerCount,
        total_paid: money(booking.total_cents ?? booking.totalCents),
        booking_id: booking.id,
        admin_link: `${env.SITE_URL}/admin/bookings/${booking.id}`,
    };
    const rendered = renderTemplate(template, vars);

    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: senderFrom(env),
        to: adminEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: 'admin_notify' },
            { name: 'booking_id', value: booking.id },
        ],
    });
}

export async function sendUserInvite(env, { toEmail, inviterName, role, acceptLink }) {
    const template = await loadTemplate(env.DB, 'user_invite');
    if (!template) return { skipped: 'template_missing' };
    const vars = { inviter_name: inviterName || 'Your admin', role, accept_link: acceptLink };
    const rendered = renderTemplate(template, vars);
    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: senderFrom(env),
        to: toEmail,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [{ name: 'type', value: 'user_invite' }],
    });
}

export async function sendPasswordReset(env, { user, resetLink }) {
    const template = await loadTemplate(env.DB, 'password_reset');
    if (!template) return { skipped: 'template_missing' };
    const vars = {
        display_name: user.display_name || user.displayName || 'there',
        reset_link: resetLink,
    };
    const rendered = renderTemplate(template, vars);
    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: senderFrom(env),
        to: user.email,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [{ name: 'type', value: 'password_reset' }],
    });
}

async function sendReminder(env, { booking, event, templateSlug }) {
    const template = await loadTemplate(env.DB, templateSlug);
    if (!template) return { skipped: 'template_missing' };

    const vars = {
        player_name: booking.full_name || booking.fullName,
        event_name: event.title,
        event_date: event.display_date || event.displayDate,
        event_location: event.location,
        check_in: event.check_in || event.checkIn || 'See event page',
        first_game: event.first_game || event.firstGame || 'See event page',
        waiver_link: `${env.SITE_URL}/booking/success?token=${booking.id}`,
        booking_id: booking.id,
    };
    const rendered = renderTemplate(template, vars);

    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: senderFrom(env),
        to: booking.email,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: templateSlug },
            { name: 'booking_id', value: booking.id },
        ],
    });
}

export function sendEventReminder(env, args) {
    return sendReminder(env, { ...args, templateSlug: 'event_reminder_24h' });
}

export function sendEventReminder1hr(env, args) {
    return sendReminder(env, { ...args, templateSlug: 'event_reminder_1hr' });
}

// M4 B3a — out-of-band refund customer notification. D06 mandates
// always-send (no opt-out checkbox); D07 specifies the seeded template
// `refund_recorded_external` (migration 0027). Operator records the
// refund in /admin/bookings/:id; this sender confirms it to the customer.
//
// `method` is one of cash | venmo | paypal | comp | waived. The template's
// `method_label` variable receives a human-friendly rendering ("Cash",
// "Venmo", etc.). `reference` is the operator-entered identifier (Venmo
// txn id, check #, "n/a" for comp/waived).
export async function sendRefundRecordedExternal(env, { booking, event, refundCents, method, reference }) {
    if (!booking?.email) return { skipped: 'no_buyer_email' };

    const template = await loadTemplate(env.DB, 'refund_recorded_external');
    if (!template) return { skipped: 'template_missing' };

    const methodLabels = {
        cash: 'Cash',
        venmo: 'Venmo',
        paypal: 'PayPal',
        comp: 'Comped (no charge)',
        waived: 'Fee waived',
    };

    const vars = {
        player_name: booking.full_name || booking.fullName,
        event_name: event.title,
        event_date: event.display_date || event.displayDate,
        amount_refunded: money(refundCents ?? booking.total_cents ?? booking.totalCents),
        method_label: methodLabels[method] || method,
        reference: reference || 'n/a',
        support_email: env.REPLY_TO_EMAIL || 'support@airactionsport.com',
    };
    const rendered = renderTemplate(template, vars);

    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: senderFrom(env),
        to: booking.email,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: 'refund_recorded_external' },
            { name: 'booking_id', value: booking.id },
            { name: 'method', value: method },
        ],
    });
}

export async function sendWaiverRequest(env, { attendee, event }) {
    if (!attendee.email) return { skipped: 'no_attendee_email' };

    const template = await loadTemplate(env.DB, 'waiver_request');
    if (!template) return { skipped: 'template_missing' };

    const firstName = attendee.first_name || attendee.firstName || '';
    const lastName = attendee.last_name || attendee.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim() || 'Player';

    const vars = {
        player_name: fullName,
        event_name: event.title,
        event_date: event.display_date || event.displayDate,
        waiver_link: `${env.SITE_URL}/waiver?token=${attendee.qr_token || attendee.qrToken}`,
    };
    const rendered = renderTemplate(template, vars);

    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: senderFrom(env),
        to: attendee.email,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: 'waiver_request' },
            { name: 'attendee_id', value: attendee.id },
        ],
    });
}

const FEEDBACK_TYPE_LABEL = {
    bug: 'Bug report',
    feature: 'Feature request',
    usability: 'Usability issue',
    other: 'Feedback',
};

const FEEDBACK_STATUS_LABEL = {
    new: 'New',
    triaged: 'Triaged',
    'in-progress': 'In progress',
    resolved: 'Resolved',
    'wont-fix': "Won't fix",
    duplicate: 'Duplicate',
};

export async function sendFeedbackNotification(env, { feedback }) {
    const adminEmail = env.ADMIN_NOTIFY_EMAIL;
    if (!adminEmail) return { skipped: 'no_admin_email' };

    const template = await loadTemplate(env.DB, 'admin_feedback_received');
    if (!template) return { skipped: 'template_missing' };

    const vars = {
        type_label: FEEDBACK_TYPE_LABEL[feedback.type] || 'Feedback',
        title: feedback.title,
        from_display: feedback.email ? feedback.email : 'Anonymous',
        page_url: feedback.page_url || '—',
        description: feedback.description,
        user_agent: feedback.user_agent || '—',
        viewport: feedback.viewport || '—',
        admin_url: `${env.SITE_URL}/admin/feedback`,
    };
    const rendered = renderTemplate(template, vars);

    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: senderFrom(env),
        to: adminEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: 'admin_feedback_received' },
            { name: 'feedback_id', value: feedback.id },
        ],
    });
}

// Render-only — used by the preview-before-send modal in /admin/feedback.
// Returns { subject, html, text } or { skipped: '...' } on missing data.
export async function renderFeedbackResolutionNotice(env, { feedback }) {
    if (!feedback.email) return { skipped: 'no_submitter_email' };

    const template = await loadTemplate(env.DB, 'feedback_resolution_notice');
    if (!template) return { skipped: 'template_missing' };

    const vars = {
        title: feedback.title,
        status_label: FEEDBACK_STATUS_LABEL[feedback.status] || feedback.status,
        note: feedback.adminNote || feedback.admin_note || '(no additional note)',
        site_url: env.SITE_URL || '',
    };
    return { rendered: renderTemplate(template, vars) };
}

export async function sendFeedbackResolutionNotice(env, { feedback }) {
    if (!feedback.email) return { skipped: 'no_submitter_email' };

    const previewResult = await renderFeedbackResolutionNotice(env, { feedback });
    if (previewResult.skipped) return previewResult;
    const rendered = previewResult.rendered;

    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: senderFrom(env),
        to: feedback.email,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: 'feedback_resolution_notice' },
            { name: 'feedback_id', value: feedback.id },
        ],
    });
}

// M5.5 Batch 10b — COI expiration alert (staff-facing). Sent by the
// nightly runCoiExpirationSweep cron when a rental's coi_expires_at
// falls into the 60d / 30d / 7d bucket and the corresponding sentinel
// (coi_alert_60d_sent_at etc.) is still NULL. Sentinels prevent
// re-sending per milestone.
//
// `bucket` ∈ {60, 30, 7}; selects the matching template slug.
// `recipient` is the resolved AAS-staff email (site coordinator or
// env.ADMIN_NOTIFY_EMAIL fallback).
export async function sendCoiAlert(env, { rental, bucket, recipient, customerName, siteName, daysUntilExpiry }) {
    if (!recipient) return { skipped: 'no_recipient_email' };
    const slug = bucket === 60 ? 'coi_alert_60d'
        : bucket === 30 ? 'coi_alert_30d'
        : bucket === 7 ? 'coi_alert_7d'
        : null;
    if (!slug) return { skipped: 'unknown_bucket' };
    const template = await loadTemplate(env.DB, slug);
    if (!template) return { skipped: 'template_missing' };

    const startsDate = Number.isFinite(Number(rental.scheduled_starts_at))
        ? new Date(Number(rental.scheduled_starts_at)).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/Denver' })
        : '—';
    const expiresDate = Number.isFinite(Number(rental.coi_expires_at))
        ? new Date(Number(rental.coi_expires_at)).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/Denver' })
        : '—';

    const vars = {
        rental_id: rental.id,
        customer_name: customerName || 'unknown',
        scheduled_starts_at: startsDate,
        site_name: siteName || 'site',
        coi_expires_on: expiresDate,
        days_until_expiry: daysUntilExpiry,
        detail_url: `${env.SITE_URL || ''}/admin/field-rentals/${rental.id}`,
    };
    const rendered = renderTemplate(template, vars);
    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: senderFrom(env),
        to: recipient,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: slug },
            { name: 'rental_id', value: rental.id },
        ],
    });
}

// M5.5 Batch 10b — Lead-stale alert (staff-facing). Sent by the
// nightly runLeadStaleSweep cron when a rental sits in lead/draft for
// 14+ days without movement; re-fires every 7 days while stuck.
// `recipient` resolution mirrors sendCoiAlert.
export async function sendLeadStaleAlert(env, { rental, recipient, customerName, daysSinceLastUpdate }) {
    if (!recipient) return { skipped: 'no_recipient_email' };
    const template = await loadTemplate(env.DB, 'field_rental_lead_stale');
    if (!template) return { skipped: 'template_missing' };

    const vars = {
        rental_id: rental.id,
        customer_name: customerName || 'unknown',
        status: rental.status || 'lead',
        days_since_last_update: daysSinceLastUpdate,
        detail_url: `${env.SITE_URL || ''}/admin/field-rentals/${rental.id}`,
    };
    const rendered = renderTemplate(template, vars);
    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: senderFrom(env),
        to: recipient,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: 'field_rental_lead_stale' },
            { name: 'rental_id', value: rental.id },
        ],
    });
}

// M5 Batch 6 — staff portal invite email (Surface 4a part 4).
// Variables: personName, inviterName, magicLink, expiresAt
export async function sendStaffPortalInvite(env, { person, inviterName, magicLink, expiresAt }) {
    if (!person?.email) return { skipped: 'no_recipient_email' };
    const template = await loadTemplate(env.DB, 'staff_portal_invite');
    if (!template) return { skipped: 'template_missing' };
    const vars = {
        personName: person.full_name || person.email || 'there',
        inviterName: inviterName || 'Your AAS admin',
        magicLink,
        expiresAt: expiresAt instanceof Date ? expiresAt.toUTCString() : String(expiresAt),
    };
    const rendered = renderTemplate(template, vars);
    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: senderFrom(env),
        to: person.email,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: 'staff_portal_invite' },
            { name: 'person_id', value: person.id },
        ],
    });
}

// Post-M5.5 — single-use promo code emailed to a specific recipient via the
// admin batch-create flow. Used by worker/routes/admin/promoCodes.js
// POST /batch when sendEmails=true.
export async function sendPromoCodeIssued(env, {
    toEmail, recipientName, code, discountDisplay, expiresAtMs, eventName,
}) {
    if (!toEmail) return { skipped: 'no_recipient_email' };
    const template = await loadTemplate(env.DB, 'promo_code_issued');
    if (!template) return { skipped: 'template_missing' };

    const expiresStr = Number.isFinite(Number(expiresAtMs))
        ? new Date(Number(expiresAtMs)).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Denver' })
        : 'no expiration';

    const vars = {
        code,
        discount_display: discountDisplay,
        expires_at: expiresStr,
        event_name: eventName || 'any event',
        site_url: env.SITE_URL || 'https://airactionsport.com',
        recipient_name: recipientName || 'there',
    };
    const rendered = renderTemplate(template, vars);
    return sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: senderFrom(env),
        to: toEmail,
        replyTo: env.REPLY_TO_EMAIL,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
            { name: 'type', value: 'promo_code_issued' },
            { name: 'code', value: code },
        ],
    });
}

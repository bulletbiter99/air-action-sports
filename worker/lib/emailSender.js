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

export async function sendBookingConfirmation(env, { booking, event }) {
    const template = await loadTemplate(env.DB, 'booking_confirmation');
    if (!template) return { skipped: 'template_missing' };

    const vars = {
        player_name: booking.full_name || booking.fullName,
        event_name: event.title,
        event_date: event.display_date || event.displayDate,
        event_location: event.location,
        player_count: booking.player_count ?? booking.playerCount,
        total_paid: money(booking.total_cents ?? booking.totalCents),
        booking_id: booking.id,
        waiver_link: `${env.SITE_URL}/booking/success?token=${booking.id}`,
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

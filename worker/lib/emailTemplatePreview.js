// M6 B4 — admin "preview with real data" helper.
//
// The admin route's existing /preview endpoint renders templates with
// sampleVars() (hardcoded "Jane Player", "Operation Nightfall", etc.).
// This module lets the admin route also render against a real DB entity
// — e.g. preview booking_confirmation as it would look for a specific
// booking row.
//
// Architecture:
//   TEMPLATE_SPECS — map slug → { kind, queryParam, buildVars }
//   getSpecForSlug — null when slug isn't supported (caller falls through
//                    to sample-vars path)
//   fetchEntityForPreview — resolves the entity bundle (booking + event +
//                            attendees) from the supplied ID
//   buildVarsFromEntity — projects the entity bundle to the var shape the
//                          template's renderer expects
//
// Why a separate helper (vs reusing emailSender's senders)?
//   The named senders in worker/lib/emailSender.js are Critical DNT. They
//   build vars + send in one go. Extracting just the var-building from
//   them would require touching DNT code. Instead, this helper mirrors
//   the small bit of var-construction logic. Tests pin the output shape
//   so divergence from the senders is caught.
//
// Initial coverage (B4 v1):
//   - booking_confirmation
//   - admin_notify
//   - event_reminder_24h
//   - event_reminder_1hr
// All four take a booking ID; the helper does the JOIN to events +
// attendees once and dispatches to the per-template var builder.
//
// Templates NOT covered (sample-vars path still works for these):
//   waiver_request, password_reset, user_invite, refund_recorded_external,
//   coi_alert_*, field_rental_lead_stale, staff_portal_invite,
//   promo_code_issued, admin_feedback_received, feedback_resolution_notice,
//   inquiry_notification, waiver_confirmation, review_invite.
// Adding any one is ~10 lines of spec + builder + test — track as a
// B4-followup if operator wants broader coverage.

function money(cents) {
    if (cents == null) return '0.00';
    return (Number(cents) / 100).toFixed(2);
}

function siteUrl(env) {
    return env?.SITE_URL || 'https://airactionsport.com';
}

// Per-slug spec. `kind` controls the entity-fetch dispatch in
// fetchEntityForPreview. `queryParam` is the URL query-string key the
// admin UI passes. `buildVars` mirrors the corresponding sender.
export const TEMPLATE_SPECS = Object.freeze({
    booking_confirmation: {
        kind: 'booking',
        queryParam: 'bookingId',
        buildVars: bookingConfirmationVars,
    },
    admin_notify: {
        kind: 'booking',
        queryParam: 'bookingId',
        buildVars: adminNotifyVars,
    },
    event_reminder_24h: {
        kind: 'booking',
        queryParam: 'bookingId',
        buildVars: reminderVars,
    },
    event_reminder_1hr: {
        kind: 'booking',
        queryParam: 'bookingId',
        buildVars: reminderVars,
    },
});

export function getSpecForSlug(slug) {
    return TEMPLATE_SPECS[slug] || null;
}

// Returns the canonical list of supported slugs in stable order. Used by
// the admin UI to decide whether to render the "preview with real data"
// section for a given template.
export function supportedSlugs() {
    return Object.keys(TEMPLATE_SPECS);
}

// Fetches the entity bundle for a slug + ID pair. Returns either
// { entity: {...} } on success or { error: '<reason>' } on failure.
// Caller handles the error → admin route maps it to a 400/404 response.
//
// Error reasons:
//   - 'unknown_template_slug'  — slug not in TEMPLATE_SPECS
//   - 'missing_entity_id'      — caller didn't pass an ID
//   - 'booking_not_found'      — ID didn't match any booking row
//   - 'event_not_found'        — booking exists but its event_id is dangling
export async function fetchEntityForPreview(env, slug, idValue) {
    const spec = getSpecForSlug(slug);
    if (!spec) return { error: 'unknown_template_slug' };
    if (!idValue || typeof idValue !== 'string' || !idValue.trim()) {
        return { error: 'missing_entity_id' };
    }
    const id = idValue.trim();

    if (spec.kind === 'booking') {
        const booking = await env.DB
            .prepare(`SELECT * FROM bookings WHERE id = ?`).bind(id).first();
        if (!booking) return { error: 'booking_not_found' };

        const event = await env.DB
            .prepare(`SELECT * FROM events WHERE id = ?`).bind(booking.event_id).first();
        if (!event) return { error: 'event_not_found' };

        const attendeesRes = await env.DB
            .prepare(`SELECT * FROM attendees WHERE booking_id = ?`).bind(id).all();
        const attendees = attendeesRes?.results || [];

        return { entity: { booking, event, attendees } };
    }

    return { error: 'unknown_entity_kind' };
}

// Projects the entity bundle to the var shape the template renderer
// expects. Returns the same var keys the corresponding sender would
// build. Pure — no I/O, just object construction.
export function buildVarsFromEntity(slug, entity, env) {
    const spec = getSpecForSlug(slug);
    if (!spec || !entity) return {};
    return spec.buildVars(entity, env);
}

// ─── Per-template var builders — mirror the senders byte-for-byte ───

function bookingConfirmationVars({ booking, event, attendees }, env) {
    const totalAttendees = (attendees || []).length;
    const signedCount = (attendees || []).filter((a) => a.waiver_id || a.waiverId).length;

    let waiverSummary;
    if (totalAttendees > 0) {
        if (signedCount === totalAttendees) {
            waiverSummary = totalAttendees === 1
                ? `Your player's waiver is already on file — you're cleared for game day, nothing to sign.`
                : `All ${totalAttendees} players already have a valid waiver on file — you're cleared for game day, nothing to sign.`;
        } else if (signedCount > 0) {
            waiverSummary = `${signedCount} of ${totalAttendees} players already have a valid waiver on file. The remaining ${totalAttendees - signedCount} ${totalAttendees - signedCount === 1 ? 'player needs' : 'players need'} to sign before game day.`;
        } else {
            waiverSummary = `Every player needs to sign a waiver before gameplay.`;
        }
    } else {
        waiverSummary = `Every player needs to sign a waiver before gameplay.`;
    }

    return {
        player_name: booking.full_name,
        event_name: event.title,
        event_date: event.display_date,
        event_location: event.location,
        player_count: booking.player_count,
        total_paid: money(booking.total_cents),
        booking_id: booking.id,
        waiver_link: `${siteUrl(env)}/booking/success?token=${booking.id}`,
        waiver_summary: waiverSummary,
    };
}

function adminNotifyVars({ booking, event }, env) {
    return {
        event_name: event.title,
        player_name: booking.full_name,
        player_email: booking.email,
        player_phone: booking.phone,
        player_count: booking.player_count,
        total_paid: money(booking.total_cents),
        booking_id: booking.id,
        admin_link: `${siteUrl(env)}/admin/bookings/${booking.id}`,
    };
}

function reminderVars({ booking, event }, env) {
    return {
        player_name: booking.full_name,
        event_name: event.title,
        event_date: event.display_date,
        event_location: event.location,
        check_in: event.check_in || 'See event page',
        first_game: event.first_game || 'See event page',
        waiver_link: `${siteUrl(env)}/booking/success?token=${booking.id}`,
        booking_id: booking.id,
    };
}

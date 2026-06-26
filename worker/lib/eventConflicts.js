// M5.5 Batch 3 — Event / blackout / field-rental conflict detection.
//
// Returns time-window conflicts on the same site_id. Half-open
// interval semantics: a record ending at time T does NOT conflict
// with a record starting at time T.
//
// AAS events are treated as whole-day windows from their `date_iso`
// (00:00 UTC start to 24:00 UTC end of that day). This matches the
// operational reality that an AAS event occupies its site for the
// full day — see B3 plan-mode decision 2026-05-11.
//
// site_blackouts is stored with epoch-ms `starts_at`/`ends_at` columns.
// field_rentals (B4) uses `scheduled_starts_at`/`scheduled_ends_at`; we
// alias them to `starts_at`/`ends_at` in the SELECT so the response
// shape stays consistent across all three conflict categories and the
// AdminEvents conflict-banner frontend keeps working unchanged.
//
// Cancelled or archived rentals don't conflict (operator-confirmed
// B7a). They're excluded at the SQL level.
//
// The try/catch around the field_rentals query is preserved for
// defensive resilience — if the table is ever missing or the schema
// drifts, the lib degrades to "no rental conflicts" rather than
// blowing up the event-create / event-edit flow.
//
// Used by:
// - worker/routes/admin/events.js (POST + PUT; B3 wires this)
// - worker/routes/admin/sites.js (B6.5 — blackout create flow)
// - worker/routes/admin/fieldRentals.js (B7a — rental create / reschedule)

/**
 * Convert an event's date span into [startMs, endMs) of whole UTC days.
 *
 * Single-day (the common case): pass only `dateIso` → [day 00:00Z, +24h).
 * Multi-day: pass `endDateIso` (the last day) → the window runs through the
 * END of that last day, i.e. [start day 00:00Z, (last day + 1) 00:00Z).
 *
 * Both args accept "YYYY-MM-DD" or "YYYY-MM-DDTHH:..." (truncated to the date
 * part). A missing / malformed / earlier-than-start `endDateIso` falls back to
 * a single day, so existing single-arg callers are unchanged. Returns null for
 * an invalid start.
 *
 * Exported for tests.
 */
export function dateIsoToDayWindow(dateIso, endDateIso = null) {
    if (!dateIso || typeof dateIso !== 'string') return null;
    // Accept "YYYY-MM-DD" or "YYYY-MM-DDTHH:..."
    const datePart = dateIso.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
    const startMs = Date.parse(`${datePart}T00:00:00Z`);
    if (!Number.isFinite(startMs)) return null;
    // Determine the last day of the span. Default to the start day (single-day).
    let lastDayPart = datePart;
    if (endDateIso && typeof endDateIso === 'string') {
        const ep = endDateIso.slice(0, 10);
        // Only honor a well-formed end day that is on/after the start day.
        if (/^\d{4}-\d{2}-\d{2}$/.test(ep) && ep >= datePart) lastDayPart = ep;
    }
    const lastDayStartMs = Date.parse(`${lastDayPart}T00:00:00Z`);
    const endMs = lastDayStartMs + 24 * 60 * 60 * 1000;
    return { startMs, endMs };
}

/**
 * Half-open interval overlap test: [aStart, aEnd) vs [bStart, bEnd).
 * Adjacent windows (a.end === b.start) do NOT overlap.
 *
 * Exported for tests.
 */
export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && aEnd > bStart;
}

/**
 * Detect time-window conflicts on the same site.
 *
 * @param {object} env Worker env with `env.DB` (D1 binding)
 * @param {object} options
 * @param {string} options.siteId Required. Returns empty conflicts if null/undefined.
 * @param {number} options.startsAt Required. Epoch ms.
 * @param {number} options.endsAt Required. Epoch ms. Must be > startsAt.
 * @param {string} [options.excludeEventId] Exclude this event from event conflicts (edit flow).
 * @param {string} [options.excludeFieldRentalId] Exclude this rental from field-rental conflicts (rental reschedule flow).
 * @param {string[]} [options.fieldIds] Reserved for future per-field scoping; currently unused.
 * @returns {Promise<{ events: object[], blackouts: object[], fieldRentals: object[] }>}
 */
export async function detectEventConflicts(env, options) {
    const opts = options || {};
    const { siteId, startsAt, endsAt, excludeEventId, excludeFieldRentalId } = opts;

    // Defensive: missing site_id or invalid window means no conflict possible
    if (!siteId || !Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
        return { events: [], blackouts: [], fieldRentals: [] };
    }
    if (endsAt <= startsAt) {
        return { events: [], blackouts: [], fieldRentals: [] };
    }

    // Events occupy whole-day windows from date_iso through the end of
    // end_date_iso (single day when end_date_iso is NULL). We pre-filter in SQL
    // by a day-overlap on the DATE PORTIONS, then verify the precise ms overlap
    // in JS (handles the inclusive-end edge case correctly).
    const startDateIso = new Date(startsAt).toISOString().slice(0, 10);
    // For endsAt, take one millisecond earlier so endsAt at midnight
    // (e.g., 2026-06-16T00:00:00Z) doesn't include 2026-06-16 in the
    // search range — only the day before. This is the request window's
    // inclusive last day. Half-open semantics.
    const endDateIsoExclusive = new Date(endsAt - 1).toISOString().slice(0, 10);

    // Day-overlap pre-filter: a candidate overlaps when it STARTS on/before the
    // request's last day AND ENDS (end_date_iso, or date_iso when single-day)
    // on/after the request's first day. Comparing the substr(...,1,10) date
    // portion (not the raw timestamp) means a time component in date_iso never
    // wrongly excludes a same-day event, and a multi-day event is caught on any
    // day it spans — not just its start day.
    const eventsRows = excludeEventId
        ? (await env.DB.prepare(
              `SELECT id, title, date_iso, end_date_iso, location FROM events
               WHERE site_id = ?
                 AND substr(date_iso, 1, 10) <= ?
                 AND substr(COALESCE(end_date_iso, date_iso), 1, 10) >= ?
                 AND id != ?`,
          )
              .bind(siteId, endDateIsoExclusive, startDateIso, excludeEventId)
              .all()).results || []
        : (await env.DB.prepare(
              `SELECT id, title, date_iso, end_date_iso, location FROM events
               WHERE site_id = ?
                 AND substr(date_iso, 1, 10) <= ?
                 AND substr(COALESCE(end_date_iso, date_iso), 1, 10) >= ?`,
          )
              .bind(siteId, endDateIsoExclusive, startDateIso)
              .all()).results || [];

    // Verify each candidate event's actual day-span window overlaps the request.
    const events = [];
    for (const row of eventsRows) {
        const dayWindow = dateIsoToDayWindow(row.date_iso, row.end_date_iso);
        if (!dayWindow) continue; // skip events with malformed date_iso
        if (intervalsOverlap(dayWindow.startMs, dayWindow.endMs, startsAt, endsAt)) {
            events.push(row);
        }
    }

    // Blackouts: epoch-ms columns, direct overlap query.
    const blackoutsRes = await env.DB.prepare(
        `SELECT id, reason, starts_at, ends_at FROM site_blackouts
         WHERE site_id = ? AND starts_at < ? AND ends_at > ?`,
    )
        .bind(siteId, endsAt, startsAt)
        .all();
    const blackouts = blackoutsRes.results || [];

    // Field rentals: aliased SELECT preserves the {starts_at, ends_at}
    // response shape consumed by AdminEvents.jsx's conflict banner.
    // Cancelled and archived rentals are excluded. excludeFieldRentalId
    // supports the rental-edit/reschedule flow (don't flag self as a
    // conflict). The defensive try/catch is preserved in case the table
    // is ever absent (e.g. local dev without migrations applied).
    let fieldRentals = [];
    try {
        const frRes = excludeFieldRentalId
            ? await env.DB.prepare(
                  `SELECT id, customer_id, scheduled_starts_at AS starts_at, scheduled_ends_at AS ends_at FROM field_rentals
                   WHERE site_id = ? AND scheduled_starts_at < ? AND scheduled_ends_at > ?
                     AND cancelled_at IS NULL AND archived_at IS NULL
                     AND id != ?`,
              )
                  .bind(siteId, endsAt, startsAt, excludeFieldRentalId)
                  .all()
            : await env.DB.prepare(
                  `SELECT id, customer_id, scheduled_starts_at AS starts_at, scheduled_ends_at AS ends_at FROM field_rentals
                   WHERE site_id = ? AND scheduled_starts_at < ? AND scheduled_ends_at > ?
                     AND cancelled_at IS NULL AND archived_at IS NULL`,
              )
                  .bind(siteId, endsAt, startsAt)
                  .all();
        fieldRentals = frRes.results || [];
    } catch (_err) {
        // field_rentals table missing or query failure — degrade to no rentals.
        fieldRentals = [];
    }

    return { events, blackouts, fieldRentals };
}

/**
 * Convenience: returns true if any conflicts exist across all three categories.
 */
export function hasAnyConflict(result) {
    if (!result) return false;
    return (
        (result.events?.length || 0) > 0 ||
        (result.blackouts?.length || 0) > 0 ||
        (result.fieldRentals?.length || 0) > 0
    );
}

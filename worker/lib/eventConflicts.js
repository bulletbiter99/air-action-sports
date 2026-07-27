// M5.5 Batch 3 — Event / blackout / field-rental conflict detection.
//
// Returns time-window conflicts on the same site_id. Half-open
// interval semantics: a record ending at time T does NOT conflict
// with a record starting at time T.
//
// AAS events are treated as whole-day windows from their `date_iso`
// (00:00 to 24:00 DENVER local on that day). This matches the operational
// reality that an AAS event occupies its site for the full day — see B3
// plan-mode decision 2026-05-11.
//
// That day used to be pinned to UTC midnight, which was 6h (MDT) / 7h (MST)
// early relative to the real Mountain day. The subtlety that hid it: for
// event-vs-EVENT both sides ran through this same function, so both shifted
// identically and the comparison stayed correct — it is pure calendar-date-span
// overlap. But site_blackouts.starts_at/ends_at and
// field_rentals.scheduled_starts_at/scheduled_ends_at hold GENUINE epoch-ms
// instants (both write paths do `new Date(<datetime-local>).getTime()`, which
// the browser parses as local time), so those comparisons mixed a shifted window
// against a true instant. Net effect: a rental 6-11 PM Mountain on an event day
// landed in the NEXT UTC day, fell outside the event's window, and was never even
// nominated as a conflict candidate — a silent field double-booking, no 409, no
// banner. The evening BEFORE was symmetrically flagged as a false conflict.
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

import { eventInstantMs, toDenverWallClock } from './eventTime.js';

// Pure calendar arithmetic: 'YYYY-MM-DD' → the next day's 'YYYY-MM-DD'.
function nextDayPart(part) {
    const [y, m, d] = part.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Convert an event's date span into [startMs, endMs) of whole DENVER days.
 *
 * Single-day (the common case): pass only `dateIso` → [day 00:00 Denver, next
 * day 00:00 Denver). Multi-day: pass `endDateIso` (the last day) → the window
 * runs through the END of that last day.
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
    const startMs = eventInstantMs(`${datePart}T00:00:00`);
    if (!Number.isFinite(startMs)) return null;
    // Determine the last day of the span. Default to the start day (single-day).
    let lastDayPart = datePart;
    if (endDateIso && typeof endDateIso === 'string') {
        const ep = endDateIso.slice(0, 10);
        // Only honor a well-formed end day that is on/after the start day.
        // Also require it to be a REAL date — a well-formed but nonexistent end
        // (e.g. '2026-02-30') would otherwise poison the window instead of
        // falling back to single-day.
        if (/^\d{4}-\d{2}-\d{2}$/.test(ep) && ep >= datePart
            && eventInstantMs(`${ep}T00:00:00`) != null) lastDayPart = ep;
    }
    // Next calendar day, then resolve THAT to a Denver instant. Not
    // `lastDayStart + 24h`: a DST day is 23 or 25 hours long, so adding a fixed
    // 24h would land an hour inside or short of the following day.
    // (UTC arithmetic on a date-only value is exact — there is no DST in UTC.)
    const endMs = eventInstantMs(`${nextDayPart(lastDayPart)}T00:00:00`);
    if (!Number.isFinite(endMs)) return null;
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
    // DENVER calendar dates, not UTC. The right-hand side of the SQL comparison
    // is substr(date_iso, 1, 10) — a Denver date — so deriving these from
    // toISOString() mixed calendars and dropped candidates before the JS
    // verification below ever saw them. That is the exact mechanism by which an
    // evening rental escaped conflict detection entirely.
    const startDateIso = toDenverWallClock(startsAt).slice(0, 10);
    // For endsAt, take one millisecond earlier so endsAt at midnight
    // (e.g., 2026-06-16T00:00:00Z) doesn't include 2026-06-16 in the
    // search range — only the day before. This is the request window's
    // inclusive last day. Half-open semantics.
    const endDateIsoExclusive = toDenverWallClock(endsAt - 1).slice(0, 10);

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

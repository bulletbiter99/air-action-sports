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
// site_blackouts + field_rentals are stored with epoch-ms start/end
// columns so the comparison is direct.
//
// field_rentals doesn't exist until B4 — this lib is defensive
// (try/catch on the field_rentals query). After B4 lands the
// field_rentals table, the same lib starts returning real rentals
// without code change.
//
// Used by:
// - worker/routes/admin/events.js (POST + PUT; B3 wires this)
// - worker/routes/admin/sites.js (B6.5 — blackout create flow)
// - worker/routes/admin/fieldRentals.js (B7 — rental create / reschedule)

/**
 * Convert a YYYY-MM-DD date_iso string into [startMs, endMs)
 * representing the whole UTC day. Returns null for invalid input.
 *
 * Exported for tests.
 */
export function dateIsoToDayWindow(dateIso) {
    if (!dateIso || typeof dateIso !== 'string') return null;
    // Accept "YYYY-MM-DD" or "YYYY-MM-DDTHH:..."
    const datePart = dateIso.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
    const startMs = Date.parse(`${datePart}T00:00:00Z`);
    if (!Number.isFinite(startMs)) return null;
    const endMs = startMs + 24 * 60 * 60 * 1000;
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
 * @param {string[]} [options.fieldIds] Reserved for future per-field scoping; currently unused.
 * @returns {Promise<{ events: object[], blackouts: object[], fieldRentals: object[] }>}
 */
export async function detectEventConflicts(env, options) {
    const opts = options || {};
    const { siteId, startsAt, endsAt, excludeEventId } = opts;

    // Defensive: missing site_id or invalid window means no conflict possible
    if (!siteId || !Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
        return { events: [], blackouts: [], fieldRentals: [] };
    }
    if (endsAt <= startsAt) {
        return { events: [], blackouts: [], fieldRentals: [] };
    }

    // Events: use whole-day windows from date_iso. We pre-filter in SQL
    // by date_iso string range, then verify each event's actual day window
    // overlaps in JS (handles the inclusive-end edge case correctly).
    const startDateIso = new Date(startsAt).toISOString().slice(0, 10);
    // For endsAt, take one millisecond earlier so endsAt at midnight
    // (e.g., 2026-06-16T00:00:00Z) doesn't include 2026-06-16 in the
    // search range — only the day before. Half-open semantics.
    const endDateIsoExclusive = new Date(endsAt - 1).toISOString().slice(0, 10);

    const eventsRows = excludeEventId
        ? (await env.DB.prepare(
              `SELECT id, title, date_iso, location FROM events
               WHERE site_id = ? AND date_iso >= ? AND date_iso <= ? AND id != ?`,
          )
              .bind(siteId, startDateIso, endDateIsoExclusive, excludeEventId)
              .all()).results || []
        : (await env.DB.prepare(
              `SELECT id, title, date_iso, location FROM events
               WHERE site_id = ? AND date_iso >= ? AND date_iso <= ?`,
          )
              .bind(siteId, startDateIso, endDateIsoExclusive)
              .all()).results || [];

    // Verify each candidate event's day window actually overlaps the request window.
    const events = [];
    for (const row of eventsRows) {
        const dayWindow = dateIsoToDayWindow(row.date_iso);
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

    // Field rentals: defensive try-catch (table doesn't exist until B4).
    let fieldRentals = [];
    try {
        const frRes = await env.DB.prepare(
            `SELECT id, customer_id, starts_at, ends_at FROM field_rentals
             WHERE site_id = ? AND starts_at < ? AND ends_at > ?`,
        )
            .bind(siteId, endsAt, startsAt)
            .all();
        fieldRentals = frRes.results || [];
    } catch (_err) {
        // field_rentals table doesn't exist yet (pre-B4). Treat as no rentals.
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

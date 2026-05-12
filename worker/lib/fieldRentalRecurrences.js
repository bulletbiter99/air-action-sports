// M5.5 Batch 10a — recurrence-generation nightly cron + pure date helpers.
//
// Generates child field_rentals rows from active field_rental_recurrences out
// to a fixed 90-day horizon. Idempotent: re-runs skip occurrences whose
// (recurrence_id, recurrence_instance_index) row already exists. Each
// generated rental:
//   - inherits the parent's site_id / customer_id / engagement_type / site
//     fee / site_field_ids and a snapshot of template_pricing_notes
//   - is created in status='draft' (operator-confirmed B10a plan-mode #5)
//   - runs through worker/lib/eventConflicts.detectEventConflicts; if any
//     conflict exists, the row is still created but a
//     field_rental.recurrence_generated_with_conflict audit row is written
//     so ops can review (plan-mode #6)
//
// Frequency support per plan-mode decision #2 (Option B):
//   - weekly: bitmask `weekday_mask` (1=Sun, 2=Mon, 4=Tue, 8=Wed, 16=Thu,
//     32=Fri, 64=Sat) — combines multiple weekdays.
//   - monthly: monthly_pattern JSON `{kind:'nth_weekday', n: 1-5, weekday: 0-6}`
//     where weekday 0=Sun ... 6=Sat. "5th weekday of month" is supported but
//     yields no occurrence in months that don't have 5 of that weekday.
//   - custom: custom_dates_json JSON array of literal YYYY-MM-DD strings.
//   - monthly_pattern.kind='day_of_month' is DEFERRED (Option A).
//
// Timezone (plan-mode #3): both sites are in Utah (Mountain Time / IANA
// America/Denver). The helper denverOffsetMinutes(YYYY-MM-DD) returns -360
// (DST, MDT) or -420 (Standard, MST) by computing the 2nd-Sunday-of-March
// and 1st-Sunday-of-November transition dates inline. No external tz lib.
//
// Cron wires into the 03:00 UTC dispatch in worker/index.js alongside the
// existing 4 sweeps (customer-tags, cert-expiration, event-staffing-reminder,
// event-staffing-auto-decline, tax-year-auto-lock).
//
// Used by:
//   - worker/index.js scheduled() handler (B10a)
//
// Tests:
//   - tests/unit/lib/fieldRentalRecurrences.test.js (pure helpers)
//   - tests/unit/cron/recurrence-generation-sweep.test.js (I/O)

import { fieldRentalId as newFieldRentalId } from './ids.js';
import { writeAudit } from './auditLog.js';
import { detectEventConflicts, hasAnyConflict } from './eventConflicts.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HORIZON_DAYS = 90;

// ────────────────────────────────────────────────────────────────────
// Date arithmetic helpers (all UTC-based; no Date.parse with tz quirks)
// ────────────────────────────────────────────────────────────────────

/**
 * Convert epoch ms to YYYY-MM-DD (UTC). Used for the date-window bounds.
 */
export function isoDate(ms) {
    if (ms == null) return null;
    if (!Number.isFinite(Number(ms))) return null;
    return new Date(Number(ms)).toISOString().slice(0, 10);
}

/**
 * YYYY-MM-DD + N days (positive or negative). Pure date math; no DST.
 */
export function addDays(yyyymmdd, deltaDays) {
    const parts = String(yyyymmdd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parts) return null;
    const utcMs = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    const shifted = new Date(utcMs + deltaDays * DAY_MS);
    return shifted.toISOString().slice(0, 10);
}

/**
 * 0=Sunday, 6=Saturday for a YYYY-MM-DD (interpreted as UTC date).
 */
export function weekdayOf(yyyymmdd) {
    const parts = String(yyyymmdd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parts) return null;
    const utcMs = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    return new Date(utcMs).getUTCDay();
}

// ────────────────────────────────────────────────────────────────────
// America/Denver timezone (Mountain Time) — DST-aware offset
// ────────────────────────────────────────────────────────────────────

/**
 * Returns the UTC offset in minutes for a given YYYY-MM-DD in America/Denver:
 *   - -420 during Standard Time (MST, Nov→Mar)
 *   - -360 during Daylight Saving Time (MDT, Mar→Nov)
 *
 * US DST rules (in effect since 2007):
 *   - Starts on the 2nd Sunday of March at 02:00 local time
 *   - Ends on the 1st Sunday of November at 02:00 local time
 *
 * For dates exactly on the transition day, the simplification is:
 *   - 2nd Sunday of March onward → DST (-360)
 *   - 1st Sunday of November onward → Standard (-420)
 * The exact 02:00-local transition hour is glossed over because the cron
 * only schedules rentals at template_starts_local times that are post-noon
 * in practice — never within the ambiguous spring-forward gap.
 */
export function denverOffsetMinutes(yyyymmdd) {
    const parts = String(yyyymmdd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parts) return null;
    const year = Number(parts[1]);
    const dstStart = nthWeekdayOfMonth(year, 3, 2, 0); // 2nd Sunday of March
    const dstEnd = nthWeekdayOfMonth(year, 11, 1, 0);  // 1st Sunday of November
    if (yyyymmdd >= dstStart && yyyymmdd < dstEnd) return -360;
    return -420;
}

/**
 * Compute the Nth occurrence of `targetWeekday` (0=Sun, 6=Sat) in a given
 * month. Returns YYYY-MM-DD or null if `n` exceeds the month's count of
 * that weekday (e.g. "5th Tuesday" in a month with only 4 Tuesdays).
 *
 * @param {number} year
 * @param {number} month - 1-12
 * @param {number} n - 1-5
 * @param {number} targetWeekday - 0=Sun, 6=Sat
 */
export function nthWeekdayOfMonth(year, month, n, targetWeekday) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
    if (!Number.isInteger(n) || n < 1 || n > 5) return null;
    if (!Number.isInteger(targetWeekday) || targetWeekday < 0 || targetWeekday > 6) return null;

    // Walk the month finding occurrences of targetWeekday
    let count = 0;
    for (let day = 1; day <= 31; day++) {
        const utc = Date.UTC(year, month - 1, day);
        // Catch month rollover (e.g. day=31 in February)
        const d = new Date(utc);
        if (d.getUTCMonth() !== month - 1) break;
        if (d.getUTCDay() === targetWeekday) {
            count++;
            if (count === n) {
                return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            }
        }
    }
    return null; // n exceeded
}

/**
 * Combine YYYY-MM-DD + HH:MM (local) + tzOffsetMinutes → epoch ms.
 * tzOffsetMinutes uses the convention: minutes EAST of UTC (negative for
 * Americas; -360 for MDT, -420 for MST).
 *
 * E.g. combineDateAndLocal('2026-06-15', '14:00', -360):
 *   local time 14:00 in MDT = 20:00 UTC = Date.UTC(2026, 5, 15, 20, 0) ms.
 */
export function combineDateAndLocal(yyyymmdd, hhmm, tzOffsetMinutes) {
    const dateMatch = String(yyyymmdd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const timeMatch = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!dateMatch || !timeMatch) return null;
    if (tzOffsetMinutes == null || !Number.isFinite(Number(tzOffsetMinutes))) return null;
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]) - 1;
    const day = Number(dateMatch[3]);
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    // Local time → UTC: subtract the offset (which is negative for Americas).
    // For MDT -360 (i.e. local is 6h behind UTC), local 14:00 → UTC 20:00,
    // which is what we get by computing Date.UTC(...) and adding -offset minutes.
    const utcMs = Date.UTC(year, month, day, hours, minutes);
    return utcMs - Number(tzOffsetMinutes) * 60 * 1000;
}

// ────────────────────────────────────────────────────────────────────
// Frequency-specific occurrence enumerators
// ────────────────────────────────────────────────────────────────────

const WEEKDAY_MASK_BITS = [1, 2, 4, 8, 16, 32, 64]; // 0=Sun → bit 1

/**
 * Decompose a weekday bitmask into an array of weekday indices (0=Sun..6=Sat).
 */
export function parseWeekdayMask(mask) {
    const n = Number(mask);
    if (!Number.isInteger(n) || n <= 0 || n > 127) return [];
    return WEEKDAY_MASK_BITS.flatMap((bit, idx) => (n & bit) ? [idx] : []);
}

/**
 * Parse + validate monthly_pattern JSON. Supports only kind='nth_weekday' in
 * B10a (operator-confirmed plan-mode #2 / Option B). Returns the parsed
 * object on success or null on invalid/unsupported input.
 */
export function parseMonthlyPattern(jsonOrObj) {
    let obj = jsonOrObj;
    if (typeof obj === 'string') {
        try { obj = JSON.parse(obj); } catch { return null; }
    }
    if (!obj || typeof obj !== 'object') return null;
    if (obj.kind !== 'nth_weekday') return null;
    const n = Number(obj.n);
    const weekday = Number(obj.weekday);
    if (!Number.isInteger(n) || n < 1 || n > 5) return null;
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
    return { kind: 'nth_weekday', n, weekday };
}

/**
 * Parse custom_dates_json into an array of valid YYYY-MM-DD strings.
 * Filters out malformed entries and duplicates; returns sorted ascending.
 */
export function parseCustomDates(jsonOrArray) {
    let arr = jsonOrArray;
    if (typeof arr === 'string') {
        try { arr = JSON.parse(arr); } catch { return []; }
    }
    if (!Array.isArray(arr)) return [];
    const out = new Set();
    for (const item of arr) {
        if (typeof item !== 'string') continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(item)) continue;
        out.add(item);
    }
    return [...out].sort();
}

/**
 * Enumerate weekly occurrence dates from fromDate (inclusive) through
 * throughDate (inclusive) that match any weekday in `weekdayIndices`.
 */
export function enumerateWeeklyDates(fromDate, throughDate, weekdayIndices) {
    if (!fromDate || !throughDate) return [];
    if (!Array.isArray(weekdayIndices) || weekdayIndices.length === 0) return [];
    const set = new Set(weekdayIndices);
    const out = [];
    let cur = fromDate;
    // Safety cap so a malformed window doesn't loop forever
    let i = 0;
    while (cur <= throughDate && i < 1000) {
        const wd = weekdayOf(cur);
        if (wd != null && set.has(wd)) out.push(cur);
        cur = addDays(cur, 1);
        i++;
    }
    return out;
}

/**
 * Enumerate monthly nth-weekday occurrences from fromDate (inclusive)
 * through throughDate (inclusive). E.g. n=2 weekday=2 → 2nd Tuesday of each
 * month in the window. Months where the Nth weekday doesn't exist yield
 * nothing for that month.
 */
export function enumerateMonthlyNthWeekdayDates(fromDate, throughDate, n, weekday) {
    if (!fromDate || !throughDate) return [];
    const out = [];
    const startMatch = fromDate.match(/^(\d{4})-(\d{2})-/);
    const endMatch = throughDate.match(/^(\d{4})-(\d{2})-/);
    if (!startMatch || !endMatch) return [];
    let year = Number(startMatch[1]);
    let month = Number(startMatch[2]);
    const endYear = Number(endMatch[1]);
    const endMonth = Number(endMatch[2]);
    let safety = 0;
    while ((year < endYear || (year === endYear && month <= endMonth)) && safety < 240) {
        const date = nthWeekdayOfMonth(year, month, n, weekday);
        if (date && date >= fromDate && date <= throughDate) {
            out.push(date);
        }
        month++;
        if (month > 12) { month = 1; year++; }
        safety++;
    }
    return out;
}

/**
 * Dispatch: given a parent recurrence row + a [fromDate, throughDate]
 * window, return the list of YYYY-MM-DD strings the cron should
 * (idempotently) materialize as child rentals.
 *
 * Defensive: invalid / unsupported patterns yield [].
 *
 * Window-clipped to the parent's own ends_on if set.
 */
export function computeNextOccurrences(recurrence, fromDate, throughDate) {
    if (!recurrence || !fromDate || !throughDate) return [];
    if (fromDate > throughDate) return [];

    // Respect the recurrence's own ends_on
    const seriesEnd = recurrence.ends_on && recurrence.ends_on < throughDate
        ? recurrence.ends_on
        : throughDate;
    if (fromDate > seriesEnd) return [];

    // Clamp to series starts_on
    const seriesStart = recurrence.starts_on > fromDate ? recurrence.starts_on : fromDate;
    if (seriesStart > seriesEnd) return [];

    switch (recurrence.frequency) {
        case 'weekly': {
            const weekdays = parseWeekdayMask(recurrence.weekday_mask);
            return enumerateWeeklyDates(seriesStart, seriesEnd, weekdays);
        }
        case 'monthly': {
            const parsed = parseMonthlyPattern(recurrence.monthly_pattern);
            if (!parsed) return [];
            return enumerateMonthlyNthWeekdayDates(seriesStart, seriesEnd, parsed.n, parsed.weekday);
        }
        case 'custom': {
            const dates = parseCustomDates(recurrence.custom_dates_json);
            return dates.filter((d) => d >= seriesStart && d <= seriesEnd);
        }
        default:
            return [];
    }
}

// ────────────────────────────────────────────────────────────────────
// I/O wrapper — the nightly cron
// ────────────────────────────────────────────────────────────────────

/**
 * Sweep active field_rental_recurrences and generate child field_rentals
 * rows out to the 90-day horizon. See file header for the full contract.
 *
 * @param {object} env - Worker env with env.DB (D1)
 * @returns {Promise<{
 *   seriesProcessed: number,
 *   generatedCount: number,
 *   seriesDeactivated: number,
 *   conflictCount: number,
 *   durationMs: number,
 * }>}
 */
export async function runRecurrenceGenerationSweep(env) {
    const t0 = Date.now();
    const now = t0;
    const today = isoDate(now);
    const horizon = isoDate(now + HORIZON_DAYS * DAY_MS);

    let seriesProcessed = 0;
    let generatedCount = 0;
    let seriesDeactivated = 0;
    let conflictCount = 0;

    let activeSeries;
    try {
        const res = await env.DB.prepare(
            `SELECT * FROM field_rental_recurrences
             WHERE active = 1
               AND (recurrence_generated_through IS NULL OR recurrence_generated_through < ?)`,
        ).bind(horizon).all();
        activeSeries = res.results || [];
    } catch {
        return { seriesProcessed: 0, generatedCount: 0, seriesDeactivated: 0, conflictCount: 0, durationMs: Date.now() - t0 };
    }

    for (const recurrence of activeSeries) {
        seriesProcessed++;

        // Where to start generating from this run
        const fromDate = recurrence.recurrence_generated_through
            ? addDays(recurrence.recurrence_generated_through, 1)
            : recurrence.starts_on;

        const seriesEndsOn = recurrence.ends_on && recurrence.ends_on < horizon
            ? recurrence.ends_on
            : horizon;

        if (!fromDate || fromDate > seriesEndsOn) {
            // Nothing to do but still advance the sentinel so we don't keep
            // re-scanning. Skip update if ends_on already passed.
            continue;
        }

        const candidateDates = computeNextOccurrences(recurrence, fromDate, seriesEndsOn);
        if (candidateDates.length === 0) {
            // Nothing for this run; bump the sentinel to seriesEndsOn to
            // avoid re-scanning the same empty window every night.
            await env.DB.prepare(
                `UPDATE field_rental_recurrences SET recurrence_generated_through = ?, updated_at = ?
                 WHERE id = ?`,
            ).bind(seriesEndsOn, now, recurrence.id).run().catch(() => {});
            continue;
        }

        // Look up the highest existing instance_index so we can resume numbering.
        let nextIdx = 1;
        let alreadyGenerated = 0;
        try {
            const maxRes = await env.DB.prepare(
                `SELECT MAX(recurrence_instance_index) AS max_idx, COUNT(*) AS cnt
                 FROM field_rentals WHERE recurrence_id = ?`,
            ).bind(recurrence.id).first();
            nextIdx = ((maxRes?.max_idx) || 0) + 1;
            alreadyGenerated = (maxRes?.cnt) || 0;
        } catch {
            // Defensive: continue with defaults
        }

        const maxOcc = Number.isInteger(recurrence.max_occurrences) ? recurrence.max_occurrences : null;
        let lastGeneratedDate = recurrence.recurrence_generated_through;

        for (const dateIso of candidateDates) {
            if (maxOcc != null && alreadyGenerated >= maxOcc) break;

            // Idempotency: skip if a row already exists for this (recurrence_id, idx)
            const existing = await env.DB.prepare(
                `SELECT id FROM field_rentals
                 WHERE recurrence_id = ? AND recurrence_instance_index = ?`,
            ).bind(recurrence.id, nextIdx).first().catch(() => null);
            if (existing) {
                lastGeneratedDate = dateIso;
                nextIdx++;
                alreadyGenerated++;
                continue;
            }

            const tzOff = denverOffsetMinutes(dateIso);
            const startsAt = combineDateAndLocal(dateIso, recurrence.template_starts_local, tzOff);
            const endsAt = combineDateAndLocal(dateIso, recurrence.template_ends_local, tzOff);
            if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
                // Malformed local-time template; skip this occurrence and continue
                continue;
            }

            const rentalId = newFieldRentalId();
            const siteFee = Number.isInteger(recurrence.template_site_fee_cents) ? recurrence.template_site_fee_cents : 0;

            try {
                await env.DB.prepare(
                    `INSERT INTO field_rentals (
                        id, customer_id, site_id, site_field_ids,
                        engagement_type,
                        recurrence_id, recurrence_instance_index,
                        scheduled_starts_at, scheduled_ends_at,
                        status, status_changed_at, status_change_reason,
                        site_fee_cents, total_cents,
                        schedule_notes,
                        created_by, created_at, updated_at
                     ) VALUES (
                        ?, ?, ?, ?,
                        ?,
                        ?, ?,
                        ?, ?,
                        'draft', ?, ?,
                        ?, ?,
                        ?,
                        NULL, ?, ?
                     )`,
                ).bind(
                    rentalId, recurrence.customer_id, recurrence.site_id,
                    recurrence.template_site_field_ids,
                    recurrence.template_engagement_type,
                    recurrence.id, nextIdx,
                    startsAt, endsAt,
                    now, 'Auto-generated from recurrence series',
                    siteFee, siteFee,
                    recurrence.template_pricing_notes || null,
                    now, now,
                ).run();
            } catch (err) {
                // Skip on insert failure (FK / constraint); don't break the
                // whole sweep. Log via audit so ops can investigate.
                await writeAudit(env, {
                    userId: null,
                    action: 'field_rental.recurrence_generation_failed',
                    targetType: 'field_rental_recurrence',
                    targetId: recurrence.id,
                    meta: { dateIso, instanceIndex: nextIdx, error: String(err?.message || err) },
                }).catch(() => {});
                continue;
            }

            // Audit the create with provenance
            await writeAudit(env, {
                userId: null,
                action: 'field_rental.created',
                targetType: 'field_rental',
                targetId: rentalId,
                meta: {
                    source: 'recurrence_cron',
                    recurrenceId: recurrence.id,
                    instanceIndex: nextIdx,
                    customerId: recurrence.customer_id,
                    siteId: recurrence.site_id,
                    scheduledStartsAt: startsAt,
                    scheduledEndsAt: endsAt,
                },
            }).catch(() => {});

            // Conflict check (plan-mode #6: create anyway, audit if conflict)
            try {
                const conflicts = await detectEventConflicts(env, {
                    siteId: recurrence.site_id,
                    startsAt,
                    endsAt,
                    excludeFieldRentalId: rentalId,
                });
                if (hasAnyConflict(conflicts)) {
                    conflictCount++;
                    await writeAudit(env, {
                        userId: null,
                        action: 'field_rental.recurrence_generated_with_conflict',
                        targetType: 'field_rental',
                        targetId: rentalId,
                        meta: {
                            recurrenceId: recurrence.id,
                            conflictingEventIds: (conflicts.events || []).map((x) => x.id),
                            conflictingBlackoutIds: (conflicts.blackouts || []).map((x) => x.id),
                            conflictingRentalIds: (conflicts.fieldRentals || []).map((x) => x.id),
                        },
                    }).catch(() => {});
                }
            } catch {
                // Conflict-detection failure shouldn't unwind the row create
            }

            generatedCount++;
            lastGeneratedDate = dateIso;
            nextIdx++;
            alreadyGenerated++;
        }

        // Advance the sentinel
        if (lastGeneratedDate) {
            await env.DB.prepare(
                `UPDATE field_rental_recurrences SET recurrence_generated_through = ?, updated_at = ?
                 WHERE id = ?`,
            ).bind(lastGeneratedDate, now, recurrence.id).run().catch(() => {});
        }

        // Auto-deactivate if max_occurrences hit
        if (maxOcc != null && alreadyGenerated >= maxOcc) {
            await env.DB.prepare(
                `UPDATE field_rental_recurrences SET active = 0, updated_at = ? WHERE id = ?`,
            ).bind(now, recurrence.id).run().catch(() => {});
            seriesDeactivated++;
        }
    }

    return {
        seriesProcessed,
        generatedCount,
        seriesDeactivated,
        conflictCount,
        durationMs: Date.now() - t0,
        today,
        horizon,
    };
}

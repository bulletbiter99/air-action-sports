/**
 * eventTime.js — converting `events.date_iso` into real instants.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────
 * `events.date_iso` (and `end_date_iso`) store LOCAL America/Denver wall-clock
 * with NO timezone suffix — e.g. '2026-07-25T08:30:00' means 8:30 AM Mountain.
 * The admin form produces this shape directly (`<input type="datetime-local">`
 * + a literal ':00', src/admin/AdminEvents.jsx:480-482) and nothing on the
 * write path normalizes it.
 *
 * Both SQLite's `unixepoch()` and JS `Date.parse()`-in-a-Worker read a naked
 * datetime as UTC, so every naive read lands 6h (MDT) / 7h (MST) EARLY.
 *
 * That is not hypothetical. On 2026-07-25, 18 Operation Last Light customers
 * received "T-MINUS 1 HOUR — kicks off in about an hour" at 1:20 AM, six hours
 * before the 8:30 AM start, and then nothing at the real T-1h because the
 * sentinel column had already been stamped.
 *
 * ── WHY NOT THE OBVIOUS FIXES ───────────────────────────────────────────
 * 1. `unixepoch(x, 'utc')` / `unixepoch(x, 'localtime')` — DEAD END, and the
 *    dangerous kind: it fails SILENTLY. SQLite's modifiers read the HOST
 *    process timezone, which in a Worker is UTC. Verified against production
 *    D1: the bare call, `,'utc'` and `,'localtime'` all return the identical
 *    integer, in both January and July. A reviewer skimming a diff sees a
 *    plausible `,'utc'` and assumes the bug is fixed.
 *
 * 2. A hardcoded `-06:00` — wrong for ~4 months a year (Denver is -07:00 in
 *    MST). The observed skew was 6h only because July is MDT.
 *
 * 3. `worker/lib/fieldRentalRecurrences.js` `denverOffsetMinutes()` — the
 *    existing in-repo Denver helper, and genuinely good, but its own docstring
 *    (lines 94-99) says it is DATE-granular and deliberately glosses over the
 *    02:00-local transition hour, which is safe there because rentals are
 *    scheduled post-noon. A reminder cron fires at all hours including the
 *    small hours, which is exactly where that approximation breaks. It also
 *    hardcodes the current US DST rule. Left alone; this module reuses its
 *    *shape* (offset → combine → epoch ms) but sources the offset from Intl.
 *
 * ── THE APPROACH ────────────────────────────────────────────────────────
 * Resolve the offset from `Intl.DateTimeFormat` with `timeZone:'America/Denver'`,
 * which carries the real IANA database — so it stays correct across DST
 * boundaries AND across any future change to US DST law, with no code edit.
 *
 * This adds NO new runtime dependency: Workers ship full-ICU and this Worker
 * already relies on it in shipped code (worker/routes/inquiry.js:66-70,
 * worker/lib/emailSender.js:367/370/478-482 — the last of which renders
 * `timeZoneName:'short'` as MST/MDT, which needs the full tz database). The
 * cron path already reaches emailSender, so ICU is on the Critical path today.
 *
 * ── AMBIGUOUS WALL-CLOCK TIMES ──────────────────────────────────────────
 * instant → wall clock is ALWAYS well-defined. The inverse is not:
 *   - SPRING FORWARD (2nd Sun of March, 02:00 → 03:00): 02:00-02:59 never
 *     happens. We still return a deterministic finite instant rather than null,
 *     because an event stored at a nonexistent local time must still be
 *     reminded about — silently dropping it is the worse failure.
 *   - FALL BACK (1st Sun of November, 02:00 → 01:00): 01:00-01:59 happens
 *     twice. We deterministically resolve to one of them.
 * Both are pinned by tests. Neither is reachable by a real AAS event today.
 */

const DENVER_TZ = 'America/Denver';

// Constructed once at module scope — Intl.DateTimeFormat construction is the
// expensive part; formatToParts on a cached instance is cheap enough for a
// LIMIT-100 sweep.
const DENVER_PARTS = new Intl.DateTimeFormat('en-US', {
    timeZone: DENVER_TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});

// 'YYYY-MM-DD' with an OPTIONAL time part. Both shapes are reachable:
// production rows are all 19-char timed values, but parseEventBody validates
// date_iso with a bare truthiness check, so a date-only value can be written
// through the admin API. Fractional seconds and a space separator are tolerated
// defensively.
const NAIVE_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

function partsAt(ms) {
    const out = {};
    for (const { type, value } of DENVER_PARTS.formatToParts(ms)) out[type] = value;
    return out;
}

/**
 * The UTC offset, in ms, that America/Denver was observing at a real instant.
 * Negative for the Americas (MDT = -6h, MST = -7h).
 */
function denverOffsetMsAt(ms) {
    const p = partsAt(ms);
    // Under hour12:false some ICU builds render midnight as '24' rather than
    // '00'. Without the %24 that silently shifts a midnight event by a day.
    const hour = Number(p.hour) % 24;
    const asIfUtc = Date.UTC(
        Number(p.year), Number(p.month) - 1, Number(p.day),
        hour, Number(p.minute), Number(p.second),
    );
    return asIfUtc - ms;
}

/**
 * Denver wall-clock components → true UTC epoch ms.
 *
 * Two-step convergence: the first offset lookup uses the wall clock read as if
 * it were UTC (wrong by the offset), the second uses the corrected instant.
 * That second pass is what makes times near a DST boundary resolve correctly
 * instead of landing an hour off.
 */
export function denverWallClockToUtcMs(year, month, day, hour = 0, minute = 0, second = 0) {
    const guess = Date.UTC(year, month - 1, day, hour, minute, second);
    if (!Number.isFinite(guess)) return null;
    const firstPass = denverOffsetMsAt(guess);
    const secondPass = denverOffsetMsAt(guess - firstPass);
    return guess - secondPass;
}

/**
 * `events.date_iso` / `end_date_iso` → true UTC epoch ms, or null when the
 * value is absent or not a well-formed naive ISO datetime.
 *
 * A date-only value is interpreted as MIDNIGHT Denver on that date.
 *
 * Callers MUST treat null as "cannot determine" and exclude the row. That
 * matches the pre-existing behavior: `unixepoch()` also returns NULL on an
 * unparseable value, and NULL fails a BETWEEN.
 */
export function eventInstantMs(dateIso) {
    const m = NAIVE_ISO_RE.exec(String(dateIso ?? '').trim());
    if (!m) return null;

    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = m[4] === undefined ? 0 : Number(m[4]);
    const minute = m[5] === undefined ? 0 : Number(m[5]);
    const second = m[6] === undefined ? 0 : Number(m[6]);

    // Range-check explicitly. Date.UTC SILENTLY normalizes out-of-range parts
    // ('2026-13-99' becomes 2027-04-08), which would turn a malformed row into
    // a confident wrong instant instead of a null.
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;

    // Catches the in-range-but-nonexistent dates the bounds above miss, e.g.
    // '2026-02-30' (which Date.UTC would roll into March).
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;

    return denverWallClockToUtcMs(year, month, day, hour, minute, second);
}

/**
 * A real instant → the Denver wall-clock string it corresponds to, in exactly
 * the same 'YYYY-MM-DDTHH:MM:SS' shape `events.date_iso` is stored in.
 *
 * This is what makes a SQL range filter on `date_iso` safe: comparing stored
 * wall clock against wall-clock bounds is a plain lexicographic TEXT range
 * (ISO-8601 sorts chronologically), so the query needs no timezone math at all
 * and stays sargable. See `denverWallClockWindow` for the intended use.
 */
export function toDenverWallClock(ms) {
    if (!Number.isFinite(ms)) return null;
    const p = partsAt(ms);
    const hour = String(Number(p.hour) % 24).padStart(2, '0');
    return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}`;
}

/**
 * An instant window [startMs, endMs] → the Denver wall-clock string bounds to
 * bind into `... AND e.date_iso BETWEEN ? AND ?`.
 *
 * ── WHY THIS IS EXACT ALMOST ALWAYS, AND WHY THAT MATTERS ───────────────
 * Denver wall clock advances strictly monotonically with real time EXCEPT
 * across a DST transition, where it skips an hour (spring) or repeats one
 * (fall). While the offset is constant across the window — every window, every
 * day of the year bar two — an event's instant is in [startMs, endMs] if and
 * only if its wall clock is in [lo, hi]. So the bounds are EXACT and the caller
 * fetches precisely the rows it would have fetched with correct instant math.
 *
 * That exactness is load-bearing, not a nicety. Callers apply a LIMIT to this
 * range. An unconditionally widened range prepends rows whose window has
 * already closed but whose sentinel is still NULL — reachable via the
 * roll-back-on-send-failure path, via overflow on a big event, and via an admin
 * reschedule — and those rows consume the LIMIT and are then discarded by the
 * exact JS test, yielding a silent no-op sweep that starves the rows actually
 * due. Widening a range guarded by a LIMIT is not the free safety margin it
 * looks like.
 *
 * Only when the window genuinely straddles a transition do we widen, by exactly
 * the offset delta, to cover the discontinuity. That is two windows a year.
 *
 * Still NOT a substitute for the exact test: re-check every returned row with
 * `eventStartsWithin`, which resolves the ambiguous fall-back hour consistently.
 *
 * ── KNOWN LIMITATION (deliberate) ───────────────────────────────────────
 * An event stored at a NONEXISTENT wall-clock time — 02:00-02:59 on
 * spring-forward Sunday — cannot be selected by any wall-clock range. No real
 * instant carries that wall clock, so `toDenverWallClock(eventInstantMs(x))`
 * lands an hour below `x` and the row falls outside its own window. Catching it
 * would mean widening the range on transition days, reintroducing the
 * LIMIT-starvation failure above for a case that requires an AAS event
 * scheduled at 2:30 AM on the second Sunday of March. Traded away knowingly;
 * pinned by an explicit test so it stays a visible decision, not a silent gap.
 *
 * @returns {{ lo: string, hi: string }}
 */
export function denverWallClockWindow(startMs, endMs) {
    const startOffset = denverOffsetMsAt(startMs);
    const endOffset = denverOffsetMsAt(endMs);
    const pad = startOffset === endOffset ? 0 : Math.abs(endOffset - startOffset);
    return {
        lo: toDenverWallClock(startMs - pad),
        hi: toDenverWallClock(endMs + pad),
    };
}

/**
 * Exact membership test for a candidate row's stored wall-clock value against
 * a real instant window. Inclusive on both ends, matching SQL BETWEEN.
 *
 * Returns false for an unparseable `dateIso` — see `eventInstantMs`.
 */
export function eventStartsWithin(dateIso, startMs, endMs) {
    const t = eventInstantMs(dateIso);
    if (t == null) return false;
    return t >= startMs && t <= endMs;
}

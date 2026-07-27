/**
 * eventTime.js (client mirror)
 *
 * Mirrored at worker/lib/eventTime.js — the two files are duplicated by
 * necessity: Vite bundles src/ for the SPA and cannot reach into worker/ without
 * coupling every visitor's JS bundle to a GATED file on the Critical reminder-
 * cron path. Same convention as src/utils/money.js + worker/lib/money.js. They
 * are tested together via tests/unit/utils/eventTime.test.js, which imports BOTH
 * and runs the same suite against each — that dual-target test is the anti-drift
 * mechanism. If you change one, change the other.
 *
 * This is the SUBSET the client needs: naive Denver wall clock → true instant.
 * The SQL-range helpers (denverWallClockWindow, eventStartsWithin) stay
 * worker-only.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────
 * `events.date_iso` is naive America/Denver wall clock with no offset
 * ('2026-07-25T08:30:00'). Per spec, a datetime string with NO offset parses in
 * the VIEWER's local zone — so `new Date(dateIso)` is correct only for a visitor
 * physically in Mountain time. An East Coast visitor's countdown ran 2 hours
 * fast and hit zero while the op was still two hours out; a UK visitor's, 7.
 *
 * Note the asymmetry that makes this subtle: `new Date(naive)` followed by
 * `.getMonth()` / `.getDate()` / `.toLocaleDateString()` is an exact round-trip
 * and renders correctly in every timezone, which is why most of the site's date
 * DISPLAY is fine. Only code that SUBTRACTS or compares against a real instant
 * is broken. Don't "fix" the display paths.
 */

const DENVER_PARTS = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});

const NAIVE_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

function partsAt(ms) {
    const out = {};
    for (const { type, value } of DENVER_PARTS.formatToParts(ms)) out[type] = value;
    return out;
}

function denverOffsetMsAt(ms) {
    const p = partsAt(ms);
    // hour12:false renders midnight as '24' in some ICU builds; without the %24
    // that silently shifts a midnight event by a day.
    const hour = Number(p.hour) % 24;
    const asIfUtc = Date.UTC(
        Number(p.year), Number(p.month) - 1, Number(p.day),
        hour, Number(p.minute), Number(p.second),
    );
    return asIfUtc - ms;
}

/**
 * Denver wall-clock components → true UTC epoch ms. Two-pass convergence so
 * times near a DST boundary resolve correctly instead of landing an hour off.
 */
export function denverWallClockToUtcMs(year, month, day, hour = 0, minute = 0, second = 0) {
    const guess = Date.UTC(year, month - 1, day, hour, minute, second);
    if (!Number.isFinite(guess)) return null;
    const firstPass = denverOffsetMsAt(guess);
    const secondPass = denverOffsetMsAt(guess - firstPass);
    return guess - secondPass;
}

/**
 * A naive Denver `date_iso` → true UTC epoch ms, or null when absent or
 * malformed. A date-only value means MIDNIGHT Denver.
 *
 * Returns null (rather than guessing) for anything already carrying a 'Z' or a
 * numeric offset — those are absolute instants and the caller should use them
 * directly.
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

    // Range-check explicitly: Date.UTC SILENTLY normalizes out-of-range parts
    // ('2026-13-99' → 2027-04-08), turning a malformed value into a confident
    // wrong instant instead of a null.
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;

    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;

    return denverWallClockToUtcMs(year, month, day, hour, minute, second);
}

/**
 * The Denver calendar date ('YYYY-MM-DD') for a real instant — what "today"
 * means to this business. Use instead of `new Date().toISOString().slice(0,10)`,
 * which is the UTC date and is wrong from 6 PM Mountain onward every day.
 */
export function denverDateFor(ms = Date.now()) {
    if (!Number.isFinite(ms)) return null;
    const p = partsAt(ms);
    return `${p.year}-${p.month}-${p.day}`;
}

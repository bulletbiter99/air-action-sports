// Date / time label helpers for the SPA (charts, tables, report axes).
//
// Extracted in the post-M7 11c polish from the Reports persona files, which
// each carried their own copy: OwnerReports had MONTHS/dayLabel/monthLabel,
// SiteCoordinatorReports had fmtDate. One home means the formats stay
// consistent across every report and any future caller.
//
// All helpers are pure and tolerant of missing/garbage input (return '').
//
// API:
//   monthLabel('2026-05')   → "May '26"   (YYYY-MM → "Mon 'YY")
//   dayLabel('2026-05-31')  → "5/31"      (YYYY-MM-DD → "M/D")
//   fmtDate(1748649600000)  → "2026-05-31" (epoch ms → ISO date)

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** YYYY-MM-DD (or any '-'-joined date) → "M/D". Returns '' for falsy input. */
export function dayLabel(iso) {
    if (!iso) return '';
    const p = String(iso).split('-');
    return p.length >= 3 ? `${Number(p[1])}/${Number(p[2])}` : iso;
}

/** YYYY-MM → "Mon 'YY". Returns '' for falsy input; echoes input if not parseable. */
export function monthLabel(ym) {
    if (!ym) return '';
    const p = String(ym).split('-');
    if (p.length < 2) return ym;
    return `${MONTHS[Number(p[1]) - 1] || p[1]} '${p[0].slice(2)}`;
}

/** epoch milliseconds → ISO date (YYYY-MM-DD). Returns '' for null/undefined/NaN. */
export function fmtDate(ms) {
    if (ms == null) return '';
    const d = new Date(Number(ms));
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

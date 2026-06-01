// M7 Batch 11a — shared client data layer for the Reports persona pages.
//
// Extracted from the 4 persona files (Owner/Bookkeeper/Marketing/SiteCoordinator),
// which each carried a verbatim copy of buildQuery + useReport + downloadCsv (modulo
// their _BASE). One copy here means the custom-date-range params (from/to) are wired
// in a single place. The query builder is a behavior-preserving superset:
//   - comparison serializes only when truthy (only Owner shows the toggle)
//   - event_id serializes only when not 'all' (SiteCoordinator never sets it)

import { useState, useEffect } from 'react';

/**
 * Build the report query string from the filter state. Pure.
 * @param {{ period?:string, comparison?:boolean, eventId?:string, from?:string, to?:string }} filters
 * @param {boolean} [csv] append format=csv
 * @returns {string} '' or '?key=val&…'
 */
export function buildReportQuery(filters, csv = false) {
    const f = filters || {};
    const p = new URLSearchParams();
    if (f.period) p.set('period', f.period);
    if (f.comparison) p.set('comparison', '1');
    if (f.eventId && f.eventId !== 'all') p.set('event_id', f.eventId);
    // Custom date range (Batch 11a) — only sent when both bounds are present.
    if (f.period === 'custom' && f.from && f.to) {
        p.set('from', f.from);
        p.set('to', f.to);
    }
    if (csv) p.set('format', 'csv');
    const s = p.toString();
    return s ? `?${s}` : '';
}

/**
 * Map a fetch/HTTP failure to user-facing copy. We never surface the raw
 * Error.message (e.g. "HTTP 500", "Failed to fetch") in the UI — the raw error
 * is logged to the console for debugging; this returns something a human reads.
 * Pure.
 */
export function reportErrorMessage(err) {
    const m = String(err?.message || '').match(/HTTP (\d{3})/);
    if (m) {
        const status = Number(m[1]);
        if (status === 401 || status === 403) return "You don't have permission to view this report.";
        if (status === 404) return 'This report is unavailable.';
        if (status >= 500) return 'Something went wrong loading this report. Please try again.';
        return 'This report could not be loaded.';
    }
    return "Couldn't load this report — check your connection and try again.";
}

/**
 * Fetch a report from `${base}/${path}` with the current filters. Refetches when any
 * filter input changes (period / comparison / eventId / custom from-to).
 * @returns {{ data:any, loading:boolean, error:string|null }}
 */
export function useReportData(base, path, filters) {
    const [state, setState] = useState({ data: null, loading: true, error: null });
    useEffect(() => {
        let cancelled = false;
        setState((s) => ({ ...s, loading: true, error: null }));
        fetch(`${base}/${path}${buildReportQuery(filters)}`, { credentials: 'include', cache: 'no-store' })
            .then(async (res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
            .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
            .catch((e) => {
                if (cancelled) return;
                console.error(`[reports] failed to load ${path}:`, e);
                setState({ data: null, loading: false, error: reportErrorMessage(e) });
            });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [base, path, filters.period, filters.comparison, filters.eventId, filters.from, filters.to]);
    return state;
}

/** Parse the download filename out of a Content-Disposition header. Pure; '' if absent. */
export function filenameFromDisposition(header) {
    if (!header) return '';
    // RFC 5987 extended form: filename*=UTF-8''my%20report.csv
    const star = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
    if (star) {
        try { return decodeURIComponent(star[1].replace(/"/g, '').trim()); } catch { /* fall through to plain */ }
    }
    const plain = header.match(/filename="?([^";]+)"?/i);
    return plain ? plain[1].trim() : '';
}

/**
 * Download `${base}/${path}` as CSV with the current filters. Fetches the blob (so a
 * server error surfaces as a rejection the caller can show, instead of the browser
 * navigating away to an error page) then triggers a client-side download. Async —
 * await it to drive an "Exporting…" state. Throws on non-2xx.
 */
export async function downloadReportCsv(base, path, filters) {
    const res = await fetch(`${base}/${path}${buildReportQuery(filters, true)}`, {
        credentials: 'include',
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const filename = filenameFromDisposition(res.headers.get('content-disposition')) || `${path}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

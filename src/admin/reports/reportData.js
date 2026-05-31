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
            .catch((e) => { if (!cancelled) setState({ data: null, loading: false, error: e.message }); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [base, path, filters.period, filters.comparison, filters.eventId, filters.from, filters.to]);
    return state;
}

/** Trigger a CSV download of `${base}/${path}` with the current filters (DOM side-effect). */
export function downloadReportCsv(base, path, filters) {
    const a = document.createElement('a');
    a.href = `${base}/${path}${buildReportQuery(filters, true)}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

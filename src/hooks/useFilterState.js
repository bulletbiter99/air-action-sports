// useFilterState — keeps a filter object in sync with the URL query string
// per a schema. Bookmarking the URL is equivalent to a saved view.
//
// API:
//   const [filters, setFilters] = useFilterState(schema, initialFilters?);
//
// Encoding rules (encodeFilters):
//   - enum (single string): ?key=value
//   - enum (array):         ?key=v1&key=v2
//   - bool true:            ?key=1
//   - bool false:           omitted
//   - range [min, max]:     ?key=min,max
//   - empty/null/undefined: omitted
//
// Parsing rules (parseFilters):
//   - Single occurrence  → scalar string (enum / typeahead / date)
//   - Multiple occurrences of same key → string[] (enum multi-select)
//   - bool '1' → true; anything else → omitted
//   - range "min,max" → ['min', 'max'] (note: caller decides numeric coerce)
//   - Unknown keys (not in schema) → ignored
//
// Pure helpers (encodeFilters, parseFilters) are exported and exhaustively
// tested in tests/unit/hooks/useFilterState.test.js. The hook itself is
// thin glue around them + window.history.

import { useState, useCallback } from 'react';

export function encodeFilters(filters, schema) {
    const params = new URLSearchParams();
    for (const filterDef of schema) {
        const v = filters[filterDef.key];
        if (v === undefined || v === null) continue;
        if (filterDef.type === 'bool') {
            if (v === true) params.set(filterDef.key, '1');
            continue;
        }
        if (Array.isArray(v) && v.length === 0) continue;
        if (filterDef.type === 'range' && Array.isArray(v) && v.length === 2) {
            params.set(filterDef.key, `${v[0]},${v[1]}`);
            continue;
        }
        if (Array.isArray(v)) {
            v.forEach((item) => params.append(filterDef.key, String(item)));
            continue;
        }
        if (v === '') continue;
        params.set(filterDef.key, String(v));
    }
    return params.toString();
}

export function parseFilters(queryString, schema) {
    // Accept both '?foo=bar' and 'foo=bar' input shapes.
    const qs = queryString.startsWith('?') ? queryString.slice(1) : queryString;
    const params = new URLSearchParams(qs);
    const filters = {};
    for (const filterDef of schema) {
        const all = params.getAll(filterDef.key);
        if (all.length === 0) continue;
        if (filterDef.type === 'enum') {
            filters[filterDef.key] = all.length === 1 ? all[0] : all;
            continue;
        }
        if (filterDef.type === 'bool') {
            filters[filterDef.key] = all[0] === '1';
            continue;
        }
        if (filterDef.type === 'range') {
            const parts = (all[0] || '').split(',');
            filters[filterDef.key] = parts.length === 2 ? parts : [];
            continue;
        }
        filters[filterDef.key] = all[0];
    }
    return filters;
}

export function useFilterState(schema, initialFilters = {}) {
    const [filters, setFiltersState] = useState(() => {
        if (typeof window === 'undefined') return initialFilters;
        const fromUrl = parseFilters(window.location.search, schema);
        return { ...initialFilters, ...fromUrl };
    });

    const setFilters = useCallback(
        (next) => {
            setFiltersState(next);
            if (typeof window === 'undefined') return;
            const qs = encodeFilters(next, schema);
            const url = qs
                ? `${window.location.pathname}?${qs}${window.location.hash || ''}`
                : `${window.location.pathname}${window.location.hash || ''}`;
            window.history.replaceState({}, '', url);
        },
        [schema],
    );

    return [filters, setFilters];
}

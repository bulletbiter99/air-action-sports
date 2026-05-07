// FilterBar — the chip-based filter primitive used by every admin list view
// from M3 onward. Controlled component: parent owns filter state, FilterBar
// renders chips + picker + saved-views dropdown and calls onChange.
//
// API:
//   <FilterBar
//     schema={[{ key, label, type: 'enum'|'typeahead'|'date'|'bool'|'range', options? }]}
//     value={filters}
//     onChange={setFilters}
//     searchValue={search}            // optional
//     onSearchChange={setSearch}      // optional — without it the search input is hidden
//     searchPlaceholder="Search…"
//     resultCount={items.length}      // optional — hides if undefined
//     savedViewsKey="adminFeedback"   // optional — namespace for useSavedViews
//     density="comfortable"           // 'comfortable' | 'compact' (B5c uses tokens)
//   />
//
// Filter type coverage in M2:
//   - enum     ✓ (multi-select via repeated picks, single-select via direct chip)
//   - typeahead — placeholder; M3+ converts pages that need it
//   - date     — placeholder; M3+
//   - bool     — placeholder; M3+
//   - range    — placeholder; M3+
//
// Pure helpers (getActiveChips, filterAvailableFilters) are exported and
// covered by tests/unit/components/FilterBar.test.js.

import { useState, useRef, useEffect } from 'react';
import { useSavedViews } from '../../hooks/useSavedViews.js';
import './FilterBar.css';

// === Pure helpers (exported for testing) ===

// Returns chip descriptors { key, label, value, displayValue } for active filters.
// "Active" means: not undefined/null/empty-string and not an empty array.
export function getActiveChips(filters, schema) {
    const chips = [];
    for (const filterDef of schema) {
        const val = filters[filterDef.key];
        if (val === undefined || val === null || val === '') continue;
        if (Array.isArray(val) && val.length === 0) continue;
        if (filterDef.type === 'bool' && val === false) continue;
        chips.push({
            key: filterDef.key,
            label: filterDef.label,
            value: val,
            displayValue: formatChipValue(val, filterDef),
        });
    }
    return chips;
}

function formatChipValue(value, filterDef) {
    if (filterDef.type === 'enum') {
        if (Array.isArray(value)) {
            const labels = value.map((v) => {
                const opt = (filterDef.options || []).find((o) => o.value === v);
                return opt?.label ?? v;
            });
            return labels.join(', ');
        }
        const opt = (filterDef.options || []).find((o) => o.value === value);
        return opt?.label ?? String(value);
    }
    if (filterDef.type === 'bool') return value ? 'Yes' : 'No';
    if (filterDef.type === 'range' && Array.isArray(value) && value.length === 2) {
        return `${value[0]}–${value[1]}`;
    }
    return String(value);
}

// Filters the schema down to options that are NOT yet active and that match
// the typeahead query (case-insensitive substring on label).
export function filterAvailableFilters(query, schema, activeFilters) {
    const q = (query || '').toLowerCase().trim();
    return schema.filter((filterDef) => {
        const val = activeFilters[filterDef.key];
        const isActive =
            val !== undefined &&
            val !== null &&
            val !== '' &&
            !(Array.isArray(val) && val.length === 0) &&
            !(filterDef.type === 'bool' && val === false);
        if (isActive) return false;
        if (!q) return true;
        return filterDef.label.toLowerCase().includes(q);
    });
}

// === Component ===

export default function FilterBar({
    schema,
    value,
    onChange,
    searchValue,
    onSearchChange,
    searchPlaceholder = 'Search…',
    resultCount,
    savedViewsKey,
    density = 'comfortable',
}) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState('');
    const pickerRef = useRef(null);

    useEffect(() => {
        if (!pickerOpen) return;
        function handle(e) {
            if (pickerRef.current && !pickerRef.current.contains(e.target)) {
                setPickerOpen(false);
                setPickerQuery('');
            }
        }
        document.addEventListener('mousedown', handle);
        return () => document.removeEventListener('mousedown', handle);
    }, [pickerOpen]);

    const chips = getActiveChips(value || {}, schema);
    const availableFilters = filterAvailableFilters(pickerQuery, schema, value || {});
    const savedViewsApi = useSavedViews(savedViewsKey || null);

    function removeChip(key) {
        const filterDef = schema.find((f) => f.key === key);
        const next = { ...value };
        if (filterDef?.type === 'enum') {
            next[key] = Array.isArray(value[key]) ? [] : '';
        } else if (filterDef?.type === 'bool') {
            next[key] = false;
        } else if (filterDef?.type === 'range') {
            next[key] = [];
        } else {
            next[key] = '';
        }
        onChange(next);
    }

    function pickEnumOption(filterDef, optionValue) {
        const next = { ...value, [filterDef.key]: optionValue };
        onChange(next);
        setPickerOpen(false);
        setPickerQuery('');
    }

    function applySavedView(view) {
        onChange(view.filters);
    }

    function saveCurrent() {
        // window.prompt is intentionally simple here. M3+ flows that need
        // a richer modal can replace this when they integrate FilterBar.
        const name = typeof window !== 'undefined' ? window.prompt('Name this view:') : null;
        if (!name || !savedViewsApi.saveView) return;
        savedViewsApi.saveView(name, value);
    }

    return (
        <div className="aas-filterbar" data-density={density}>
            <div className="aas-filterbar__row">
                {onSearchChange && (
                    <input
                        type="search"
                        className="aas-filterbar__search"
                        value={searchValue ?? ''}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder={searchPlaceholder}
                    />
                )}
                {savedViewsKey && (
                    <SavedViewsDropdown
                        api={savedViewsApi}
                        onApply={applySavedView}
                        onSave={saveCurrent}
                    />
                )}
            </div>
            <div className="aas-filterbar__chips">
                {chips.map((chip) => (
                    <span key={chip.key} className="aas-filterbar__chip">
                        <span className="aas-filterbar__chip-label">{chip.label}:</span>
                        <span className="aas-filterbar__chip-value">{chip.displayValue}</span>
                        <button
                            type="button"
                            className="aas-filterbar__chip-remove"
                            onClick={() => removeChip(chip.key)}
                            aria-label={`Remove ${chip.label} filter`}
                        >
                            ×
                        </button>
                    </span>
                ))}
                <div className="aas-filterbar__add" ref={pickerRef}>
                    <button
                        type="button"
                        className="aas-filterbar__add-btn"
                        onClick={() => setPickerOpen((o) => !o)}
                    >
                        + Add filter
                    </button>
                    {pickerOpen && (
                        <FilterPicker
                            availableFilters={availableFilters}
                            query={pickerQuery}
                            onQueryChange={setPickerQuery}
                            onPickEnum={pickEnumOption}
                        />
                    )}
                </div>
                {resultCount !== undefined && (
                    <span className="aas-filterbar__count">
                        {resultCount} {resultCount === 1 ? 'result' : 'results'}
                    </span>
                )}
            </div>
        </div>
    );
}

function FilterPicker({ availableFilters, query, onQueryChange, onPickEnum }) {
    return (
        <div className="aas-filterbar__picker">
            <input
                type="search"
                className="aas-filterbar__picker-search"
                placeholder="Find a filter…"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                autoFocus
            />
            <ul className="aas-filterbar__picker-list">
                {availableFilters.length === 0 && (
                    <li className="aas-filterbar__picker-empty">No filters match.</li>
                )}
                {availableFilters.map((filterDef) => (
                    <li key={filterDef.key} className="aas-filterbar__picker-item">
                        {filterDef.type === 'enum' ? (
                            <details>
                                <summary>{filterDef.label}</summary>
                                <ul className="aas-filterbar__picker-options">
                                    {(filterDef.options || []).map((opt) => (
                                        <li key={opt.value}>
                                            <button
                                                type="button"
                                                onClick={() => onPickEnum(filterDef, opt.value)}
                                            >
                                                {opt.label}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </details>
                        ) : (
                            <span
                                className="aas-filterbar__picker-todo"
                                data-filter-type={filterDef.type}
                                title={`Filter type "${filterDef.type}" not yet implemented (M3+).`}
                            >
                                {filterDef.label} <em>(coming in M3+)</em>
                            </span>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function SavedViewsDropdown({ api, onApply, onSave }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        function handle(e) {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        }
        document.addEventListener('mousedown', handle);
        return () => document.removeEventListener('mousedown', handle);
    }, [open]);

    return (
        <div className="aas-filterbar__views" ref={ref}>
            <button
                type="button"
                className="aas-filterbar__views-btn"
                onClick={() => setOpen((o) => !o)}
            >
                Saved views ▾
            </button>
            {open && (
                <div className="aas-filterbar__views-menu">
                    <button
                        type="button"
                        className="aas-filterbar__views-save"
                        onClick={() => {
                            onSave();
                            setOpen(false);
                        }}
                    >
                        + Save current
                    </button>
                    {api.views.length === 0 && (
                        <p className="aas-filterbar__views-empty">No saved views yet.</p>
                    )}
                    {api.views.map((view) => (
                        <div key={view.name} className="aas-filterbar__views-item">
                            <button
                                type="button"
                                onClick={() => {
                                    onApply(view);
                                    setOpen(false);
                                }}
                            >
                                {view.name}
                            </button>
                            <button
                                type="button"
                                className="aas-filterbar__views-delete"
                                onClick={() => api.deleteView(view.name)}
                                aria-label={`Delete view ${view.name}`}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

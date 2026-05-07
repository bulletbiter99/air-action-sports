// M4 B6 — CustomerTypeahead: debounced search-and-select for the
// customers entity. Wraps a free-text input with a dropdown of matches
// from /api/admin/customers?q=<query>. Reusable across future
// customer-linked admin features. Follows the MergeModal pattern
// from AdminCustomerDetail.jsx (250ms debounce, fetch-on-query).
//
// Combobox UX:
//   - Free text input drives `query`
//   - Dropdown shows matches; up/down arrow navigates; enter/click selects
//   - Selecting calls onSelect({ id, email, name, phone, ... })
//   - "+ Use as new customer" escape hatch keeps current text and clears
//     selection state so staff can continue with a brand-new customer

import { useEffect, useRef, useState } from 'react';

const DEBOUNCE_MS = 250;
const FETCH_LIMIT = 10;

export default function CustomerTypeahead({
    value,
    onChange,
    onSelect,
    onClear,
    placeholder = 'Email…',
    inputType = 'email',
    inputStyle,
    required = false,
    autoFocus = false,
}) {
    const [results, setResults] = useState([]);
    const [open, setOpen] = useState(false);
    const [activeIdx, setActiveIdx] = useState(-1);
    const [loading, setLoading] = useState(false);
    const debounceRef = useRef(null);
    const containerRef = useRef(null);

    // Debounced fetch on value change. Skips empty / very short strings
    // to avoid hammering the endpoint on the first keystroke.
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        const trimmed = (value || '').trim();
        if (trimmed.length < 2) {
            setResults([]);
            setOpen(false);
            setActiveIdx(-1);
            return;
        }
        debounceRef.current = setTimeout(async () => {
            setLoading(true);
            try {
                const res = await fetch(
                    `/api/admin/customers?q=${encodeURIComponent(trimmed)}&limit=${FETCH_LIMIT}`,
                    { credentials: 'include', cache: 'no-store' },
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                setResults(json.customers || []);
                setOpen(true);
                setActiveIdx(-1);
            } catch {
                setResults([]);
            } finally {
                setLoading(false);
            }
        }, DEBOUNCE_MS);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [value]);

    // Close dropdown on outside click.
    useEffect(() => {
        if (!open) return undefined;
        const onDoc = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    const handleSelect = (customer) => {
        setOpen(false);
        setActiveIdx(-1);
        onSelect?.(customer);
    };

    const handleUseNew = () => {
        setOpen(false);
        setActiveIdx(-1);
        onClear?.();
    };

    const handleKeyDown = (e) => {
        if (!open) return;
        const optionsLen = results.length + 1; // +1 for "Use as new customer"
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx((i) => (i + 1) % optionsLen);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx((i) => (i - 1 + optionsLen) % optionsLen);
        } else if (e.key === 'Enter') {
            if (activeIdx >= 0 && activeIdx < results.length) {
                e.preventDefault();
                handleSelect(results[activeIdx]);
            } else if (activeIdx === results.length) {
                e.preventDefault();
                handleUseNew();
            }
        } else if (e.key === 'Escape') {
            setOpen(false);
            setActiveIdx(-1);
        }
    };

    return (
        <div className="admin-customer-typeahead" ref={containerRef}>
            <input
                type={inputType}
                value={value || ''}
                onChange={(e) => onChange?.(e.target.value)}
                onFocus={() => {
                    if ((value || '').trim().length >= 2 && results.length > 0) {
                        setOpen(true);
                    }
                }}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                required={required}
                autoFocus={autoFocus}
                style={inputStyle}
                role="combobox"
                aria-expanded={open}
                aria-autocomplete="list"
                aria-activedescendant={
                    activeIdx >= 0 ? `customer-typeahead-opt-${activeIdx}` : undefined
                }
            />
            {open && (
                <div className="admin-customer-typeahead__dropdown" role="listbox">
                    {loading && results.length === 0 && (
                        <div className="admin-customer-typeahead__hint">Searching…</div>
                    )}
                    {!loading && results.length === 0 && (
                        <div className="admin-customer-typeahead__hint">No matches.</div>
                    )}
                    {results.map((c, idx) => (
                        <button
                            key={c.id || c.email}
                            id={`customer-typeahead-opt-${idx}`}
                            type="button"
                            className={
                                'admin-customer-typeahead__option' +
                                (idx === activeIdx ? ' admin-customer-typeahead__option--active' : '')
                            }
                            onMouseDown={(e) => {
                                e.preventDefault(); // prevent input blur before click
                                handleSelect(c);
                            }}
                            role="option"
                            aria-selected={idx === activeIdx}
                        >
                            <span className="admin-customer-typeahead__option-email">
                                {c.email || '(no email)'}
                            </span>
                            {c.name && (
                                <span className="admin-customer-typeahead__option-name">
                                    {c.name}
                                </span>
                            )}
                        </button>
                    ))}
                    <button
                        id={`customer-typeahead-opt-${results.length}`}
                        type="button"
                        className={
                            'admin-customer-typeahead__option admin-customer-typeahead__option--new' +
                            (activeIdx === results.length ? ' admin-customer-typeahead__option--active' : '')
                        }
                        onMouseDown={(e) => {
                            e.preventDefault();
                            handleUseNew();
                        }}
                        role="option"
                        aria-selected={activeIdx === results.length}
                    >
                        + Create new customer
                    </button>
                </div>
            )}
        </div>
    );
}

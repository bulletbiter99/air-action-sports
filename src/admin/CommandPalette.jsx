// M4 B7 — CommandPalette: keyboard-driven navigation overlay (Cmd+K).
//
// Centered modal with autofocused input + filtered command list.
// Commands are derived from the SIDEBAR config (sidebarConfig.js)
// via commandsFromSidebar — single source of truth for nav.
//
// Keyboard: arrow up/down navigates, enter executes, escape closes.
// Click outside closes (backdrop). Mobile-friendly: scales to viewport.
//
// Follows the FeedbackModal.jsx structure pattern (one-off styled
// overlay; no generic Dialog wrapper exists yet, and B7 doesn't
// introduce one). Uses inline styles for the modal chrome consistent
// with that precedent; dropdown rows use admin.css classes for
// reusable theming.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTodayActive } from '../hooks/useWidgetData.js';
import { SIDEBAR } from './sidebarConfig.js';
import { commandsFromSidebar, filterCommands } from './commandRegistry.js';

export default function CommandPalette({ open, onClose }) {
    const navigate = useNavigate();
    const inputRef = useRef(null);
    const todayState = useTodayActive();
    const [query, setQuery] = useState('');
    const [activeIdx, setActiveIdx] = useState(0);

    // M4 B12b removed the customers_entity flag plumbing — no sidebar
    // item carries `requiresFlag` anymore; commandsFromSidebar's filter
    // logic stays in place but receives no items to filter on flag.
    const commands = useMemo(
        () => commandsFromSidebar(SIDEBAR, { todayState }),
        [todayState],
    );

    const filtered = useMemo(
        () => filterCommands(commands, query),
        [commands, query],
    );

    // Reset state and focus the input on open.
    useEffect(() => {
        if (!open) return;
        setQuery('');
        setActiveIdx(0);
        // Defer focus to next tick so the modal mounts first.
        const t = setTimeout(() => {
            inputRef.current?.focus();
        }, 0);
        return () => clearTimeout(t);
    }, [open]);

    // Reset highlight when filtered list changes (e.g., user typed).
    useEffect(() => {
        setActiveIdx(0);
    }, [query]);

    // Escape closes; arrow keys navigate; enter executes.
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose?.();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx((i) =>
                filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length,
            );
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            const cmd = filtered[activeIdx];
            if (cmd?.to) {
                navigate(cmd.to);
                onClose?.();
            }
        }
    };

    if (!open) return null;

    return (
        <div
            className="admin-cmdk-backdrop"
            onMouseDown={(e) => {
                // Close on outside-click; ignore inside-modal mousedowns.
                if (e.target === e.currentTarget) onClose?.();
            }}
            role="presentation"
        >
            <div
                className="admin-cmdk-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Command palette"
            >
                <input
                    ref={inputRef}
                    type="text"
                    className="admin-cmdk-input"
                    placeholder="Search commands…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    aria-label="Command search"
                    aria-autocomplete="list"
                    aria-expanded={filtered.length > 0}
                />
                <div className="admin-cmdk-list" role="listbox">
                    {filtered.length === 0 && (
                        <div className="admin-cmdk-empty">
                            No matches{query ? ` for "${query}"` : ''}.
                        </div>
                    )}
                    {filtered.map((cmd, idx) => (
                        <button
                            key={cmd.to}
                            type="button"
                            className={
                                'admin-cmdk-option' +
                                (idx === activeIdx ? ' admin-cmdk-option--active' : '')
                            }
                            onMouseEnter={() => setActiveIdx(idx)}
                            onMouseDown={(e) => {
                                e.preventDefault(); // keep focus on input
                                navigate(cmd.to);
                                onClose?.();
                            }}
                            role="option"
                            aria-selected={idx === activeIdx}
                        >
                            <span className="admin-cmdk-option-label">{cmd.label}</span>
                            {cmd.category && (
                                <span className="admin-cmdk-option-category">
                                    {cmd.category}
                                </span>
                            )}
                            <span className="admin-cmdk-option-route">{cmd.to}</span>
                        </button>
                    ))}
                </div>
                <div className="admin-cmdk-footer">
                    <span><kbd>↑↓</kbd> navigate</span>
                    <span><kbd>↵</kbd> open</span>
                    <span><kbd>esc</kbd> close</span>
                </div>
            </div>
        </div>
    );
}

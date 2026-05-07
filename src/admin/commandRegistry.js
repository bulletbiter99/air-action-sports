// M4 B7 — pure helpers for the keyboard-driven Command Palette.
//
// Two responsibilities:
//
//   1. commandsFromSidebar(sidebar, ctx) — derives a flat command list
//      from the SIDEBAR config (B5's sidebarConfig.js). Single source of
//      truth: adding a new sidebar item automatically surfaces it as a
//      command. Filters by the same predicates as getVisibleItems
//      (dynamic todayActive, requiresFlag) so the palette only offers
//      what the user can navigate to.
//
//   2. filterCommands(commands, query) — case-insensitive substring
//      match on label. Empty query returns the full list. Sort order:
//      prefix matches first, then substring matches. Substring match is
//      sufficient for ~15-25 commands; no fuzzy library needed.

import { getVisibleItems } from './sidebarConfig.js';

/**
 * Walks a sidebar config and produces a flat list of palette commands.
 * Top-level items become single-tier commands. Group items become
 * "Group · Item" commands so the user can search by either.
 *
 * Filtering follows the same dynamic/requiresFlag rules as the sidebar
 * itself (via getVisibleItems), so the palette never offers items the
 * user can't see in the sidebar (or the dashboard).
 *
 * @param {Array} sidebar - SIDEBAR config from sidebarConfig.js
 * @param {Object} ctx - Render context.
 * @param {Object|null} ctx.todayState - From useTodayActive(); shape
 *   { activeEventToday, eventId, checkInOpen } | null
 * @param {Object} ctx.flags - Feature flag values keyed by name
 * @returns {Array<{ label, to, category, end? }>}
 */
export function commandsFromSidebar(sidebar, ctx = {}) {
    const visible = getVisibleItems(sidebar, ctx);
    const out = [];
    for (const entry of visible) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.type === 'separator') continue;
        if (entry.type === 'group') {
            const groupLabel = entry.label || 'Group';
            for (const sub of (entry.items || [])) {
                if (!sub || sub.type !== 'item') continue;
                out.push({
                    label: `${groupLabel} · ${sub.label}`,
                    to: sub.to,
                    category: groupLabel,
                    end: sub.end || false,
                });
            }
            continue;
        }
        if (entry.type === 'item') {
            out.push({
                label: entry.label,
                to: entry.to,
                category: 'Nav',
                end: entry.end || false,
            });
        }
    }
    return out;
}

/**
 * Filters and sorts a command list by query. Empty query returns the
 * full list unchanged. Non-empty query matches case-insensitively on
 * label substring; results are sorted with prefix matches first, then
 * substring matches in original order.
 *
 * @param {Array<{ label }>} commands
 * @param {string} query
 * @returns {Array} Filtered + sorted subset
 */
export function filterCommands(commands, query) {
    if (!Array.isArray(commands)) return [];
    const trimmed = (query || '').trim().toLowerCase();
    if (!trimmed) return commands.slice();

    const prefix = [];
    const substring = [];
    for (const cmd of commands) {
        if (!cmd || typeof cmd.label !== 'string') continue;
        const lower = cmd.label.toLowerCase();
        if (lower.startsWith(trimmed)) {
            prefix.push(cmd);
        } else if (lower.includes(trimmed)) {
            substring.push(cmd);
        }
    }
    return [...prefix, ...substring];
}

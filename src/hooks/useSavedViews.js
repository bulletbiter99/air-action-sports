// useSavedViews — D1-backed CRUD for per-user saved filter views (M4 B2a).
//
// API (unchanged from M2 except added `loading`):
//   const { views, saveView, deleteView, renameView, loading } = useSavedViews(page);
//
// where `page` is a string namespace (e.g. 'adminFeedback'). A view is
// `{ id, name, filters, sort, createdAt, updatedAt, pageKey }`.
//
// Storage: D1 via /api/admin/saved-views (migration 0026_saved_views.sql).
// Migrated from M2's localStorage backing so views sync across devices.
// The public hook surface is preserved so existing callers (FilterBar in
// src/components/admin/FilterBar.jsx) need no changes — they just see
// `views` populate asynchronously instead of synchronously on first render.
//
// NEW return field `loading: boolean` — true during the initial fetch and
// during in-flight mutations. Callers that didn't read it before (FilterBar,
// AdminFeedback, AdminCustomers) ignore it; callers that want a spinner can
// adopt it.
//
// Pure async helpers (apiList, apiCreate, apiUpdate, apiDelete) are
// exported for testing without React rendering — vitest's node environment
// has no DOM. The hook is a thin wrapper around them.

import { useState, useCallback, useEffect } from 'react';

// ────────────────────────────────────────────────────────────────────
// Pure async helpers (exported for testing)
// ────────────────────────────────────────────────────────────────────

/**
 * Fetch all saved views for the calling user + page.
 * Returns [] on any error (network, 4xx, 5xx, JSON parse).
 *
 * @param {string} page
 * @returns {Promise<Array<{ id, pageKey, name, filters, sort, createdAt, updatedAt }>>}
 */
export async function apiList(page) {
    if (!page) return [];
    try {
        const res = await fetch(
            `/api/admin/saved-views?page=${encodeURIComponent(page)}`,
            { credentials: 'include', cache: 'no-store' },
        );
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.views) ? data.views : [];
    } catch {
        return [];
    }
}

/**
 * Create or update a view by (user, page, name). Returns the upserted view
 * (with id, createdAt, updatedAt) on success, or null on any error.
 *
 * @param {string} page
 * @param {string} name
 * @param {object} filters
 * @returns {Promise<object|null>}
 */
export async function apiCreate(page, name, filters) {
    if (!page || !name) return null;
    try {
        const res = await fetch('/api/admin/saved-views', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pageKey: page, name, filters }),
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

/**
 * Rename a view by id. Returns true on success.
 *
 * @param {string} id
 * @param {string} newName
 * @returns {Promise<boolean>}
 */
export async function apiUpdate(id, newName) {
    if (!id || !newName) return false;
    try {
        const res = await fetch(`/api/admin/saved-views/${encodeURIComponent(id)}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName }),
        });
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Delete a view by id. Returns true on success.
 *
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function apiDelete(id) {
    if (!id) return false;
    try {
        const res = await fetch(`/api/admin/saved-views/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        return res.ok;
    } catch {
        return false;
    }
}

// ────────────────────────────────────────────────────────────────────
// React hook
// ────────────────────────────────────────────────────────────────────

export function useSavedViews(page) {
    const [views, setViews] = useState([]);
    const [loading, setLoading] = useState(Boolean(page));

    const refetch = useCallback(async () => {
        if (!page) {
            setViews([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        const fresh = await apiList(page);
        setViews(fresh);
        setLoading(false);
    }, [page]);

    useEffect(() => {
        refetch();
    }, [refetch]);

    const saveView = useCallback(
        async (name, filters) => {
            if (!page || !name) return;
            await apiCreate(page, name, filters);
            await refetch();
        },
        [page, refetch],
    );

    const deleteView = useCallback(
        async (name) => {
            if (!page || !name) return;
            // Hook API takes name (M2-compatible). Resolve to id from current views.
            const target = views.find((v) => v.name === name);
            if (!target) return;
            await apiDelete(target.id);
            await refetch();
        },
        [page, views, refetch],
    );

    const renameView = useCallback(
        async (oldName, newName) => {
            if (!page || !oldName || !newName) return;
            const target = views.find((v) => v.name === oldName);
            if (!target) return;
            await apiUpdate(target.id, newName);
            await refetch();
        },
        [page, views, refetch],
    );

    return { views, saveView, deleteView, renameView, loading };
}

// useSavedViews — localStorage-backed CRUD for saved filter views.
//
// API:
//   const { views, saveView, deleteView, renameView } = useSavedViews(page);
//
// where `page` is a string namespace (e.g. 'adminFeedback'). Storage key is
// `aas:savedViews:<page>`. A view is `{ name: string, filters: object }`.
//
// In M2 this is per-user, ephemeral (device-local). M4 batch 3 swaps the
// storage backend to D1 so views sync across devices; the public API
// surface here will stay stable so consumers don't change.
//
// Pure helpers (loadViews, saveViews) accept an injectable storage so
// tests can pass a fake localStorage. The hook uses the real
// window.localStorage by default.

import { useState, useCallback, useEffect } from 'react';

const PREFIX = 'aas:savedViews:';

function defaultStorage() {
    return typeof window !== 'undefined' ? window.localStorage : null;
}

export function loadViews(page, storage = defaultStorage()) {
    if (!storage || !page) return [];
    try {
        const raw = storage.getItem(PREFIX + page);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function saveViews(page, views, storage = defaultStorage()) {
    if (!storage || !page) return;
    try {
        storage.setItem(PREFIX + page, JSON.stringify(views));
    } catch {
        // Quota errors / private-browsing — silently ignore. The next read
        // will return the previous state, which is acceptable for views.
    }
}

export function useSavedViews(page) {
    const [views, setViews] = useState(() => loadViews(page));

    useEffect(() => {
        setViews(loadViews(page));
    }, [page]);

    const saveView = useCallback(
        (name, filters) => {
            if (!page || !name) return;
            setViews((prev) => {
                const filtered = prev.filter((v) => v.name !== name);
                const next = [...filtered, { name, filters }];
                saveViews(page, next);
                return next;
            });
        },
        [page],
    );

    const deleteView = useCallback(
        (name) => {
            if (!page || !name) return;
            setViews((prev) => {
                const next = prev.filter((v) => v.name !== name);
                saveViews(page, next);
                return next;
            });
        },
        [page],
    );

    const renameView = useCallback(
        (oldName, newName) => {
            if (!page || !oldName || !newName) return;
            setViews((prev) => {
                const next = prev.map((v) =>
                    v.name === oldName ? { ...v, name: newName } : v,
                );
                saveViews(page, next);
                return next;
            });
        },
        [page],
    );

    return { views, saveView, deleteView, renameView };
}

// M4 Batch 2a — useSavedViews imperative-helper tests.
//
// vitest's node environment has no DOM, so the React hook itself is not
// rendered here. Per the M2 useFeatureFlag pattern (tests/unit/hooks/
// useFeatureFlag.test.js), the testable surface is the imperative async
// helpers (apiList, apiCreate, apiUpdate, apiDelete) that the hook calls
// internally. The hook's React state-management code is exercised via
// integration in tests/unit/admin/saved-views.test.js (route side) +
// manual browser verification of the FilterBar dropdown.

import { describe, it, expect } from 'vitest';
import {
    apiList,
    apiCreate,
    apiUpdate,
    apiDelete,
} from '../../../src/hooks/useSavedViews.js';

describe('apiList', () => {
    it('issues GET to /api/admin/saved-views?page=<encoded>', async () => {
        globalThis.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ views: [] }),
        });

        await apiList('admin Feedback');

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toBe('/api/admin/saved-views?page=admin%20Feedback');
        expect(opts.credentials).toBe('include');
        expect(opts.cache).toBe('no-store');
    });

    it('returns the views array on a 2xx response', async () => {
        const views = [
            { id: 'sv_1', pageKey: 'p', name: 'A', filters: {}, sort: null, createdAt: 1, updatedAt: 1 },
        ];
        globalThis.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ views }),
        });

        const out = await apiList('p');
        expect(out).toEqual(views);
    });

    it('returns [] on non-ok response (e.g. 401, 500)', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
        const out = await apiList('p');
        expect(out).toEqual([]);
    });

    it('returns [] on network error (graceful)', async () => {
        globalThis.fetch.mockRejectedValueOnce(new Error('Network down'));
        const out = await apiList('p');
        expect(out).toEqual([]);
    });

    it('returns [] when response.views is missing or non-array', async () => {
        globalThis.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ /* no views key */ }),
        });
        expect(await apiList('p')).toEqual([]);

        globalThis.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ views: 'not an array' }),
        });
        expect(await apiList('p')).toEqual([]);
    });

    it('returns [] when page is falsy (no fetch issued)', async () => {
        const out = await apiList('');
        expect(out).toEqual([]);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});

describe('apiCreate', () => {
    it('issues POST with { pageKey, name, filters }', async () => {
        const created = { id: 'sv_new', pageKey: 'p', name: 'X', filters: { a: 1 }, sort: null, createdAt: 9, updatedAt: 9 };
        globalThis.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => created,
        });

        const out = await apiCreate('p', 'X', { a: 1 });

        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toBe('/api/admin/saved-views');
        expect(opts.method).toBe('POST');
        expect(opts.credentials).toBe('include');
        expect(opts.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(opts.body)).toEqual({ pageKey: 'p', name: 'X', filters: { a: 1 } });
        expect(out).toEqual(created);
    });

    it('returns null on non-ok response', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 400 });
        const out = await apiCreate('p', 'X', {});
        expect(out).toBeNull();
    });

    it('returns null on network error (graceful)', async () => {
        globalThis.fetch.mockRejectedValueOnce(new Error('Network down'));
        const out = await apiCreate('p', 'X', {});
        expect(out).toBeNull();
    });

    it('returns null when page or name is falsy (no fetch issued)', async () => {
        expect(await apiCreate('', 'X', {})).toBeNull();
        expect(await apiCreate('p', '', {})).toBeNull();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});

describe('apiUpdate', () => {
    it('issues PUT to /api/admin/saved-views/:id with { name }', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true });

        const out = await apiUpdate('sv_x', 'New name');

        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toBe('/api/admin/saved-views/sv_x');
        expect(opts.method).toBe('PUT');
        expect(opts.credentials).toBe('include');
        expect(opts.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(opts.body)).toEqual({ name: 'New name' });
        expect(out).toBe(true);
    });

    it('encodes the id segment for URL safety', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true });
        await apiUpdate('sv with spaces', 'X');
        expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/admin/saved-views/sv%20with%20spaces');
    });

    it('returns false on non-ok or error', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: false });
        expect(await apiUpdate('sv_x', 'X')).toBe(false);

        globalThis.fetch.mockRejectedValueOnce(new Error('boom'));
        expect(await apiUpdate('sv_x', 'X')).toBe(false);
    });

    it('returns false when id or newName falsy (no fetch issued)', async () => {
        expect(await apiUpdate('', 'X')).toBe(false);
        expect(await apiUpdate('sv_x', '')).toBe(false);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});

describe('apiDelete', () => {
    it('issues DELETE to /api/admin/saved-views/:id', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true });

        const out = await apiDelete('sv_x');

        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toBe('/api/admin/saved-views/sv_x');
        expect(opts.method).toBe('DELETE');
        expect(opts.credentials).toBe('include');
        expect(out).toBe(true);
    });

    it('encodes the id segment for URL safety', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true });
        await apiDelete('sv x');
        expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/admin/saved-views/sv%20x');
    });

    it('returns false on non-ok or error', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: false });
        expect(await apiDelete('sv_x')).toBe(false);

        globalThis.fetch.mockRejectedValueOnce(new Error('boom'));
        expect(await apiDelete('sv_x')).toBe(false);
    });

    it('returns false when id falsy (no fetch issued)', async () => {
        expect(await apiDelete('')).toBe(false);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});

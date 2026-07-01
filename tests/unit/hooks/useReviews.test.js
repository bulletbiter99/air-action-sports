// @vitest-environment jsdom

// Tests for src/hooks/useReviews.js (Batch 6) — the standalone public-review
// hook backing Home (summary), EventDetail (event feed), and /reviews (all).
// Locks the mode→URL routing + the normalized average/count/reviews projection
// that reads the same across all three response shapes, plus the "hold until
// eventId resolves" guard EventDetail relies on.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import { useReviews } from '../../../src/hooks/useReviews.js';

describe('useReviews', () => {
    beforeEach(() => {
        // tests/setup.js resets the throw-on-unmocked fetch mock each test.
    });

    it('summary mode hits /api/reviews/summary and normalizes overall+recent', async () => {
        const fetchMock = installClientFetch([
            { match: '/api/reviews/summary', body: { overall: { average: 4.6, count: 12 }, recent: [{ id: 'rv_1', rating: 5, comment: 'Great', authorName: 'Jane D.' }] } },
        ]);
        const { result } = renderHook(() => useReviews({ mode: 'summary', recent: 6 }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.average).toBe(4.6);
        expect(result.current.count).toBe(12);
        expect(result.current.reviews).toHaveLength(1);
        expect(fetchMock.mock.calls[0][0]).toContain('/api/reviews/summary?recent=6');
    });

    it('event mode hits /api/reviews?event=<id> and reads count/average/reviews', async () => {
        const fetchMock = installClientFetch([
            { match: '/api/reviews', body: { event: { id: 'ev_1' }, average: 4.5, count: 3, reviews: [{ id: 'rv_a', rating: 4 }, { id: 'rv_b', rating: 5 }] } },
        ]);
        const { result } = renderHook(() => useReviews({ eventId: 'ev_1', limit: 20 }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.average).toBe(4.5);
        expect(result.current.count).toBe(3);
        expect(result.current.reviews).toHaveLength(2);
        expect(fetchMock.mock.calls[0][0]).toContain('/api/reviews?event=ev_1&limit=20');
    });

    it('explicit event mode with no eventId holds — never fires a request', async () => {
        // EventDetail passes { mode: 'event', eventId: event?.id }; while the
        // event is still loading eventId is undefined, and the hook must hold
        // rather than fall back to a summary fetch.
        const fetchMock = installClientFetch([
            { match: '/api/reviews', body: {} },
        ]);
        const { result } = renderHook(() => useReviews({ mode: 'event', eventId: null }));

        // Give any (wrongly) scheduled effect a tick to run.
        await new Promise((r) => setTimeout(r, 10));
        expect(result.current.loading).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('all mode hits /api/reviews/all and maps total→count', async () => {
        const fetchMock = installClientFetch([
            { match: '/api/reviews/all', body: { total: 9, average: 4.2, reviews: [{ id: 'rv_x', rating: 4 }] } },
        ]);
        const { result } = renderHook(() => useReviews({ mode: 'all', limit: 50 }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.count).toBe(9);
        expect(result.current.average).toBe(4.2);
        expect(fetchMock.mock.calls[0][0]).toContain('/api/reviews/all?limit=50');
    });

    it('zero-state summary yields null average + count 0 + empty reviews', async () => {
        installClientFetch([
            { match: '/api/reviews/summary', body: { overall: { average: null, count: 0 }, recent: [] } },
        ]);
        const { result } = renderHook(() => useReviews({ mode: 'summary' }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.average).toBeNull();
        expect(result.current.count).toBe(0);
        expect(result.current.reviews).toEqual([]);
    });

    it('surfaces an error and reports count 0 on a non-ok response', async () => {
        installClientFetch([
            { match: '/api/reviews/summary', status: 500, body: { error: 'boom' } },
        ]);
        const { result } = renderHook(() => useReviews({ mode: 'summary' }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeTruthy();
        expect(result.current.count).toBe(0);
    });
});

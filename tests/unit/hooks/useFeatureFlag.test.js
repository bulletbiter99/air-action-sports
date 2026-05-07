// Unit tests for the imperative half of src/admin/useFeatureFlag.js —
// setFeatureFlagOverride. The React hook's read path is exercised via
// integration in tests/unit/admin/feature-flags-route.test.js (worker
// side) plus manual browser verification of the AdminSettings toggle.

import { describe, it, expect, vi } from 'vitest';
import { setFeatureFlagOverride } from '../../../src/admin/useFeatureFlag.js';

describe('setFeatureFlagOverride', () => {
    it('issues PUT to /api/admin/feature-flags/:key/override with { enabled }', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true });

        await setFeatureFlagOverride('density_compact', true);

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toBe('/api/admin/feature-flags/density_compact/override');
        expect(opts.method).toBe('PUT');
        expect(opts.credentials).toBe('include');
        expect(opts.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(opts.body)).toEqual({ enabled: true });
    });

    it('returns true on a 2xx response', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true });
        const result = await setFeatureFlagOverride('density_compact', false);
        expect(result).toBe(true);
        // Verify enabled=false serializes correctly too
        expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ enabled: false });
    });

    it('returns false on a non-2xx response (e.g. 401 unauthenticated)', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
        const result = await setFeatureFlagOverride('density_compact', true);
        expect(result).toBe(false);
    });
});

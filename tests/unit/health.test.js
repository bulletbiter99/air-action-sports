// First sanity test for the M1 test infrastructure.
//
// Validates: (a) Vitest is wired correctly, (b) worker/index.js imports
// cleanly under Node 20 (no Cloudflare-only globals leak at import time),
// (c) Hono routing reaches /api/health, (d) withSecurityHeaders applies on
// every response, (e) the env mock factory provides everything needed for
// a basic API call.
//
// This is NOT a do-not-touch test — /api/health is a public uptime check
// with no production-side coupling. It's safe to characterize and modify
// independently. Real characterization tests for do-not-touch surfaces
// land in batches 2-5.

import { describe, it, expect } from 'vitest';
import worker from '../../worker/index.js';
import { createMockEnv } from '../helpers/mockEnv.js';

const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
};

describe('GET /api/health', () => {
    it('returns ok:true with a numeric timestamp', async () => {
        const env = createMockEnv();
        const req = new Request('https://airactionsport.com/api/health');
        const res = await worker.fetch(req, env, ctx);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(typeof body.ts).toBe('number');
        expect(body.ts).toBeGreaterThan(0);
    });

    it('applies the security header wrapper to the response', async () => {
        const env = createMockEnv();
        const req = new Request('https://airactionsport.com/api/health');
        const res = await worker.fetch(req, env, ctx);

        // worker/index.js withSecurityHeaders wraps every response.
        expect(res.headers.get('strict-transport-security')).toBe(
            'max-age=31536000; includeSubDomains'
        );
        expect(res.headers.get('x-frame-options')).toBe('DENY');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    });

    it('applies Cache-Control: no-store for /api/* responses', async () => {
        const env = createMockEnv();
        const req = new Request('https://airactionsport.com/api/health');
        const res = await worker.fetch(req, env, ctx);

        // worker/index.js applies Cache-Control: no-store for all /api/* paths.
        expect(res.headers.get('cache-control')).toContain('no-store');
    });
});

// M8 Batch C — client-side fetch mock for React component tests.
//
// The admin page components call `fetch(url, opts)` directly and read
// `res.ok` / `res.status` / `await res.json()`. tests/setup.js already installs a
// throw-on-unmocked `globalThis.fetch` vi-mock; this helper swaps in a
// route-matching implementation for a single component test. Because it mutates
// that existing vi-mock, tests/setup.js's `beforeEach` resets it between tests —
// no manual teardown. It's the client-side analog of mockEnv / mockD1 (worker).
//
// Usage (in a *.test.jsx, jsdom env):
//   const fetchMock = installClientFetch([
//     { match: '/api/admin/campaigns', body: { campaigns: [...] } },
//     { match: '/api/admin/segments',  body: { segments: [] } },
//     { match: '/api/admin/x',         status: 500, body: { error: 'boom' } },
//   ]);
// `match` is a URL substring (includes) or a RegExp; first hit wins. `status`
// defaults to 200 (ok derived from it). `body` may be a value or a 0-arg function.
// Unmatched URLs throw, surfacing accidental real calls. Returns the vi mock fn so
// callers can assert `.mock.calls` (e.g. a status-filter re-fetch URL).

import { vi } from 'vitest';

export function installClientFetch(routes = []) {
    const impl = async (input) => {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        for (const r of routes) {
            const hit = r.match instanceof RegExp ? r.match.test(url) : url.includes(r.match);
            if (hit) {
                const status = r.status ?? 200;
                const body = typeof r.body === 'function' ? r.body() : r.body;
                return {
                    ok: status >= 200 && status < 300,
                    status,
                    json: async () => body,
                    text: async () => JSON.stringify(body),
                };
            }
        }
        throw new Error(`Unmocked client fetch: ${url}`);
    };
    if (globalThis.fetch && vi.isMockFunction(globalThis.fetch)) {
        globalThis.fetch.mockImplementation(impl);
        return globalThis.fetch;
    }
    globalThis.fetch = vi.fn(impl);
    return globalThis.fetch;
}

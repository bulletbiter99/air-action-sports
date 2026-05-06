// Fetch-level Stripe mock. The bespoke worker/lib/stripe.js wrapper calls
// `https://api.stripe.com/v1/...` via global fetch — we override that fetch
// to return canned responses keyed by "METHOD /v1/path".
//
// Usage:
//   import { mockStripeFetch } from '../helpers/mockStripe.js';
//
//   mockStripeFetch({
//     'POST /v1/checkout/sessions': {
//       id: 'cs_mock_123',
//       url: 'https://checkout.stripe.com/c/cs_mock_123',
//       payment_intent: 'pi_mock_123',
//     },
//     'POST /v1/refunds': { id: 're_mock', status: 'succeeded' },
//   });
//
// Inspect captured calls via globalThis.fetch.mock.calls — each entry is
// [url, init].

const STRIPE_BASE = 'https://api.stripe.com';

export function mockStripeFetch(responses = {}) {
    globalThis.fetch.mockImplementation(async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        const method = (init.method || 'GET').toUpperCase();

        if (!url.startsWith(STRIPE_BASE)) {
            throw new Error(
                `mockStripeFetch: unexpected non-Stripe URL: ${url}. ` +
                'Did you mean to also call mockResendFetch?'
            );
        }

        const path = url.slice(STRIPE_BASE.length).split('?')[0];
        const key = `${method} ${path}`;
        const r = responses[key];

        if (r === undefined) {
            return new Response(
                JSON.stringify({ error: { message: `mockStripeFetch: no mock for ${key}` } }),
                { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
        }
        if (r instanceof Response) return r;

        // Allow tests to override status by attaching __status to the body.
        const status = r.__status || 200;
        const body = { ...r };
        delete body.__status;

        return new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
        });
    });

    return globalThis.fetch;
}

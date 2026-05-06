// Fetch-level Resend mock. worker/lib/email.js posts to
// https://api.resend.com/emails with `{ from, to, subject, html, text, tags }`.
// We override global fetch to return success.
//
// Usage:
//   mockResendFetch();                          // default success
//   mockResendFetch({ id: 'specific-email-id' }); // override response body
//   mockResendFetch({ __status: 429 });          // simulate Resend rate-limit
//
// Inspect captured calls via globalThis.fetch.mock.calls — each entry is
// [url, init]. Init.body is the JSON-stringified payload sent to Resend.

const RESEND_URL = 'https://api.resend.com/emails';

export function mockResendFetch(response = { id: 'mock-resend-id' }) {
    globalThis.fetch.mockImplementation(async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;

        if (url !== RESEND_URL) {
            throw new Error(
                `mockResendFetch: unexpected non-Resend URL: ${url}. ` +
                'Did you mean to also call mockStripeFetch?'
            );
        }

        const status = response.__status || 200;
        const body = { ...response };
        delete body.__status;

        return new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
        });
    });

    return globalThis.fetch;
}

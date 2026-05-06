// Compute a Stripe-compatible HMAC-SHA256 signature header for tests.
// Mirrors the algorithm in worker/lib/stripe.js verifyWebhookSignature so
// our tests can exercise that function with payloads we control.
//
// Stripe-Signature header format: "t=<unix_seconds>,v1=<hex_sha256>[,v1=<hex>...]"
// HMAC payload: `${timestamp}.${body}` — body is the verbatim request body
// the receiver will read.
//
// Usage:
//   const { signatureHeader, body } = await signStripeWebhook({
//     payload: { type: 'checkout.session.completed', data: { object: {...} } },
//     secret: 'whsec_test',
//   });
//
//   // Inject extra (incorrect) v1 values to test rotation:
//   await signStripeWebhook({
//     payload, secret,
//     multiV1: { values: ['a'.repeat(64)] },  // bogus first; correct appended after
//   });
//
//   // Override timestamp (for stale-tolerance tests):
//   await signStripeWebhook({ payload, secret, timestamp: <unix_seconds> });

export async function signStripeWebhook({
    payload,
    secret,
    timestamp = null,
    multiV1 = null,
}) {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const data = `${ts}.${body}`;

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    const sigHex = Array.from(new Uint8Array(sigBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    let signatureHeader;
    if (multiV1) {
        // Build a header with multiple v1= entries. By default the correctly-
        // computed sigHex is appended last so it WILL match. Pass
        // multiV1.appendCorrect=false to test the all-bogus case.
        const parts = [`t=${ts}`];
        for (const v of (multiV1.values || [])) {
            parts.push(`v1=${v}`);
        }
        if (multiV1.appendCorrect !== false) {
            parts.push(`v1=${sigHex}`);
        }
        signatureHeader = parts.join(',');
    } else {
        signatureHeader = `t=${ts},v1=${sigHex}`;
    }

    return { signatureHeader, body, sigHex, timestamp: ts };
}

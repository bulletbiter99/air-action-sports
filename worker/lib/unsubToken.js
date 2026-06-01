// HMAC unsubscribe tokens — stateless, per-customer.
//
// The marketing unsubscribe link carries ?c=<customerId>&t=<token>, where token
// is HMAC-SHA256(customerId) under SESSION_SECRET (same secret-reuse posture as
// vendorToken.js — rotating SESSION_SECRET invalidates outstanding links, which
// is the right behavior on a compromise). No expiry: CAN-SPAM requires the
// unsubscribe to keep working for at least 30 days after a send; never-expiring
// is simplest and compliant.
//
// Tests: tests/unit/lib/unsubToken.test.js

/** Mint the unsubscribe token for a customer id. */
export async function createUnsubToken(customerId, secret) {
    return sign(String(customerId), secret);
}

/** True iff `token` is the valid unsubscribe token for `customerId`. Constant-time. */
export async function verifyUnsubToken(customerId, token, secret) {
    if (customerId == null || !token || typeof token !== 'string') return false;
    const expected = await sign(String(customerId), secret);
    return timingSafeEqualStr(expected, token);
}

async function sign(data, secret) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return b64urlBytes(new Uint8Array(sig));
}

function b64urlBytes(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqualStr(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

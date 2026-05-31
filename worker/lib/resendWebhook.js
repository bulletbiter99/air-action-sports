// Svix-style webhook signature verification for Resend webhooks.
//
// Resend signs every webhook with Svix. Three headers travel with each POST:
//   svix-id         — unique message id (stable across redeliveries; our
//                     idempotency key)
//   svix-timestamp  — unix SECONDS the message was signed (replay guard)
//   svix-signature  — space-delimited list of "v<ver>,<base64sig>" tokens
//                     (multiple appear during secret rotation)
//
// Algorithm (https://docs.svix.com/receiving/verifying-payloads/how-manual):
//   signedContent = `${svix-id}.${svix-timestamp}.${rawBody}`
//   key           = base64-decode(secret without its "whsec_" prefix)
//   expected      = base64( HMAC-SHA256(key, signedContent) )
//   accept iff expected matches the sig part of ANY "v1,…" token.
//
// This intentionally MIRRORS the structure of worker/lib/stripe.js
// verifyWebhookSignature but is a separate function — the two schemes differ:
//   - Stripe HMACs `${ts}.${body}` with the RAW secret string and hex-encodes;
//     v1 values live in a comma-separated `t=…,v1=…` header.
//   - Svix HMACs `${id}.${ts}.${body}` with the BASE64-DECODED secret and
//     base64-encodes; v1 values live in a space-separated `v1,…` header.
// Keeping them separate preserves the Critical-DNT Stripe verifier byte-for-byte.

const SVIX_PREFIX = 'whsec_';

/**
 * Verify a Resend (Svix) webhook and return the parsed JSON body.
 *
 * @param {object} args
 * @param {string} args.body          Raw request body (verbatim — do NOT re-stringify).
 * @param {string} args.svixId        `svix-id` header.
 * @param {string} args.svixTimestamp `svix-timestamp` header (unix seconds).
 * @param {string} args.svixSignature `svix-signature` header.
 * @param {string} args.secret        Signing secret, e.g. `whsec_<base64>`.
 * @param {number} [args.tolerance=300] Max clock skew in seconds.
 * @returns {Promise<object>} Parsed event body.
 * @throws on any missing header, stale timestamp, or signature mismatch.
 */
export async function verifyResendWebhook({ body, svixId, svixTimestamp, svixSignature, secret, tolerance = 300 }) {
    if (!secret) throw new Error('Missing Resend webhook secret');
    if (!svixId || !svixTimestamp || !svixSignature) {
        throw new Error('Missing svix-id / svix-timestamp / svix-signature header');
    }

    // Replay guard — reject messages signed too long ago (or too far in the future).
    const tsSec = Number(svixTimestamp);
    if (!Number.isFinite(tsSec)) throw new Error('Malformed svix-timestamp');
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - tsSec) > tolerance) {
        throw new Error('Webhook timestamp outside tolerance');
    }

    // Decode the signing key (strip the whsec_ prefix if present, then base64-decode).
    const b64Secret = secret.startsWith(SVIX_PREFIX) ? secret.slice(SVIX_PREFIX.length) : secret;
    let keyBytes;
    try {
        keyBytes = base64ToBytes(b64Secret);
    } catch {
        throw new Error('Malformed Resend webhook secret');
    }

    const signedContent = `${svixId}.${svixTimestamp}.${body}`;
    const key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
    const expected = bytesToBase64(new Uint8Array(sigBuf));

    // svix-signature: space-delimited "v1,<base64>" tokens. Accept any v1 match.
    let matched = false;
    for (const token of svixSignature.split(' ')) {
        const comma = token.indexOf(',');
        if (comma < 0) continue;
        const version = token.slice(0, comma);
        const sig = token.slice(comma + 1);
        if (version !== 'v1') continue;
        if (timingSafeEqual(expected, sig)) { matched = true; break; }
    }
    if (!matched) throw new Error('Webhook signature mismatch');

    return JSON.parse(body);
}

// Constant-time string compare (mirrors the private helper in stripe.js).
function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

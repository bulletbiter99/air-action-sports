// Compute a Svix-compatible webhook signature for tests, mirroring the
// algorithm in worker/lib/resendWebhook.js verifyResendWebhook so our tests can
// exercise that function (and the /resend route) with payloads we control.
//
// Svix headers: svix-id, svix-timestamp (unix SECONDS), svix-signature.
// signed content = `${svixId}.${svixTimestamp}.${body}`
// key            = base64-decode(secret without its "whsec_" prefix)
// signature      = "v1," + base64( HMAC-SHA256(key, signedContent) )
//
// Usage:
//   const { headers, body } = await signSvixWebhook({
//     payload: { type: 'email.bounced', data: { email: 'a@b.com', bounce_type: 'hard' } },
//     secret: 'whsec_c3ZpeF90ZXN0X3NlY3JldF8wMQ==',
//   });
//   // Tamper / replay / multi-token variants:
//   await signSvixWebhook({ payload, secret, tamperBody: true });   // body changed post-sign
//   await signSvixWebhook({ payload, secret, badSig: true });       // corrupt the sig
//   await signSvixWebhook({ payload, secret, timestamp: 1 });       // stale (replay)
//   await signSvixWebhook({ payload, secret, extraV1: ['AAAA'] });  // bogus v1 first, correct appended

export async function signSvixWebhook({
    payload,
    secret,
    svixId = 'msg_test_0001',
    timestamp = null,
    tamperBody = false,
    badSig = false,
    extraV1 = null,
}) {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);

    const b64Secret = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
    const key = await crypto.subtle.importKey(
        'raw',
        base64ToBytes(b64Secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signedContent = `${svixId}.${ts}.${body}`;
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
    let sigB64 = bytesToBase64(new Uint8Array(sigBuf));
    if (badSig) sigB64 = `AAAA${sigB64.slice(4)}`; // corrupt while preserving length

    // Build the svix-signature header (space-delimited "v1,<b64>" tokens).
    const tokens = [];
    for (const bogus of (extraV1 || [])) tokens.push(`v1,${bogus}`);
    tokens.push(`v1,${sigB64}`);
    const svixSignature = tokens.join(' ');

    return {
        body: tamperBody ? `${body} ` : body,
        svixId,
        svixTimestamp: String(ts),
        svixSignature,
        headers: {
            'svix-id': svixId,
            'svix-timestamp': String(ts),
            'svix-signature': svixSignature,
        },
    };
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

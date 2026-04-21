// HMAC-signed vendor-package access tokens. Embeds the event_vendor id and
// the token_version at issue time; the Worker rejects any token whose
// embedded version is lower than the current row's token_version, letting
// admins revoke access instantly by bumping the column.
//
// Format: b64url(JSON).b64url(HMAC-SHA256)
// Payload: { evid: string, tv: number, exp: seconds_epoch }
//
// Reuses SESSION_SECRET so we don't introduce another secret lifecycle.
// Rotating SESSION_SECRET invalidates all vendor tokens, which matches the
// "assume compromise" posture we'd want on a rotation anyway.

export async function createVendorToken(eventVendorId, tokenVersion, expiresAtMs, secret) {
    const payload = {
        evid: eventVendorId,
        tv: tokenVersion,
        exp: Math.floor(expiresAtMs / 1000),
    };
    const header = b64urlString(JSON.stringify(payload));
    const sig = await sign(header, secret);
    return `${header}.${sig}`;
}

// Returns { evid, tv, exp } on success, null on any failure (bad format,
// bad signature, or expired). Caller must still check tv against the
// current event_vendors.token_version value.
export async function verifyVendorToken(token, secret) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [header, sig] = parts;
    const expected = await sign(header, secret);
    if (!timingSafeEqualStr(expected, sig)) return null;
    let payload;
    try {
        payload = JSON.parse(b64urlDecodeString(header));
    } catch { return null; }
    if (typeof payload?.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload?.evid !== 'string' || typeof payload?.tv !== 'number') return null;
    return payload;
}

async function sign(data, secret) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return b64urlBytes(new Uint8Array(sig));
}

function b64urlString(s) {
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlBytes(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecodeString(s) {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4);
    return atob(padded);
}
function timingSafeEqualStr(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

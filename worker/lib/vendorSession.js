// HMAC-signed session cookie for vendor-contact logins. Same primitive as
// the admin session but with a distinct cookie name so browsers don't leak
// admin auth to the vendor portal or vice versa.

export const VENDOR_COOKIE_NAME = 'aas_vendor';
const TTL_SEC = 30 * 24 * 60 * 60; // 30 days — vendors log in rarely

export async function createVendorSession(contactId, sessionVersion, secret) {
    const payload = {
        cid: contactId,
        sv: sessionVersion,
        exp: Math.floor(Date.now() / 1000) + TTL_SEC,
    };
    const header = b64urlString(JSON.stringify(payload));
    const sig = await sign(header, secret);
    return `${header}.${sig}`;
}

export async function verifyVendorSession(cookieValue, secret) {
    if (!cookieValue || typeof cookieValue !== 'string') return null;
    const parts = cookieValue.split('.');
    if (parts.length !== 2) return null;
    const [header, sig] = parts;
    const expected = await sign(header, secret);
    if (!timingSafeEqualStr(expected, sig)) return null;
    let payload;
    try { payload = JSON.parse(b64urlDecodeString(header)); } catch { return null; }
    if (typeof payload?.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload?.cid !== 'string') return null;
    return payload;
}

export function setVendorCookie(value) {
    return `${VENDOR_COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${TTL_SEC}`;
}
export function clearVendorCookie() {
    return `${VENDOR_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
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
function b64urlString(s) { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlBytes(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
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

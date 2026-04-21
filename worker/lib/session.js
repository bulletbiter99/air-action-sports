// HMAC-signed session cookie. Payload = base64url(JSON), signature = base64url(HMAC-SHA256).

export const COOKIE_NAME = 'aas_session';
const TTL_SEC = 7 * 24 * 60 * 60; // 7 days

// sv = session_version. Must match users.session_version at auth-time.
// Bumping the DB column invalidates every existing cookie for that user.
export async function createSession(userId, role, sessionVersion, secret) {
    const payload = {
        uid: userId,
        role,
        sv: sessionVersion,
        exp: Math.floor(Date.now() / 1000) + TTL_SEC,
    };
    const header = b64urlString(JSON.stringify(payload));
    const sig = await sign(header, secret);
    return `${header}.${sig}`;
}

export async function verifySession(cookieValue, secret) {
    if (!cookieValue || typeof cookieValue !== 'string') return null;
    const parts = cookieValue.split('.');
    if (parts.length !== 2) return null;
    const [header, sig] = parts;
    const expected = await sign(header, secret);
    if (!timingSafeEqualStr(expected, sig)) return null;
    let payload;
    try {
        payload = JSON.parse(b64urlDecodeString(header));
    } catch { return null; }
    if (typeof payload?.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
}

export function setCookie(value) {
    return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${TTL_SEC}`;
}
export function clearCookie() {
    return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function parseCookieHeader(header, name = COOKIE_NAME) {
    if (!header) return null;
    const parts = header.split(';').map((p) => p.trim());
    for (const p of parts) {
        const eq = p.indexOf('=');
        if (eq === -1) continue;
        if (p.slice(0, eq) === name) return p.slice(eq + 1);
    }
    return null;
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

// M5 Batch 6 — Light-access portal session machinery (Surface 4a part 4).
//
// Tier-3 persons receive a magic-link email when an admin clicks "Invite
// to portal". Clicking the link consumes the token and converts to a
// cookie-based session for ~30 days. Bumping portal_sessions.token_version
// or setting revoked_at = NOW invalidates outstanding cookies.
//
// Strict separation from /admin/* enforced via cookie name:
//   - /admin/* uses 'aas_session' (worker/lib/session.js)
//   - /portal/* uses 'aas_portal_session' (this file)
//
// The portal cookie is HMAC-signed with SESSION_SECRET (same primitive
// as admin sessions) but encodes the portal_session_id rather than the
// user_id, and looks up the persons row indirectly.

const TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const TOKEN_LENGTH_BYTES = 32; // 256 bits of entropy
const PORTAL_COOKIE_NAME = 'aas_portal_session';

// ────────────────────────────────────────────────────────────────────
// Token mint + hash (used by the admin invite endpoint)
// ────────────────────────────────────────────────────────────────────

/**
 * Generates a fresh magic-link token (cleartext) + its SHA-256 hash.
 * The cleartext is sent in the email; only the hash is stored in
 * portal_sessions.token_hash.
 *
 * @returns {Promise<{ token: string, tokenHash: string }>}
 */
export async function mintInviteToken() {
    const bytes = new Uint8Array(TOKEN_LENGTH_BYTES);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const tokenHash = await sha256Hex(token);
    return { token, tokenHash };
}

async function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ────────────────────────────────────────────────────────────────────
// Cookie minting / verification (after token consume)
// ────────────────────────────────────────────────────────────────────

/**
 * Creates an HMAC-signed portal session cookie value. The payload encodes
 * the portal_sessions.id + token_version + expiry; the server reads it
 * back and joins to the persons row via portal_sessions.person_id.
 *
 * @param {string} portalSessionId
 * @param {number} tokenVersion
 * @param {string} secret  - SESSION_SECRET
 */
export async function createPortalCookie(portalSessionId, tokenVersion, secret) {
    const payload = {
        psi: portalSessionId,
        tv: tokenVersion,
        exp: Math.floor(Date.now() / 1000) + TTL_SEC,
    };
    const header = b64urlString(JSON.stringify(payload));
    const sig = await sign(header, secret);
    return `${header}.${sig}`;
}

export async function verifyPortalCookie(cookieValue, secret) {
    if (!cookieValue || typeof cookieValue !== 'string') return null;
    const parts = cookieValue.split('.');
    if (parts.length !== 2) return null;
    const [header, sig] = parts;
    const expected = await sign(header, secret);
    if (!timingSafeEqualStr(expected, sig)) return null;
    let payload;
    try { payload = JSON.parse(b64urlDecodeString(header)); } catch { return null; }
    if (typeof payload?.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.psi) return null;
    return payload;
}

export function setPortalCookie(value) {
    return `${PORTAL_COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${TTL_SEC}`;
}

export function clearPortalCookie() {
    return `${PORTAL_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function parsePortalCookieHeader(header) {
    if (!header) return null;
    const parts = header.split(';').map((p) => p.trim());
    for (const p of parts) {
        const eq = p.indexOf('=');
        if (eq === -1) continue;
        if (p.slice(0, eq) === PORTAL_COOKIE_NAME) return p.slice(eq + 1);
    }
    return null;
}

// ────────────────────────────────────────────────────────────────────
// Hono middleware: requirePortalAuth (mirrors requireAuth)
// ────────────────────────────────────────────────────────────────────

/**
 * Hono middleware that verifies the portal cookie, looks up the
 * portal_sessions row + the linked persons row, validates token_version,
 * and attaches the person to c.set('person', ...). Returns 401 on any
 * failure.
 */
export async function requirePortalAuth(c, next) {
    const cookieHeader = c.req.header('cookie');
    const cookieValue = parsePortalCookieHeader(cookieHeader);
    const session = await verifyPortalCookie(cookieValue, c.env.SESSION_SECRET);
    if (!session) return c.json({ error: 'Not authenticated' }, 401);

    const portalRow = await c.env.DB.prepare(
        `SELECT ps.id, ps.person_id, ps.token_version, ps.cookie_expires_at, ps.revoked_at,
                p.id AS person_id, p.full_name, p.email, p.archived_at, p.status
         FROM portal_sessions ps
         INNER JOIN persons p ON p.id = ps.person_id
         WHERE ps.id = ?`
    ).bind(session.psi).first().catch(() => null);
    if (!portalRow) return c.json({ error: 'Session not found' }, 401);

    if (portalRow.token_version !== session.tv) {
        return c.json({ error: 'Session revoked' }, 401);
    }
    if (portalRow.revoked_at) {
        return c.json({ error: 'Session revoked' }, 401);
    }
    if (portalRow.cookie_expires_at && portalRow.cookie_expires_at < Date.now()) {
        return c.json({ error: 'Session expired' }, 401);
    }
    if (portalRow.archived_at) {
        return c.json({ error: 'Account archived' }, 401);
    }

    c.set('portalSession', { id: portalRow.id });
    c.set('person', {
        id: portalRow.person_id,
        full_name: portalRow.full_name,
        email: portalRow.email,
        status: portalRow.status,
    });
    await next();
}

// ────────────────────────────────────────────────────────────────────
// Internal HMAC helpers (mirrors session.js)
// ────────────────────────────────────────────────────────────────────

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

export { PORTAL_COOKIE_NAME };

// Body-size guard for JSON endpoints.
//
// Cloudflare Workers accept up to 100MB request bodies by default. For any
// endpoint that parses JSON, an attacker-supplied 10MB body is a CPU-burn
// and memory-pressure vector — especially on unauthenticated public paths
// (checkout, login, forgot-password, waiver submission).
//
// readJson() applies a byte cap BEFORE parsing. It first checks the
// Content-Length header to reject early, then re-measures the actual body
// after reading (in case the header lied). Both gates return 413 when
// tripped.
//
// Usage:
//   const p = await readJson(c, 8 * 1024);
//   if (p.error) return c.json({ error: p.error }, p.status);
//   const body = p.body;
//
// Size guidance:
//   - Auth flows (email+password only):           4 KB
//   - Small forms (edit attendee, promo code):    8 KB
//   - Default (admin CRUD, event edits):         16 KB
//   - Booking checkout/quote (attendees array):  64 KB
//   - Email templates (HTML body):              128 KB

export async function readJson(c, maxBytes = 16 * 1024) {
    const headerLen = Number(c.req.header('content-length') || '0');
    if (headerLen > maxBytes) {
        return { error: `Request body too large (max ${maxBytes} bytes)`, status: 413 };
    }
    let raw;
    try {
        raw = await c.req.text();
    } catch {
        return { error: 'Could not read request body', status: 400 };
    }
    // Byte length (not char length) — encoding-safe.
    const actualBytes = new TextEncoder().encode(raw).byteLength;
    if (actualBytes > maxBytes) {
        return { error: `Request body too large (max ${maxBytes} bytes)`, status: 413 };
    }
    if (!raw) return { body: {} };
    try {
        return { body: JSON.parse(raw) };
    } catch {
        return { error: 'Invalid JSON', status: 400 };
    }
}

// Size presets — keep call sites self-documenting.
export const BODY_LIMITS = {
    AUTH: 4 * 1024,
    SMALL: 8 * 1024,
    DEFAULT: 16 * 1024,
    BOOKING: 64 * 1024,
    EMAIL_TEMPLATE: 128 * 1024,
};

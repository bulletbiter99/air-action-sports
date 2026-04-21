// Vendor contact password portal — optional convenience layer on top of the
// magic-link system. Once logged in, a contact can list all their active
// packages; clicking one mints a fresh magic-link token and redirects to
// /v/:token, so package-scoped authorization stays token-driven everywhere.

import { Hono } from 'hono';
import { rateLimit, clientIp } from '../lib/rateLimit.js';
import { readJson, BODY_LIMITS } from '../lib/bodyGuard.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
    createVendorSession, verifyVendorSession,
    setVendorCookie, clearVendorCookie, VENDOR_COOKIE_NAME,
} from '../lib/vendorSession.js';
import { verifyVendorToken, createVendorToken } from '../lib/vendorToken.js';

const vendorAuth = new Hono();

// Noindex / no-store headers on every auth-portal response.
vendorAuth.use('*', async (c, next) => {
    await next();
    c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cache-Control', 'private, no-store');
});

function parseVendorCookie(c) {
    const header = c.req.header('cookie');
    if (!header) return null;
    const parts = header.split(';').map((p) => p.trim());
    for (const p of parts) {
        const eq = p.indexOf('=');
        if (eq === -1) continue;
        if (p.slice(0, eq) === VENDOR_COOKIE_NAME) return p.slice(eq + 1);
    }
    return null;
}

async function requireVendor(c) {
    const cookie = parseVendorCookie(c);
    const payload = await verifyVendorSession(cookie, c.env.SESSION_SECRET);
    if (!payload) return null;
    const contact = await c.env.DB.prepare(
        `SELECT vc.*, v.company_name AS vendor_company_name
         FROM vendor_contacts vc
         JOIN vendors v ON v.id = vc.vendor_id
         WHERE vc.id = ? AND vc.deleted_at IS NULL AND v.deleted_at IS NULL`
    ).bind(payload.cid).first();
    if (!contact) return null;
    if (contact.session_version !== payload.sv) return null;
    return contact;
}

// POST /api/vendor/auth/set-password  { magicToken, password }
// Sets (or resets) the password for whichever contact owns the magic-link
// token. A valid active magic link is proof of access to the contact's email
// — we piggyback on that rather than sending a separate email verification.
vendorAuth.post('/set-password', rateLimit('RL_RESET_PWD'), async (c) => {
    const p = await readJson(c, BODY_LIMITS.SMALL);
    if (p.error) return c.json({ error: p.error }, p.status);
    const body = p.body || {};
    const magicToken = String(body.magicToken || '');
    const password = String(body.password || '');
    if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);
    if (password.length > 200) return c.json({ error: 'Password too long' }, 400);

    const payload = await verifyVendorToken(magicToken, c.env.SESSION_SECRET);
    if (!payload) return c.json({ error: 'Invalid or expired magic link' }, 401);

    const ev = await c.env.DB.prepare(
        `SELECT ev.*, vc.id AS contact_id
         FROM event_vendors ev
         LEFT JOIN vendor_contacts vc ON vc.id = ev.primary_contact_id AND vc.deleted_at IS NULL
         WHERE ev.id = ?`
    ).bind(payload.evid).first();
    if (!ev || ev.token_version !== payload.tv || ev.status === 'revoked') {
        return c.json({ error: 'Invalid or expired magic link' }, 401);
    }
    if (!ev.contact_id) return c.json({ error: 'No primary contact associated with this package' }, 400);

    const hash = await hashPassword(password);
    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE vendor_contacts
         SET password_hash = ?, password_updated_at = ?, session_version = session_version + 1
         WHERE id = ?`
    ).bind(hash, now, ev.contact_id).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
         VALUES (NULL, 'vendor_contact.password_set', 'vendor_contact', ?, ?, ?, ?)`
    ).bind(ev.contact_id, JSON.stringify({ event_vendor_id: ev.id }), clientIp(c), now).run();

    return c.json({ ok: true });
});

// POST /api/vendor/auth/login { email, password }
vendorAuth.post('/login', rateLimit('RL_LOGIN'), async (c) => {
    const p = await readJson(c, BODY_LIMITS.SMALL);
    if (p.error) return c.json({ error: p.error }, p.status);
    const body = p.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) return c.json({ error: 'Email and password required' }, 400);

    // Email may match multiple contacts (different vendors, same person) — we
    // try each one that has a password set and find the first whose hash
    // matches. Deliberately generic error messages to avoid user enumeration.
    const candidates = await c.env.DB.prepare(
        `SELECT vc.* FROM vendor_contacts vc
         JOIN vendors v ON v.id = vc.vendor_id
         WHERE vc.email = ? AND vc.deleted_at IS NULL AND vc.password_hash IS NOT NULL
           AND v.deleted_at IS NULL`
    ).bind(email).all();

    for (const c0 of candidates.results || []) {
        if (await verifyPassword(password, c0.password_hash)) {
            const session = await createVendorSession(c0.id, c0.session_version, c.env.SESSION_SECRET);
            c.header('Set-Cookie', setVendorCookie(session));
            await c.env.DB.prepare(
                `UPDATE vendor_contacts SET last_login_at = ? WHERE id = ?`
            ).bind(Date.now(), c0.id).run();
            await c.env.DB.prepare(
                `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
                 VALUES (NULL, 'vendor_contact.login', 'vendor_contact', ?, ?, ?, ?)`
            ).bind(c0.id, null, clientIp(c), Date.now()).run();
            return c.json({
                contact: { id: c0.id, name: c0.name, email: c0.email },
            });
        }
    }
    return c.json({ error: 'Invalid email or password' }, 401);
});

// POST /api/vendor/auth/logout
vendorAuth.post('/logout', async (c) => {
    const contact = await requireVendor(c);
    if (contact) {
        // Bump session version to invalidate any other active cookies for this contact.
        await c.env.DB.prepare(
            `UPDATE vendor_contacts SET session_version = session_version + 1 WHERE id = ?`
        ).bind(contact.id).run();
    }
    c.header('Set-Cookie', clearVendorCookie());
    return c.json({ ok: true });
});

// GET /api/vendor/auth/me
vendorAuth.get('/me', async (c) => {
    const contact = await requireVendor(c);
    if (!contact) return c.json({ contact: null });
    return c.json({
        contact: {
            id: contact.id,
            name: contact.name,
            email: contact.email,
            vendorId: contact.vendor_id,
            vendorCompanyName: contact.vendor_company_name,
        },
    });
});

// GET /api/vendor/my-packages — all non-revoked packages across every
// vendor_contact row that shares this contact's email. Each package comes
// back with a freshly-minted magic-link token and a /v/:token URL so the UI
// can route straight through.
vendorAuth.get('/my-packages', async (c) => {
    const contact = await requireVendor(c);
    if (!contact) return c.json({ error: 'Not authenticated' }, 401);

    // Collect every contact_id across any vendor that shares this email — a
    // single person may be listed on multiple vendor records.
    const siblings = await c.env.DB.prepare(
        `SELECT id, vendor_id FROM vendor_contacts
         WHERE email = ? AND deleted_at IS NULL`
    ).bind(contact.email).all();
    const vendorIds = [...new Set((siblings.results || []).map((r) => r.vendor_id))];
    if (vendorIds.length === 0) return c.json({ packages: [] });

    const placeholders = vendorIds.map(() => '?').join(',');
    const rows = await c.env.DB.prepare(
        `SELECT ev.*, e.title AS event_title, e.display_date AS event_display_date,
                e.date_iso AS event_date_iso, v.company_name AS vendor_company_name
         FROM event_vendors ev
         JOIN events e ON e.id = ev.event_id
         JOIN vendors v ON v.id = ev.vendor_id
         WHERE ev.vendor_id IN (${placeholders})
           AND ev.status != 'revoked'
           AND v.deleted_at IS NULL
         ORDER BY e.date_iso ASC`
    ).bind(...vendorIds).all();

    const secret = c.env.SESSION_SECRET;
    const now = Date.now();
    const SHORT_TTL_MS = 24 * 60 * 60 * 1000; // 24h — this is a convenience link
    const packages = [];
    for (const r of rows.results || []) {
        // Bake a short-TTL token based on the package's current token_version
        // so any revoke bump still kills the portal-issued link.
        const tokenExpiresAt = Math.min(
            r.token_expires_at ?? (now + SHORT_TTL_MS),
            now + SHORT_TTL_MS,
        );
        const token = await createVendorToken(r.id, r.token_version, tokenExpiresAt, secret);
        packages.push({
            eventVendorId: r.id,
            status: r.status,
            event: {
                id: r.event_id,
                title: r.event_title,
                displayDate: r.event_display_date,
                dateIso: r.event_date_iso,
            },
            vendorCompanyName: r.vendor_company_name,
            contractRequired: !!r.contract_required,
            contractSignedAt: r.contract_signed_at,
            contractCountersignedAt: r.contract_countersigned_at,
            packageUrl: `${c.env.SITE_URL}/v/${token}`,
        });
    }

    return c.json({ packages });
});

export default vendorAuth;

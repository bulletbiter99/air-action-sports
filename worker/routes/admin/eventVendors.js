// Admin management of per-event vendor packages. Handles attaching a vendor
// to an event, composing the package sections, sending the magic link email,
// and revoking access. The vendor-facing read/download side lives in
// worker/routes/vendor.js.

import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { randomId } from '../../lib/ids.js';
import { clientIp } from '../../lib/rateLimit.js';
import { createVendorToken } from '../../lib/vendorToken.js';
import { loadTemplate, renderTemplate } from '../../lib/templates.js';
import { sendEmail } from '../../lib/email.js';

async function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const adminEventVendors = new Hono();
adminEventVendors.use('*', requireAuth);

function evndId() { return `evnd_${randomId(12)}`; }
function vpsId() { return `vps_${randomId(12)}`; }

const SECTION_KINDS = ['overview', 'schedule', 'map', 'contact', 'custom'];

function formatEventVendor(r) {
    if (!r) return null;
    return {
        id: r.id,
        eventId: r.event_id,
        vendorId: r.vendor_id,
        primaryContactId: r.primary_contact_id,
        status: r.status,
        tokenVersion: r.token_version,
        tokenExpiresAt: r.token_expires_at,
        sentAt: r.sent_at,
        firstViewedAt: r.first_viewed_at,
        lastViewedAt: r.last_viewed_at,
        notes: r.notes,
        contractRequired: !!r.contract_required,
        contractSignedAt: r.contract_signed_at,
        contractCountersignedAt: r.contract_countersigned_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

function formatSection(r) {
    if (!r) return null;
    return {
        id: r.id,
        eventVendorId: r.event_vendor_id,
        kind: r.kind,
        title: r.title,
        bodyHtml: r.body_html,
        sortOrder: r.sort_order,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

function formatDoc(r) {
    if (!r) return null;
    return {
        id: r.id,
        eventVendorId: r.event_vendor_id,
        vendorId: r.vendor_id,
        filename: r.filename,
        contentType: r.content_type,
        byteSize: r.byte_size,
        kind: r.kind,
        createdAt: r.created_at,
    };
}

async function writeAudit(env, userId, action, targetType, targetId, meta, ip) {
    await env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(userId, action, targetType, targetId, meta ? JSON.stringify(meta) : null, ip, Date.now()).run();
}

// ───── List ─────
// GET /api/admin/event-vendors?event_id=&vendor_id=
adminEventVendors.get('/', async (c) => {
    const url = new URL(c.req.url);
    const event_id = url.searchParams.get('event_id');
    const vendor_id = url.searchParams.get('vendor_id');
    const clauses = [];
    const binds = [];
    if (event_id) { clauses.push('ev.event_id = ?'); binds.push(event_id); }
    if (vendor_id) { clauses.push('ev.vendor_id = ?'); binds.push(vendor_id); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await c.env.DB.prepare(
        `SELECT ev.*, v.company_name AS vendor_company_name,
                e.title AS event_title, e.display_date AS event_display_date,
                vc.name AS primary_contact_name, vc.email AS primary_contact_email
         FROM event_vendors ev
         JOIN vendors v ON v.id = ev.vendor_id
         JOIN events e ON e.id = ev.event_id
         LEFT JOIN vendor_contacts vc ON vc.id = ev.primary_contact_id
         ${where}
         ORDER BY ev.updated_at DESC`
    ).bind(...binds).all();

    return c.json({
        eventVendors: (rows.results || []).map((r) => ({
            ...formatEventVendor(r),
            vendor: { id: r.vendor_id, companyName: r.vendor_company_name },
            event: { id: r.event_id, title: r.event_title, displayDate: r.event_display_date },
            primaryContact: r.primary_contact_id ? {
                id: r.primary_contact_id,
                name: r.primary_contact_name,
                email: r.primary_contact_email,
            } : null,
        })),
    });
});

// ───── Create (attach vendor to event) ─────
// POST /api/admin/event-vendors  { eventId, vendorId, primaryContactId?, notes? }
adminEventVendors.post('/', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    const eventId = String(body.eventId || '').trim();
    const vendorId = String(body.vendorId || '').trim();
    if (!eventId || !vendorId) return c.json({ error: 'eventId and vendorId required' }, 400);

    const [event, vendor] = await Promise.all([
        c.env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(eventId).first(),
        c.env.DB.prepare('SELECT id FROM vendors WHERE id = ? AND deleted_at IS NULL').bind(vendorId).first(),
    ]);
    if (!event) return c.json({ error: 'Event not found' }, 404);
    if (!vendor) return c.json({ error: 'Vendor not found' }, 404);

    const existing = await c.env.DB.prepare(
        `SELECT id, status FROM event_vendors WHERE event_id = ? AND vendor_id = ?`
    ).bind(eventId, vendorId).first();
    if (existing) return c.json({ error: 'This vendor is already attached to this event', id: existing.id }, 409);

    let primary_contact_id = body.primaryContactId ? String(body.primaryContactId) : null;
    if (primary_contact_id) {
        const contact = await c.env.DB.prepare(
            `SELECT id FROM vendor_contacts WHERE id = ? AND vendor_id = ? AND deleted_at IS NULL`
        ).bind(primary_contact_id, vendorId).first();
        if (!contact) return c.json({ error: 'primaryContactId does not belong to that vendor' }, 400);
    } else {
        // Fall back to the vendor's is_primary contact, if any.
        const fallback = await c.env.DB.prepare(
            `SELECT id FROM vendor_contacts WHERE vendor_id = ? AND deleted_at IS NULL AND is_primary = 1 LIMIT 1`
        ).bind(vendorId).first();
        primary_contact_id = fallback?.id || null;
    }

    const id = evndId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO event_vendors (id, event_id, vendor_id, primary_contact_id, status, token_version, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', 1, ?, ?, ?)`
    ).bind(id, eventId, vendorId, primary_contact_id, (body.notes || '').toString().trim() || null, now, now).run();

    await writeAudit(c.env, user.id, 'event_vendor.created', 'event_vendor', id, { event_id: eventId, vendor_id: vendorId }, clientIp(c));
    const row = await c.env.DB.prepare('SELECT * FROM event_vendors WHERE id = ?').bind(id).first();
    return c.json({ eventVendor: formatEventVendor(row) }, 201);
});

// ───── Detail (full package view for admin) ─────
// GET /api/admin/event-vendors/:id
adminEventVendors.get('/:id', async (c) => {
    const id = c.req.param('id');
    const ev = await c.env.DB.prepare(
        `SELECT ev.*, v.company_name AS vendor_company_name, v.coi_expires_on AS vendor_coi_expires_on,
                e.title AS event_title, e.display_date AS event_display_date, e.location AS event_location,
                e.date_iso AS event_date_iso,
                vc.name AS primary_contact_name, vc.email AS primary_contact_email
         FROM event_vendors ev
         JOIN vendors v ON v.id = ev.vendor_id
         JOIN events e ON e.id = ev.event_id
         LEFT JOIN vendor_contacts vc ON vc.id = ev.primary_contact_id
         WHERE ev.id = ?`
    ).bind(id).first();
    if (!ev) return c.json({ error: 'Not found' }, 404);

    const [sections, docs, access] = await Promise.all([
        c.env.DB.prepare(
            `SELECT * FROM vendor_package_sections WHERE event_vendor_id = ? ORDER BY sort_order ASC, created_at ASC`
        ).bind(id).all(),
        c.env.DB.prepare(
            `SELECT * FROM vendor_documents WHERE event_vendor_id = ? OR vendor_id = ?
             ORDER BY created_at DESC`
        ).bind(id, ev.vendor_id).all(),
        c.env.DB.prepare(
            `SELECT * FROM vendor_access_log WHERE event_vendor_id = ? ORDER BY created_at DESC LIMIT 100`
        ).bind(id).all(),
    ]);

    return c.json({
        eventVendor: {
            ...formatEventVendor(ev),
            vendor: { id: ev.vendor_id, companyName: ev.vendor_company_name, coiExpiresOn: ev.vendor_coi_expires_on },
            event: {
                id: ev.event_id,
                title: ev.event_title,
                displayDate: ev.event_display_date,
                location: ev.event_location,
                dateIso: ev.event_date_iso,
            },
            primaryContact: ev.primary_contact_id ? {
                id: ev.primary_contact_id,
                name: ev.primary_contact_name,
                email: ev.primary_contact_email,
            } : null,
        },
        sections: (sections.results || []).map(formatSection),
        documents: (docs.results || []).map(formatDoc),
        accessLog: (access.results || []).map((r) => ({
            id: r.id,
            action: r.action,
            target: r.target,
            ip: r.ip,
            userAgent: r.user_agent,
            tokenVersion: r.token_version,
            createdAt: r.created_at,
        })),
    });
});

// ───── Update (primary contact, notes, status) ─────
// PUT /api/admin/event-vendors/:id
adminEventVendors.put('/:id', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    const existing = await c.env.DB.prepare('SELECT * FROM event_vendors WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);

    // Validate incoming primary contact belongs to the same vendor.
    let primary_contact_id = existing.primary_contact_id;
    if (body.primaryContactId !== undefined) {
        if (body.primaryContactId === null) {
            primary_contact_id = null;
        } else {
            const valid = await c.env.DB.prepare(
                `SELECT id FROM vendor_contacts WHERE id = ? AND vendor_id = ? AND deleted_at IS NULL`
            ).bind(String(body.primaryContactId), existing.vendor_id).first();
            if (!valid) return c.json({ error: 'primaryContactId does not belong to that vendor' }, 400);
            primary_contact_id = valid.id;
        }
    }

    // Only allow admin-driven status to 'draft' or 'complete'. 'sent'/'viewed'
    // are driven by system events; 'revoked' goes through POST /:id/revoke.
    let status = existing.status;
    if (body.status !== undefined) {
        if (!['draft', 'complete'].includes(body.status)) {
            return c.json({ error: 'status may only be set to draft or complete here; use /revoke to revoke' }, 400);
        }
        status = body.status;
    }

    await c.env.DB.prepare(
        `UPDATE event_vendors SET primary_contact_id = ?, status = ?, notes = ?, updated_at = ?
         WHERE id = ?`
    ).bind(
        primary_contact_id,
        status,
        body.notes !== undefined ? (String(body.notes).trim() || null) : existing.notes,
        Date.now(),
        id,
    ).run();
    await writeAudit(c.env, user.id, 'event_vendor.updated', 'event_vendor', id, null, clientIp(c));
    const row = await c.env.DB.prepare('SELECT * FROM event_vendors WHERE id = ?').bind(id).first();
    return c.json({ eventVendor: formatEventVendor(row) });
});

// ───── Detach ─────
// DELETE /api/admin/event-vendors/:id — hard delete; cascades to sections + docs.
adminEventVendors.delete('/:id', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM event_vendors WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);
    // Access log rows reference event_vendors(id) but without ON DELETE
    // CASCADE — we keep them for the audit trail, so clear the FK first.
    await c.env.DB.prepare('DELETE FROM vendor_package_sections WHERE event_vendor_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM vendor_documents WHERE event_vendor_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM event_vendors WHERE id = ?').bind(id).run();
    await writeAudit(c.env, user.id, 'event_vendor.deleted', 'event_vendor', id, { event_id: existing.event_id, vendor_id: existing.vendor_id }, clientIp(c));
    return c.json({ ok: true });
});

// ───── Sections ─────

// POST /api/admin/event-vendors/:id/sections  { kind, title, bodyHtml?, sortOrder? }
adminEventVendors.post('/:id/sections', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const event_vendor_id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    const kind = String(body.kind || '').trim();
    if (!SECTION_KINDS.includes(kind)) return c.json({ error: `kind must be one of ${SECTION_KINDS.join(', ')}` }, 400);
    const title = String(body.title || '').trim();
    if (!title) return c.json({ error: 'title required' }, 400);
    if (title.length > 200) return c.json({ error: 'title too long' }, 400);
    const bodyHtml = body.bodyHtml === undefined || body.bodyHtml === null ? null : String(body.bodyHtml);
    if (bodyHtml && bodyHtml.length > 50000) return c.json({ error: 'bodyHtml too long' }, 400);

    const ev = await c.env.DB.prepare('SELECT id FROM event_vendors WHERE id = ?').bind(event_vendor_id).first();
    if (!ev) return c.json({ error: 'Event vendor not found' }, 404);

    const id = vpsId();
    const now = Date.now();
    // Auto-append if sortOrder not provided.
    let sortOrder = Number.isFinite(body.sortOrder) ? body.sortOrder : null;
    if (sortOrder === null) {
        const max = await c.env.DB.prepare(
            `SELECT COALESCE(MAX(sort_order), -1) AS m FROM vendor_package_sections WHERE event_vendor_id = ?`
        ).bind(event_vendor_id).first();
        sortOrder = (max?.m ?? -1) + 1;
    }
    await c.env.DB.prepare(
        `INSERT INTO vendor_package_sections (id, event_vendor_id, kind, title, body_html, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, event_vendor_id, kind, title, bodyHtml, sortOrder, now, now).run();
    await writeAudit(c.env, user.id, 'event_vendor.section_created', 'vendor_package_section', id, { event_vendor_id }, clientIp(c));
    const row = await c.env.DB.prepare('SELECT * FROM vendor_package_sections WHERE id = ?').bind(id).first();
    return c.json({ section: formatSection(row) }, 201);
});

// PUT /api/admin/event-vendors/:id/sections/:sid
adminEventVendors.put('/:id/sections/:sid', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const event_vendor_id = c.req.param('id');
    const sid = c.req.param('sid');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    const existing = await c.env.DB.prepare(
        `SELECT * FROM vendor_package_sections WHERE id = ? AND event_vendor_id = ?`
    ).bind(sid, event_vendor_id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);

    const kind = body.kind !== undefined ? String(body.kind).trim() : existing.kind;
    if (!SECTION_KINDS.includes(kind)) return c.json({ error: `kind must be one of ${SECTION_KINDS.join(', ')}` }, 400);
    const title = body.title !== undefined ? String(body.title).trim() : existing.title;
    if (!title) return c.json({ error: 'title required' }, 400);
    const bodyHtml = body.bodyHtml === undefined ? existing.body_html
        : (body.bodyHtml === null ? null : String(body.bodyHtml));
    if (bodyHtml && bodyHtml.length > 50000) return c.json({ error: 'bodyHtml too long' }, 400);

    await c.env.DB.prepare(
        `UPDATE vendor_package_sections SET kind = ?, title = ?, body_html = ?, sort_order = ?, updated_at = ?
         WHERE id = ?`
    ).bind(
        kind, title, bodyHtml,
        Number.isFinite(body.sortOrder) ? body.sortOrder : existing.sort_order,
        Date.now(),
        sid,
    ).run();
    await writeAudit(c.env, user.id, 'event_vendor.section_updated', 'vendor_package_section', sid, null, clientIp(c));
    const row = await c.env.DB.prepare('SELECT * FROM vendor_package_sections WHERE id = ?').bind(sid).first();
    return c.json({ section: formatSection(row) });
});

// DELETE /api/admin/event-vendors/:id/sections/:sid
adminEventVendors.delete('/:id/sections/:sid', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const event_vendor_id = c.req.param('id');
    const sid = c.req.param('sid');
    const existing = await c.env.DB.prepare(
        `SELECT id FROM vendor_package_sections WHERE id = ? AND event_vendor_id = ?`
    ).bind(sid, event_vendor_id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);
    await c.env.DB.prepare('DELETE FROM vendor_package_sections WHERE id = ?').bind(sid).run();
    await writeAudit(c.env, user.id, 'event_vendor.section_deleted', 'vendor_package_section', sid, { event_vendor_id }, clientIp(c));
    return c.json({ ok: true });
});

// ───── Send package (mint token, email primary contact) ─────
// POST /api/admin/event-vendors/:id/send
// Default token TTL = event start + 60d; can be overridden via body.expiresAt
// (ms epoch). Also stamps status='sent' and records sent_at.
adminEventVendors.post('/:id/send', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const ev = await c.env.DB.prepare(
        `SELECT ev.*, e.title AS event_title, e.display_date AS event_display_date,
                e.date_iso AS event_date_iso,
                vc.name AS primary_contact_name, vc.email AS primary_contact_email
         FROM event_vendors ev
         JOIN events e ON e.id = ev.event_id
         LEFT JOIN vendor_contacts vc ON vc.id = ev.primary_contact_id
         WHERE ev.id = ?`
    ).bind(id).first();
    if (!ev) return c.json({ error: 'Not found' }, 404);
    if (ev.status === 'revoked') return c.json({ error: 'Package is revoked; un-revoke by issuing a new one' }, 409);
    if (!ev.primary_contact_id || !ev.primary_contact_email) {
        return c.json({ error: 'No primary contact set for this package' }, 400);
    }

    // Default expiry = event start + 60 days. Gives buffer for any post-event
    // follow-up; admin can shorten via body.expiresAt.
    const eventStartMs = ev.event_date_iso ? Date.parse(ev.event_date_iso) : NaN;
    const defaultExpiresAt = Number.isFinite(eventStartMs)
        ? eventStartMs + 60 * 24 * 60 * 60 * 1000
        : Date.now() + 90 * 24 * 60 * 60 * 1000;
    const expiresAt = Number.isFinite(body?.expiresAt) ? body.expiresAt : defaultExpiresAt;
    if (expiresAt <= Date.now()) return c.json({ error: 'expiresAt must be in the future' }, 400);

    const secret = c.env.SESSION_SECRET;
    if (!secret) return c.json({ error: 'SESSION_SECRET not configured' }, 500);
    const token = await createVendorToken(ev.id, ev.token_version, expiresAt, secret);
    const packageUrl = `${c.env.SITE_URL}/v/${token}`;

    const template = await loadTemplate(c.env.DB, 'vendor_package_sent');
    if (!template) return c.json({ error: 'Email template vendor_package_sent missing' }, 500);

    const expiresDisplay = new Date(expiresAt).toLocaleDateString('en-US', {
        day: 'numeric', month: 'long', year: 'numeric',
    });
    const vars = {
        contact_name: ev.primary_contact_name || '',
        event_title: ev.event_title || '',
        event_date: ev.event_display_date || '',
        package_url: packageUrl,
        token_expires_display: expiresDisplay,
    };
    const rendered = renderTemplate(template, vars);

    try {
        await sendEmail({
            apiKey: c.env.RESEND_API_KEY,
            from: c.env.FROM_EMAIL,
            to: ev.primary_contact_email,
            replyTo: c.env.REPLY_TO_EMAIL,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            tags: [
                { name: 'type', value: 'vendor_package_sent' },
                { name: 'event_vendor_id', value: ev.id },
            ],
        });
    } catch (err) {
        console.error('vendor_package_sent send failed', err);
        return c.json({ error: 'Email send failed' }, 502);
    }

    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE event_vendors SET status = 'sent', sent_at = ?, token_expires_at = ?, updated_at = ?
         WHERE id = ?`
    ).bind(now, expiresAt, now, id).run();
    await writeAudit(c.env, user.id, 'event_vendor.sent', 'event_vendor', id, {
        to: ev.primary_contact_email,
        token_version: ev.token_version,
        token_expires_at: expiresAt,
    }, clientIp(c));

    return c.json({ ok: true, sentAt: now, tokenExpiresAt: expiresAt });
});

// ───── Revoke (bump token_version, invalidates outstanding links) ─────
// POST /api/admin/event-vendors/:id/revoke
adminEventVendors.post('/:id/revoke', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const ev = await c.env.DB.prepare('SELECT * FROM event_vendors WHERE id = ?').bind(id).first();
    if (!ev) return c.json({ error: 'Not found' }, 404);
    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE event_vendors SET status = 'revoked', token_version = token_version + 1, updated_at = ?
         WHERE id = ?`
    ).bind(now, id).run();
    await writeAudit(c.env, user.id, 'event_vendor.revoked', 'event_vendor', id, {
        old_token_version: ev.token_version,
    }, clientIp(c));
    return c.json({ ok: true, newTokenVersion: ev.token_version + 1 });
});

// ───── Contract toggle ─────
// PUT /api/admin/event-vendors/:id/contract  { required: true|false }
// Flips `contract_required` for a package. If true, the live
// vendor_contract_documents row is what the vendor will see + sign.
adminEventVendors.put('/:id/contract', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    const required = body.required ? 1 : 0;
    const ev = await c.env.DB.prepare('SELECT * FROM event_vendors WHERE id = ?').bind(id).first();
    if (!ev) return c.json({ error: 'Not found' }, 404);

    if (required) {
        const live = await c.env.DB.prepare(
            `SELECT id FROM vendor_contract_documents WHERE retired_at IS NULL LIMIT 1`
        ).first();
        if (!live) {
            return c.json({ error: 'No live vendor contract document. Create one at /admin/vendor-contracts first.' }, 400);
        }
    }

    await c.env.DB.prepare(
        `UPDATE event_vendors SET contract_required = ?, updated_at = ? WHERE id = ?`
    ).bind(required, Date.now(), id).run();
    await writeAudit(c.env, user.id, 'event_vendor.contract_required_updated', 'event_vendor', id, { required: !!required }, clientIp(c));
    return c.json({ ok: true, contractRequired: !!required });
});

// ───── Countersign ─────
// POST /api/admin/event-vendors/:id/countersign — owner only.
// Stamps countersigned_by_user_id / countersigned_at on the vendor_signatures
// row and the denormalised field on event_vendors. Emails the primary
// contact with the fully-executed copy.
adminEventVendors.post('/:id/countersign', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const ev = await c.env.DB.prepare(
        `SELECT ev.*, e.title AS event_title, e.display_date AS event_display_date,
                vc.name AS primary_contact_name, vc.email AS primary_contact_email
         FROM event_vendors ev
         JOIN events e ON e.id = ev.event_id
         LEFT JOIN vendor_contacts vc ON vc.id = ev.primary_contact_id
         WHERE ev.id = ?`
    ).bind(id).first();
    if (!ev) return c.json({ error: 'Not found' }, 404);

    const sig = await c.env.DB.prepare(
        `SELECT * FROM vendor_signatures WHERE event_vendor_id = ?`
    ).bind(id).first();
    if (!sig) return c.json({ error: 'Vendor has not signed yet' }, 409);
    if (sig.countersigned_at) return c.json({ error: 'Already countersigned' }, 409);

    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE vendor_signatures SET countersigned_by_user_id = ?, countersigned_at = ? WHERE id = ?`
    ).bind(user.id, now, sig.id).run();
    await c.env.DB.prepare(
        `UPDATE event_vendors SET contract_countersigned_at = ?, updated_at = ? WHERE id = ?`
    ).bind(now, now, id).run();

    // Send the countersigned notification. Non-fatal if it fails — the
    // countersign is recorded regardless; we just log it in audit_log.
    const template = await loadTemplate(c.env.DB, 'vendor_countersigned');
    let emailResult = null;
    if (template && ev.primary_contact_email) {
        try {
            const secret = c.env.SESSION_SECRET;
            const token = await createVendorToken(ev.id, ev.token_version, ev.token_expires_at || (now + 30 * 24 * 60 * 60 * 1000), secret);
            const rendered = renderTemplate(template, {
                contact_name: ev.primary_contact_name || '',
                event_title: ev.event_title || '',
                package_url: `${c.env.SITE_URL}/v/${token}`,
            });
            await sendEmail({
                apiKey: c.env.RESEND_API_KEY,
                from: c.env.FROM_EMAIL,
                to: ev.primary_contact_email,
                replyTo: c.env.REPLY_TO_EMAIL,
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
                tags: [
                    { name: 'type', value: 'vendor_countersigned' },
                    { name: 'event_vendor_id', value: ev.id },
                ],
            });
            emailResult = 'sent';
        } catch (err) {
            console.error('vendor_countersigned send failed', err);
            emailResult = 'failed';
        }
    }

    await writeAudit(c.env, user.id, 'event_vendor.countersigned', 'event_vendor', id, {
        signature_id: sig.id, email: emailResult,
    }, clientIp(c));
    return c.json({ ok: true, countersignedAt: now, emailResult });
});

// GET /api/admin/event-vendors/:id/signature — full signature detail incl snapshot
adminEventVendors.get('/:id/signature', async (c) => {
    const id = c.req.param('id');
    const sig = await c.env.DB.prepare(
        `SELECT s.*, vc.name AS contact_name, vc.email AS contact_email
         FROM vendor_signatures s
         LEFT JOIN vendor_contacts vc ON vc.id = s.contact_id
         WHERE s.event_vendor_id = ?`
    ).bind(id).first();
    if (!sig) return c.json({ signature: null });
    return c.json({
        signature: {
            id: sig.id,
            eventVendorId: sig.event_vendor_id,
            contactId: sig.contact_id,
            contactName: sig.contact_name,
            contactEmail: sig.contact_email,
            contractDocumentId: sig.contract_document_id,
            contractDocumentVersion: sig.contract_document_version,
            bodyHtmlSnapshot: sig.body_html_snapshot,
            bodySha256: sig.body_sha256,
            typedName: sig.typed_name,
            erecordsConsent: !!sig.erecords_consent,
            ip: sig.ip,
            userAgent: sig.user_agent,
            tokenVersion: sig.token_version,
            signedAt: sig.signed_at,
            countersignedByUserId: sig.countersigned_by_user_id,
            countersignedAt: sig.countersigned_at,
        },
    });
});

export default adminEventVendors;

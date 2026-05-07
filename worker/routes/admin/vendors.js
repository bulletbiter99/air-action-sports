// Admin CRUD for vendors + vendor contacts. Event-level package composition
// lives in eventVendors.js. Routes are role-gated through requireAuth +
// requireRole; audit_log is written on every mutation.

import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { randomId } from '../../lib/ids.js';
import { clientIp } from '../../lib/rateLimit.js';
import { isValidEmail } from '../../lib/email.js';

const adminVendors = new Hono();
adminVendors.use('*', requireAuth);

function vendorId() { return `vnd_${randomId(12)}`; }
function contactId() { return `vct_${randomId(12)}`; }

function formatVendor(r, contacts = []) {
    if (!r) return null;
    return {
        id: r.id,
        companyName: r.company_name,
        tags: r.tags || '',
        website: r.website,
        notes: r.notes,
        coiExpiresOn: r.coi_expires_on,
        deletedAt: r.deleted_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        contacts,
    };
}

function formatContact(r) {
    if (!r) return null;
    return {
        id: r.id,
        vendorId: r.vendor_id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        role: r.role,
        isPrimary: !!r.is_primary,
        deletedAt: r.deleted_at,
        createdAt: r.created_at,
    };
}

async function writeAudit(env, userId, action, targetType, targetId, meta, ip) {
    await env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(userId, action, targetType, targetId, meta ? JSON.stringify(meta) : null, ip, Date.now()).run();
}

// ───── Vendor list ─────
// GET /api/admin/vendors?q=&includeDeleted=1
adminVendors.get('/', async (c) => {
    const url = new URL(c.req.url);
    const q = url.searchParams.get('q')?.trim();
    const includeDeleted = url.searchParams.get('includeDeleted') === '1';

    const clauses = [];
    const binds = [];
    if (!includeDeleted) clauses.push('deleted_at IS NULL');
    if (q) {
        clauses.push('(company_name LIKE ? OR tags LIKE ?)');
        binds.push(`%${q}%`, `%${q}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await c.env.DB.prepare(
        `SELECT * FROM vendors ${where} ORDER BY company_name ASC`
    ).bind(...binds).all();
    return c.json({ vendors: (rows.results || []).map((r) => formatVendor(r)) });
});

// ───── Create vendor ─────
// POST /api/admin/vendors  { companyName, tags?, website?, notes?, coiExpiresOn? }
adminVendors.post('/', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    const companyName = String(body.companyName || '').trim();
    if (!companyName) return c.json({ error: 'companyName required' }, 400);
    if (companyName.length > 200) return c.json({ error: 'companyName too long' }, 400);

    const id = vendorId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO vendors (id, company_name, tags, website, notes, coi_expires_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        id,
        companyName,
        (body.tags || '').toString().trim() || null,
        (body.website || '').toString().trim() || null,
        (body.notes || '').toString().trim() || null,
        (body.coiExpiresOn || null),
        now,
        now,
    ).run();
    await writeAudit(c.env, user.id, 'vendor.created', 'vendor', id, { company_name: companyName }, clientIp(c));
    const row = await c.env.DB.prepare('SELECT * FROM vendors WHERE id = ?').bind(id).first();
    return c.json({ vendor: formatVendor(row, []) }, 201);
});

// ───── Vendor detail ─────
// GET /api/admin/vendors/:id
adminVendors.get('/:id', async (c) => {
    const id = c.req.param('id');
    const vendor = await c.env.DB.prepare('SELECT * FROM vendors WHERE id = ?').bind(id).first();
    if (!vendor) return c.json({ error: 'Not found' }, 404);

    const contacts = await c.env.DB.prepare(
        `SELECT * FROM vendor_contacts WHERE vendor_id = ? AND deleted_at IS NULL
         ORDER BY is_primary DESC, name ASC`
    ).bind(id).all();

    const events = await c.env.DB.prepare(
        `SELECT ev.id AS event_vendor_id, ev.status, ev.sent_at, ev.last_viewed_at,
                e.id AS event_id, e.title AS event_title, e.display_date AS event_display_date, e.date_iso
         FROM event_vendors ev
         JOIN events e ON e.id = ev.event_id
         WHERE ev.vendor_id = ?
         ORDER BY e.date_iso DESC`
    ).bind(id).all();

    return c.json({
        vendor: formatVendor(vendor, (contacts.results || []).map(formatContact)),
        eventVendors: (events.results || []).map((r) => ({
            eventVendorId: r.event_vendor_id,
            status: r.status,
            sentAt: r.sent_at,
            lastViewedAt: r.last_viewed_at,
            event: {
                id: r.event_id,
                title: r.event_title,
                displayDate: r.event_display_date,
                dateIso: r.date_iso,
            },
        })),
    });
});

// ───── Update vendor ─────
// PUT /api/admin/vendors/:id
adminVendors.put('/:id', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await c.env.DB.prepare('SELECT * FROM vendors WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);

    const companyName = body.companyName !== undefined ? String(body.companyName).trim() : existing.company_name;
    if (!companyName) return c.json({ error: 'companyName required' }, 400);
    if (companyName.length > 200) return c.json({ error: 'companyName too long' }, 400);

    await c.env.DB.prepare(
        `UPDATE vendors SET company_name = ?, tags = ?, website = ?, notes = ?, coi_expires_on = ?, updated_at = ?
         WHERE id = ?`
    ).bind(
        companyName,
        body.tags !== undefined ? (String(body.tags).trim() || null) : existing.tags,
        body.website !== undefined ? (String(body.website).trim() || null) : existing.website,
        body.notes !== undefined ? (String(body.notes).trim() || null) : existing.notes,
        body.coiExpiresOn !== undefined ? (body.coiExpiresOn || null) : existing.coi_expires_on,
        Date.now(),
        id,
    ).run();
    await writeAudit(c.env, user.id, 'vendor.updated', 'vendor', id, null, clientIp(c));
    const row = await c.env.DB.prepare('SELECT * FROM vendors WHERE id = ?').bind(id).first();
    return c.json({ vendor: formatVendor(row) });
});

// ───── Soft-delete vendor ─────
// DELETE /api/admin/vendors/:id — owner only. Refuses if any event_vendor rows
// are non-revoked; force via ?force=1 revokes all of them first.
adminVendors.delete('/:id', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const force = new URL(c.req.url).searchParams.get('force') === '1';
    const existing = await c.env.DB.prepare('SELECT * FROM vendors WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);

    const active = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM event_vendors WHERE vendor_id = ? AND status != 'revoked'`
    ).bind(id).first();
    if ((active?.n ?? 0) > 0 && !force) {
        return c.json({ error: `Vendor has ${active.n} active event package(s). Pass ?force=1 to revoke them all and delete.` }, 409);
    }

    const now = Date.now();
    if (active?.n > 0 && force) {
        // Bumping token_version invalidates any outstanding magic links.
        await c.env.DB.prepare(
            `UPDATE event_vendors SET status = 'revoked', token_version = token_version + 1, updated_at = ?
             WHERE vendor_id = ? AND status != 'revoked'`
        ).bind(now, id).run();
    }
    await c.env.DB.prepare(
        `UPDATE vendors SET deleted_at = ?, updated_at = ? WHERE id = ?`
    ).bind(now, now, id).run();
    await writeAudit(c.env, user.id, 'vendor.deleted', 'vendor', id, { force, revoked_packages: active?.n ?? 0 }, clientIp(c));
    return c.json({ ok: true });
});

// ───── Add contact to vendor ─────
// POST /api/admin/vendors/:id/contacts  { name, email, phone?, role?, isPrimary? }
adminVendors.post('/:id/contacts', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const vendor_id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    if (!name) return c.json({ error: 'name required' }, 400);
    if (!isValidEmail(email)) return c.json({ error: 'valid email required' }, 400);
    if (name.length > 200 || email.length > 200) return c.json({ error: 'field too long' }, 400);

    const vendor = await c.env.DB.prepare('SELECT id FROM vendors WHERE id = ? AND deleted_at IS NULL').bind(vendor_id).first();
    if (!vendor) return c.json({ error: 'Vendor not found' }, 404);

    // Partial unique index on (vendor_id, email) enforces uniqueness among active rows.
    const existing = await c.env.DB.prepare(
        `SELECT id FROM vendor_contacts WHERE vendor_id = ? AND email = ? AND deleted_at IS NULL`
    ).bind(vendor_id, email).first();
    if (existing) return c.json({ error: 'A contact with that email already exists for this vendor' }, 409);

    const id = contactId();
    const isPrimary = body.isPrimary ? 1 : 0;
    // Only one primary per vendor — clear any prior primary if this one is.
    if (isPrimary) {
        await c.env.DB.prepare(
            `UPDATE vendor_contacts SET is_primary = 0 WHERE vendor_id = ? AND deleted_at IS NULL`
        ).bind(vendor_id).run();
    }
    await c.env.DB.prepare(
        `INSERT INTO vendor_contacts (id, vendor_id, name, email, phone, role, is_primary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        id, vendor_id, name, email,
        (body.phone || '').toString().trim() || null,
        (body.role || '').toString().trim() || null,
        isPrimary,
        Date.now(),
    ).run();
    await writeAudit(c.env, user.id, 'vendor_contact.created', 'vendor_contact', id, { vendor_id, email }, clientIp(c));
    const row = await c.env.DB.prepare('SELECT * FROM vendor_contacts WHERE id = ?').bind(id).first();
    return c.json({ contact: formatContact(row) }, 201);
});

// ───── Update contact ─────
// PUT /api/admin/vendors/contacts/:id
adminVendors.put('/contacts/:id', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    const existing = await c.env.DB.prepare('SELECT * FROM vendor_contacts WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);

    const newEmail = body.email !== undefined ? String(body.email).trim().toLowerCase() : existing.email;
    if (!isValidEmail(newEmail)) {
        return c.json({ error: 'valid email required' }, 400);
    }
    const isPrimary = body.isPrimary !== undefined ? (body.isPrimary ? 1 : 0) : existing.is_primary;
    if (isPrimary && !existing.is_primary) {
        await c.env.DB.prepare(
            `UPDATE vendor_contacts SET is_primary = 0 WHERE vendor_id = ? AND deleted_at IS NULL AND id != ?`
        ).bind(existing.vendor_id, id).run();
    }

    await c.env.DB.prepare(
        `UPDATE vendor_contacts SET name = ?, email = ?, phone = ?, role = ?, is_primary = ? WHERE id = ?`
    ).bind(
        body.name !== undefined ? String(body.name).trim() : existing.name,
        newEmail,
        body.phone !== undefined ? (String(body.phone).trim() || null) : existing.phone,
        body.role !== undefined ? (String(body.role).trim() || null) : existing.role,
        isPrimary,
        id,
    ).run();
    await writeAudit(c.env, user.id, 'vendor_contact.updated', 'vendor_contact', id, null, clientIp(c));
    const row = await c.env.DB.prepare('SELECT * FROM vendor_contacts WHERE id = ?').bind(id).first();
    return c.json({ contact: formatContact(row) });
});

// ───── Soft-delete contact ─────
// DELETE /api/admin/vendors/contacts/:id
adminVendors.delete('/contacts/:id', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM vendor_contacts WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);
    // If this contact is the primary on any event_vendor row, refuse — caller
    // should promote another contact first to avoid orphaning outbound emails.
    const pinned = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM event_vendors WHERE primary_contact_id = ? AND status != 'revoked'`
    ).bind(id).first();
    if ((pinned?.n ?? 0) > 0) {
        return c.json({ error: `Contact is the primary on ${pinned.n} active package(s). Reassign first.` }, 409);
    }
    await c.env.DB.prepare(
        `UPDATE vendor_contacts SET deleted_at = ? WHERE id = ?`
    ).bind(Date.now(), id).run();
    await writeAudit(c.env, user.id, 'vendor_contact.deleted', 'vendor_contact', id, { vendor_id: existing.vendor_id }, clientIp(c));
    return c.json({ ok: true });
});

export default adminVendors;

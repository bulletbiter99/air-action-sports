// M3 Batch 8a — admin customers route.
//
// Backs the customers admin UI (B8b). Three endpoints:
//
//   GET  /api/admin/customers
//        Paginated list with q (email/name search) + archived filter.
//
//   GET  /api/admin/customers/:id
//        Customer detail + their bookings (joined to events) + their tags.
//
//   POST /api/admin/customers/merge
//        Body: { primaryId, duplicateIds: [string] }
//        Archives each duplicate (archived_at, reason='merged', merged_into),
//        re-targets their bookings + attendees to the primary, and
//        recomputes the primary's denormalized fields. Emits one
//        customer.merged audit row per duplicate.
//
// Routes are gated by requireAuth only; the customers_entity feature flag
// (migration 0024) gates the UI client-side, not the route. This means
// the routes are queryable by any authenticated admin even with the flag
// off — useful for ops triage. The flag stays off in production until
// the owner flips it via /admin/settings.

import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { requireCapability, hasCapability, listCapabilities } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';
import { recomputeCustomerDenormalizedFields } from '../../lib/customers.js';
import { encrypt, decryptSafely } from '../../lib/personEncryption.js';
import { customerId } from '../../lib/ids.js';

const adminCustomers = new Hono();

adminCustomers.use('*', requireAuth);

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/customers — paginated list with filters
// ────────────────────────────────────────────────────────────────────
adminCustomers.get('/', async (c) => {
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const q = params.get('q');
    const archivedParam = params.get('archived'); // 'true' | 'false' | 'all'
    const limit = Math.min(Number(params.get('limit') || 50), 200);
    const offset = Math.max(0, Number(params.get('offset') || 0));

    const where = [];
    const binds = [];

    if (archivedParam === 'true') {
        where.push('archived_at IS NOT NULL');
    } else if (archivedParam === 'all') {
        // no filter
    } else {
        // default + 'false': active customers only
        where.push('archived_at IS NULL');
    }

    if (q) {
        const needle = `%${q.toLowerCase()}%`;
        where.push('(LOWER(email) LIKE ? OR LOWER(name) LIKE ?)');
        binds.push(needle, needle);
    }

    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM customers ${whereSQL}`,
    ).bind(...binds).first();

    const rowsResult = await c.env.DB.prepare(
        `SELECT id, email, email_normalized, name, phone,
                total_bookings, total_attendees, lifetime_value_cents, refund_count,
                first_booking_at, last_booking_at,
                archived_at, archived_reason, merged_into,
                created_at, updated_at
         FROM customers ${whereSQL}
         ORDER BY archived_at IS NOT NULL, last_booking_at DESC, created_at DESC
         LIMIT ? OFFSET ?`,
    ).bind(...binds, limit, offset).all();

    return c.json({
        total: countRow?.n ?? 0,
        limit,
        offset,
        customers: (rowsResult.results || []).map(formatCustomer),
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/customers — create
//
// Post-M6 D-1b. Gated on customers.write. Phone-intake operator
// workflow: create a customer record without waiting for them to book.
// Required: email. Optional: name, phone, clientType (default
// 'individual'), notes, business_* fields. Email is validated against
// a simple format regex + duplicate-checked (case-insensitive). EIN
// validated as XX-XXXXXXX and encrypted; billing address (when object)
// is JSON-stringified and encrypted.
//
// Returns 409 { existingCustomerId } when an active customer already
// has this email_normalized — the UI uses that to offer an "open
// existing customer" affordance instead of refusing the operator.
// ────────────────────────────────────────────────────────────────────
adminCustomers.post('/', requireCapability('customers.write'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const emailRaw = body.email ? String(body.email).trim() : '';
    if (!emailRaw) return c.json({ error: 'email is required' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
        return c.json({ error: 'email is not a valid format' }, 400);
    }
    const emailNormalized = emailRaw.toLowerCase();

    const clientType = body.clientType ?? 'individual';
    if (clientType !== 'individual' && clientType !== 'business') {
        return c.json({ error: 'clientType must be "individual" or "business"' }, 400);
    }

    // Encrypt business fields up-front so we can fail fast on format errors
    // before the duplicate check + INSERT.
    let encryptedTaxId = null;
    let encryptedBillingAddress = null;
    if (body.businessTaxId) {
        const ein = String(body.businessTaxId).trim();
        if (!/^\d{2}-\d{7}$/.test(ein)) {
            return c.json({ error: 'businessTaxId must be in XX-XXXXXXX format' }, 400);
        }
        encryptedTaxId = await encrypt(ein, c.env.SESSION_SECRET);
    }
    if (body.businessBillingAddress) {
        const addr = body.businessBillingAddress;
        if (typeof addr !== 'object' || Array.isArray(addr)) {
            return c.json({ error: 'businessBillingAddress must be an object' }, 400);
        }
        const cleaned = {};
        for (const k of ['line1', 'line2', 'city', 'state', 'postal', 'country']) {
            if (addr[k] !== undefined && addr[k] !== null) {
                const t = String(addr[k]).trim();
                if (t) cleaned[k] = t;
            }
        }
        if (Object.keys(cleaned).length) {
            encryptedBillingAddress = await encrypt(JSON.stringify(cleaned), c.env.SESSION_SECRET);
        }
    }

    // Duplicate check against active rows only — an archived customer with
    // the same email is fine (the operator may have archived in error
    // earlier; let them resurface via the existing /admin/customers
    // archive filter rather than blocking creation).
    const existing = await c.env.DB.prepare(
        'SELECT id FROM customers WHERE email_normalized = ? AND archived_at IS NULL',
    ).bind(emailNormalized).first();
    if (existing) {
        return c.json({
            error: 'Customer with this email already exists',
            existingCustomerId: existing.id,
        }, 409);
    }

    const id = customerId();
    const now = Date.now();

    await c.env.DB.prepare(
        `INSERT INTO customers (
            id, email, email_normalized, name, phone,
            total_bookings, total_attendees, lifetime_value_cents, refund_count,
            first_booking_at, last_booking_at,
            email_transactional, email_marketing, sms_transactional, sms_marketing,
            notes,
            client_type, business_name, business_website,
            business_tax_id, business_billing_address,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
        id,
        emailRaw,
        emailNormalized,
        body.name ? String(body.name).trim() : null,
        body.phone ? String(body.phone).trim() : null,
        body.emailTransactional === false ? 0 : 1,
        body.emailMarketing === false ? 0 : 1,
        body.smsTransactional ? 1 : 0,
        body.smsMarketing ? 1 : 0,
        body.notes ? String(body.notes).trim() : null,
        clientType,
        body.businessName ? String(body.businessName).trim() : null,
        body.businessWebsite ? String(body.businessWebsite).trim() : null,
        encryptedTaxId,
        encryptedBillingAddress,
        now,
        now,
    ).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'customer.created',
        targetType: 'customer',
        targetId: id,
        meta: { email: emailNormalized, clientType },
    });

    return c.json({ success: true, customerId: id }, 201);
});

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/customers/:id — detail with bookings + tags
//
// Post-M6 D-1a: business fields (EIN + billing address) decrypt on the
// fly when viewer has customers.read.business_fields. Unmask is audited
// per call so we can trace who saw which customer's encrypted PII.
// ────────────────────────────────────────────────────────────────────
adminCustomers.get('/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
        `SELECT * FROM customers WHERE id = ?`,
    ).bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);

    // Pre-load capabilities so the sync hasCapability checks below resolve
    // against the M5 DB-backed cap set instead of falling through to the
    // legacy role mapping (which lacks the customers.* caps).
    if (!Array.isArray(user.capabilities)) {
        user.capabilities = await listCapabilities(c.env, user.id);
        c.set('user', user);
    }

    const canSeeBiz = hasCapability(user, 'customers.read.business_fields');
    const canWriteBiz = hasCapability(user, 'customers.write.business_fields');

    // Decrypt business fields when capable + present.
    let decryptedTaxId = null;
    let decryptedBillingAddress = null;
    let unmaskAttempted = false;
    if (canSeeBiz) {
        if (row.business_tax_id) {
            decryptedTaxId = await decryptSafely(row.business_tax_id, c.env.SESSION_SECRET);
            unmaskAttempted = true;
        }
        if (row.business_billing_address) {
            const raw = await decryptSafely(row.business_billing_address, c.env.SESSION_SECRET);
            if (raw) {
                try { decryptedBillingAddress = JSON.parse(raw); }
                catch { decryptedBillingAddress = null; }
            }
            unmaskAttempted = true;
        }
    }

    // Audit only when we actually attempted to surface encrypted data
    // (capability present AND a value exists). A capable viewer hitting
    // a customer with no encrypted business fields produces no audit.
    if (unmaskAttempted) {
        await writeAudit(c.env, {
            userId: user.id,
            action: 'customer.business_fields_unmasked',
            targetType: 'customer',
            targetId: id,
            meta: {
                hadTaxId: !!row.business_tax_id,
                hadBillingAddress: !!row.business_billing_address,
            },
        });
    }

    const bookingsResult = await c.env.DB.prepare(
        `SELECT b.id, b.event_id, b.full_name, b.email, b.status,
                b.subtotal_cents, b.tax_cents, b.fee_cents, b.total_cents,
                b.payment_method, b.created_at, b.paid_at, b.refunded_at,
                e.title AS event_title, e.date_iso AS event_date_iso
         FROM bookings b
         LEFT JOIN events e ON e.id = b.event_id
         WHERE b.customer_id = ?
         ORDER BY b.created_at DESC`,
    ).bind(id).all();

    const tagsResult = await c.env.DB.prepare(
        `SELECT tag, tag_type, created_at, created_by
         FROM customer_tags
         WHERE customer_id = ?
         ORDER BY tag_type, tag`,
    ).bind(id).all();

    // M5.5 B9 — Field rentals linked to this customer. Bounded at 100
    // rows for high-volume customers (none today; future-proof). For a
    // full list, the operator clicks through to
    // /admin/field-rentals?customer_id=... which uses the paginated
    // list endpoint with its own ordering controls.
    //
    // Defensive try/catch in case the field_rentals table is somehow
    // absent (shouldn't happen on remote post-migration-0047, but
    // protects local-dev callers without a fully-applied schema).
    let fieldRentalsRows = [];
    try {
        const frResult = await c.env.DB.prepare(
            `SELECT id, status, scheduled_starts_at, scheduled_ends_at,
                    total_cents, coi_status, coi_expires_at, archived_at,
                    engagement_type
             FROM field_rentals
             WHERE customer_id = ?
             ORDER BY scheduled_starts_at DESC
             LIMIT 100`,
        ).bind(id).all();
        fieldRentalsRows = frResult.results || [];
    } catch {
        fieldRentalsRows = [];
    }

    return c.json({
        customer: formatCustomer(row, {
            decryptedTaxId,
            decryptedBillingAddress,
            viewerCanSeeBusinessFields: canSeeBiz,
            viewerCanWriteBusinessFields: canWriteBiz,
        }),
        bookings: (bookingsResult.results || []).map((b) => ({
            id: b.id,
            eventId: b.event_id,
            eventTitle: b.event_title,
            eventDateIso: b.event_date_iso,
            fullName: b.full_name,
            email: b.email,
            status: b.status,
            subtotalCents: b.subtotal_cents,
            taxCents: b.tax_cents,
            feeCents: b.fee_cents,
            totalCents: b.total_cents,
            paymentMethod: b.payment_method,
            createdAt: b.created_at,
            paidAt: b.paid_at,
            refundedAt: b.refunded_at,
        })),
        tags: (tagsResult.results || []).map((t) => ({
            tag: t.tag,
            tagType: t.tag_type,
            createdAt: t.created_at,
            createdBy: t.created_by,
        })),
        fieldRentals: fieldRentalsRows.map((fr) => ({
            id: fr.id,
            status: fr.status,
            scheduledStartsAt: fr.scheduled_starts_at,
            scheduledEndsAt: fr.scheduled_ends_at,
            totalCents: fr.total_cents,
            coiStatus: fr.coi_status,
            coiExpiresAt: fr.coi_expires_at,
            archivedAt: fr.archived_at,
            engagementType: fr.engagement_type,
        })),
    });
});

// ────────────────────────────────────────────────────────────────────
// PUT /api/admin/customers/:id/business — edit B2B fields
//
// Post-M6 D-1a. Gated on customers.write.business_fields (owner +
// bookkeeper per 0031). EIN encrypted at write time after format
// validation (XX-XXXXXXX). Billing address JSON-stringified then
// encrypted. Each field is independently optional in the body — only
// provided fields are touched, missing fields stay as-is.
// ────────────────────────────────────────────────────────────────────
adminCustomers.put('/:id/business', requireCapability('customers.write.business_fields'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const row = await c.env.DB.prepare(
        'SELECT id, archived_at FROM customers WHERE id = ?',
    ).bind(id).first();
    if (!row) return c.json({ error: 'Customer not found' }, 404);
    if (row.archived_at) return c.json({ error: 'Cannot edit archived customer' }, 409);

    const updates = {};

    if (body.clientType !== undefined) {
        if (body.clientType !== 'individual' && body.clientType !== 'business') {
            return c.json({ error: 'clientType must be "individual" or "business"' }, 400);
        }
        updates.client_type = body.clientType;
    }
    if (body.businessName !== undefined) {
        updates.business_name = body.businessName ? String(body.businessName).trim() : null;
    }
    if (body.businessWebsite !== undefined) {
        updates.business_website = body.businessWebsite ? String(body.businessWebsite).trim() : null;
    }

    // EIN: validate XX-XXXXXXX before encrypt. Empty/null clears the column.
    if (body.businessTaxId !== undefined) {
        const ein = body.businessTaxId ? String(body.businessTaxId).trim() : '';
        if (ein && !/^\d{2}-\d{7}$/.test(ein)) {
            return c.json({ error: 'businessTaxId must be in XX-XXXXXXX format' }, 400);
        }
        updates.business_tax_id = ein ? await encrypt(ein, c.env.SESSION_SECRET) : null;
    }

    // Billing address: explicit null clears, object encrypts the JSON.
    if (body.businessBillingAddress !== undefined) {
        const addr = body.businessBillingAddress;
        if (addr === null) {
            updates.business_billing_address = null;
        } else if (typeof addr === 'object' && !Array.isArray(addr)) {
            const cleaned = {};
            for (const k of ['line1', 'line2', 'city', 'state', 'postal', 'country']) {
                if (addr[k] !== undefined && addr[k] !== null) {
                    const trimmed = String(addr[k]).trim();
                    if (trimmed) cleaned[k] = trimmed;
                }
            }
            updates.business_billing_address = Object.keys(cleaned).length
                ? await encrypt(JSON.stringify(cleaned), c.env.SESSION_SECRET)
                : null;
        } else {
            return c.json({ error: 'businessBillingAddress must be an object or null' }, 400);
        }
    }

    if (Object.keys(updates).length === 0) {
        return c.json({ error: 'No fields to update' }, 400);
    }

    const now = Date.now();
    updates.updated_at = now;
    const keys = Object.keys(updates);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const binds = keys.map((k) => updates[k]);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE customers SET ${sets} WHERE id = ?`).bind(...binds).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'customer.business_fields_updated',
        targetType: 'customer',
        targetId: id,
        meta: { fields: keys.filter((k) => k !== 'updated_at') },
    });

    return c.json({ success: true, customerId: id });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/customers/merge — manager+ archives duplicates
//   Body: { primaryId: string, duplicateIds: string[] }
//   Each duplicate is soft-archived (archived_at, archived_reason='merged',
//   merged_into=primaryId). Their bookings + attendees re-target to primary.
//   Primary's denormalized aggregates are recomputed last.
// ────────────────────────────────────────────────────────────────────
adminCustomers.post('/merge', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.primaryId !== 'string') {
        return c.json({ error: 'primaryId required' }, 400);
    }
    if (!Array.isArray(body.duplicateIds) || body.duplicateIds.length === 0) {
        return c.json({ error: 'duplicateIds must be a non-empty array' }, 400);
    }

    const primaryId = body.primaryId;
    const duplicateIds = body.duplicateIds.filter((id) => typeof id === 'string' && id);
    if (duplicateIds.includes(primaryId)) {
        return c.json({ error: 'primaryId cannot also be in duplicateIds (self-merge)' }, 400);
    }

    // Validate the primary exists and is active
    const primary = await c.env.DB.prepare(
        `SELECT id, archived_at FROM customers WHERE id = ?`,
    ).bind(primaryId).first();
    if (!primary) return c.json({ error: 'Primary customer not found' }, 404);
    if (primary.archived_at) {
        return c.json({ error: 'Primary customer is archived; cannot merge into it' }, 409);
    }

    // Validate each duplicate exists and is active. We refuse the whole
    // merge if any duplicate is already archived or missing — partial
    // merges are confusing and operator probably wants to investigate.
    const duplicates = [];
    for (const dupId of duplicateIds) {
        const row = await c.env.DB.prepare(
            `SELECT id, archived_at FROM customers WHERE id = ?`,
        ).bind(dupId).first();
        if (!row) {
            return c.json({ error: `Duplicate not found: ${dupId}` }, 404);
        }
        if (row.archived_at) {
            return c.json({ error: `Duplicate already archived: ${dupId}` }, 409);
        }
        duplicates.push(row);
    }

    const now = Date.now();

    // For each duplicate: re-target its bookings/attendees, archive the
    // customer, emit a customer.merged audit row.
    for (const dup of duplicates) {
        await c.env.DB.prepare(
            `UPDATE bookings SET customer_id = ? WHERE customer_id = ?`,
        ).bind(primaryId, dup.id).run();

        await c.env.DB.prepare(
            `UPDATE attendees SET customer_id = ? WHERE customer_id = ?`,
        ).bind(primaryId, dup.id).run();

        await c.env.DB.prepare(
            `UPDATE customers SET
                archived_at = ?,
                archived_reason = 'merged',
                archived_by = ?,
                merged_into = ?,
                updated_at = ?
             WHERE id = ?`,
        ).bind(now, user.id, primaryId, now, dup.id).run();

        await writeAudit(c.env, {
            userId: user.id,
            action: 'customer.merged',
            targetType: 'customer',
            targetId: dup.id,
            meta: { merged_into: primaryId },
        });
    }

    // Recompute the primary's denormalized fields now that bookings have
    // been re-pointed (LTV, totals, refund_count, first/last_booking_at
    // all change).
    await recomputeCustomerDenormalizedFields(c.env.DB, primaryId);

    return c.json({
        success: true,
        primaryId,
        archivedCount: duplicates.length,
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/customers/:id/gdpr-delete — owner only.
//   Body: { reason?: string, requestedVia: 'CCPA'|'GDPR'|'manual',
//           retentionUntil?: number (ms epoch) }
//   Soft-archives the customer with archived_reason='gdpr_delete',
//   redacts personal fields (email, email_normalized, name, phone,
//   notes, notes_sensitive) to NULL/anonymized strings, deletes their
//   customer_tags, and writes a gdpr_deletions audit row. Bookings +
//   attendees keep customer_id pointing at the archived row so
//   accounting + history stay intact, but the personal data is gone.
//
//   Idempotent: the FK on customer_id (post-B6 NOT NULL) means the
//   row CAN'T be hard-deleted without orphaning bookings; the
//   soft-archive + redact is the canonical "delete" for our schema.
//
//   The gdpr_deletions row is intentionally not FK-bound to
//   customers (per migration 0022 #3 design) so the audit row
//   survives even if a future cleanup ever does hard-delete the
//   customer record.
// ────────────────────────────────────────────────────────────────────
adminCustomers.post('/:id/gdpr-delete', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const requestedVia = body?.requestedVia || 'manual';
    if (!['CCPA', 'GDPR', 'manual'].includes(requestedVia)) {
        return c.json({ error: "requestedVia must be 'CCPA', 'GDPR', or 'manual'" }, 400);
    }
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : null;
    const retentionUntil = Number.isFinite(Number(body?.retentionUntil))
        ? Number(body.retentionUntil)
        : null;

    const row = await c.env.DB.prepare(
        `SELECT id, archived_at FROM customers WHERE id = ?`,
    ).bind(id).first();
    if (!row) return c.json({ error: 'Customer not found' }, 404);
    if (row.archived_at) {
        return c.json({ error: 'Customer is already archived; cannot re-delete' }, 409);
    }

    const now = Date.now();
    const redactedEmail = `gdpr-deleted+${id}@redacted.local`;

    // Redact personal fields + soft-archive in one UPDATE so a partial
    // failure doesn't leave personal data sitting around with an
    // archive flag set elsewhere.
    await c.env.DB.prepare(
        `UPDATE customers SET
            email = ?,
            email_normalized = ?,
            name = NULL,
            phone = NULL,
            notes = NULL,
            notes_sensitive = NULL,
            archived_at = ?,
            archived_reason = 'gdpr_delete',
            archived_by = ?,
            updated_at = ?
         WHERE id = ?`,
    ).bind(redactedEmail, redactedEmail, now, user.id, now, id).run();

    // Drop the customer's tags (no value retaining tags on a deleted person).
    await c.env.DB.prepare(
        `DELETE FROM customer_tags WHERE customer_id = ?`,
    ).bind(id).run();

    // Audit trail. customer_id is intentionally non-FK (per migration
    // 0022) so this row survives even if the customer is ever fully
    // hard-deleted in a future cleanup.
    await c.env.DB.prepare(
        `INSERT INTO gdpr_deletions
            (customer_id, reason, requested_via, requested_at, deleted_at,
             deleted_by, retention_until, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
        id,
        reason,
        requestedVia,
        now,
        now,
        user.id,
        retentionUntil,
        null,
    ).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'customer.gdpr_deleted',
        targetType: 'customer',
        targetId: id,
        meta: { requestedVia, reason: reason || null },
    });

    return c.json({ success: true, customerId: id, archivedAt: now });
});

function formatCustomer(row, opts = {}) {
    if (!row) return null;
    const {
        decryptedTaxId = null,
        decryptedBillingAddress = null,
        viewerCanSeeBusinessFields = false,
        viewerCanWriteBusinessFields = false,
    } = opts;
    return {
        id: row.id,
        email: row.email,
        emailNormalized: row.email_normalized,
        name: row.name,
        phone: row.phone,
        totalBookings: row.total_bookings,
        totalAttendees: row.total_attendees,
        lifetimeValueCents: row.lifetime_value_cents,
        refundCount: row.refund_count,
        firstBookingAt: row.first_booking_at,
        lastBookingAt: row.last_booking_at,
        emailTransactional: !!row.email_transactional,
        emailMarketing: !!row.email_marketing,
        smsTransactional: !!row.sms_transactional,
        smsMarketing: !!row.sms_marketing,
        notes: row.notes,
        archivedAt: row.archived_at,
        archivedReason: row.archived_reason,
        archivedBy: row.archived_by,
        mergedInto: row.merged_into,
        createdAt: row.created_at,
        updatedAt: row.updated_at,

        // M5.5 B3 + post-M6 D-1a — business profile fields. EIN and
        // billing address are encrypted at rest (AES-GCM via
        // worker/lib/personEncryption.js). Caller passes decrypted
        // values via opts when viewer has customers.read.business_fields;
        // the has* booleans let UI distinguish "no value set" from
        // "value present but you can't see it".
        clientType: row.client_type || 'individual',
        businessName: row.business_name || null,
        businessWebsite: row.business_website || null,
        hasEncryptedTaxId: !!row.business_tax_id,
        hasEncryptedBillingAddress: !!row.business_billing_address,
        businessTaxId: decryptedTaxId,
        businessBillingAddress: decryptedBillingAddress,
        viewerCanSeeBusinessFields,
        viewerCanWriteBusinessFields,
    };
}

export default adminCustomers;

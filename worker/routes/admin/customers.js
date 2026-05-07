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
import { writeAudit } from '../../lib/auditLog.js';
import { recomputeCustomerDenormalizedFields } from '../../lib/customers.js';

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
// GET /api/admin/customers/:id — detail with bookings + tags
// ────────────────────────────────────────────────────────────────────
adminCustomers.get('/:id', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
        `SELECT * FROM customers WHERE id = ?`,
    ).bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);

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

    return c.json({
        customer: formatCustomer(row),
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
    });
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

function formatCustomer(row) {
    if (!row) return null;
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
    };
}

export default adminCustomers;

// M5.5 Batch 7a — admin field rentals route.
//
// Endpoints:
//   GET    /api/admin/field-rentals                        list with filters + pagination
//   GET    /api/admin/field-rentals/:id                    detail + contacts + site + customer
//   POST   /api/admin/field-rentals                        create (runs conflict check)
//   PUT    /api/admin/field-rentals/:id                    update non-status fields
//   POST   /api/admin/field-rentals/:id/status             status transition (non-cancel)
//   POST   /api/admin/field-rentals/:id/cancel             cancel + reason + deposit-retain flag
//   POST   /api/admin/field-rentals/:id/archive            soft-archive completed rental
//   POST   /api/admin/field-rentals/:id/reschedule         change schedule + re-run conflict check
//
// Capability gating per endpoint listed inline. Conflict-override on
// create + reschedule requires `field_rentals.create.bypass_conflict`
// AND `acknowledgeConflicts: true` in the body. Documents + payments
// live in B7b.

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability, hasCapability } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';
import { detectEventConflicts, hasAnyConflict } from '../../lib/eventConflicts.js';
import {
    fieldRentalId as newFieldRentalId,
    rentalContactId as newContactId,
} from '../../lib/ids.js';
import {
    FIELD_RENTAL_STATUSES,
    FIELD_RENTAL_ENGAGEMENT_TYPES,
    FIELD_RENTAL_COI_STATUSES,
    FIELD_RENTAL_LEAD_SOURCES,
    allowedTransitions,
    validateStatusTransition,
    parseAddonFees,
    computePricing,
    formatFieldRental,
    formatFieldRentalContact,
} from '../../lib/fieldRentals.js';

const adminFieldRentals = new Hono();
adminFieldRentals.use('*', requireAuth);

// ────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────

const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 200;
const VALID_ORDER_BY = new Set(['scheduled_starts_at', 'created_at', 'status_changed_at']);
const VALID_ORDER = new Set(['asc', 'desc']);
const CONTACT_ROLES = new Set(['billing', 'onsite_lead', 'signer', 'other']);
const SPECIAL_PERMISSIONS_KEYS = new Set([
    'pyrotechnics', 'alcohol_service', 'live_steel', 'overnight', 'commercial_filming',
]);

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function viewerCaps(user) {
    return {
        viewerCanSeePII: hasCapability(user, 'field_rentals.read.pii'),
        viewerCanSeeSensitiveNotes: hasCapability(user, 'field_rentals.notes.read_sensitive'),
    };
}

function parseSpecialPermissions(input) {
    if (input === null || input === undefined) return { ok: true, value: '{}' };
    let obj = input;
    if (typeof input === 'string') {
        try { obj = JSON.parse(input); }
        catch { return { ok: false, error: 'special_permissions_json must be valid JSON' }; }
    }
    if (typeof obj !== 'object' || Array.isArray(obj)) {
        return { ok: false, error: 'special_permissions_json must be an object' };
    }
    const cleaned = {};
    for (const [k, v] of Object.entries(obj)) {
        if (!SPECIAL_PERMISSIONS_KEYS.has(k)) continue; // silently drop unknown keys
        cleaned[k] = !!v;
    }
    return { ok: true, value: JSON.stringify(cleaned) };
}

function parseSiteFieldIds(input) {
    if (Array.isArray(input)) {
        const cleaned = input.map((s) => String(s).trim()).filter(Boolean);
        if (cleaned.length === 0) return { ok: false, error: 'site_field_ids cannot be empty' };
        return { ok: true, value: cleaned.join(',') };
    }
    if (typeof input === 'string') {
        const cleaned = input.split(',').map((s) => s.trim()).filter(Boolean);
        if (cleaned.length === 0) return { ok: false, error: 'site_field_ids cannot be empty' };
        return { ok: true, value: cleaned.join(',') };
    }
    return { ok: false, error: 'site_field_ids must be an array or comma-separated string' };
}

function parseScheduleWindow(startsAt, endsAt) {
    const s = Number(startsAt);
    const e = Number(endsAt);
    if (!Number.isFinite(s) || !Number.isFinite(e)) {
        return { ok: false, error: 'scheduled_starts_at and scheduled_ends_at are required (epoch ms)' };
    }
    if (e <= s) return { ok: false, error: 'scheduled_ends_at must be after scheduled_starts_at' };
    return { ok: true, startsAt: s, endsAt: e };
}

// Wraps detectEventConflicts + the acknowledge-override capability check.
// Returns either { ok: true } (no conflict OR acknowledged-and-permitted)
// or { ok: false, status, body } ready to feed c.json().
async function applyConflictCheck(c, { siteId, startsAt, endsAt, excludeFieldRentalId }) {
    const body = await c.req.json().catch(() => ({}));
    const conflicts = await detectEventConflicts(c.env, {
        siteId, startsAt, endsAt, excludeFieldRentalId,
    });
    if (!hasAnyConflict(conflicts)) return { ok: true, body, conflicts: null };
    if (!body.acknowledgeConflicts) {
        return {
            ok: false,
            status: 409,
            body: { error: 'Schedule conflict', conflicts },
        };
    }
    const user = c.get('user');
    if (!hasCapability(user, 'field_rentals.create.bypass_conflict')) {
        return {
            ok: false,
            status: 403,
            body: {
                error: 'Forbidden',
                requiresCapability: 'field_rentals.create.bypass_conflict',
                hint: 'Conflict acknowledgment requires the bypass-conflict capability (Owner-only).',
            },
        };
    }
    return { ok: true, body, conflicts };
}

async function fetchRental(env, id) {
    return env.DB.prepare('SELECT * FROM field_rentals WHERE id = ?').bind(id).first();
}

async function fetchRentalContacts(env, rentalId) {
    const res = await env.DB.prepare(
        'SELECT * FROM field_rental_contacts WHERE rental_id = ? ORDER BY is_primary DESC, role ASC, created_at ASC',
    ).bind(rentalId).all();
    return res.results || [];
}

// ────────────────────────────────────────────────────────────────────
// Body parsers
// ────────────────────────────────────────────────────────────────────

// Returns { patch, error } where patch is the column-name-keyed update object.
// On create (partial=false) required fields enforced; on update (partial=true)
// only provided fields are touched. status is NEVER accepted via this parser
// — status transitions go through dedicated endpoints.
function parseRentalBody(body, { partial = false } = {}) {
    const patch = {};

    if (body.customer_id !== undefined) patch.customer_id = String(body.customer_id).trim();
    if (body.site_id !== undefined) patch.site_id = String(body.site_id).trim();
    if (body.site_field_ids !== undefined) {
        const r = parseSiteFieldIds(body.site_field_ids);
        if (!r.ok) return { error: r.error };
        patch.site_field_ids = r.value;
    }

    if (body.engagement_type !== undefined) {
        if (!FIELD_RENTAL_ENGAGEMENT_TYPES.includes(body.engagement_type)) {
            return { error: `engagement_type must be one of: ${FIELD_RENTAL_ENGAGEMENT_TYPES.join(', ')}` };
        }
        patch.engagement_type = body.engagement_type;
    }

    if (body.lead_source !== undefined) {
        if (body.lead_source !== null && !FIELD_RENTAL_LEAD_SOURCES.includes(body.lead_source)) {
            return { error: `lead_source must be one of: ${FIELD_RENTAL_LEAD_SOURCES.join(', ')}` };
        }
        patch.lead_source = body.lead_source;
    }

    if (body.scheduled_starts_at !== undefined || body.scheduled_ends_at !== undefined) {
        // Both must be provided together (or neither). For partial updates this
        // routes through /reschedule, not PUT — so PUT should reject these.
        return { error: 'Use POST /:id/reschedule to change scheduled times' };
    }

    if (body.arrival_window_starts_at !== undefined) {
        if (body.arrival_window_starts_at === null) {
            patch.arrival_window_starts_at = null;
        } else {
            const n = Number(body.arrival_window_starts_at);
            if (!Number.isFinite(n)) return { error: 'arrival_window_starts_at must be epoch ms or null' };
            patch.arrival_window_starts_at = n;
        }
    }
    if (body.cleanup_buffer_ends_at !== undefined) {
        if (body.cleanup_buffer_ends_at === null) {
            patch.cleanup_buffer_ends_at = null;
        } else {
            const n = Number(body.cleanup_buffer_ends_at);
            if (!Number.isFinite(n)) return { error: 'cleanup_buffer_ends_at must be epoch ms or null' };
            patch.cleanup_buffer_ends_at = n;
        }
    }

    // Pricing inputs — recomputed downstream
    if (body.site_fee_cents !== undefined) {
        const n = Number(body.site_fee_cents);
        if (!Number.isInteger(n) || n < 0) return { error: 'site_fee_cents must be a non-negative integer' };
        patch.site_fee_cents = n;
    }
    if (body.addon_fees !== undefined || body.addon_fees_json !== undefined) {
        const r = parseAddonFees(body.addon_fees ?? body.addon_fees_json);
        if (!r.ok) return { error: r.error };
        patch.addon_fees_json = JSON.stringify(r.addons);
    }
    if (body.discount_cents !== undefined) {
        const n = Number(body.discount_cents);
        if (!Number.isInteger(n) || n < 0) return { error: 'discount_cents must be a non-negative integer' };
        patch.discount_cents = n;
    }
    if (body.discount_reason !== undefined) {
        patch.discount_reason = body.discount_reason === null ? null : String(body.discount_reason);
    }
    if (body.tax_cents !== undefined) {
        const n = Number(body.tax_cents);
        if (!Number.isInteger(n) || n < 0) return { error: 'tax_cents must be a non-negative integer' };
        patch.tax_cents = n;
    }

    // Deposit / balance schedule (recording payments happens in B7b)
    if (body.deposit_required_cents !== undefined) {
        if (body.deposit_required_cents === null) {
            patch.deposit_required_cents = null;
        } else {
            const n = Number(body.deposit_required_cents);
            if (!Number.isInteger(n) || n < 0) return { error: 'deposit_required_cents must be a non-negative integer or null' };
            patch.deposit_required_cents = n;
        }
    }
    if (body.deposit_due_at !== undefined) {
        patch.deposit_due_at = body.deposit_due_at === null ? null : Number(body.deposit_due_at);
        if (patch.deposit_due_at !== null && !Number.isFinite(patch.deposit_due_at)) {
            return { error: 'deposit_due_at must be epoch ms or null' };
        }
    }
    if (body.balance_due_at !== undefined) {
        patch.balance_due_at = body.balance_due_at === null ? null : Number(body.balance_due_at);
        if (patch.balance_due_at !== null && !Number.isFinite(patch.balance_due_at)) {
            return { error: 'balance_due_at must be epoch ms or null' };
        }
    }

    if (body.coi_status !== undefined) {
        if (!FIELD_RENTAL_COI_STATUSES.includes(body.coi_status)) {
            return { error: `coi_status must be one of: ${FIELD_RENTAL_COI_STATUSES.join(', ')}` };
        }
        patch.coi_status = body.coi_status;
    }
    if (body.coi_expires_at !== undefined) {
        patch.coi_expires_at = body.coi_expires_at === null ? null : Number(body.coi_expires_at);
        if (patch.coi_expires_at !== null && !Number.isFinite(patch.coi_expires_at)) {
            return { error: 'coi_expires_at must be epoch ms or null' };
        }
    }

    if (body.headcount_estimate !== undefined) {
        if (body.headcount_estimate === null) {
            patch.headcount_estimate = null;
        } else {
            const n = Number(body.headcount_estimate);
            if (!Number.isInteger(n) || n < 0) return { error: 'headcount_estimate must be a non-negative integer or null' };
            patch.headcount_estimate = n;
        }
    }
    if (body.schedule_notes !== undefined) patch.schedule_notes = body.schedule_notes === null ? null : String(body.schedule_notes);
    if (body.equipment_notes !== undefined) patch.equipment_notes = body.equipment_notes === null ? null : String(body.equipment_notes);
    if (body.staffing_notes !== undefined) patch.staffing_notes = body.staffing_notes === null ? null : String(body.staffing_notes);
    if (body.special_permissions !== undefined || body.special_permissions_json !== undefined) {
        const r = parseSpecialPermissions(body.special_permissions ?? body.special_permissions_json);
        if (!r.ok) return { error: r.error };
        patch.special_permissions_json = r.value;
    }

    // Requirements checklist (5 booleans)
    if (body.requirements_coi_received !== undefined) {
        patch.requirements_coi_received = body.requirements_coi_received ? 1 : 0;
    }
    if (body.requirements_agreement_signed !== undefined) {
        patch.requirements_agreement_signed = body.requirements_agreement_signed ? 1 : 0;
    }
    if (body.requirements_deposit_received !== undefined) {
        patch.requirements_deposit_received = body.requirements_deposit_received ? 1 : 0;
    }
    if (body.requirements_briefing_scheduled !== undefined) {
        patch.requirements_briefing_scheduled = body.requirements_briefing_scheduled ? 1 : 0;
    }
    if (body.requirements_walkthrough_completed !== undefined) {
        patch.requirements_walkthrough_completed = body.requirements_walkthrough_completed ? 1 : 0;
    }

    // Notes (PII-gated read but no separate write gate at the route level —
    // .write covers it. Sensitive-notes WRITE is gated by .notes.write_sensitive
    // at a per-call check below if a future batch adds it.)
    if (body.notes !== undefined) patch.notes = body.notes === null ? null : String(body.notes);
    if (body.notes_sensitive !== undefined) patch.notes_sensitive = body.notes_sensitive === null ? null : String(body.notes_sensitive);

    if (body.aas_site_coordinator_person_id !== undefined) {
        patch.aas_site_coordinator_person_id = body.aas_site_coordinator_person_id === null
            ? null
            : String(body.aas_site_coordinator_person_id);
    }

    if (!partial) {
        for (const required of [
            'customer_id', 'site_id', 'site_field_ids', 'engagement_type',
        ]) {
            if (!patch[required]) return { error: `${required} is required` };
        }
        // Pricing defaults at create time when omitted
        if (patch.site_fee_cents === undefined) patch.site_fee_cents = 0;
        if (patch.discount_cents === undefined) patch.discount_cents = 0;
        if (patch.tax_cents === undefined) patch.tax_cents = 0;
    }

    return { patch };
}

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/field-rentals — list with filters
// ────────────────────────────────────────────────────────────────────

adminFieldRentals.get('/', requireCapability('field_rentals.read'), async (c) => {
    const user = c.get('user');
    const url = new URL(c.req.url);

    const where = [];
    const binds = [];

    const archivedParam = url.searchParams.get('archived');
    if (archivedParam !== 'all') {
        if (archivedParam === 'true') where.push('archived_at IS NOT NULL');
        else where.push('archived_at IS NULL');
    }

    const statusParam = url.searchParams.get('status');
    if (statusParam) {
        const statuses = statusParam.split(',').map((s) => s.trim()).filter((s) => FIELD_RENTAL_STATUSES.includes(s));
        if (statuses.length > 0) {
            where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
            binds.push(...statuses);
        }
    }

    const siteIdParam = url.searchParams.get('site_id');
    if (siteIdParam) { where.push('site_id = ?'); binds.push(siteIdParam); }

    const customerIdParam = url.searchParams.get('customer_id');
    if (customerIdParam) { where.push('customer_id = ?'); binds.push(customerIdParam); }

    const engagementParam = url.searchParams.get('engagement_type');
    if (engagementParam && FIELD_RENTAL_ENGAGEMENT_TYPES.includes(engagementParam)) {
        where.push('engagement_type = ?'); binds.push(engagementParam);
    }

    const coiStatusParam = url.searchParams.get('coi_status');
    if (coiStatusParam && FIELD_RENTAL_COI_STATUSES.includes(coiStatusParam)) {
        where.push('coi_status = ?'); binds.push(coiStatusParam);
    }

    const startsAfterParam = Number(url.searchParams.get('starts_at_after'));
    if (Number.isFinite(startsAfterParam)) {
        where.push('scheduled_starts_at >= ?'); binds.push(startsAfterParam);
    }
    const startsBeforeParam = Number(url.searchParams.get('starts_at_before'));
    if (Number.isFinite(startsBeforeParam)) {
        where.push('scheduled_starts_at <= ?'); binds.push(startsBeforeParam);
    }

    // Free-text search. notes is PII-gated — only included when viewer has read.pii.
    const qParam = url.searchParams.get('q');
    if (qParam && qParam.trim()) {
        const needle = `%${qParam.trim().toLowerCase()}%`;
        const canSeePII = hasCapability(user, 'field_rentals.read.pii');
        if (canSeePII) {
            where.push('(LOWER(schedule_notes) LIKE ? OR LOWER(notes) LIKE ? OR LOWER(id) LIKE ?)');
            binds.push(needle, needle, needle);
        } else {
            where.push('(LOWER(schedule_notes) LIKE ? OR LOWER(id) LIKE ?)');
            binds.push(needle, needle);
        }
    }

    // Order + pagination
    let orderBy = url.searchParams.get('order_by') || 'scheduled_starts_at';
    if (!VALID_ORDER_BY.has(orderBy)) orderBy = 'scheduled_starts_at';
    let order = (url.searchParams.get('order') || 'desc').toLowerCase();
    if (!VALID_ORDER.has(order)) order = 'desc';

    let limit = Number(url.searchParams.get('limit'));
    if (!Number.isInteger(limit) || limit <= 0) limit = LIST_LIMIT_DEFAULT;
    if (limit > LIST_LIMIT_MAX) limit = LIST_LIMIT_MAX;
    let offset = Number(url.searchParams.get('offset'));
    if (!Number.isInteger(offset) || offset < 0) offset = 0;

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM field_rentals ${whereSql}`,
    ).bind(...binds).first();
    const total = totalRow?.n || 0;

    const listRes = await c.env.DB.prepare(
        `SELECT * FROM field_rentals ${whereSql}
         ORDER BY ${orderBy} ${order.toUpperCase()}, id ASC
         LIMIT ? OFFSET ?`,
    ).bind(...binds, limit, offset).all();

    const caps = viewerCaps(user);
    return c.json({
        rentals: (listRes.results || []).map((row) => formatFieldRental(row, caps)),
        total,
        limit,
        offset,
    });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/admin/field-rentals/:id — detail
// ────────────────────────────────────────────────────────────────────

adminFieldRentals.get('/:id', requireCapability('field_rentals.read'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');

    const rental = await fetchRental(c.env, id);
    if (!rental) return c.json({ error: 'Field rental not found' }, 404);

    const contacts = await fetchRentalContacts(c.env, id);

    // Light-touch joins for the detail page header
    const site = await c.env.DB.prepare(
        'SELECT id, name, slug FROM sites WHERE id = ?',
    ).bind(rental.site_id).first();
    const customer = await c.env.DB.prepare(
        'SELECT id, email, name, client_type FROM customers WHERE id = ?',
    ).bind(rental.customer_id).first();

    const caps = viewerCaps(user);

    // Audit-log a PII access when the viewer actually unmasked something.
    if (caps.viewerCanSeePII && (rental.notes || contacts.some((cc) => cc.email || cc.phone))) {
        await writeAudit(c.env, {
            userId: user.id,
            action: 'customer_pii.unmasked',
            targetType: 'field_rental',
            targetId: id,
            meta: { surface: 'field_rental.detail' },
        });
    }

    return c.json({
        rental: formatFieldRental(rental, caps),
        contacts: contacts.map((cc) => formatFieldRentalContact(cc, caps)),
        site: site || null,
        customer: customer
            ? { id: customer.id, email: caps.viewerCanSeePII ? customer.email : null, name: customer.name, clientType: customer.client_type }
            : null,
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/field-rentals — create
// ────────────────────────────────────────────────────────────────────

adminFieldRentals.post('/', requireCapability('field_rentals.create'), async (c) => {
    const user = c.get('user');
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) return c.json({ error: 'Invalid body' }, 400);

    const schedule = parseScheduleWindow(rawBody.scheduled_starts_at, rawBody.scheduled_ends_at);
    if (!schedule.ok) return c.json({ error: schedule.error }, 400);

    // Parse the rest. The body parser rejects scheduled_*_at on its own path;
    // we strip them out here so it focuses on everything else.
    const { scheduled_starts_at: _s, scheduled_ends_at: _e, ...bodyWithoutSchedule } = rawBody;
    const parsed = parseRentalBody(bodyWithoutSchedule, { partial: false });
    if (parsed.error) return c.json({ error: parsed.error }, 400);
    const { patch } = parsed;

    // Verify customer + site exist (early friendly failure vs FK error later)
    const customer = await c.env.DB.prepare('SELECT id FROM customers WHERE id = ?').bind(patch.customer_id).first();
    if (!customer) return c.json({ error: 'customer_id does not exist' }, 400);
    const site = await c.env.DB.prepare('SELECT id, archived_at FROM sites WHERE id = ?').bind(patch.site_id).first();
    if (!site) return c.json({ error: 'site_id does not exist' }, 400);
    if (site.archived_at) return c.json({ error: 'Cannot create rental on archived site' }, 409);

    // Pricing recompute (server-trusted)
    const addonsParsed = parseAddonFees(patch.addon_fees_json || '[]');
    if (!addonsParsed.ok) return c.json({ error: addonsParsed.error }, 400);
    const pricing = computePricing({
        siteFeeCents: patch.site_fee_cents,
        addons: addonsParsed.addons,
        discountCents: patch.discount_cents,
        taxCents: patch.tax_cents,
    });
    if (!pricing.ok) return c.json({ error: pricing.error }, 400);

    // Conflict check
    const conflictResult = await applyConflictCheck(c, {
        siteId: patch.site_id,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
    });
    if (!conflictResult.ok) return c.json(conflictResult.body, conflictResult.status);

    const id = newFieldRentalId();
    const now = Date.now();
    const initialStatus = 'lead';

    await c.env.DB.prepare(
        `INSERT INTO field_rentals (
            id, customer_id, site_id, site_field_ids,
            engagement_type, lead_source,
            scheduled_starts_at, scheduled_ends_at, arrival_window_starts_at, cleanup_buffer_ends_at,
            status, status_changed_at,
            site_fee_cents, addon_fees_json, discount_cents, discount_reason,
            tax_cents, total_cents,
            deposit_required_cents, deposit_due_at,
            balance_due_at,
            coi_status, coi_expires_at,
            headcount_estimate, schedule_notes, equipment_notes, staffing_notes, special_permissions_json,
            requirements_coi_received, requirements_agreement_signed,
            requirements_deposit_received, requirements_briefing_scheduled, requirements_walkthrough_completed,
            notes, notes_sensitive,
            aas_site_coordinator_person_id,
            cancellation_deposit_retained,
            created_by, created_at, updated_at
         ) VALUES (
            ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?, ?,
            ?, ?,
            ?, ?,
            ?,
            ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?,
            ?,
            ?,
            ?, ?, ?
         )`,
    ).bind(
        id, patch.customer_id, patch.site_id, patch.site_field_ids,
        patch.engagement_type, patch.lead_source ?? null,
        schedule.startsAt, schedule.endsAt,
        patch.arrival_window_starts_at ?? null, patch.cleanup_buffer_ends_at ?? null,
        initialStatus, now,
        patch.site_fee_cents, patch.addon_fees_json ?? '[]',
        patch.discount_cents, patch.discount_reason ?? null,
        patch.tax_cents, pricing.totalCents,
        patch.deposit_required_cents ?? null, patch.deposit_due_at ?? null,
        patch.balance_due_at ?? null,
        patch.coi_status ?? 'not_required', patch.coi_expires_at ?? null,
        patch.headcount_estimate ?? null,
        patch.schedule_notes ?? null, patch.equipment_notes ?? null, patch.staffing_notes ?? null,
        patch.special_permissions_json ?? '{}',
        patch.requirements_coi_received ?? 0, patch.requirements_agreement_signed ?? 0,
        patch.requirements_deposit_received ?? 0, patch.requirements_briefing_scheduled ?? 0,
        patch.requirements_walkthrough_completed ?? 0,
        patch.notes ?? null, patch.notes_sensitive ?? null,
        patch.aas_site_coordinator_person_id ?? null,
        0,
        user.id, now, now,
    ).run();

    // Optional contacts seed at create time
    const contactsInput = Array.isArray(rawBody.contacts) ? rawBody.contacts : [];
    for (const ct of contactsInput) {
        if (!ct?.full_name) continue;
        const role = CONTACT_ROLES.has(ct.role) ? ct.role : 'other';
        await c.env.DB.prepare(
            `INSERT INTO field_rental_contacts (id, rental_id, full_name, email, phone, role, is_primary, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
            newContactId(), id, String(ct.full_name).trim(),
            ct.email ? String(ct.email).trim() : null,
            ct.phone ? String(ct.phone).trim() : null,
            role,
            ct.is_primary ? 1 : 0,
            ct.notes ? String(ct.notes) : null,
            now, now,
        ).run();
    }

    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental.created',
        targetType: 'field_rental',
        targetId: id,
        meta: {
            customerId: patch.customer_id,
            siteId: patch.site_id,
            engagementType: patch.engagement_type,
            totalCents: pricing.totalCents,
            conflictAcknowledged: !!conflictResult.conflicts,
        },
    });
    if (conflictResult.conflicts) {
        await writeAudit(c.env, {
            userId: user.id,
            action: 'field_rental.conflict_acknowledged',
            targetType: 'field_rental',
            targetId: id,
            meta: {
                conflictingEventIds: (conflictResult.conflicts.events || []).map((x) => x.id),
                conflictingBlackoutIds: (conflictResult.conflicts.blackouts || []).map((x) => x.id),
                conflictingRentalIds: (conflictResult.conflicts.fieldRentals || []).map((x) => x.id),
            },
        });
    }

    const created = await fetchRental(c.env, id);
    const caps = viewerCaps(user);
    return c.json({ rental: formatFieldRental(created, caps) }, 201);
});

// ────────────────────────────────────────────────────────────────────
// PUT /api/admin/field-rentals/:id — update non-status fields
// ────────────────────────────────────────────────────────────────────

adminFieldRentals.put('/:id', requireCapability('field_rentals.write'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await fetchRental(c.env, id);
    if (!existing) return c.json({ error: 'Field rental not found' }, 404);
    if (existing.archived_at) return c.json({ error: 'Cannot edit archived rental' }, 409);

    if (body.status !== undefined) {
        return c.json({ error: 'Use POST /:id/status, /:id/cancel, or /:id/archive to change lifecycle state' }, 400);
    }

    const parsed = parseRentalBody(body, { partial: true });
    if (parsed.error) return c.json({ error: parsed.error }, 400);
    const { patch } = parsed;

    if (Object.keys(patch).length === 0) return c.json({ error: 'No changes' }, 400);

    // If any pricing input changed, recompute total_cents.
    const pricingTouched = ['site_fee_cents', 'addon_fees_json', 'discount_cents', 'tax_cents']
        .some((k) => patch[k] !== undefined);
    if (pricingTouched) {
        const addons = parseAddonFees(patch.addon_fees_json ?? existing.addon_fees_json ?? '[]');
        if (!addons.ok) return c.json({ error: addons.error }, 400);
        const pricing = computePricing({
            siteFeeCents: patch.site_fee_cents ?? existing.site_fee_cents,
            addons: addons.addons,
            discountCents: patch.discount_cents ?? existing.discount_cents,
            taxCents: patch.tax_cents ?? existing.tax_cents,
        });
        if (!pricing.ok) return c.json({ error: pricing.error }, 400);
        patch.total_cents = pricing.totalCents;
    }

    const keys = Object.keys(patch);
    keys.push('updated_at');
    patch.updated_at = Date.now();
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const binds = keys.map((k) => patch[k]);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE field_rentals SET ${sets} WHERE id = ?`).bind(...binds).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental.updated',
        targetType: 'field_rental',
        targetId: id,
        meta: { fields: keys.filter((k) => k !== 'updated_at') },
    });

    const updated = await fetchRental(c.env, id);
    return c.json({ rental: formatFieldRental(updated, viewerCaps(user)) });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/field-rentals/:id/status — non-cancel transitions
// ────────────────────────────────────────────────────────────────────

adminFieldRentals.post('/:id/status', requireCapability('field_rentals.write'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const to = body.to;
    if (!FIELD_RENTAL_STATUSES.includes(to)) {
        return c.json({ error: `to must be one of: ${FIELD_RENTAL_STATUSES.join(', ')}` }, 400);
    }
    if (to === 'cancelled') {
        return c.json({ error: 'Use POST /:id/cancel for cancellations' }, 400);
    }
    if (to === 'refunded') {
        // Refund flow ships in B7b — direct status flip not permitted in B7a.
        return c.json({ error: 'Refund must be issued via the payments endpoint (B7b)' }, 400);
    }

    const existing = await fetchRental(c.env, id);
    if (!existing) return c.json({ error: 'Field rental not found' }, 404);
    if (existing.archived_at) return c.json({ error: 'Cannot transition archived rental' }, 409);

    if (!validateStatusTransition(existing.status, to)) {
        return c.json({
            error: `Invalid transition: ${existing.status} → ${to}`,
            allowed: allowedTransitions(existing.status),
        }, 409);
    }

    const now = Date.now();
    const reason = body.reason ? String(body.reason) : null;
    await c.env.DB.prepare(
        `UPDATE field_rentals SET status = ?, status_changed_at = ?, status_change_reason = ?, updated_at = ?
         WHERE id = ?`,
    ).bind(to, now, reason, now, id).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental.status_changed',
        targetType: 'field_rental',
        targetId: id,
        meta: { from: existing.status, to, reason },
    });

    const updated = await fetchRental(c.env, id);
    return c.json({ rental: formatFieldRental(updated, viewerCaps(user)) });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/field-rentals/:id/cancel — cancel + reason
// ────────────────────────────────────────────────────────────────────

adminFieldRentals.post('/:id/cancel', requireCapability('field_rentals.cancel'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const existing = await fetchRental(c.env, id);
    if (!existing) return c.json({ error: 'Field rental not found' }, 404);
    if (existing.status === 'cancelled') return c.json({ error: 'Rental already cancelled' }, 409);
    if (existing.archived_at) return c.json({ error: 'Cannot cancel archived rental' }, 409);

    if (!validateStatusTransition(existing.status, 'cancelled')) {
        return c.json({
            error: `Cannot cancel from status ${existing.status}`,
            allowed: allowedTransitions(existing.status),
        }, 409);
    }

    const reason = body.reason ? String(body.reason) : null;
    const depositRetained = body.deposit_retained ? 1 : 0;
    const now = Date.now();

    await c.env.DB.prepare(
        `UPDATE field_rentals
         SET status = 'cancelled', status_changed_at = ?, status_change_reason = ?,
             cancelled_at = ?, cancellation_reason = ?, cancellation_deposit_retained = ?,
             updated_at = ?
         WHERE id = ?`,
    ).bind(now, reason, now, reason, depositRetained, now, id).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental.cancelled',
        targetType: 'field_rental',
        targetId: id,
        meta: { from: existing.status, reason, depositRetained: !!depositRetained },
    });

    const updated = await fetchRental(c.env, id);
    return c.json({ rental: formatFieldRental(updated, viewerCaps(user)) });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/field-rentals/:id/archive — soft-archive
// ────────────────────────────────────────────────────────────────────

adminFieldRentals.post('/:id/archive', requireCapability('field_rentals.archive'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');

    const existing = await fetchRental(c.env, id);
    if (!existing) return c.json({ error: 'Field rental not found' }, 404);
    if (existing.archived_at) return c.json({ error: 'Rental already archived' }, 409);

    // Only terminal statuses can be archived (completed / cancelled / refunded).
    const TERMINAL = new Set(['completed', 'cancelled', 'refunded']);
    if (!TERMINAL.has(existing.status)) {
        return c.json({
            error: `Cannot archive rental in status ${existing.status} — archive is for completed / cancelled / refunded rentals only`,
        }, 409);
    }

    const now = Date.now();
    await c.env.DB.prepare(
        `UPDATE field_rentals SET archived_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(now, now, id).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental.archived',
        targetType: 'field_rental',
        targetId: id,
        meta: { fromStatus: existing.status },
    });

    return c.json({ archived: true });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/admin/field-rentals/:id/reschedule — change schedule
// ────────────────────────────────────────────────────────────────────

adminFieldRentals.post('/:id/reschedule', requireCapability('field_rentals.reschedule'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) return c.json({ error: 'Invalid body' }, 400);

    const schedule = parseScheduleWindow(rawBody.scheduled_starts_at, rawBody.scheduled_ends_at);
    if (!schedule.ok) return c.json({ error: schedule.error }, 400);

    const existing = await fetchRental(c.env, id);
    if (!existing) return c.json({ error: 'Field rental not found' }, 404);
    if (existing.archived_at) return c.json({ error: 'Cannot reschedule archived rental' }, 409);
    if (existing.status === 'cancelled' || existing.status === 'refunded') {
        return c.json({ error: `Cannot reschedule rental in status ${existing.status}` }, 409);
    }

    const conflictResult = await applyConflictCheck(c, {
        siteId: existing.site_id,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        excludeFieldRentalId: id,
    });
    if (!conflictResult.ok) return c.json(conflictResult.body, conflictResult.status);

    const now = Date.now();
    const arrivalAt = rawBody.arrival_window_starts_at === undefined
        ? existing.arrival_window_starts_at
        : (rawBody.arrival_window_starts_at === null ? null : Number(rawBody.arrival_window_starts_at));
    const cleanupAt = rawBody.cleanup_buffer_ends_at === undefined
        ? existing.cleanup_buffer_ends_at
        : (rawBody.cleanup_buffer_ends_at === null ? null : Number(rawBody.cleanup_buffer_ends_at));

    await c.env.DB.prepare(
        `UPDATE field_rentals
         SET scheduled_starts_at = ?, scheduled_ends_at = ?,
             arrival_window_starts_at = ?, cleanup_buffer_ends_at = ?,
             updated_at = ?
         WHERE id = ?`,
    ).bind(schedule.startsAt, schedule.endsAt, arrivalAt, cleanupAt, now, id).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental.rescheduled',
        targetType: 'field_rental',
        targetId: id,
        meta: {
            fromStartsAt: existing.scheduled_starts_at,
            fromEndsAt: existing.scheduled_ends_at,
            toStartsAt: schedule.startsAt,
            toEndsAt: schedule.endsAt,
            conflictAcknowledged: !!conflictResult.conflicts,
        },
    });
    if (conflictResult.conflicts) {
        await writeAudit(c.env, {
            userId: user.id,
            action: 'field_rental.conflict_acknowledged',
            targetType: 'field_rental',
            targetId: id,
            meta: {
                surface: 'reschedule',
                conflictingEventIds: (conflictResult.conflicts.events || []).map((x) => x.id),
                conflictingBlackoutIds: (conflictResult.conflicts.blackouts || []).map((x) => x.id),
                conflictingRentalIds: (conflictResult.conflicts.fieldRentals || []).map((x) => x.id),
            },
        });
    }

    const updated = await fetchRental(c.env, id);
    return c.json({ rental: formatFieldRental(updated, viewerCaps(user)) });
});

export default adminFieldRentals;

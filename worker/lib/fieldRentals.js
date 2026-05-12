// M5.5 Batch 7a — Pure helpers for the field rentals route.
//
// Server-trusted business logic that doesn't touch I/O: pricing
// computation, status-transition validation, addon-fee parsing, and
// the DB-row-to-API-response format with PII masking.
//
// Used by:
// - worker/routes/admin/fieldRentals.js (B7a)
// - worker/routes/admin/fieldRentalDocuments.js (B7b)
// - worker/routes/admin/fieldRentalPayments.js (B7b)
//
// Tests:
// - tests/unit/lib/fieldRentals.test.js

// ────────────────────────────────────────────────────────────────────
// Status transition matrix
// ────────────────────────────────────────────────────────────────────
//
// Operator-confirmed B7 graph (8 statuses). `from -> [allowed `to`s]`.
// Back-reverts permitted: `sent -> draft` (renter retracted, re-edit),
// `agreed -> sent` (renegotiation). `paid -> completed` is the happy-
// path forward edge; `paid -> refunded` covers a refund issued before
// completion. `cancelled -> refunded` retains the option to refund a
// previously-cancelled rental (the cancellation_deposit_retained flag
// + B7b refund flow control whether the deposit comes back).
const STATUS_TRANSITIONS = {
    lead:      ['draft', 'cancelled'],
    draft:     ['sent', 'cancelled'],
    sent:      ['agreed', 'draft', 'cancelled'],
    agreed:    ['paid', 'sent', 'cancelled'],
    paid:      ['completed', 'refunded'],
    completed: ['refunded'],
    cancelled: ['refunded'],
    refunded:  [],
};

export const FIELD_RENTAL_STATUSES = Object.keys(STATUS_TRANSITIONS);

export const FIELD_RENTAL_ENGAGEMENT_TYPES = [
    'private_skirmish', 'paintball', 'tactical_training', 'film_shoot',
    'corporate', 'youth_program', 'other',
];

export const FIELD_RENTAL_COI_STATUSES = ['not_required', 'pending', 'received', 'expired'];

export const FIELD_RENTAL_LEAD_SOURCES = [
    'inquiry_form', 'phone', 'email', 'referral', 'walkin', 'other',
];

/**
 * Returns the array of valid `to` statuses for a given `from`.
 * Returns [] for unknown `from` (defensive — caller should validate
 * the input status against FIELD_RENTAL_STATUSES first).
 */
export function allowedTransitions(from) {
    return STATUS_TRANSITIONS[from] || [];
}

/**
 * True if `to` is a permitted next state for `from`. Same-state
 * transitions (from === to) are not transitions and return false.
 */
export function validateStatusTransition(from, to) {
    if (!from || !to || from === to) return false;
    return allowedTransitions(from).includes(to);
}

// ────────────────────────────────────────────────────────────────────
// Addon fee parsing
// ────────────────────────────────────────────────────────────────────

const ADDON_MAX_ITEMS = 20;
const ADDON_LABEL_MAX_LEN = 100;

/**
 * Parses + validates the `addon_fees_json` shape. Accepts either a
 * JSON string (DB-stored shape) or an already-parsed array. Returns
 * `{ ok: true, addons: [{label, cents}] }` on success, or
 * `{ ok: false, error: '...' }` on any validation failure.
 *
 * Validation rules:
 * - Must be an array (or JSON string parsing to an array)
 * - Max 20 items
 * - Each item: { label: non-empty string ≤100 chars, cents: integer >= 0 }
 */
export function parseAddonFees(input) {
    let arr;
    if (Array.isArray(input)) {
        arr = input;
    } else if (typeof input === 'string') {
        try {
            arr = JSON.parse(input);
        } catch {
            return { ok: false, error: 'addon_fees_json must be valid JSON' };
        }
    } else if (input === null || input === undefined) {
        return { ok: true, addons: [] };
    } else {
        return { ok: false, error: 'addon_fees_json must be a JSON array' };
    }

    if (!Array.isArray(arr)) {
        return { ok: false, error: 'addon_fees_json must be a JSON array' };
    }
    if (arr.length > ADDON_MAX_ITEMS) {
        return { ok: false, error: `addon_fees_json cannot exceed ${ADDON_MAX_ITEMS} items` };
    }

    const addons = [];
    for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (!item || typeof item !== 'object') {
            return { ok: false, error: `addon_fees_json[${i}] must be an object` };
        }
        const label = typeof item.label === 'string' ? item.label.trim() : '';
        if (!label) {
            return { ok: false, error: `addon_fees_json[${i}].label is required` };
        }
        if (label.length > ADDON_LABEL_MAX_LEN) {
            return { ok: false, error: `addon_fees_json[${i}].label exceeds ${ADDON_LABEL_MAX_LEN} chars` };
        }
        const cents = Number(item.cents);
        if (!Number.isInteger(cents) || cents < 0) {
            return { ok: false, error: `addon_fees_json[${i}].cents must be a non-negative integer` };
        }
        addons.push({ label, cents });
    }
    return { ok: true, addons };
}

// ────────────────────────────────────────────────────────────────────
// Pricing
// ────────────────────────────────────────────────────────────────────

/**
 * Server-trusted pricing recompute. Caller passes the raw inputs;
 * helper returns `{ ok, totalCents, addonSubtotalCents }` or
 * `{ ok: false, error }`.
 *
 * Formula:
 *   addon_subtotal = sum(addons[].cents)
 *   total = site_fee + addon_subtotal - discount + tax
 *
 * Reject when:
 * - any input is not a non-negative integer (after coercion)
 * - total goes negative (discount exceeds site_fee + addons + tax)
 *
 * tax_cents is caller-provided for M5.5; no tax engine integration.
 */
export function computePricing({ siteFeeCents, addons, discountCents, taxCents }) {
    const site = Number.isInteger(siteFeeCents) ? siteFeeCents : Number(siteFeeCents);
    const discount = Number.isInteger(discountCents) ? discountCents : Number(discountCents || 0);
    const tax = Number.isInteger(taxCents) ? taxCents : Number(taxCents || 0);

    if (!Number.isInteger(site) || site < 0) {
        return { ok: false, error: 'site_fee_cents must be a non-negative integer' };
    }
    if (!Number.isInteger(discount) || discount < 0) {
        return { ok: false, error: 'discount_cents must be a non-negative integer' };
    }
    if (!Number.isInteger(tax) || tax < 0) {
        return { ok: false, error: 'tax_cents must be a non-negative integer' };
    }

    const addonList = Array.isArray(addons) ? addons : [];
    let addonSubtotal = 0;
    for (const a of addonList) {
        const c = Number(a?.cents);
        if (!Number.isInteger(c) || c < 0) {
            return { ok: false, error: 'addon entries must have a non-negative integer cents value' };
        }
        addonSubtotal += c;
    }

    const total = site + addonSubtotal - discount + tax;
    if (total < 0) {
        return { ok: false, error: 'discount_cents exceeds total — would yield negative total' };
    }
    return { ok: true, totalCents: total, addonSubtotalCents: addonSubtotal };
}

// ────────────────────────────────────────────────────────────────────
// Display formatter (DB row → API response shape with PII masking)
// ────────────────────────────────────────────────────────────────────

const MASKED = '***';

/**
 * Format a field_rentals row for API response. Masking:
 * - `notes` masked unless viewer has field_rentals.read.pii
 * - `notesSensitive` masked unless viewer has field_rentals.notes.read_sensitive
 *   (and only surfaced when viewerCanSeeSensitiveNotes is true; otherwise
 *   the field is dropped from the response entirely)
 * - Contact-side PII (emails/phones inside `field_rental_contacts`) is
 *   masked by `formatFieldRentalContact` separately — this function only
 *   handles the parent row.
 *
 * `viewerCanSeePII` and `viewerCanSeeSensitiveNotes` default to false (safest).
 */
export function formatFieldRental(row, options = {}) {
    if (!row) return null;
    const viewerCanSeePII = !!options.viewerCanSeePII;
    const viewerCanSeeSensitiveNotes = !!options.viewerCanSeeSensitiveNotes;

    let addonFees = [];
    if (row.addon_fees_json) {
        try { addonFees = JSON.parse(row.addon_fees_json); }
        catch { addonFees = []; }
    }
    let specialPermissions = {};
    if (row.special_permissions_json) {
        try { specialPermissions = JSON.parse(row.special_permissions_json); }
        catch { specialPermissions = {}; }
    }

    const siteFieldIds = typeof row.site_field_ids === 'string'
        ? row.site_field_ids.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

    const out = {
        id: row.id,
        customerId: row.customer_id,
        siteId: row.site_id,
        siteFieldIds,

        engagementType: row.engagement_type,
        leadSource: row.lead_source,

        recurrenceId: row.recurrence_id,
        recurrenceInstanceIndex: row.recurrence_instance_index,

        scheduledStartsAt: row.scheduled_starts_at,
        scheduledEndsAt: row.scheduled_ends_at,
        arrivalWindowStartsAt: row.arrival_window_starts_at,
        cleanupBufferEndsAt: row.cleanup_buffer_ends_at,

        status: row.status,
        statusChangedAt: row.status_changed_at,
        statusChangeReason: row.status_change_reason,

        siteFeeCents: row.site_fee_cents,
        addonFees,
        discountCents: row.discount_cents,
        discountReason: row.discount_reason,
        taxCents: row.tax_cents,
        totalCents: row.total_cents,

        depositRequiredCents: row.deposit_required_cents,
        depositDueAt: row.deposit_due_at,
        depositReceivedAt: row.deposit_received_at,
        depositMethod: row.deposit_method,
        depositReference: row.deposit_reference,
        depositReceivedBy: row.deposit_received_by,

        balanceDueAt: row.balance_due_at,
        balanceReceivedAt: row.balance_received_at,
        balanceMethod: row.balance_method,
        balanceReference: row.balance_reference,
        balanceReceivedBy: row.balance_received_by,

        coiStatus: row.coi_status,
        coiExpiresAt: row.coi_expires_at,

        headcountEstimate: row.headcount_estimate,
        scheduleNotes: row.schedule_notes,
        equipmentNotes: row.equipment_notes,
        staffingNotes: row.staffing_notes,
        specialPermissions,

        requirements: {
            coiReceived: row.requirements_coi_received === 1,
            agreementSigned: row.requirements_agreement_signed === 1,
            depositReceived: row.requirements_deposit_received === 1,
            briefingScheduled: row.requirements_briefing_scheduled === 1,
            walkthroughCompleted: row.requirements_walkthrough_completed === 1,
        },

        notes: viewerCanSeePII ? row.notes : (row.notes ? MASKED : null),

        aasSiteCoordinatorPersonId: row.aas_site_coordinator_person_id,

        archivedAt: row.archived_at,
        cancelledAt: row.cancelled_at,
        cancellationReason: row.cancellation_reason,
        cancellationDepositRetained: row.cancellation_deposit_retained === 1,

        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };

    // notesSensitive is surfaced only with explicit capability; otherwise
    // dropped entirely from the response (avoiding the existence-disclosure
    // gain that masking-with-asterisks would leak).
    if (viewerCanSeeSensitiveNotes) {
        out.notesSensitive = row.notes_sensitive;
    }

    return out;
}

/**
 * Format a field_rental_contacts row. Masks email + phone when viewer
 * lacks field_rentals.read.pii.
 */
export function formatFieldRentalContact(row, options = {}) {
    if (!row) return null;
    const viewerCanSeePII = !!options.viewerCanSeePII;
    return {
        id: row.id,
        rentalId: row.rental_id,
        fullName: row.full_name,
        email: viewerCanSeePII ? row.email : (row.email ? MASKED : null),
        phone: viewerCanSeePII ? row.phone : (row.phone ? MASKED : null),
        role: row.role,
        isPrimary: row.is_primary === 1,
        notes: viewerCanSeePII ? row.notes : (row.notes ? MASKED : null),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

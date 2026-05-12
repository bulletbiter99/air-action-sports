// M5.5 Batch 7a — pure-helper tests for worker/lib/fieldRentals.js.
//
// Covers:
//   - The 8-state status transition matrix (every from x to combination)
//   - validateStatusTransition() rejecting same-state, invalid, and unknown
//   - parseAddonFees() validation rules + happy path
//   - computePricing() math + boundary rejections
//   - formatFieldRental() PII masking shape (notes, notes_sensitive)
//   - formatFieldRentalContact() PII masking shape
//   - Exported constant arrays match the schema CHECK enums

import { describe, it, expect } from 'vitest';
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
} from '../../../worker/lib/fieldRentals.js';

// ────────────────────────────────────────────────────────────────────
// Exported constants
// ────────────────────────────────────────────────────────────────────

describe('exported constant arrays', () => {
    it('FIELD_RENTAL_STATUSES contains the 8 schema CHECK enum values', () => {
        expect(FIELD_RENTAL_STATUSES).toEqual([
            'lead', 'draft', 'sent', 'agreed', 'paid', 'completed', 'cancelled', 'refunded',
        ]);
    });

    it('FIELD_RENTAL_ENGAGEMENT_TYPES matches migration 0047 CHECK enum (7 values)', () => {
        expect(FIELD_RENTAL_ENGAGEMENT_TYPES).toEqual([
            'private_skirmish', 'paintball', 'tactical_training', 'film_shoot',
            'corporate', 'youth_program', 'other',
        ]);
    });

    it('FIELD_RENTAL_COI_STATUSES matches migration 0047 (4 values)', () => {
        expect(FIELD_RENTAL_COI_STATUSES).toEqual([
            'not_required', 'pending', 'received', 'expired',
        ]);
    });

    it('FIELD_RENTAL_LEAD_SOURCES matches migration 0047 (6 values)', () => {
        expect(FIELD_RENTAL_LEAD_SOURCES).toEqual([
            'inquiry_form', 'phone', 'email', 'referral', 'walkin', 'other',
        ]);
    });
});

// ────────────────────────────────────────────────────────────────────
// Status transition matrix
// ────────────────────────────────────────────────────────────────────

describe('allowedTransitions / validateStatusTransition', () => {
    it('lead → draft, cancelled (only)', () => {
        expect(allowedTransitions('lead').sort()).toEqual(['cancelled', 'draft']);
    });

    it('draft → sent, cancelled', () => {
        expect(allowedTransitions('draft').sort()).toEqual(['cancelled', 'sent']);
    });

    it('sent → agreed, draft (back-revert), cancelled', () => {
        expect(allowedTransitions('sent').sort()).toEqual(['agreed', 'cancelled', 'draft']);
    });

    it('agreed → paid, sent (back-revert), cancelled', () => {
        expect(allowedTransitions('agreed').sort()).toEqual(['cancelled', 'paid', 'sent']);
    });

    it('paid → completed, refunded', () => {
        expect(allowedTransitions('paid').sort()).toEqual(['completed', 'refunded']);
    });

    it('completed → refunded', () => {
        expect(allowedTransitions('completed')).toEqual(['refunded']);
    });

    it('cancelled → refunded (allows refunding a cancelled rental)', () => {
        expect(allowedTransitions('cancelled')).toEqual(['refunded']);
    });

    it('refunded is terminal — no outgoing transitions', () => {
        expect(allowedTransitions('refunded')).toEqual([]);
    });

    it('unknown status returns empty allowed-list', () => {
        expect(allowedTransitions('made-up')).toEqual([]);
        expect(allowedTransitions(null)).toEqual([]);
        expect(allowedTransitions(undefined)).toEqual([]);
    });

    it('validateStatusTransition: same-state rejected', () => {
        expect(validateStatusTransition('lead', 'lead')).toBe(false);
        expect(validateStatusTransition('paid', 'paid')).toBe(false);
    });

    it('validateStatusTransition: invalid jumps rejected', () => {
        expect(validateStatusTransition('lead', 'paid')).toBe(false);
        expect(validateStatusTransition('draft', 'completed')).toBe(false);
        expect(validateStatusTransition('refunded', 'lead')).toBe(false);
        expect(validateStatusTransition('completed', 'cancelled')).toBe(false);
    });

    it('validateStatusTransition: happy-path forward edges accepted', () => {
        expect(validateStatusTransition('lead', 'draft')).toBe(true);
        expect(validateStatusTransition('draft', 'sent')).toBe(true);
        expect(validateStatusTransition('sent', 'agreed')).toBe(true);
        expect(validateStatusTransition('agreed', 'paid')).toBe(true);
        expect(validateStatusTransition('paid', 'completed')).toBe(true);
        expect(validateStatusTransition('completed', 'refunded')).toBe(true);
    });

    it('validateStatusTransition: back-reverts accepted', () => {
        expect(validateStatusTransition('sent', 'draft')).toBe(true);
        expect(validateStatusTransition('agreed', 'sent')).toBe(true);
    });

    it('validateStatusTransition: null/undefined inputs return false', () => {
        expect(validateStatusTransition(null, 'draft')).toBe(false);
        expect(validateStatusTransition('lead', null)).toBe(false);
        expect(validateStatusTransition(undefined, undefined)).toBe(false);
    });
});

// ────────────────────────────────────────────────────────────────────
// parseAddonFees
// ────────────────────────────────────────────────────────────────────

describe('parseAddonFees', () => {
    it('null/undefined input → ok with empty addons', () => {
        expect(parseAddonFees(null)).toEqual({ ok: true, addons: [] });
        expect(parseAddonFees(undefined)).toEqual({ ok: true, addons: [] });
    });

    it('empty array → ok with empty addons', () => {
        expect(parseAddonFees([])).toEqual({ ok: true, addons: [] });
    });

    it('empty JSON-string array → ok with empty addons', () => {
        expect(parseAddonFees('[]')).toEqual({ ok: true, addons: [] });
    });

    it('valid array of {label, cents} → addons echoed back', () => {
        const result = parseAddonFees([
            { label: 'Cleanup fee', cents: 5000 },
            { label: 'Lighting rental', cents: 10000 },
        ]);
        expect(result.ok).toBe(true);
        expect(result.addons).toEqual([
            { label: 'Cleanup fee', cents: 5000 },
            { label: 'Lighting rental', cents: 10000 },
        ]);
    });

    it('parses a JSON-string array', () => {
        const result = parseAddonFees('[{"label":"Cleanup","cents":5000}]');
        expect(result.ok).toBe(true);
        expect(result.addons).toEqual([{ label: 'Cleanup', cents: 5000 }]);
    });

    it('rejects invalid JSON string', () => {
        const result = parseAddonFees('not json');
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/valid JSON/);
    });

    it('rejects non-array', () => {
        expect(parseAddonFees(42).ok).toBe(false);
        expect(parseAddonFees({ label: 'x', cents: 100 }).ok).toBe(false);
        expect(parseAddonFees('{}').ok).toBe(false); // JSON object, not array
    });

    it('rejects more than 20 items', () => {
        const arr = Array.from({ length: 21 }, (_, i) => ({ label: `f${i}`, cents: 100 }));
        const result = parseAddonFees(arr);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/cannot exceed 20/);
    });

    it('rejects item without label', () => {
        const result = parseAddonFees([{ cents: 100 }]);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/label is required/);
    });

    it('rejects label > 100 chars', () => {
        const result = parseAddonFees([{ label: 'x'.repeat(101), cents: 100 }]);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/exceeds 100 chars/);
    });

    it('rejects negative cents', () => {
        const result = parseAddonFees([{ label: 'x', cents: -100 }]);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/non-negative integer/);
    });

    it('rejects non-integer cents', () => {
        const result = parseAddonFees([{ label: 'x', cents: 99.5 }]);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/non-negative integer/);
    });

    it('trims label whitespace and rejects empty-after-trim', () => {
        const result = parseAddonFees([{ label: '   ', cents: 100 }]);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/label is required/);

        const trimmed = parseAddonFees([{ label: '  Cleanup  ', cents: 100 }]);
        expect(trimmed.addons[0].label).toBe('Cleanup');
    });

    it('rejects non-object array entry', () => {
        const result = parseAddonFees(['not an object']);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/must be an object/);
    });
});

// ────────────────────────────────────────────────────────────────────
// computePricing
// ────────────────────────────────────────────────────────────────────

describe('computePricing', () => {
    it('zero everything → zero total', () => {
        const r = computePricing({ siteFeeCents: 0, addons: [], discountCents: 0, taxCents: 0 });
        expect(r.ok).toBe(true);
        expect(r.totalCents).toBe(0);
        expect(r.addonSubtotalCents).toBe(0);
    });

    it('site fee only → total = site fee', () => {
        const r = computePricing({ siteFeeCents: 50000, addons: [], discountCents: 0, taxCents: 0 });
        expect(r.totalCents).toBe(50000);
    });

    it('site fee + addons + tax → sum', () => {
        const r = computePricing({
            siteFeeCents: 50000,
            addons: [{ cents: 5000 }, { cents: 10000 }],
            discountCents: 0,
            taxCents: 5500,
        });
        expect(r.ok).toBe(true);
        expect(r.addonSubtotalCents).toBe(15000);
        expect(r.totalCents).toBe(70500); // 50000 + 15000 - 0 + 5500
    });

    it('discount applied before tax', () => {
        // Formula is site + addons - discount + tax (tax is caller-provided, not %-based)
        const r = computePricing({
            siteFeeCents: 50000,
            addons: [],
            discountCents: 10000,
            taxCents: 4400,
        });
        expect(r.totalCents).toBe(44400);
    });

    it('rejects negative total when discount overshoots', () => {
        const r = computePricing({ siteFeeCents: 1000, addons: [], discountCents: 5000, taxCents: 0 });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/negative total/);
    });

    it('rejects non-integer site fee', () => {
        const r = computePricing({ siteFeeCents: 100.5, addons: [], discountCents: 0, taxCents: 0 });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/site_fee_cents/);
    });

    it('rejects negative site fee', () => {
        const r = computePricing({ siteFeeCents: -100, addons: [], discountCents: 0, taxCents: 0 });
        expect(r.ok).toBe(false);
    });

    it('rejects non-integer addon cents', () => {
        const r = computePricing({
            siteFeeCents: 1000,
            addons: [{ cents: 99.5 }],
            discountCents: 0,
            taxCents: 0,
        });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/non-negative integer/);
    });

    it('treats missing addons array as empty', () => {
        const r = computePricing({ siteFeeCents: 1000, addons: undefined, discountCents: 0, taxCents: 0 });
        expect(r.ok).toBe(true);
        expect(r.totalCents).toBe(1000);
    });

    it('defaults discount/tax to 0 when undefined', () => {
        const r = computePricing({ siteFeeCents: 1000 });
        expect(r.ok).toBe(true);
        expect(r.totalCents).toBe(1000);
    });
});

// ────────────────────────────────────────────────────────────────────
// formatFieldRental — PII masking
// ────────────────────────────────────────────────────────────────────

function sampleRow(overrides = {}) {
    return {
        id: 'fr_test',
        customer_id: 'cus_x',
        site_id: 'site_g',
        site_field_ids: 'fld_main',
        engagement_type: 'tactical_training',
        lead_source: 'email',
        recurrence_id: null,
        recurrence_instance_index: null,
        scheduled_starts_at: 1000,
        scheduled_ends_at: 2000,
        arrival_window_starts_at: null,
        cleanup_buffer_ends_at: null,
        status: 'lead',
        status_changed_at: 1000,
        status_change_reason: null,
        site_fee_cents: 50000,
        addon_fees_json: '[]',
        discount_cents: 0,
        discount_reason: null,
        tax_cents: 0,
        total_cents: 50000,
        deposit_required_cents: null,
        deposit_due_at: null,
        deposit_received_at: null,
        deposit_method: null,
        deposit_reference: null,
        deposit_received_by: null,
        balance_due_at: null,
        balance_received_at: null,
        balance_method: null,
        balance_reference: null,
        balance_received_by: null,
        coi_status: 'not_required',
        coi_expires_at: null,
        headcount_estimate: null,
        schedule_notes: 'Arrive at 9am',
        equipment_notes: null,
        staffing_notes: null,
        special_permissions_json: '{}',
        requirements_coi_received: 0,
        requirements_agreement_signed: 0,
        requirements_deposit_received: 0,
        requirements_briefing_scheduled: 0,
        requirements_walkthrough_completed: 0,
        notes: 'Customer is repeat client; prefers Field A',
        notes_sensitive: 'POC John doe SSN-fragment ending 1234',
        aas_site_coordinator_person_id: null,
        archived_at: null,
        cancelled_at: null,
        cancellation_reason: null,
        cancellation_deposit_retained: 0,
        created_by: 'u_owner',
        created_at: 1000,
        updated_at: 1000,
        ...overrides,
    };
}

describe('formatFieldRental — PII masking', () => {
    it('null row → null', () => {
        expect(formatFieldRental(null)).toBeNull();
    });

    it('default (no caps) → notes masked, notesSensitive dropped', () => {
        const out = formatFieldRental(sampleRow());
        expect(out.notes).toBe('***');
        expect(out).not.toHaveProperty('notesSensitive');
    });

    it('viewerCanSeePII=true → notes unmasked, notesSensitive still dropped', () => {
        const out = formatFieldRental(sampleRow(), { viewerCanSeePII: true });
        expect(out.notes).toBe('Customer is repeat client; prefers Field A');
        expect(out).not.toHaveProperty('notesSensitive');
    });

    it('viewerCanSeeSensitiveNotes=true → notesSensitive surfaced', () => {
        const out = formatFieldRental(sampleRow(), { viewerCanSeePII: true, viewerCanSeeSensitiveNotes: true });
        expect(out.notesSensitive).toBe('POC John doe SSN-fragment ending 1234');
    });

    it('null notes value → null in response (not "***")', () => {
        const out = formatFieldRental(sampleRow({ notes: null }));
        expect(out.notes).toBeNull();
    });

    it('decodes addon_fees_json into addonFees array', () => {
        const out = formatFieldRental(sampleRow({
            addon_fees_json: '[{"label":"Cleanup","cents":5000}]',
        }));
        expect(out.addonFees).toEqual([{ label: 'Cleanup', cents: 5000 }]);
    });

    it('malformed addon_fees_json defaults to []', () => {
        const out = formatFieldRental(sampleRow({ addon_fees_json: 'not-json' }));
        expect(out.addonFees).toEqual([]);
    });

    it('decodes special_permissions_json into object', () => {
        const out = formatFieldRental(sampleRow({
            special_permissions_json: '{"pyrotechnics":true,"alcohol_service":false}',
        }));
        expect(out.specialPermissions).toEqual({ pyrotechnics: true, alcohol_service: false });
    });

    it('splits comma-separated site_field_ids into array', () => {
        const out = formatFieldRental(sampleRow({ site_field_ids: 'fld_a,fld_b,fld_c' }));
        expect(out.siteFieldIds).toEqual(['fld_a', 'fld_b', 'fld_c']);
    });

    it('handles single site_field_id (no comma)', () => {
        const out = formatFieldRental(sampleRow({ site_field_ids: 'fld_only' }));
        expect(out.siteFieldIds).toEqual(['fld_only']);
    });

    it('coerces requirements booleans from 0/1', () => {
        const out = formatFieldRental(sampleRow({
            requirements_coi_received: 1,
            requirements_agreement_signed: 0,
        }));
        expect(out.requirements.coiReceived).toBe(true);
        expect(out.requirements.agreementSigned).toBe(false);
    });

    it('coerces cancellation_deposit_retained from 0/1', () => {
        expect(formatFieldRental(sampleRow({ cancellation_deposit_retained: 1 })).cancellationDepositRetained).toBe(true);
        expect(formatFieldRental(sampleRow({ cancellation_deposit_retained: 0 })).cancellationDepositRetained).toBe(false);
    });
});

// ────────────────────────────────────────────────────────────────────
// formatFieldRentalContact
// ────────────────────────────────────────────────────────────────────

const contactRow = {
    id: 'frc_1',
    rental_id: 'fr_test',
    full_name: 'Jane Renter',
    email: 'jane@acme.example',
    phone: '5551112222',
    role: 'billing',
    is_primary: 1,
    notes: 'Day-of escalation',
    created_at: 1000,
    updated_at: 1000,
};

describe('formatFieldRentalContact — PII masking', () => {
    it('null row → null', () => {
        expect(formatFieldRentalContact(null)).toBeNull();
    });

    it('default (no caps) → email/phone/notes masked, fullName surfaced', () => {
        const out = formatFieldRentalContact(contactRow);
        expect(out.fullName).toBe('Jane Renter');
        expect(out.email).toBe('***');
        expect(out.phone).toBe('***');
        expect(out.notes).toBe('***');
        expect(out.isPrimary).toBe(true);
    });

    it('viewerCanSeePII=true → email/phone/notes unmasked', () => {
        const out = formatFieldRentalContact(contactRow, { viewerCanSeePII: true });
        expect(out.email).toBe('jane@acme.example');
        expect(out.phone).toBe('5551112222');
        expect(out.notes).toBe('Day-of escalation');
    });

    it('null PII values stay null (not "***")', () => {
        const out = formatFieldRentalContact({ ...contactRow, email: null, phone: null, notes: null });
        expect(out.email).toBeNull();
        expect(out.phone).toBeNull();
        expect(out.notes).toBeNull();
    });
});

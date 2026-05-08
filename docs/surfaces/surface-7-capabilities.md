# Surface 7 — Capability inventory

Capability keys introduced by the M5.5 Field Rentals build. Maps to the role_presets seeded in M5 Batch 2 (`worker/lib/capabilities.js` + `migrations/0031_capabilities_seed.sql`).

This file is the input to M5.5 Batch 2 (when capabilities seed for field rentals is added) and to any future role_preset_capabilities reshuffle.

---

## Categories

### `sites.*` — Site directory

| Key | Description |
|---|---|
| `sites.read` | View `/admin/sites` directory + site detail. |
| `sites.write` | Create / edit site records + fields + blackouts. |
| `sites.archive` | Soft-archive a site (must have no upcoming rentals or events). |

### `field_rentals.*` — Rental records

| Key | Description |
|---|---|
| `field_rentals.read` | List + detail view. PII (renter contacts, notes) masked unless granted `field_rentals.read.pii`. |
| `field_rentals.read.pii` | Unmask renter contact email/phone + notes_sensitive on detail view. Audit-logged per access. |
| `field_rentals.read.financials` | View invoice + payment status + refund detail. |
| `field_rentals.create` | New-rental flow. Includes conflict-detection bypass capability `field_rentals.create.bypass_conflict` (separate; below). |
| `field_rentals.create.bypass_conflict` | Allows creating a rental that overlaps an existing event/rental on the same field. Prompts confirmation. Owner-only. |
| `field_rentals.write` | Edit existing rental fields (notes, schedule pre-agreement, contacts). After agreement signed, only Owner can edit material terms. |
| `field_rentals.cancel` | Cancel a rental with refund per policy. |
| `field_rentals.refund` | Issue Stripe refund or record out-of-band refund (cash/check). |
| `field_rentals.reschedule` | Move occurrences (re-runs conflict detection). |

### `field_rental_agreements.*` — Site-use agreements

| Key | Description |
|---|---|
| `field_rental_agreements.read` | View agreement library + per-rental signed copies. |
| `field_rental_agreements.write` | Create new agreement version. Owner-only by convention; bind to Owner role-preset only. |
| `field_rental_agreements.send` | Send agreement to renter for signing. |
| `field_rental_agreements.countersign` | Countersign signed agreement (the AAS-side signature finalizing the contract). Owner-only. |
| `field_rental_agreements.retire` | Retire an old agreement version (mostly automatic on new-version create; manual for emergency retire). Owner-only. |

### `field_rentals.reports.*` — Bookkeeper rollups

| Key | Description |
|---|---|
| `field_rentals.reports.read` | View `/admin/field-rentals/reports` (revenue by client / month / site). |
| `field_rentals.reports.export` | Download CSV export of report data. |

### `customers.*` extensions for B2B

The M3 customers entity capabilities (`customers.read`, `customers.write`, `customers.merge`, `customers.gdpr_delete`) cover individual + business equally. Two new keys:

| Key | Description |
|---|---|
| `customers.read.business_fields` | Unmask EIN, legal_name, registration_number on business customer detail. Without this, business fields render as masked. |
| `customers.write.business_fields` | Edit EIN / legal_name / registration_number / billing_address. Bookkeeper has this; Booking Coordinator does not. |

---

## Default role-preset bindings

The M5 Batch 2 seed will include these mappings as part of the `role_preset_capabilities` table.

| Capability | Owner | Operations Manager | Booking Coordinator | Marketing | Bookkeeper | Read-Only Auditor |
|---|---|---|---|---|---|---|
| `sites.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `sites.write` | ✓ | ✓ | — | — | — | — |
| `sites.archive` | ✓ | — | — | — | — | — |
| `field_rentals.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `field_rentals.read.pii` | ✓ | ✓ | ✓ | — | ✓ | — |
| `field_rentals.read.financials` | ✓ | ✓ | ✓ | — | ✓ | — |
| `field_rentals.create` | ✓ | ✓ | ✓ | — | — | — |
| `field_rentals.create.bypass_conflict` | ✓ | — | — | — | — | — |
| `field_rentals.write` | ✓ | ✓ | ✓ | — | — | — |
| `field_rentals.cancel` | ✓ | ✓ | ✓ | — | — | — |
| `field_rentals.refund` | ✓ | ✓ | — | — | ✓ | — |
| `field_rentals.reschedule` | ✓ | ✓ | ✓ | — | — | — |
| `field_rental_agreements.read` | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| `field_rental_agreements.write` | ✓ | — | — | — | — | — |
| `field_rental_agreements.send` | ✓ | ✓ | ✓ | — | — | — |
| `field_rental_agreements.countersign` | ✓ | — | — | — | — | — |
| `field_rental_agreements.retire` | ✓ | — | — | — | — | — |
| `field_rentals.reports.read` | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `field_rentals.reports.export` | ✓ | ✓ | — | ✓ | ✓ | — |
| `customers.read.business_fields` | ✓ | ✓ | ✓ | — | ✓ | — |
| `customers.write.business_fields` | ✓ | — | — | — | ✓ | — |

---

## Capability dependency rules

Follows the pattern from M5 Batch 2's `capabilities.requires_capability_dependency` column:

| Capability | Requires |
|---|---|
| `field_rentals.read.pii` | `field_rentals.read` |
| `field_rentals.read.financials` | `field_rentals.read` |
| `field_rentals.create.bypass_conflict` | `field_rentals.create` |
| `field_rentals.cancel` | `field_rentals.read` |
| `field_rentals.refund` | `field_rentals.read.financials` |
| `field_rentals.reschedule` | `field_rentals.write` |
| `field_rental_agreements.write` | `field_rental_agreements.read` |
| `field_rental_agreements.countersign` | `field_rental_agreements.send` + `field_rental_agreements.read` |
| `field_rental_agreements.retire` | `field_rental_agreements.write` |
| `field_rentals.reports.export` | `field_rentals.reports.read` |
| `customers.read.business_fields` | `customers.read` |
| `customers.write.business_fields` | `customers.write` + `customers.read.business_fields` |

The capability check helper (`requireCapability(c, 'X')`) walks the dependency chain and returns 403 with a hint about the missing prerequisite.

---

## Audit-logged capability uses

These actions write an `audit_log` row beyond the normal action audit:

- `customer_pii.unmasked` — when `field_rentals.read.pii` or `customers.read.business_fields` is exercised. Mirrors the M4 B3a booking-PII pattern.
- `field_rental.bypass_conflict` — every override is audited with the conflicting record IDs.
- `field_rental_agreement.signed` — renter signs.
- `field_rental_agreement.countersigned` — owner countersigns.
- `field_rental_agreement.integrity_failure` — body_sha256 mismatch on read.
- `field_rental.cancelled`, `field_rental.refunded`, `field_rental.rescheduled` — material lifecycle events.

---

## Open questions for M5.5 batch 2

1. Should `field_rentals.read.financials` and `field_rentals.read.pii` be combined into a single `field_rentals.read.sensitive` instead? Decision factor: how many real personas need PII without financials, or vice versa.
2. Per-site capability scoping (e.g. an Equipment Manager assigned to Ghost Town can only rent that site). Today's design is global; M5.5 ships global; per-site is a deferred enhancement.
3. `field_rental_agreements.countersign` — should this be available to a non-Owner if the Owner is unreachable on a deadline? Today's answer is no (Owner-only is a safety property). Revisit if this blocks operations.

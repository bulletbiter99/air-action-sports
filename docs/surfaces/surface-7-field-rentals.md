# Surface 7 — Field Rentals

**Status:** approved design substrate. Prerequisite for **M5.5** (Field Rentals build, the milestone immediately following M5 close).

**Audience:** future M5.5 batches reading this as the source of truth for what to build.

---

## 1. The problem this surface solves

Air Action Sports operates two airsoft event sites today (Ghost Town in Hiawatha, UT and Foxtrot Fields). The same physical fields are rentable **outside** of AAS-run events to:

- Other airsoft groups running their own private skirmishes
- Paintball groups
- Tactical-training schools running courses for civilian or LE clientele
- Film productions / commercial photo shoots
- Corporate team-building organizers
- Scout troops, youth programs, schools doing field days

These are **business rentals, not consumer event tickets.** Different invoicing, different liability posture, different paperwork (site-use agreements + COIs from the renting party rather than per-attendee waivers), different cadence (often recurring weekly/monthly bookings rather than one-shot tickets).

Today this is run entirely off-platform — email threads, ad hoc spreadsheets, Stripe Invoices manually generated. The platform doesn't know these rentals exist, which causes two problems:

1. **Event scheduling conflicts.** Operations Manager schedules an AAS milsim on a Saturday only to discover after the fact that the field is already booked by a paintball group. Today's only check is "ask Paul in Slack."
2. **No customer entity unification.** A repeat field renter has no customer record (M3 customers entity exists but is keyed off booking-side flow). Marketing has no way to slice revenue by client type or surface lifetime value of recurring B2B clients.

Surface 7 makes field rentals a first-class entity: schedulable, invoiceable, conflict-detectable, customer-linked.

---

## 2. Scope of M5.5 build

**In scope:**
- Sites + Site Fields directory (`/admin/sites`, `/admin/sites/:id`)
- Field Rentals list + detail (`/admin/field-rentals`, `/admin/field-rentals/:id`)
- New booking flow for B2B rentals (separate from `/admin/new-booking` which stays event-ticket-only)
- Recurrence engine (weekly / monthly / custom interval)
- Site-use agreement document versioning (mirrors waiver_documents)
- COI tracking per renting business
- Conflict detection: a field rental can't overlap an AAS event on the same field, and vice versa
- Invoice generation via Stripe Invoices (off-session, customer keeps card on file)
- Customer entity extension: `client_type` enum (`individual` | `business`) + business fields (legal name, EIN, billing contact, etc.)

**Out of scope (deferred to post-M5.5):**
- Public self-serve booking page for businesses (M5.5 is admin-driven; renter contacts AAS, admin creates the rental)
- Inquiry form on `/contact` that pre-fills a draft rental (notes for follow-up, see open-followups doc)
- Multi-site cross-renting (we have 2 sites today; this is a 4-site+ problem)
- Photographer / filming-specific add-ons (catered to ad hoc; revisit when frequency justifies)

---

## 3. Personas

Three personas interact with Surface 7. Each gets a tailored slice of the UI.

### Operations Manager / Event Director (Tier 1, role: `owner`)

**Use cases:**
- Schedule a recurring rental for a paintball group every Tuesday for 12 weeks
- Review pending site-use agreements awaiting countersign
- Triage conflict alerts (rental conflicts with newly-scheduled AAS event)
- Approve over-cap rental discounts (for known repeat clients)

**Surface 7 home view:** `/admin/field-rentals` filtered to "Needs action" (pending COI / pending agreement / conflict-detected).

### Booking Coordinator (Tier 1, persona: `booking_coordinator`)

**Use cases:**
- Field initial inquiries via email/phone, create draft rental record
- Send agreements + invoices for owner countersign
- Track payment status per rental
- Reschedule a rental at renter's request (must re-check conflict)

**Surface 7 home view:** `/admin/field-rentals` filtered to "Open / In-progress" + "Upcoming this month" sections.

### Bookkeeper (Tier 1, persona: `bookkeeper`)

**Use cases:**
- Reconcile field rental revenue separately from event ticket revenue
- Generate per-client invoicing reports
- Issue refunds for cancelled rentals (separate from event refunds)
- Year-end 1099 filings for any independent contractors paid out of rental revenue

**Surface 7 home view:** `/admin/field-rentals/reports` (aggregates by client, month, site, status).

---

## 4. Top-level pages

```
/admin/sites                       Site directory list
/admin/sites/:id                   Site detail (fields, blackouts, contacts)
/admin/sites/:id/fields/:fid       Field detail (calendar view)
/admin/field-rentals               Rental list (Surface 2-style filter UI)
/admin/field-rentals/:id           Rental detail (parties, schedule, docs, payments, conflicts)
/admin/field-rentals/new           New rental flow (3-step: customer → schedule → terms)
/admin/field-rentals/reports       Bookkeeper rollup
/admin/site-agreements             Versioned site-use agreement library
```

---

## 5. New rental flow (3 steps)

### Step 1 — Customer

Either pick existing customer (typeahead from M3 customers entity) or create new.

For new customers, the form requires `client_type` (`individual` | `business`):

- `individual`: standard customer fields
- `business`: extends with legal name, EIN, primary billing contact, optional D&B/registration number, billing address (separate from primary contact's home address)

Recurring B2B clients get auto-tagged as `vip` after 3 paid rentals (similar to event customer tagging).

### Step 2 — Schedule

Pick site → pick field → pick start datetime → end datetime. Optionally pick recurrence:

- **Once** (single occurrence)
- **Weekly** (every N weeks for M weeks)
- **Monthly** (Nth weekday or specific date)
- **Custom** (operator picks specific datetimes)

Conflict detection runs synchronously: the form refuses to advance if the picked window overlaps an existing event or rental on the same field.

Site_blackouts table holds operator-configured downtime (maintenance, weather closures) — these block rentals at any tier.

### Step 3 — Terms

- Site-use agreement: pick from versioned templates, or override with custom (rare; Owner-only)
- COI requirement: insurance amount + policy expiration tracking
- Pricing: per-day / per-hour / flat rate (depends on site policy)
- Tax/fee: auto-applied per `taxes_fees` table where `applies_to` includes `field_rental`
- Deposit: optional refundable deposit
- Payment terms: net-0 (pay on book) / net-15 / net-30
- Cancellation policy: standard / negotiated

Submit creates the rental record + sends agreement email + (if net-0) generates Stripe Invoice.

---

## 6. Rental detail (`/admin/field-rentals/:id`)

Two-column layout (mirrors M4's `/admin/bookings/:id`):

**Left column (primary):**
- Status badge + key dates
- Schedule (occurrences if recurring, with per-occurrence status: scheduled / completed / cancelled / no-show)
- Linked customer card (with link to `/admin/customers/:id`)
- Activity log (audit-log filtered by this rental)

**Right column (sidebar):**
- Documents (agreement + COI + amendments)
- Payments (invoice status per occurrence)
- Conflicts (live check; reruns nightly via cron)
- Quick actions (resend agreement, mark completed, cancel, refund)

---

## 7. Conflict detection

Implemented at three points:

1. **At create time** (Step 2 of new-rental flow): synchronous SQL query against `events` + `field_rentals` for overlapping windows on the same `field_id`. Refuses submit on conflict; shows the conflicting record + suggested adjacent windows.
2. **At reschedule time**: same logic on PUT `/api/admin/field-rentals/:id/reschedule`.
3. **Nightly sweep** (cron, 02:00 UTC): re-runs the check across all upcoming rentals + events. Any new conflicts (e.g. event scheduled into a window where a rental was already booked) write an audit row + email Operations Manager.

Conflict resolution is operator-driven — system surfaces, operator decides. No auto-cancel.

---

## 8. Pricing model

Pricing for field rentals is per-site-policy (Ghost Town and Foxtrot Fields differ):

- **Per-hour rate** — for short rentals (1–4 hr training sessions)
- **Per-day rate** — full-day rentals (most common for skirmish groups)
- **Flat-rate** — multi-day weekend events
- **Recurring discount** — operator-configurable % off after N committed occurrences

Tax/fee policy reuses the existing `taxes_fees` table with a new `applies_to=field_rental` enum value.

Refund policy is rental-specific:
- Cancelled ≥30 days before: full refund
- Cancelled 14–30 days: 50% refund
- Cancelled <14 days: forfeit deposit, prorate against any costs already incurred (operator judgment)

---

## 9. Site-use agreements

Versioned exactly like waiver_documents (migration 0011 pattern):

- `site_use_agreement_documents` table with `body_html`, `body_sha256`, `version`, `retired_at`
- New version retires previous; past signers stay pinned to whatever they signed
- Per-rental snapshot of `body_html` + `body_sha256` at sign time on the `field_rentals` row
- Integrity check on read: recompute hash, refuse on tampering, audit `site_agreement.integrity_failure`

Body content covers:
- Site rules and restrictions (no live ammunition, no pyrotechnics, etc.)
- Liability waiver from the renting business (umbrella to cover all their attendees)
- Insurance minimums + COI requirements
- Cleanup expectations + damage forfeiture
- Photo / video / commercial-use rights
- Cancellation policy
- Indemnification clause

Owner-only edit. Manager can view past versions but not edit.

---

## 10. Capabilities

Capabilities introduced by Surface 7 (full inventory in `surface-7-capabilities.md`):

- `sites.read`, `sites.write`, `sites.archive`
- `field_rentals.read`, `field_rentals.create`, `field_rentals.write`, `field_rentals.cancel`, `field_rentals.refund`
- `field_rentals.read.financials` (separate gate for invoice/payment detail)
- `field_rental_agreements.read`, `field_rental_agreements.write`, `field_rental_agreements.countersign`
- `field_rentals.reports.read`, `field_rentals.reports.export`
- `customers.read.business_fields` (gates EIN + business legal name + billing contact)

Default role-preset bindings:
- Owner: all
- Booking Coordinator: read + write + cancel + refund (NOT countersign agreements)
- Bookkeeper: read + reports + financials
- Marketing: read (for revenue / LTV insight)
- Read-only Auditor: read

---

## 11. Out-of-band integrations

- **Stripe Invoices** (not Checkout): off-session, customer-pays-via-emailed-invoice. Card-on-file flow requires customer's first interaction to authorize storage; subsequent invoices for recurring rentals charge automatically (ties into Surface 5 addendum's Option-A path that M6 enables).
- **DocuSign / e-sign** (optional, post-M5.5): if site-use agreements need notarized witness signing for high-value rentals (commercial film, government contracts), wire e-sign provider. Today's typed-name + IP + UA + token-version snapshot is sufficient for typical B2B rentals.
- **Calendar export** (.ics): Operations Manager wants a single feed showing all events + rentals across both sites. M5.5 batch X ships an authenticated `/api/admin/calendar/aas.ics` endpoint.

---

## 12. Migration cadence (M5.5)

The schema rolls in one migration with new tables + nullable customers extension:

- `0043_field_rentals_schema.sql` — all 9 new tables + `customers.client_type` + `customers.legal_name` + `customers.ein` + `customers.billing_contact_id` (FK to a new `customer_contacts` table) + `customers.billing_address_id`

Followed by:
- Backfill: existing customers default to `client_type='individual'` (already true semantically)
- Seed: site_use_agreement_document v1.0 (placeholder; Owner edits at `/admin/site-agreements`)

No code changes from M5 milestone affect this — Surface 7 is fully separable.

---

## 13. Open follow-ups

See `surface-7-open-followups.md` for items that block M5.5 batch 1 specifically:

- Inquiry form on `/contact` — needs an audit before M5.5 batch 1 to decide whether existing form fields are reused or rewritten
- Existing event conflict-detection extension — the M5.5 conflict logic relies on `events.field_id` (a column that doesn't exist today); an early M5.5 batch must add it + backfill before the rental-side query can run

---

## 14. Why Surface 7 is M5.5, not M5

M5 lands staff infrastructure + event-day mode + damage-charge fast-path. Surface 7 is parallel work — same milestone window in elapsed days but a logically separable scope. Splitting it into M5.5 prevents the M5 prompt from tripling in size and lets the field-rental team work in parallel once M5 docs are in place.

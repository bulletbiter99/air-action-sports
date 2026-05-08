# Surface 7 — Open follow-ups

Items captured here are explicitly NOT in scope for the Surface 7 design as transcribed in `surface-7-field-rentals.md` and `surface-7-schema.md`, but they are prerequisites for an M5.5 batch 1 to start cleanly. Each one needs an audit + decision before the rental-side work can ship.

---

## 1. Inquiry form audit on `/contact` — needed before M5.5 B1

**What:** the public site has a `/contact` page (per HANDOFF §9 frontend routes). Today its form fields are unknown to me — they were last touched in pre-Phase-2 work.

**Why it's a Surface 7 dependency:** the public-facing inquiry path for "I'd like to rent your field" should pre-fill a draft `field_rentals` record (status='draft') with everything the customer-facing form captures. To wire that up, M5.5 batch 1 needs to know:

- What fields does the form ask for today?
- Are any of them already structured to map onto Surface 7 fields (legal name, EIN, requested dates, requested site)?
- Does the form route to a Resend email today, or does it write somewhere queryable?
- Is there an admin-side review queue for inquiries today, or are they purely email?

**Action item:** an early M5.5 audit batch (B0a or B1) reads `src/pages/Contact.jsx` (or wherever the form lives) and produces a fields-vs-Surface-7-mapping doc. The output decides whether M5.5 reuses the form, rewrites it, or adds a parallel "Field rentals inquiry" form.

**Owner-input needed:** preferred path forward (reuse / rewrite / parallel form). Default if no input: parallel form to keep concerns separate.

---

## 2. Existing event conflict-detection extension — needed before M5.5 B1

**What:** Surface 7's conflict detection (when a new field rental is created) needs to query both `field_rentals` AND `events` for overlapping windows on the same field. The query shape:

```sql
SELECT 'event' AS kind, id, slug, name, date AS starts_at, end_date AS ends_at FROM events
  WHERE field_id = ? AND date < ? AND end_date > ?

UNION ALL

SELECT 'field_rental' AS kind, id, ... FROM field_rentals
  WHERE field_id = ? AND starts_at < ? AND ends_at > ?
```

**The blocker:** `events.field_id` doesn't exist today. The events table has `location` (a free-text string like "Ghost Town, Hiawatha UT") but no FK to `site_fields`.

**M5.5 batch 1 sequencing:**

1. Migration: `ALTER TABLE events ADD COLUMN field_id TEXT REFERENCES site_fields(id);` (already documented in `surface-7-schema.md` §4)
2. Operator manual seeds Sites + Fields via the Sites admin UI (M5.5 B2).
3. Operator runs a one-shot backfill script: `UPDATE events SET field_id = '<field_id>' WHERE id IN (...)` for each existing event.
4. Conflict-detection logic in `worker/lib/fieldRentalConflict.js` becomes valid only after step 3 completes.

**Risk if skipped:** rentals could be created that overlap real AAS events on the same physical field, which the operator would only discover via the calendar export or by manual cross-check.

**Action item:** this becomes an explicit M5.5 B1 sub-batch (e.g. `B1a-events-field-id-migration` and `B1b-events-backfill-script`) before any field-rental UI ships.

---

## 3. Stripe Invoices integration scope

**What:** Surface 7 says "Invoice generation via Stripe Invoices (off-session, customer keeps card on file)". The existing AAS Stripe integration is Checkout Sessions-based; Invoices is a different API surface with its own webhooks and lifecycle.

**Open question:** does M5.5 wire Stripe Invoices fully (auto-charge recurring rentals, dunning on failure) or keep it manual (operator clicks "Send invoice" from `/admin/field-rentals/:id`, payment lands via the Stripe-hosted invoice page, webhook updates our `field_rental_payments` row)?

**Default if no input:** ship manual first (lower risk; same as how event refunds work today), add auto-charge in a follow-up M5.6 if the Booking Coordinator persona reports it as friction.

**Stripe API contract notes:**
- Stripe Invoices webhooks: `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, `invoice.finalized`. Need handler routes parallel to the existing Checkout webhook.
- `setup_future_usage` (the M6 plan for event bookings) doesn't apply to Invoices — Invoices uses default payment method on the Customer object directly.
- Stripe Customer object: M5.5 must create one per business customer (the M3 customers entity doesn't currently mirror to Stripe; the booking flow uses Checkout's email→customer auto-link).

---

## 4. Legacy off-platform data ingestion

**What:** AAS has historical field-rental records in email threads + spreadsheets. Are any in scope to import into the new `field_rentals` table?

**Default if no input:** no ingestion — start the new table empty, log the historical data as out-of-system reference. Operator can manually re-create high-value recurring clients (paintball groups, training schools) by running the new-rental flow with backdated `created_at`.

If there IS an ingestion ask, it's a separate M5.5 batch with its own audit + script + idempotency handling.

---

## 5. Site-use agreement library v1.0 content

**What:** Surface 7's `site_use_agreement_documents` table needs a v1.0 row to seed. The body content covers liability waiver, COI requirements, cancellation policy, etc. (see `surface-7-field-rentals.md` §9).

**Open question:** does AAS have an existing template (Word doc, PDF, lawyer-drafted) that becomes v1.0, or does M5.5 B-final include a blocking task "Owner drafts initial agreement body"?

**Default if no input:** ship M5.5 with a placeholder seed (blank body marked "TEMPLATE — do not use until reviewed by counsel"), with a documented blocker that the Field Rentals UI is operational but agreement-send refuses until v1.0 has real content.

---

## 6. Per-site pricing customization vs global pricing

**What:** Surface 7 says each site has `default_pricing_model` + `default_per_hour_cents` / `default_per_day_cents`. But what about a per-rental override? E.g. a known repeat client gets a flat 10% off across all their rentals.

**Default in current schema:** `field_rentals.rate_cents` is per-record, so an operator can manually override at create time. There's no "client preset rate" concept yet.

**Action item:** during M5.5 B-pricing, decide whether to add a `customer_rate_overrides` table (customer × site × rate) or keep manual overrides. Default: keep manual; revisit if it becomes friction.

---

## 7. Calendar export endpoint format

**What:** Surface 7 §11 mentions `/api/admin/calendar/aas.ics` as a unified events + rentals feed.

**Open questions:**
- iCalendar format: standard `.ics` or Google-Calendar-flavored extensions? Default: standard.
- Auth: cookie-based (admin-only) or token-based (separate sharable URL with revoke)? Default: cookie-based admin-only first; token-based when an external integration asks.
- Event name format: `[AAS] {event_name}` for events, `[Rental] {customer_name}` for rentals? Default: yes, with `[Blackout] {reason}` for site_blackouts as a third category.

---

## 8. Recurring rental edit semantics

**What:** if a renter says "move my recurring Tuesday booking to Wednesday going forward," is that a single rescheduled rental with edited recurrence or a new rental + cancel of the old one?

**Default in current schema:** the rescheduling endpoint operates per-`field_rental_recurrences` row, so the operator picks specific occurrences to move. A "move all future Tuesdays" action becomes a multi-row UPDATE under the hood.

**Open question:** UX-wise, do we offer a "shift the entire series" affordance, or require occurrence-by-occurrence picking?

**Default if no input:** offer both. "Edit this occurrence" for one-offs and "Edit all future occurrences" for series-wide changes. Mirrors Google Calendar's recurring-event-edit dialog.

---

This file gets updated as M5.5 work progresses — items either resolve into sub-batch specs or get downgraded to explicit deferrals.

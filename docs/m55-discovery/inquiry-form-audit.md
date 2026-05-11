# Inquiry form audit (M5.5 Batch 1 — Task 1a)

**Audit date:** 2026-05-11
**Auditor:** Claude Code (M5.5 Batch 1)
**Source of truth files:** `src/pages/Contact.jsx`, `src/App.jsx` (line 106), `src/data/siteConfig.js`, plus codebase-wide grep on worker routes.
**Outcome:** The public inquiry form **exists in the SPA but is fully placeholder** — it has no submission integration of any kind (no worker endpoint, no Resend, no Formspree, no Google Forms, no mailto). B11 has a green-field integration with no backward-compat concerns.

---

## 1. Discovery summary

| Question | Finding |
|---|---|
| Does a public inquiry form exist? | **Yes**, at `/contact`. |
| SPA source file | `src/pages/Contact.jsx` |
| Route registration | `src/App.jsx` line 22 (lazy import) + line 106 (`<Route path="contact" element={<Contact />} />`) |
| Does it submit anywhere? | **No.** `handleSubmit` calls `window.alert()` and clears form state. |
| Is there a worker endpoint? | **No.** Codebase grep for `/api/inquir*` / `/api/contact*` / `/api/message*` returns zero matches in `worker/routes/`. |
| Mailto fallback? | **No.** The form has zero outbound integration. (Separate from the form, the info panel renders a `mailto:actionairsport@gmail.com` link — but that's a standalone link, not a form submission target.) |
| Resend / Formspree / Google Forms? | **No.** The comment in Contact.jsx line 40 explicitly says: "PLACEHOLDER: Replace with actual form submission (Formspree, fetch to backend, etc.)". A second placeholder comment at line 68 reads: "PLACEHOLDER: Replace YOUR-FORM-ID with your Formspree endpoint" — indicating Formspree was the originally-intended path, never wired up. |
| Rate limiting? | N/A (no backend) |
| Spam protection? | N/A (no backend, no honeypot field, no CAPTCHA on the form) |
| Backend table? | N/A |

## 2. Current state

### Frontend (`src/pages/Contact.jsx`)

**Form fields captured:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | text | ✓ | Non-empty after `.trim()` |
| `email` | email | ✓ | Regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `phone` | tel | — | None (free-text) |
| `subject` | select | — | Dropdown — 6 options: `general` / `booking` / `private-hire` / `corporate` / `feedback` / `other` |
| `message` | textarea | ✓ | Non-empty after `.trim()` |

**Submission behavior** (lines 34-45):

```jsx
const handleSubmit = (e) => {
  e.preventDefault();
  const newErrors = validate();
  setErrors(newErrors);

  if (Object.keys(newErrors).length === 0) {
    // PLACEHOLDER: Replace with actual form submission (Formspree, fetch to backend, etc.)
    alert("Message sent! We'll get back to you shortly.");
    setFormData({ name: '', email: '', phone: '', subject: '', message: '' });
    setErrors({});
  }
};
```

The user fills out the form, validation runs, and on success a fake `alert()` fires. **The user thinks the message went somewhere; it didn't.** This is a real customer-facing risk (someone may have been waiting for a response that never came) — see §5 risk #6.

### Backend

Verified via codebase-wide grep against `app.use|route|post|get` paired with `inquir|contact|message`: **zero matches**. No worker route. No public endpoint mounted for inquiries. The matches grep returned on worker files were false positives (e.g. "contact" inside `vendor_contacts`, "rent" inside `rentals`).

### Side info

- `siteConfig.email = 'actionairsport@gmail.com'` (rendered as a mailto: link in the info panel, separate from the form).
- The page's "Ready to Book?" CTA at the bottom links to `siteConfig.bookingLink` (the existing event-booking flow) — distinct from the contact form.

## 3. Field mapping to Surface 7 field-rental lead model

Surface 7's lead state for `field_rentals` expects a customer (lookup or create) + scheduling intent (site, date window) + business context (legal name, EIN for B2B). The Contact form's existing fields map as follows:

| Contact form | Maps to | Notes |
|---|---|---|
| `name` | `customers.name` (individual) OR `customers.business_name` (business) | Need to disambiguate at submission time. Could be a checkbox or inferred from `subject`. |
| `email` | `customers.email` | Direct. Email is also the dedup key for the M3 customers entity. |
| `phone` | `customers.phone` | Direct. |
| `subject = 'private-hire'` or `'corporate'` | Signals **field-rental lead** | Use as the routing signal in B11. |
| `subject = 'general'` / `'booking'` / `'feedback'` / `'other'` | Stays "general inquiry" (email notification only) | No field-rental row created. |
| `message` | `field_rentals.notes` (initial lead description) | Direct. |
| (absent) | `field_rentals.site_id` | Not in form — lead row has NULL until operator triages. |
| (absent) | `field_rentals.scheduled_starts_at` | Not in form — lead row has NULL. |
| (absent) | `customers.business_tax_id` (EIN) | Not in form — collected later in the rental flow. |
| (absent) | `customers.business_billing_address` | Not in form — collected later. |

**The form does NOT need expansion to flow into a `field_rentals` lead.** A lead is a low-information record by design — operator triages and enriches via `/admin/field-rentals/:id` after intake. Surface 7 §5 Step 1 (Customer typeahead OR create) handles the email-already-exists case naturally.

## 4. Recommended path for B11 integration

**Path A — Reuse the existing form, with `subject` as the routing signal.**

Rationale:
- The form already has sensible fields and live UX (CSS + validation + info panel + responsive layout).
- `subject = 'private-hire'` and `subject = 'corporate'` are natural field-rental triggers.
- No backward-compat concerns — the form has zero existing integration.
- A separate `/rent-our-fields` form would duplicate UX work for no UX win — both forms would ask the same fields.
- Operator triages all inquiries through one admin queue regardless of subject.

### B11 implementation sketch (subject to operator review)

1. Add worker route `worker/routes/inquiry.js` exposing `POST /api/inquiry`:
   - Body: `{ name, email, phone?, subject, message, honeypot? }`
   - Validation: mirror client-side (email regex, required name/email/message; subject is optional).
   - Honeypot: a hidden `website` field; if filled, return 200 OK with silent drop (cheap spam protection).
   - Rate limit: use the public-form-submit binding from `worker/lib/rateLimit.js` (one of the 8 bindings introduced in M5).
   - Behavior branches by subject:
     - `subject IN ('private-hire', 'corporate')`: lookup/create customer (by email) → INSERT `field_rentals` row (`status='lead'`, NULL schedule, message → `notes`, audit-log `field_rental.lead_created`), send Resend notification to operator with `[Field Rental Inquiry]` prefix.
     - Otherwise (`general` / `booking` / `feedback` / `other`): send Resend notification to operator with `[General Inquiry]` prefix; no D1 write beyond audit_log.
   - Returns: `200 {"ok":true}` on success; `400` on validation error; `429` on rate limit.
2. Update `src/pages/Contact.jsx`:
   - Replace `alert()` placeholder with `fetch('/api/inquiry', { method: 'POST', body: JSON.stringify(formData) })`.
   - On success: replace alert with inline success state (e.g. "Thanks! We'll get back to you within 24 hours.").
   - On 400: show inline error.
   - On 429: show inline "too many submissions, try again later".
   - Add the hidden honeypot input.
3. Lead arrival in admin: `/admin/field-rentals` (built in B8) already shows `status='lead'` rows; this just becomes the natural intake path.
4. Tests:
   - Worker route unit tests in `tests/unit/inquiry/route.test.js` — validation, branching by subject, rate limit, honeypot, idempotency.
   - Visual regression baseline refresh for `/contact` (success state + error state).

### Honeypot rationale

Since the form is public, B11 should add a honeypot field — a hidden `<input type="text" name="website" style="display:none" tabindex="-1" autocomplete="off" />`. If filled by a bot, the worker returns 200 OK with silent drop. Cheap, effective, no CAPTCHA UX. Cloudflare Bot Management is an alternative if the honeypot proves insufficient post-launch.

## 5. Risks / open questions for operator

1. **Routing signal.** Today I'm proposing `subject ∈ {'private-hire', 'corporate'}` triggers a field-rental lead. Alternative: add an explicit checkbox "I'm interested in renting your fields" with yes/no. **Default if no input:** subject-based routing.
2. **Email destination.** Notifications should land in operator's inbox. Today `siteConfig.email = 'actionairsport@gmail.com'`. Should this be a different address for field-rental leads vs general inquiries? **Default:** same address, different subject-line prefix (`[Field Rental Inquiry]` vs `[General Inquiry]`).
3. **Customer dedup.** If a known customer (already in `customers` by email) submits the form, do we link the lead to their existing row, or create a new one? **Default:** link to existing (matches M3 customer-entity dedup semantics — email is the key).
4. **"Feedback" subject overlap.** Currently `subject='feedback'` would just notify the operator via email. Should it instead tie into the existing `/api/feedback` flow? **Default:** keep separate — the M3 FeedbackModal is logged-in-user feedback; Contact form is anonymous public.
5. **"Corporate" is ambiguous.** Could mean field rental (private hire by a company) OR a corporate event booking (a company books an AAS-run event for their team). **Default:** treat as field-rental lead; operator re-routes at triage if it's actually an event-booking inquiry. The lead row can be cancelled and a `bookings`-shaped record created instead.
6. **Customers expecting a response may not have received one.** Since the form has been live with placeholder behavior for an unknown duration, customers may have submitted inquiries believing they were received. **Pre-B11 action item for operator:** decide whether to add a banner to `/contact` noting the form is being upgraded, or simply ship B11 and ensure email delivery is reliable from day 1.

## 6. B11 scope estimate (for B11 plan-mode)

| Item | Files |
|---|---|
| New worker route | `worker/routes/inquiry.js` |
| Mount in worker/index.js | 1-line addition |
| Contact.jsx update | placeholder → real submission + success/error states + honeypot |
| Test file | `tests/unit/inquiry/route.test.js` |
| Resend template seed (if structured email body wanted) | 1 migration row per Lesson #7 |
| Runbook updates | M5.5 baseline coverage + deploy notes |

**Estimated B11 scope: 4-6 files, well within the 8-file cap.** Possibly 7-8 if the Resend template seed migrates separately (B11 plan-mode will resolve this).

---

## 7. What this audit does NOT do

- Does not change Contact.jsx (no code change in B1).
- Does not create the worker route (deferred to B11).
- Does not seed the Resend template (deferred to B11 if needed).
- Does not migrate any data (the form has captured no data to migrate).

This audit is a discovery document. B11's plan-mode will reference it and post a concrete implementation plan for operator approval.

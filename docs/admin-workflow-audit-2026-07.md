# Admin Workflow Audit — Do the Operator Journeys Work End-to-End? (2026-07-24)

> ## ✅ STATUS 2026-07-28 (later the same day) — ALL FOUR SPRINTS ARE COMPLETE. **This audit is CLOSED.**
>
> Sprint 4 closed 2026-07-28 in PRs [#403](https://github.com/bulletbiter99/air-action-sports/pull/403)–[#411](https://github.com/bulletbiter99/air-action-sports/pull/411) (migration **0080**): the C1 archive contract (archived events visible on /games + detail, never bookable; `sales_close_at` ENFORCED at /quote+/checkout with an AdminEvents field), C8 pending-card lifecycle (payment-link recovery, cancel-with-Stripe-session-expiry, reschedule capacity), C9 labor completion (PUT edit + reject + tax-year-lock enforcement), the 1099 tax-identity editor (Sprint 2 tail), B5 SUA seed + runbook, B4 recurrence API + UI + runbook, the persona dropdown (+ a login-accounts surface on Settings), and the stale-copy sweep (headline: the public privacy policy named THREE processors the site doesn't use).
>
> **Parked with reasons:** the `w2_salary` CHECK-widening (documented at both dead-SQL sites; waits for an actual salaried person — 0 labor rows), custom-dates recurrence UI (SQL recipe in the runbook), and role/active editing for login accounts (API-only; persona is the one Settings write because it's a lens, not access).
>
> ## Previous status (2026-07-28 morning) — Sprints 1–3 complete
>
> Sprint 3 closed 2026-07-28 in PRs [#393](https://github.com/bulletbiter99/air-action-sports/pull/393)–[#400](https://github.com/bulletbiter99/air-action-sports/pull/400), **with no migrations**: C3 customer edit + the marketing-consent write path + manual tags, C7 unpaid/abandoned visibility + record-payment, C2 field-rental lead triage, C4 marketing dormant-state safety, B7 staff/cert/document actions, C6 admin incidents (file **and** resolve).
>
> **The findings in sections A–D below are written in the present tense and most are now FIXED.** Treat "Suggested sequencing" at the bottom as the authoritative status, not the finding text. Deferred on purpose: C4's test-send / per-recipient view / segment count-cache, and B7's staff-document role-tagging.
>
> **Two corrections to this document, verified in source:** B7 claims a `/unarchive` endpoint that never existed (archiving was one-way until #399 shipped the mirror) and cert edit/renew UI that was never wired (the editor supported the modes; nothing passed them). C2's `refunded` claim misreads which layer rejects it — `allowedNextStatuses` faithfully mirrors the server's transition map; the route special-cases `refunded` earlier.

> **STATUS (updated 2026-07-25, second pass): SPRINT 2 IS ALSO COMPLETE** — A4 CronHealth ([#385](https://github.com/bulletbiter99/air-action-sports/pull/385)), A6 duplicate columns ([#386](https://github.com/bulletbiter99/air-action-sports/pull/386)), B3 site dropdown ([#387](https://github.com/bulletbiter99/air-action-sports/pull/387)), A2 1099 migration 0078 ([#388](https://github.com/bulletbiter99/air-action-sports/pull/388)), A3 pay-link decision — stop emailing it, migration 0079 ([#389](https://github.com/bulletbiter99/air-action-sports/pull/389)), and the mockD1 meta-fix as a real-schema guard ([#383](https://github.com/bulletbiter99/air-action-sports/pull/383)) which also fixed A7 + part of A1 and **found four bugs this audit missed** — headline: `runStripeFeeSync` has captured 0 fees across 74 bookings since 2026-06-24 (`UPDATE bookings SET … updated_at`, a column that doesn't exist), and the A/R aging report 500s (`c.full_name`). B2/B6 were already resolved by #379. Corrections found while verifying: **A2's `POST /lock-year` was never broken**; **B7 is wrong** (compensation/mailing-address writes don't exist server-side either); A3's landing was specified behind `requireAuth`, so it would have 401'd. Details + operator steps in [docs/next-session.md](next-session.md). ~~Sprints 3–4 remain.~~ (Sprint 3 has since closed — see the banner above.)
>
> **(prior) STATUS:** **Sprint 1 is COMPLETE** — D1+D3 two-event/multi-day Today fixes ([#377](https://github.com/bulletbiter99/air-action-sports/pull/377)), D2 AdminScan payment-due + wrong-event safeguards + dead-fetch fix ([#378](https://github.com/bulletbiter99/air-action-sports/pull/378)), A5 reschedule price-diff fix + C5 review-invite visibility/resend ([#381](https://github.com/bulletbiter99/air-action-sports/pull/381)), plus the Today-page **walk-in New Booking tile** ([#380](https://github.com/bulletbiter99/air-action-sports/pull/380), operator-requested). D4 kiosk decision: **admin path is the operational system** (kiosk repair deferred). Separately, the **open-reads access model** shipped ([#379](https://github.com/bulletbiter99/air-action-sports/pull/379)) — which also resolved **B2** (Charges nav entry) and **B6** (command palette gated-destination gap, dissolved by removing sidebar capability fields). ~~Sprints 2–4 below otherwise remain open.~~ (Sprints 2 and 3 have since closed.)

Produced by a 9-agent workflow: 7 cluster auditors traced every operator journey through the code
(events, bookings/payments, customers/marketing/reviews, staff/compliance, field rentals/sites,
event-day kiosk, dashboard/reports/settings), each mechanically verifying that every `fetch()` in
the JSX has a matching worker route + capability gate. Two adversarial cross-checkers then
re-verified all 23 high-impact claims against the code: **all 23 CONFIRMED**. As of `main` `def6848`.

**Bottom line:** the core money paths — bookings ops, event CRUD/publish, customers, reports,
finances, settings — are mature, mechanically sound, and safer than typical (publish guards,
refund distinction, PII masking, consent-by-construction, audit trails). But a second tier of
features **looks finished and is actually dead**: the entire event-day kiosk, event staffing, the
1099 surface, the damage-charge payment link, and field-rental lead triage all fail at the first
real use. Several of these matter specifically on **July 25–26**.

---

## A. Confirmed BROKEN (bugs, not gaps)

| # | What | Evidence | Why it matters |
|---|---|---|---|
| A1 | **Event-day kiosk is dead end-to-end.** No client code ever calls `POST /api/event-day/sessions/start`, so every kiosk API call 401s at `requireEventDayAuth`. Additionally: `/start` itself 500s (`SELECT id, rsvp FROM event_staffing` — the `rsvp` column doesn't exist; schema has `status`), the kiosk's active-event fetch hits an **admin**-authed endpoint (portal marshals get 403 → "No event today"), WalkUpBooking fetches a **nonexistent** endpoint (`GET /api/admin/events/:id/ticket-types`), CheckIn.jsx calls admin routes with wrong field shapes (snake_case reads off camelCase responses — "Already checked in" can never show), and the offline queue **enqueues but is never replayed** ("Queued for replay" is a false promise; queued check-ins/walk-ups are silently lost). | session.js:72-76; eventDaySession.js:284-326; EventDayContext.jsx:44-58; WalkUpBooking.jsx:51; CheckIn.jsx:18-66; offlineQueue.js:139 (zero callers) | The kiosk cannot be used July 25. The admin path (/admin/today → scan → roster) is the only working day-of system — see D. |
| A2 | **1099 thresholds surface 500s** — `worker/lib/thresholds1099.js` selects `persons.legal_name`/`persons.ein`, columns that don't exist (no migration ever added them). The report, CSV export, tax-year auto-lock, and W-9 reminder cron have all been silently broken since M5. | thresholds1099.js:152, 313-320; migrations/0030 (no such columns) | Compliance surface is dead; the nightly sweep errors silently (its .catch guard hides it). |
| A3 | **Damage-charge "Approve" emails customers a payment link that 404s** — `paymentLink = SITE_URL + '/admin/booking-charges/pay/<token>'`; no such SPA route or worker route exists (the M5 landing page was never built; M6 shipped the off-session charge instead). | bookingCharges.js:104-105, 189, 319; App.jsx:210 | Customer-visible 404 on real money collection. |
| A4 | **CronHealth widget is permanently red/STALE** — it reads `lastSweepAgeMs` / `last24hReminders24hCount` / `last24hReminders1hCount`; the endpoint returns `lastSweepAt` / `reminders24h.{sent24hr,sent1hr}`. Field names exist nowhere else — never worked. | PersonaWidgets.jsx:127-143 vs analytics.js:476-483 | Owner dashboard cries wolf daily; trains the operator to ignore health signals. |
| A5 | **Reschedule modal price-diff preview shows wrong amounts** — reads camelCase keys (`i.unitPriceCents`) off snake_case line items (`unit_price_cents`). | AdminBookingsDetail.jsx:557-559, 624-630 vs formatters.js:83 | Operator makes price-difference decisions on wrong numbers. |
| A6 | **Event duplicate silently drops** custom_questions_json (incl. the live events' REQUIRED faction picker), site_id, featured, all focal points + overlay opacities; copies stale `sales_close_at` verbatim; and the `window.prompt` default titles the copy literally "(copy)". | events.js:800-823; AdminEvents.jsx:92-107 | Duplicating Fire Storm as next op's template silently loses its most load-bearing config. |
| A7 | **Event-day HQ staffing counter is a permanent 0/0** — wrong column AND wrong status value, masked by a silent catch. | eventChecklists.js:298-305 | Minor, but same class as A1/A2: mockD1 pattern-matching masked a real-schema error. |

**Meta-lesson (A1/A2/A7):** three schema-mismatch 500s shipped because mockD1 tests pattern-match
SQL strings and return fixture rows regardless of real columns. Recommendation: add a small
integration check that runs the cluster's real SQL against the local D1 fixture (the
`setup-local-d1.sh` harness already exists).

## B. Complete features that are UNREACHABLE (orphaned)

| # | What | Fix size |
|---|---|---|
| B1 | **AdminEventStaffing.jsx has no route, no import, no link** — 7 live API endpoints + 2 nightly crons (reminders, auto-decline) run headless; staffing an event is SQL-only. Also: its role picker calls an unmounted endpoint and falls back to a wrong hardcoded role id (ghost assignments); "Assign + send invite" **sends no invite** (the seeded `event_staff_invite` template is referenced nowhere). | Route + link = ~3 lines; invite send + role fix = small |
| B2 | **/admin/booking-charges has zero inbound navigation** — no sidebar entry, no settings card, absent from the command palette (it derives from SIDEBAR), no action-queue count. A hidden URL. | Sidebar entry = small |
| B3 | **Conflict detection is unreachable for UI-created events** — the event form's "Site" text field maps to `events.site` (series branding), not `events.site_id`; nothing in the admin ever sends `siteId`, and the conflict check short-circuits on NULL site_id. The whole M5.5 conflict engine + banner is dead for any event made in the UI. | Site dropdown (GET /api/admin/sites exists) + relabel = small |
| B4 | **Field-rental recurrences are SQL-only** — cron generates instances, but no API/UI exists to create, pause, or cancel a series. | Medium-large; at minimum document the SQL recipe |
| B5 | **SUA (site-use agreement) upload is dead-on-arrival** — no template seeded, and the 409 error copy points at a page that doesn't exist. | Seed one template + fix copy = small |
| B6 | **Command palette lost every capability-gated destination** (Reports, Finances, Reviews, Sites, Field Rentals, Roster, Scan) — it never threads user capabilities into `commandsFromSidebar`. | Small |
| B7 | **Staff-doc role-tagging + retire, cert renew/edit/revoke, staff archive/unarchive, compensation + mailing-address writes** — all built + tested server-side, zero UI callers. The editor literally says "Manager+ can attach via API." | Pure UI, small each |

## C. Workflow DEAD ENDS and gaps (journeys that can't complete)

1. **Archive contract is self-contradictory**: `/games` requires `published=1`, but every natural
   end-of-life action (soft-archive, unpublish) sets `published=0` — so the archive page promises
   "changes appear on /games" and nothing ever appears. Conversely, staying published keeps the
   event **bookable** (checkout gates on published only). And `sales_close_at` is a **phantom** —
   defaulted on create, formatted, never enforced anywhere. Decide the contract: archive-visible
   should not require bookable; add a real sales-closed mechanism (checkout change = Critical DNT
   additive protocol).
2. **Field-rental lead → cash is not UI-drivable**: the detail page never calls the existing PUT
   edit or POST /reschedule endpoints, so an inquiry lead (site NULL, schedule epoch-0 → renders
   "Dec 31, 1969") can never be triaged into a scheduled rental without SQL or the
   wizard-recreate-and-cancel workaround. Also: rental "refunded" status is offered in the dropdown
   but rejected by the API with internal jargon ("(B7b)"); cancelled rentals keep live "Mark
   received" buttons on pending payment rows (the A/R leak); the wizard's datetime inputs display
   UTC while parsing local (times jump on every edit).
3. **Customers are create-only**: no PUT for name/phone/notes/comm-prefs — the
   `email_marketing` toggle is unwritable by admins, which is a **consent-compliance gap** (a
   phone opt-out can't be honored). Manual customer tags are referenced by segments + the
   tag_added automation trigger but writable nowhere.
4. **Dormant marketing fails silently**: sending a campaign today strands it in an unrecoverable
   `sending` state (no transition out, no env-state banner anywhere). No test-send exists. No
   per-recipient delivery view. Segment "Last count" reads a cache no code ever writes.
5. **Review-invite pipeline has zero operator visibility** — invites start going out ~July 26 and
   there is no "invite sent/suppressed/resend" surface anywhere (mirror the waiver-confirmation
   resend pattern on the booking detail).
6. **Incidents can be filed (only via the dead kiosk) and never resolved** — no admin incidents
   surface, no resolve action, "escalates to Owner" sends nothing.
7. **`unpaid` / `abandoned` booking statuses are UI dead ends** — not in the filter options, no
   pill styling, no "record payment received" action; SQL-only lifecycle (this exact flow was
   needed during the Stripe-cutover invoices).
8. **Pending card bookings**: the payment link is unrecoverable after leaving the create screen,
   and "Cancel" doesn't actually invalidate the Stripe session. Reschedule also bypasses
   target-event capacity and offers unpublished/past targets.
9. **Labor approval is half-built**: no reject, no pre-approval edit, tax-year lock not enforced
   on mutations.

## D. July 25–26 SPECIFIC (the weekend this system meets reality)

The admin path (AdminToday → AdminScan → AdminRoster) is the only working day-of system — but:

1. **Two events run the same day** — `/today/active` returns `eventId: null` when 2+ events match,
   AdminToday collapses to a link-less "ambiguous" card, and the dashboard today-widgets degrade.
   Fix: return the matching events' id+title (shape-additive) and render one tile row per event.
2. **AdminScan hides payment status** — a scanned attendee with an unpaid/cancelled booking shows
   no warning (the kiosk's AttendeeDetail has this flag; AdminScan doesn't). It also fetches a
   nonexistent event endpoint (`GET /api/admin/events/:id` — dead code path) and only flashes,
   not blocks, on waiver/wrong-event.
3. **Multi-day span**: TodayEvents/TodayCheckIns widgets treat only `dateIso === today` as active —
   July 26 morning (Fire Storm still running) shows nothing.
4. **Kiosk decision needed**: repair minimally (bootstrap + rsvp fix + picker: A1) or declare the
   admin path official for this event and repair the kiosk later. Either is defensible; deciding
   is the point. If staff check-in via portal is wanted, B1's staffing route must land too.
5. **Review-invite visibility** (C5) lands its value the night of July 26.

## E. What's genuinely GOOD (calibration — don't rebuild these)

- Publish guard (no publish with zero active tickets) + auto-seeded GA ticket; destructive-action
  rails (soft-archive with bookings, deactivate-not-delete sold tickets, capacity ≥ sold).
- Stripe vs external refund distinction with consequence bullets + idempotency key surfaced;
  attendee-rename waiver-integrity guard; server-side PII masking with per-view audit.
- Manual booking flow: quote parity with public checkout, capacity 409s, customer recall.
- Consent-by-construction marketing SQL (`email_marketing=1 AND archived_at IS NULL` hard-appended);
  campaign recipient snapshotting; batch promo codes (chip parser, dry-run, hard confirm).
- Portal session security (hash-only tokens, token_version, revocation); staff-doc versioning with
  sha256 ack snapshots; per-sweep .catch isolation in the cron.
- Field-rental status matrix with helpful 409s; symmetric event↔rental conflict engine (once
  site_id is settable, B3); COI denormalization + expiry crons; defensive public inquiry intake.
- Reports: all 21 endpoints correctly gated; finances loop (expenses→budgets→P&L→per-event P&L)
  genuinely closed; audit-log FTS graceful fallback; email-templates journey complete incl. test-send.

## Suggested sequencing

**Sprint 1 — before July 25 (event-day readiness):** D1 two-event tiles + D3 multi-day widget
dates; D2 AdminScan payment banner + dead-fetch fix; A5 reschedule display fix; C5 review-invite
visibility; the kiosk decision (D4) — if repairing: A1 bootstrap + rsvp column + event picker,
B1 staffing route. Small PRs, mostly client-side.

**Sprint 2 — broken-wiring fixes:** A4 CronHealth; A6 duplicate INSERT columns; B3 site dropdown;
B2 charge-queue nav + A3 pay-link decision (build the pay landing or stop emailing links);
A2 1099 migration (`persons.legal_name`/`ein` or encrypted variants); B6 command palette caps;
the mockD1 meta-fix (one real-schema integration test).

**Sprint 3 — workflow completion:** ✅ **CLOSED 2026-07-28** (PRs #393–#400, no migrations).
C3 customer edit + manual tags; C2 rental edit/reschedule modals; B7 staff-doc/cert/archive
buttons; C6 incidents — built with a FILING path too, since the kiosk (the only existing one) is
dead; C7 unpaid/abandoned status actions + record-payment; C4 marketing dormant-state banner +
sending→canceled. **Deferred:** C4 test-send / per-recipient view / segment-count cache (not
exercisable until the marketing env vars land), B7 document role-tagging (a feature, not a button).
**Three items in this list were wrong** — see the corrections in
[docs/next-session.md](next-session.md): B7 claims an `/unarchive` endpoint that does not exist and
cert edit/renew UI that was never wired; C2's `refunded` claim misreads which layer rejects it.

**Sprint 4 — contracts & polish:** ✅ **CLOSED 2026-07-28** (PRs #403–#411, migration 0080).
C1 archive contract + sales_close_at enforcement (operator chose the FULL contract — the
Critical-DNT checkout gates shipped additively, Groups A/B byte-green); B4 recurrence API + UI +
runbook; B5 SUA placeholder seed + runbook (operator chose seed AND runbook); C8 pending-card
lifecycle; C9 labor completion; 1099 tax-identity editor; persona dropdown (operator chose
dormant-doc AND dropdown); stale-copy sweep. **One correction to this list:** the "Coming in M5"
tiles were already removed (#254) and "(B7b)" already fixed (#397) before this sprint — the real
stale copy was the privacy policy naming Google Analytics, Formspree AND Mailchimp (all unused),
AdminSegments' batch numbering, and FilterBar's "(coming in M3+)".

# Post-M5.5 next-session prompt

**Status:** M5.5 (Field Rentals) is **CLOSED + DEPLOYED 2026-05-12** — production runs the full Surface 7 build. The previous version of this file handed off B7 plan-mode mid-milestone; this version is for the **post-M5.5 session** that decides between two forks: ship the 6-item polish backlog, or move to **M6 (Stripe live cutover + invoice integration for field rentals)**.

The fresh session should read this file first, then read [HANDOFF.md](../HANDOFF.md) §NEW SESSION + the closed-M5.5 section in [CLAUDE.md](../CLAUDE.md) for the full context.

---

```
You are starting a fresh session on the Air Action Sports project.
M5.5 (Field Rentals) shipped + closed 2026-05-12. Production at
`main` SHA 8decacc (merge PR #162). Workers Builds auto-deployed.

═══════════════════════════════════════════════════════════════════════
STATE AT HANDOFF (2026-05-12)
═══════════════════════════════════════════════════════════════════════

main: 8decacc (M5.5 close merge — preserves per-batch SHAs as second-
  parent commits; first-parent log is clean).
Tests: 1997 / 161 files (M5 baseline was 1538 / 146).
Lint: 0 errors / 440 warnings (advisory; react-refresh).
Build: clean (~270ms).
Open PRs: 0.

D1 migrations applied to remote (M5.5 portion — all 10 applied):
  0044 sites_schema                       (B1, applied 2026-05-11)
  0045 events_site_id                     (B2, applied 2026-05-11)
  0046 customers_client_type              (B3, applied 2026-05-11)
  0047 field_rentals_core                 (B4, applied 2026-05-11)
  0048 field_rentals_documents_payments   (B5, applied 2026-05-11)
  0049 field_rentals_capabilities         (B6, applied 2026-05-11)
  0050 customers_client_type_not_null     (B9, applied 2026-05-12 post-deploy)
  0051 cron_sentinels_and_business_caps   (B10a, applied 2026-05-12 post-deploy)
  0052 field_rental_cron_email_templates  (B10b, applied 2026-05-12 post-deploy)
  0053 inquiry_notification_email_template (B11, applied 2026-05-12 post-deploy)

Verified post-apply:
- 5 new email templates seeded (coi_alert_60d/30d/7d + field_rental_lead_stale + inquiry_notification)
- 2 existing customers backfilled to client_type='individual'
- site_coordinator binding for customers.read.business_fields seeded
  (5 role-presets total now: owner / event_director / booking_coordinator
  / bookkeeper / site_coordinator)
- /api/health returns 200

Production data state:
- 2 sites: Ghost Town (Hiawatha UT 84545) + Foxtrot (Kaysville UT 84037)
- 1 event (operation-nightfall) linked to Ghost Town
- 0 field_rentals records — first exercise lands when the first
  /api/inquiry hits with subject=private-hire or corporate
- Crons all wired but idle (no qualifying data to act on)

═══════════════════════════════════════════════════════════════════════
OPERATOR-APPLIES-REMOTE STATUS
═══════════════════════════════════════════════════════════════════════

✓ DONE: all 10 M5.5 migrations applied to remote D1 (2026-05-12).

Remaining operator-driven verification (not blocking next code change;
can happen alongside the next session):

1. 6-item smoke checklist in docs/runbooks/m55-deploy.md "Post-deploy
   smoke" section. Confirms:
   - /contact form submission (general + field-rental paths)
   - Operator notification email arrives
   - Honeypot guard returns 200 silently
   - Rate limit returns 429 on burst
   - 03:00 UTC cron summary includes recurrenceGen + coiAlerts + leadStale

2. First overnight cron — inspect Cloudflare Workers logs after the
   next 03:00 UTC sweep. Expected: all three new sweeps return zero
   counts with 0 field_rentals records in production.

If smoke fails on any item, see docs/runbooks/m55-rollback.md for the
4-level decision tree. The fresh session can help diagnose — start by
checking audit_log for inquiry.email_failed / coi_alert_no_recipient /
lead_stale_template_missing rows.

═══════════════════════════════════════════════════════════════════════
FORK: NEXT DIRECTION (operator picks)
═══════════════════════════════════════════════════════════════════════

After smoke passes, the operator picks one of two directions:

── Fork A: post-M5.5 polish (6 items, ~3-5 batches at 8-file cap)
   ──────────────────────────────────────────────────────────────

   1. AES decryption surface for business_tax_id (EIN) +
      business_billing_address
      - worker/lib/personEncryption.js already has decrypt helpers
        (M5 used these for compensation_rate_cents)
      - Extend customers.js GET /:id to decrypt when viewer has
        customers.read.business_fields capability
      - AdminCustomerDetail.jsx renders decrypted fields (currently
        shows "lands in M5.5 B10" placeholder text — replace)
      - Add edit modal for business fields, gated by
        customers.write.business_fields
      - Estimated 5-6 files. Capabilities + bindings already seeded.

   2. Admin POST /api/admin/customers + create modal
      - Phone-intake gap: operator currently has no UI to manually
        create a customer (only via booking flow or /contact form)
      - New endpoint in worker/routes/admin/customers.js
      - Modal in src/admin/AdminCustomers.jsx with client_type +
        business field collection
      - Estimated 3-4 files.

   3. Monthly day_of_month recurrence pattern
      - Schema accepts {kind: 'day_of_month', day: 1-31} but the
        generator only handles {kind: 'nth_weekday'}
      - Operator decision needed: Feb 30 → skip month OR fall back to
        last day OR fall forward to March 1
      - Estimated 2-3 files (lib + tests + maybe doc update).

   4. /status route clears lead_stale_at on transition
      - Current behavior: 7-day silence after revert before re-alert
      - Add lead_stale_at = NULL to the UPDATE in
        worker/routes/admin/fieldRentals.js /status handler
      - Estimated 1-2 files (route + 1 test).

   5. UNIQUE constraint on (recurrence_id, recurrence_instance_index)
      - Stronger idempotency for the recurrence cron
      - Requires column-rename pattern (D1 quirk #2) since the
        existing idx_field_rentals_recurrence is just an INDEX, not
        UNIQUE
      - Estimated 1 migration + tests.

   6. AdminScan + AdminRoster ?event= deep-link parsing
      - M5 carryover; currently /admin/today links navigate but don't
        pre-select the event
      - useSearchParams() to read event= and pre-fill the dropdown
      - Estimated 2 files (~10 lines per file).

   These can ship as one combined "post-M5.5 polish" batch OR split.
   Recommended split: items 1+2 (largest, customer-facing), then 3+4
   (recurrence + lead-stale polish), then 5+6 (small carryover items).

── Fork B: M6 (Stripe live + invoice integration)
   ──────────────────────────────────

   This is the larger, longer milestone. Scope per CLAUDE.md M5.5
   open questions + Surface 7 §11:

   - Stripe sandbox → live cutover (test keys → live keys; webhook
     endpoint signing key rotation)
   - $1 end-to-end live test
   - DMARC + Resend DKIM/SPF DNS records (booking confirmations
     currently may land in spam)
   - Stripe Invoices integration for field rentals (currently
     payments are off-platform; field_rental_payments.stripe_invoice_id
     column is reserved but unused)
   - Recurring B2B billing: card-on-file for paintball groups with
     monthly bookings (the recurring discount in
     field_rental_recurrences.template_pricing_notes is operator-
     descriptive; M6 makes it actually charge a card)

   M6 should start with plan-mode + decisions register entry. The
   surface is large enough to be its own milestone, not a polish PR.

═══════════════════════════════════════════════════════════════════════
PRE-FLIGHT (before any code change)
═══════════════════════════════════════════════════════════════════════

  git checkout main
  git pull origin main
  npm install
  npm test                # expect 1997 passed across 161 files
  npm run lint            # expect 0 errors / 440 warnings
  npm run build           # expect clean
  curl https://airactionsport.com/api/health
                          # expect {"ok":true,...}

If any of these fails or numbers differ materially, STOP and investigate.

═══════════════════════════════════════════════════════════════════════
NON-NEGOTIABLE OPERATING RULES (preserved from M5.5)
═══════════════════════════════════════════════════════════════════════

1. Plan-mode-first per batch. Write the plan, post it, WAIT for
   "proceed" before editing.
2. 8-file cap per PR (M5.5 standard). Split upfront if scope exceeds.
3. Conventional Commits with appropriate scope.
4. No --force, no rebases on shared branches, no direct commits to main.
5. Pre-migration spot-check is mandatory — verify production schema
   via `wrangler d1 execute --remote --command=".schema <table>"`
   BEFORE writing the migration.
6. Every email_templates seed includes id='tpl_<slug>' and
   created_at=updated_at (Lesson #7).
7. Use --command (NOT --file) for SELECT against remote D1 (D1 quirk #4).
8. Between-batch handoff required — 5-bullet summary; operator confirms
   before next batch's plan-mode.
9. Stop-and-ask conditions:
   - A do-not-touch file needs modification (formatEvent, bookings.js,
     waivers.js, stripe.js, auth.js)
   - Pre-migration spot-check reveals divergence
   - A test reveals current behavior conflicts with audit-documented
     behavior
   - Coverage on any gated file drops from current baseline

═══════════════════════════════════════════════════════════════════════
READING ORDER FOR THE FRESH SESSION
═══════════════════════════════════════════════════════════════════════

Read end-to-end BEFORE deciding on Fork A vs Fork B:

1. HANDOFF.md §NEW SESSION (top) — current state + state-at-close table
2. CLAUDE.md Milestone 5.5 section — full per-batch table + lessons +
   carry-forward facts + polish backlog
3. docs/runbooks/m55-deploy.md — operator deploy procedure + smoke
4. docs/runbooks/m55-rollback.md — 4-level decision tree (in case
   anything breaks on first real /api/inquiry submission)
5. docs/runbooks/m55-baseline-coverage.txt — snapshot at close
6. docs/audit/06-do-not-touch.md — DNT inventory (still in force)

═══════════════════════════════════════════════════════════════════════
QUICK DECISIONS TO SURFACE TO OPERATOR EARLY
═══════════════════════════════════════════════════════════════════════

(Operator can answer these before any plan-mode posting.)

1. Has migration 0053 been applied to remote?
2. Has the 6-item smoke checklist been run? Any failures?
3. Fork A (polish) or Fork B (M6)?
4. If Fork A: ship the 6 items as one combined batch, or split into
   3 batches (1+2 / 3+4 / 5+6)?
5. If Fork B: any operator constraints on Stripe live cutover timing
   (e.g. waiting for a specific event date or accounting close)?

═══════════════════════════════════════════════════════════════════════
END OF PROMPT
═══════════════════════════════════════════════════════════════════════
```

---

### What this file replaces

The previous version of this file was the B7 plan-mode handoff prompt (M5.5 mid-milestone). It's been fully repurposed for the post-M5.5 session. The history of the mid-milestone version is in git — `git log --all -- docs/m55-next-session.md` shows the prior state.

### Future maintenance

This file should stay synchronized with HANDOFF.md §NEW SESSION + CLAUDE.md Milestone 5.5 section. When the next milestone (M6 or polish batches) starts:

- If polish batches: append a state update at the top of this file noting which polish items have shipped, OR rotate this file to `docs/post-m55-polish-next-session.md` for clarity
- If M6: create `docs/m6-next-session.md` mirroring the M3/M4/M5 pattern; this file becomes a historical reference

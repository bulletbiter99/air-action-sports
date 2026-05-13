# Post-M5.5 next-session prompt

**Status:** M5.5 (Field Rentals) is **CLOSED + DEPLOYED 2026-05-12**. Through the rest of the same day, **11 follow-up PRs** shipped on top: the post-M5.5 staff-wiring fix (PR #165–#166), the per-tab build-out of `/admin/staff/:id` (P1 #167, P3 #168, P2 #169, P4 #170), three Access-tab UX/security follow-ups (#171, #172, capability gating), two public-side fixes (home hero #173, event slug normalize #174), and one new feature (email-bound batch promo codes with migration 0054 — PR #175). **Production Worker version `6b680a02-966b-4056-af5b-3e7d2fce9c1f`** at session close. **All 8 staff detail tabs are at 100%.**

The Fork-A polish backlog is unchanged (none of those items were touched this session). Fork B (M6 Stripe live) also unchanged.

The fresh session should read this file first, then read [HANDOFF.md](../HANDOFF.md) §NEW SESSION + the closed-M5.5 + post-M5.5-fix + Continued-post-M5.5-work sections in [CLAUDE.md](../CLAUDE.md) for full context.

---

```
You are starting a fresh session on the Air Action Sports project.
M5.5 (Field Rentals) shipped + closed 2026-05-12; the same operator
session continued through 11 follow-up PRs the rest of that day.
Production worker version 6b680a02-966b-4056-af5b-3e7d2fce9c1f;
main at eb89f13 (PR #175 merge).

═══════════════════════════════════════════════════════════════════════
STATE AT HANDOFF (2026-05-12 late evening)
═══════════════════════════════════════════════════════════════════════

main:    eb89f13 (PR #175 — email-bound promo codes — most recent merge).
Tests:   2073 / 168 files (M5.5 close was 1997 / 161 → +76).
Lint:    0 errors / 448 warnings (all react-refresh advisory).
Build:   clean (~265ms).
Open PRs: 0 active (PR #1 is a stale April config-rename; safe to close).

Migrations on remote D1 (cumulative, all applied):
  0044-0053  M5.5 milestone (applied 2026-05-11 / 2026-05-12)
  0054       promo_codes_email_binding (applied this session, 2026-05-12)

Continued post-M5.5 work — what shipped in this session (11 PRs total):
  PR #165  Post-M5.5 staff-wiring fix (5 prongs: persons backfill +
           createPersonForUser wiring + + New Person flow + role_preset
           backfill + nav-CSS scoping).
  PR #166  Follow-up deploy-fix + docs refresh.
  PR #167  P1 — Profile edit modal + Notes sensitive-textarea gating.
  PR #168  P3 — Access tab: portal sessions list + revoke + invite.
  PR #169  P2 — Documents tab: per-person ack list + admin override.
  PR #170  P4 — Issues tab: incidents filed-by + involving.
  PR #171  Portal invite confirm modal (UX fix).
  PR #172  Gate portal invite on staff.invite capability (not role
           hierarchy); remove cap from booking_coordinator preset.
  PR #173  Home hero headline: "Lock & Load Up." → "Live Airsoft Events".
  PR #174  Event create: normalize slug input (apostrophes/spaces/
           uppercase silently slugified; no rejection).
  PR #175  Email-bound single-use promo codes + batch-create modal with
           chip parser + hard confirmation modal. Migration 0054 adds
           promo_codes.restricted_to_email + seeds promo_code_issued
           email template. New POST /api/admin/promo-codes/batch endpoint.

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
  0054 promo_codes_email_binding           (PR #175, applied 2026-05-12 evening)

Admin staff suite — all 8 tabs at 100% on /admin/staff/:id:
  Profile        Edit modal w/ 8 fields (PR #167)
  Roles          functional (existed; unblocked by post-M5.5 wiring fix)
  Documents      Per-person ack list + admin override (PR #169)
  Notes          Public + sensitive textareas (PR #167)
  Access         Portal sessions + revoke + invite confirm (PRs #168 #171)
  Issues         Filed-by + involving incidents (PR #170)
  Certifications functional
  Schedule       functional

Capability gate refinements (PR #172):
- Frontend AccessTab.canInvite now reads hasCapability('staff.invite')
  instead of hasRole('manager'). AdminContext plumbs capabilities[]
  from /api/admin/auth/me + exposes hasCapability(cap).
- DELETE FROM role_preset_capabilities WHERE capability_key='staff.invite'
  AND role_preset_key='booking_coordinator';  → bound only to
  owner + event_director presets now.
- HR coordinator role_preset doesn't exist yet (see follow-ups below).

Email-bound single-use promo codes (PR #175, the new feature):
- promo_codes.restricted_to_email column. /checkout hard-rejects when
  booking email mismatches (case-insensitive). /quote previews soft
  when buyer email not yet provided.
- POST /api/admin/promo-codes/batch generates N codes (max 500),
  each single-use + bound to one recipient email. Optional
  sendToSelfFirst dry-run flag prepends admin's email.
- Admin UI: + Batch Create button next to + New Code. Modal parses
  email list to chips with X-to-remove + invalid/duplicate warnings;
  confirmation modal shows ⚠ "This cannot be undone" before any
  emails fire.

Verified post-apply:
- 33 email templates in production (32 pre-session + promo_code_issued)
- 2 existing customers backfilled to client_type='individual'
- 4 persons rows for the 4 admin users (Paul, Rebecca, Adam, Bradley)
  all on role_preset_key='owner' (96 caps)
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

── Newly-queued admin follow-ups (from the 2026-05-12 evening session)
   ───────────────────────────────────────────────────────────────────

   7. HR coordinator role_preset doesn't exist yet.
      Two SQL statements give an HR person invite access:
        INSERT INTO role_presets (key, name)
          VALUES ('hr_coordinator', 'HR Coordinator');
        INSERT INTO role_preset_capabilities
          (role_preset_key, capability_key)
          VALUES ('hr_coordinator', 'staff.invite'),
                 ('hr_coordinator', 'staff.read'),
                 ('hr_coordinator', 'staff.read.pii'),
                 ('hr_coordinator', 'staff.notes.read_sensitive'),
                 ('hr_coordinator', 'staff.notes.write_sensitive');
        UPDATE users SET role_preset_key='hr_coordinator'
          WHERE email='<hr_email>';
      Decision needed: which staff.* capabilities should HR get?

   8. Past-games / event archive page (DISCUSSED, DEFERRED).
      Scope: customer-facing "Past Games" index + per-event archive
      page with video embeds + image gallery + downloadable files.
      Recommended phased approach:
        Phase 1 (~6 files, no R2 plumbing): public index + detail
          page + admin UI to paste YouTube/Drive links into an
          event_media table.
        Phase 2: R2-hosted images + bulk admin upload tooling.
        Phase 3: optional video hosting in R2.
      Operator preferred public-archive over attendee-gated, and
      external-links over R2 for phase 1.

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
  npm test                # expect 2073 passed across 168 files
  npm run lint            # expect 0 errors / 448 warnings
  npm run build           # expect clean (~265ms)
  curl https://airactionsport.com/api/health
                          # expect {"ok":true,...}
  # Optional admin smokes (need a logged-in browser session):
  #   /admin/staff/<id>             — all 8 tabs render
  #   /admin/staff/<id> Profile     — Edit profile button opens modal
  #   /admin/staff/<id> Documents   — empty state links to library
  #   /admin/staff/<id> Access      — + Send portal invite opens confirm modal
  #   /admin/staff/<id> Issues      — empty state ("no incidents on file")
  #   /admin/promo-codes            — + Batch Create button opens chip-parser modal
  #   /                              — hero shows "LIVE AIRSOFT / EVENTS"

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

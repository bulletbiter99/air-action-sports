# M6 next-session prompt

**Status:** M6 (Stripe live flow + damage charge Option A + vendor templates + email drafts) is **IN PROGRESS**. Batches 0 / 0-followup / 1 / 2 are merged + deployed to main. **B3 plan is parked below — ack to execute.** All operator-side pre-flight items from B0 (M5.5 smoke, overnight cron, DNS, HTTPS) still pending capture; they do NOT block B3 code shipping, but DMARC/SPF/DKIM verification should land before B3 merges since B3 is the lead-in to deliverability-sensitive email work.

The fresh session should read this file first, then [HANDOFF.md](../HANDOFF.md) top-of-doc + [CLAUDE.md](../CLAUDE.md) Milestone 6 section for full context.

---

## Copy-paste prompt for fresh session

```
I'm resuming work on the Air Action Sports booking system, mid-M6.
Read in order:

  1. docs/m6-next-session.md (this file) — current B3 plan + pre-flight
     status + decisions parked
  2. HANDOFF.md top-of-doc — production state, what shipped in the
     previous session
  3. CLAUDE.md Milestone 6 section — batch-by-batch detail with PR
     numbers and SHAs

M6 batches done (4 PRs merged + deployed):
  - B0:           cutover runbook + spot-check scaffold + staff
                  labeling polish (PR #188, 0206120)
  - B0-followup:  spot-check populated, runbook fix (PR #191, 9da716a)
  - B1:           vendor package templates library — list/create/
                  soft-delete (PR #189, f0cd431)
  - B2:           vendor package templates — detail/edit composer +
                  clone-to-event (PR #190, fd1e3ba)

B3 is plan-mode parked — see the "B3 PARKED PLAN" section in
docs/m6-next-session.md for the full plan to ack.

Production state at handoff:
  main:    9da716a (PR #191 — docs-only B0-followup)
  Worker:  a6c147db-8299-45e8-82ab-d0ee1e0ac115 (post-B2 deploy)
  Tests:   2135 / 173 files
  Lint:    0 errors / 448 warnings
  Build:   clean (~260ms)
  Migrations on remote: 0001-0055 (no M6 migrations yet)

When acking B3:
- I'll write the migration first (operator-applies-remote per
  M6 prompt rule — provide the command, operator runs, output
  captured for the closing summary).
- email_templates schema already verified safe via the B0-followup
  spot-check.
- Group A + Group B regression must stay 138/138.

If the operator wants to pivot to a different track instead of B3,
the alternatives are:
  (a) Native Marketing milestone (planned, not started — see
      memory project_marketing_milestone.md)
  (b) Post-M5.5 polish backlog Fork A — 6 small items in
      docs/m55-next-session.md
  (c) Continue M6 from B3 (this file's parked plan)

Workflow rules in effect for M6:
  - Plan-mode-first per batch. No edits before ack.
  - 8-file operating target, 10-file hard ceiling.
  - Mandatory 5-bullet closing summary between batches.
  - Claude Code never executes `wrangler d1 execute --remote`
    for MUTATIONS. Read-only schema queries — operator was
    permissive at B0-followup; the default is still
    operator-runs-it.
  - Conventional Commits with m6-<area> scope; flat
    m6-batch-N-slug sub-branches.
  - Browser-verify in production after every deploy via
    Claude_in_Chrome (not just /api/health).
```

---

## B3 PARKED PLAN — Email template draft state (schema + worker)

### What's shipping
A `status` column on `email_templates` (`'draft' | 'published'`) so admins can author email templates without them being live-eligible until explicitly published. Worker-side: send paths filter out drafts; only previewable in admin.

### Pre-migration spot-check status
✅ **Cleared.** Schema captured 2026-05-25 (in `docs/m6-discovery/spot-check-log.md`):
- `id TEXT PRIMARY KEY` ✓
- `created_at INTEGER NOT NULL` ✓
- `slug TEXT NOT NULL UNIQUE` ✓
- Other cols as expected; no surprises

### Files (5-6 of 8 target; final count depends on whether a helper extracts cleanly)

1. **`migrations/0056_email_templates_status.sql`** (NEW) — single-statement ALTER:

   ```sql
   ALTER TABLE email_templates ADD COLUMN status TEXT NOT NULL DEFAULT 'published';
   ```

   D1 quirk #2 doesn't apply (no table rebuild). Existing rows backfill to `'published'` automatically.

2. **`worker/lib/emailTemplates.js`** (NEW OR EDIT — investigate at exec time) — fetch-by-slug with `requirePublished=true` default. Used by every email-send call site so drafts are silently skipped.

3. **`worker/routes/admin/emailTemplates.js`** (EDIT) — `formatTemplate` exposes the new `status` field; send / test-send paths return `{skipped: 'template_draft'}` instead of attempting Resend when the template is `'draft'`. Preview endpoint UNAFFECTED.

4. **`tests/unit/admin/email-templates-status.test.js`** (NEW) — list returns status field, draft excluded from send paths, published proceeds normally, default `'published'` on insert.

5. **`tests/unit/lib/emailTemplates-status.test.js`** (NEW — if a pure helper extracts cleanly) — `isPublishedTemplate(row)` tests.

### What B3 does NOT do
- **No admin UI changes** — that's B4.
- **No new email templates seeded.**
- **No changes to `worker/lib/email.js`** (High DNT) or the 9 named senders in `worker/lib/emailSender.js` (Critical DNT). All filtering at the template-fetch layer.

### Gates
- Group A + Group B regression (must stay 138/138)
- Existing `email_templates` route + admin test files unchanged in behavior
- Migration applies cleanly (operator-applies-remote — Claude provides the command, operator runs it, paste output)

### Operator handoff at B3 close
- Migration apply command provided in the closing summary
- After operator runs, paste output back to me
- Confirm row count: every existing template row should show `status='published'`
- Then move to B4 (admin UI for status toggle + preview-against-real-data)

### Risk
**Medium** — touches a Lesson #7 table. Mitigations: spot-check captured (clear), ALTER syntax verified safe, no existing send-path semantics change for already-published templates.

---

## Pre-flight items STILL PENDING from B0 (operator-side)

These don't block B3 code from shipping but should land before B3 merges to main:

1. **M5.5 smoke checklist** — 6 items in `docs/runbooks/m55-deploy.md`. Paste results into `docs/m6-discovery/spot-check-log.md` "M5.5 smoke checklist" section.
2. **Overnight cron 8-key summary verification** — Cloudflare Workers logs → most recent 03:00 UTC invocation → confirm `tags / certs / staffReminders / staffAutoDecline / taxYearAutoLock / recurrenceGen / coiAlerts / leadStale` all present. Paste line into the spot-check log.
3. **DMARC + Resend DKIM/SPF DNS records** — Cloudflare DNS → `airactionsport.com` zone. Verify the 3 TXT records. **Most material for B3+** since email-template work is the lead-in to deliverability-sensitive sends.
4. **Cloudflare Always-Use-HTTPS toggle** — verify ON in Cloudflare → SSL/TLS → Edge Certificates.
5. **Vendor/charge table existence query** — gates B6/B7, not B3:
   ```bash
   CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 execute air-action-sports-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%vendor%' OR name LIKE '%charge%' OR name LIKE '%dispute%') ORDER BY name"
   ```
   Paste results into spot-check log.

---

## Alternative tracks the operator may pick instead of B3

### Native Marketing milestone (parallel, planned)

See memory `project_marketing_milestone.md`. ~6 batches. Independent of M6 (different surfaces; no scope overlap). Operator chose M6 first but can switch if priorities shift.

### Post-M5.5 polish backlog (Fork A)

6 items from `docs/m55-next-session.md`:
- AES decryption surface for `business_tax_id` (EIN) + `business_billing_address`
- Admin POST customers + create modal
- Monthly day_of_month recurrence pattern
- `/status` route clears `lead_stale_at` on transition
- UNIQUE constraint on (recurrence_id, recurrence_instance_index)
- AdminScan + AdminRoster `?event=` deep-link parsing

These could ship as small batches between M6 batches if the operator wants to interleave.

### Newly-queued admin follow-ups (from previous session 2026-05-12)

- HR coordinator role_preset doesn't exist yet (3 SQL statements)
- Past-games / event archive page (phase 1: public archive + external video/photo links)

---

## Why M6 was paused at B3 plan-mode

Operator asked for clean session-handoff prep at 2026-05-26 (post-B2). The B3 plan was presented earlier in the session but never ack'd or executed — parked here verbatim. The fresh session can resume by ack'ing the B3 plan, OR pivoting to one of the alternatives above.

## Carry-forward observations (durable across sessions)

- **Audit log is 7-col, not 6.** CLAUDE.md's M5 post-deploy carry-forward note states "audit_log has 6 columns" — production has 7 (includes `ip_address`). M2 `writeAudit()` handles both shapes via the `ipAddress` branch. No code fix needed; CLAUDE.md correction logged in `docs/m6-discovery/spot-check-log.md` for the next docs-only sweep.
- **bookings column name is `stripe_payment_intent`** (no `_id` suffix). Fixed in the M6 cutover runbook in B0-followup.
- **`worker/services/waiverService.js` doesn't exist.** The M6 prompt's DNT callout was citing a phantom path. Real waiver DNT surfaces are `worker/routes/waivers.js` and `worker/lib/waiverLookup.js`.
- **Vendor package templates table was already shipped (migration 0012)** — B1+B2 built the admin UI for the existing table, did NOT create a new one.
- **Sections kind enum**: `vendor_package_sections.kind IN ('overview', 'schedule', 'map', 'contact', 'custom')`. Templates store kind as plaintext JSON; B2's `normalizeSections` coerces unknown kinds to `'custom'` so any template is always cloneable.

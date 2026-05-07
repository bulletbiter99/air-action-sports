# M3 Pre-flight: M2 primitive dogfood verification

Captured 2026-05-07 in M3 batch 0 task 0d.

**Goal:** before M3's risky schema migration starts, confirm M2's six new shared primitives are working as intended in production.

**Method:** code-level verification + production `audit_log` query for runtime evidence. Local-D1 dev-server checks are documented but not run here (Batch 1 establishes the local-D1 setup; this batch checks evidence already on remote).

---

## 1. `<FilterBar>` chip primitive (B1)

**Code-level:**
- `src/components/admin/FilterBar.jsx` exists, exports `FilterBar` component.
- Already exercised by AdminFeedback (B1 proof site). M3 batch 8 will add a second consumer (AdminCustomers).

**Test coverage:**
- `tests/unit/components/FilterBar.test.js` — **23 tests passing** (per `npm test`).
- `tests/unit/hooks/useFilterState.test.js` — **22 tests passing** for the URL-sync hook.

**Status:** ✓ verified. Tests are the floor; runtime is in production via AdminFeedback chips.

---

## 2. CSS density tokens + density toggle (B5c)

**Already verified at M2 close:**
- `src/styles/tokens.css` `:root` block resolves to: `--admin-pad-main: 2rem`, `--admin-pad-nav: 12px 0`, `--admin-pad-section-label: 10px 18px 6px`, `--admin-row-gap: 12px` (zero pixel diff vs pre-tokenization).
- `[data-density="compact"]` block resolves to: `--admin-pad-main: 1.25rem`, `--admin-pad-nav: 8px 0`, `--admin-pad-section-label: 8px 16px 4px`, `--admin-row-gap: 8px`.
- Verified via dev-server `getComputedStyle` probe during PR #25.

**Production runtime evidence:**
- `/api/admin/feature-flags` returns 401 unauthenticated (route mounted) — confirmed in M2 deploy ceremony.
- Migration 0021 applied; `density_compact` flag seeded (`state='user_opt_in'`, default off).

**Status:** ✓ verified.

---

## 3. `writeAudit()` helper (B2) — 5 refactored call sites

**Code-level (grep verification of imports + uses):**
- `worker/routes/admin/users.js`: imported on line 5; called on **lines 106, 128, 180** — 3 sites (user.invited, user.invite_revoked, user.updated)
- `worker/routes/admin/emailTemplates.js`: imported on line 5; called on **lines 111, 157** — 2 sites (email_template.updated, email_template.created)

**Production audit_log distribution** (queried via `wrangler d1 execute --remote`):

| action | rows in production |
|---|---:|
| `cron.swept` | 123 |
| `user.updated` | 3 |
| `user.invited` | 3 |
| `booking.refunded` | 2 |
| `booking.paid` | 2 |
| `booking.manual_card_pending` | 1 |

`user.updated` and `user.invited` rows confirm `writeAudit()` is firing from the refactored sites in production. (`email_template.*` rows: 0 returned — expected since the operator hasn't edited templates since the M2 deploy. Code path is verified by static analysis above.)

**Status:** ✓ verified.

---

## 4. `findExistingValidWaiver` cross-route relocation (B4a/4b)

**Code-level (grep verification of imports):**
- `worker/routes/webhooks.js:6`: `import { findExistingValidWaiver } from '../lib/waiverLookup.js';`
- `worker/routes/admin/bookings.js:7`: `import { findExistingValidWaiver } from '../../lib/waiverLookup.js';`

Both flows import from the new `worker/lib/waiverLookup.js` location. The B4b shim re-export in `webhooks.js` was successfully dropped — no `export { findExistingValidWaiver }` remains in the route files.

**Test coverage:**
- `tests/unit/auto-link/*.test.js` — 25 Group D tests passing against the new location.
- `worker/lib/waiverLookup.js` is at 100% coverage per M2 baseline.

**Status:** ✓ verified. Audit §08 #7 cross-route smell fully closed.

---

## 5. Feature-flag substrate (B5a/5b/5c)

**Production runtime evidence:**
- Migration 0021 applied to remote D1.
- `density_compact` seed row exists: `state='user_opt_in'`, `user_opt_in_default=0`.
- Admin route mounted: `/api/admin/feature-flags` returns 401 unauthenticated.
- 34 tests covering `worker/lib/featureFlags.js` (27 lib + 7 readiness).
- 7 tests covering admin route.
- 3 tests covering `setFeatureFlagOverride` client helper.

**Status:** ✓ verified.

---

## 6. Worker auto-deploy on push to main (Workers Builds)

**Production evidence:**
- `curl https://airactionsport.com/api/health` returns `{"ok":true,...}` confirming the M2-merge deploy is live.
- `cron.swept` count of 123 rows confirms the cron is firing on the deployed Worker.

**Status:** ✓ verified.

---

## Summary

All six M2 primitives are working in production. No anomalies. Safe to proceed to M3 batch 1 (local D1 setup).

Items deferred to runtime verification when local D1 exists (Batch 1):
- `<FilterBar>` chip-add/remove + URL-sync + saved-views localStorage in dev mode (currently verified via tests + production AdminFeedback).
- Density toggle live click-through against a local D1 with the user override row.

Both items are already covered by tests + production runtime evidence; the local-D1 versions become available once `scripts/setup-local-d1.sh` lands.

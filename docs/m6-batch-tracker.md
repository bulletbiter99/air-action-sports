# M6 batch tracker

Single-source-of-truth status board for Milestone 6 (Stripe live + damage charge Option A + vendor templates + email drafts). Updated after every PR merge + post-deploy browser-verify.

Last updated: 2026-05-26 (post-B6 + B10 merge; awaiting operator live cutover for B5/B6/B7+ live verification).

## Status table

| Batch | What | PR | Merge SHA | Deploy version | Sandbox verify | Live verify | Docs updated |
|---|---|---|---|---|---|---|---|
| **B0** | Cutover runbook draft + spot-check scaffold + staff labeling polish | [#188](https://github.com/bulletbiter99/air-action-sports/pull/188) | `0206120` | post-B0 | ✓ | n/a | ✓ |
| **B0-followup** | Spot-check populated + cutover runbook column-name fix | [#191](https://github.com/bulletbiter99/air-action-sports/pull/191) | `9da716a` | docs-only | n/a | n/a | ✓ |
| **B1** | Vendor package templates library — list/create/soft-delete | [#189](https://github.com/bulletbiter99/air-action-sports/pull/189) | `f0cd431` | post-B1 | ✓ | n/a | ✓ |
| **B2** | Vendor package templates — detail/edit composer + clone-to-event | [#190](https://github.com/bulletbiter99/air-action-sports/pull/190) | `fd1e3ba` | post-B2 (`a6c147db`) | ✓ | n/a | ✓ |
| **B3** | Email template draft state — schema + worker send-path filter | [#193](https://github.com/bulletbiter99/air-action-sports/pull/193) | `65a6c83` | post-B3 + B4 (`09c58ed1`) | ✓ | n/a | ✓ |
| **B4** | Email template draft state — admin UI + preview-with-real-data | [#194](https://github.com/bulletbiter99/air-action-sports/pull/194) | `f3b845f` | `09c58ed1` | ✓ (12-point matrix passed) | n/a | ✓ |
| **B5** | Stripe `setup_future_usage` off_session on public checkout | [#195](https://github.com/bulletbiter99/air-action-sports/pull/195) | `8a9d3dd` | `ba6545c2` | ✓ (public /booking page renders; flow unchanged) | ⏳ (operator $1 e2e gated on cutover items 1-5) | ✓ |
| **B6** | `charge.dispute.created` webhook consumer | [#196](https://github.com/bulletbiter99/air-action-sports/pull/196) | `db7e7b8` | `518af64a` | ✓ (17/17 tests; idempotency + orphan paths) | ⏳ (no on-demand dispute creation; first real disputed payment is live verify) | ✓ |
| **B7** | Damage charge Option A activation (off-session) | _pending_ | _pending_ | _pending_ | ✓ (28 tests: 10 stripe lib + 18 route; declined / 3DS / 422 fallback / 502 retrieval) | ⏳ (real off-session capture against live PM; needs B5 live cutover + a real saved PM) | ✓ |
| **B8** | Damage charge admin UI polish — Charge card button + confirm modal + error/success banners on /admin/booking-charges | _pending_ | _pending_ | _pending_ | ✓ (build clean; existing 18 route tests cover the wire-up) | ⏳ (live verify needs B5 cutover + a real saved PM to test charge-card flow end-to-end in browser) | ✓ |
| **B9** | Admin action: remove saved payment method | — | — | — | — | — | — |
| **B10** | booking_confirmation template update with "additional charges may apply" copy | [#197](https://github.com/bulletbiter99/air-action-sports/pull/197) | `<merge>` | `954964c3` | ✓ (admin preview renders new "Heads-up" section + Stripe + damage mention; text version includes HEADS-UP block) | ⏳ (next real customer booking exercises live email) | ✓ |
| **B11** | Closing runbooks + decision-register updates | — | — | — | — | — | — |

## Live cutover blocker (B5 → B7 chain)

Five operator-only items gate B5's live e2e + B6/B7/B9's live verification. Full checklist in [`docs/m6-operator-cutover-checklist.md`](m6-operator-cutover-checklist.md).

## Per-batch verification standard

Every B-batch close must hit:
- ✓ Full vitest suite passing (running count updated below per batch)
- ✓ Group A (pricing 79) + Group B (webhook 59) = **138 / 138** regression
- ✓ Lint 0 errors
- ✓ Build clean
- ✓ Migration applied to remote D1 (when applicable)
- ✓ Workers Builds auto-deploy verified via `/api/health` + `wrangler deployments list`
- ✓ Browser-verify the changed surface in Claude_in_Chrome (admin: via `javascript_tool`; public: via screenshot)
- ✓ This tracker + CLAUDE.md M6 section + HANDOFF.md top-of-doc updated

## Test count baseline

| Milestone close point | Count |
|---|---|
| M5.5 close (2026-05-12) | 1997 / 161 |
| M6 B2 close (2026-05-25) | 2135 / 173 |
| M6 B3 close | 2175 / 176 |
| M6 B4 close | 2212 / 178 |
| M6 B5 close | 2231 / 180 |
| M6 B6 close | 2251 / 182 |
| M6 B10 close | **2251 / 182** (no code change in B10) |

## Quirks + lessons specific to M6 (cumulative)

1. **`.schema` is sqlite3 shell, not D1 SQL.** Use `SELECT sql FROM sqlite_master` for table inspection. (B0)
2. **`audit_log` is 7-col** (includes `ip_address`), not 6 as CLAUDE.md M5 note claimed. M2 `writeAudit()` handles both. (B0)
3. **`vendor_package_sections.kind` has a CHECK enum** — JSON normalizers feeding it must coerce to allowed values. (B2)
4. **Helper extraction can be a budget lever between batches.** (B1→B2 pattern)
5. **GitHub Actions anti-recursion** — bot-pushed commits don't auto-fire `pull_request: synchronize`. Push an empty commit to re-trigger. (B3)
6. **Admin pages never go network-idle** — `useWidgetData` cadence + `useTodayActive` shared subscription keep polling. Screenshot helpers time out. Use `javascript_tool` instead. (B4 verification)
7. **`worker/routes/bookings.js` `POST /checkout` returns `stripeUrl`** (not `url`) + `bookingId`. Test fixtures must match. (B5 test author)
8. **`rateLimit` middleware no-ops without `CF-Connecting-IP` header** — tests exercising rate-limit must set the header. (B5 test author)

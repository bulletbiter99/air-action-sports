# Decisions Register

Closes audit open questions and operator-decision-pending placeholders as they're resolved. Newest at top. Reference each entry by its date + short ID when citing in code/PRs.

---

## 2026-05-07 — D03: Audit pain-point #8 closed (lint config)

**Source:** `docs/audit/08-pain-points.md` #8 ("ESLint 9 + plugins declared in package.json but no eslint.config.js exists; lint not blocking in CI").

**Resolution:** Landed in M3 batch 0 task 0a:
- `eslint.config.js` flat config (ESLint recommended + react-hooks legacy rules + react-refresh; v7's new strict purity / set-state rules deliberately not adopted yet)
- `.github/workflows/ci.yml` lint step now blocking (dropped `continue-on-error: true`)
- Five blocking errors fixed; 253 informational warnings remain (deferred react-hooks and unused-vars cleanup; new code held to "no new warnings" by review)

**Status:** ✓ resolved

---

## 2026-05-07 — D02: Audit §08 Section 1 (operator-stated pain points) resolved

**Source:** `docs/audit/08-pain-points.md` Section 1 ("Operator-stated pain points (TBD by operator) — placeholder section").

**Resolution:** Operator declined to expand. The seeded candidate list at `docs/audit/08-pain-points.md` items 2-42 (the 42 code-observable issues) is treated as the ground-truth pain-point inventory. No additional operator-stated items will be added to Section 1.

**Status:** ✓ resolved — Section 1 may be removed in a future docs cleanup; for now it reads "see Section 2 onward" implicitly.

---

## 2026-05-07 — D01: Audit open question #13 (Phase 2 goal) resolved

**Source:** `docs/audit/10-open-questions.md` #13 ("What is the goal of Phase 2 (admin overhaul) — dashboard-first redesign? IA reorganization? Persona-tailored landing screens? Incremental polish?").

**Resolution:** Answered as **A + B + C + incremental** — all four directions in combination, sequenced across milestones:

| Phase 2 milestone | Direction emphasized |
|---|---|
| M2 (closed) | Incremental — shared primitives extraction, cross-route fix, feature-flag substrate |
| M3 (in flight) | C — persona-tailored AdminDashboard (Owner / BC / Marketing / Bookkeeper) + new customers entity (Surface 3) |
| M4 | A — IA reorganization (`/admin/bookings` redesign, sidebar restructure, visual regression suite) |
| M5 | B — staff infrastructure (new cron sweeps, role hierarchy expansion) |
| M6 | Stripe `setup_future_usage` to public booking flow (saves card on first paid booking; enables Surface 3 customer card view) |
| M7 | Reporting (funnel, LTV, segments — populates the Marketing persona widgets stubbed in M3 batch 9) |
| M8 | Closing — final hardening, M3-prep regrets, ROE owner-decision gaps if owner has resolved them by then |

**Status:** ✓ resolved

# The reporting calendar is UTC, not the Denver business calendar

**Status: PARKED (operator decision, 2026-07-27).** Documented, deliberately not
fixed. This is a *policy* question about which calendar the books run on, not a
bug in the sense the rest of the `date_iso` timezone work was — and fixing it
moves numbers the operator has been reconciling against.

Surfaced by the completeness sweep during the `date_iso` timezone series
(PRs #391 + the follow-up). Everything below is code-verified.

---

## The claim

Every financial and reporting surface buckets and windows on the **UTC**
calendar. Air Action Sports operates on the **America/Denver** calendar. During
MDT those disagree for six hours a day; during MST, seven.

Concretely:

- **"MTD" actually begins at 6:00 PM Mountain on the last day of the previous
  month.**
- **A booking paid at 7:00 PM Mountain on the last day of a month lands in the
  NEXT month's revenue bucket.**

The same applies to QTD, YTD, every per-month chart, and the operator's custom
from/to date pickers.

## Why this is NOT the bug that was just fixed

The `date_iso` family had a genuine mismatch: one side of a comparison was naive
Denver wall clock and the other was a real UTC instant, so the two sides
disagreed about what moment they described. That produced contradictions —
reminders at 1:20 AM, an event that was simultaneously "today" and "not today".

This is different. It is **internally consistent**: UTC window boundaries applied
to UTC-bucketed timestamps. Nothing contradicts anything else. Every number
reconciles against every other number. The books are correct — they are just
keeping time in the wrong city.

That is exactly why it is safe to park, and exactly why it is worth fixing
eventually: it will not blow up, it will just quietly misattribute revenue near
month boundaries forever.

## Affected sites (all verified)

| Location | What |
|---|---|
| `worker/lib/reports.js:44-91` | `resolvePeriodWindow` — `Date.UTC(y, m, 1)` for mtd / qtd / ytd |
| `worker/routes/admin/reports.js:76-77` | `parseCustomBounds` — the operator's custom date pickers read as UTC midnight |
| `worker/lib/reports.js` :187, :252, :459, :472, :506, :624, :639, :814, :869 | nine `strftime('%Y-%m', <col>/1000, 'unixepoch')` month buckets |
| `worker/routes/admin/analytics.js:28-30` | `?period=mtd` month start via `getUTCFullYear()` / `getUTCMonth()` |
| `worker/lib/reports.js` (scorecard) | Monday-anchored trailing-13-ISO-week window, UTC-anchored |
| `worker/lib/cashFlow.js` | 13-week forecast bucketing |

Note `analytics.js`'s **deferred-revenue** endpoint was moved to the Denver
calendar in this series, because there the mismatch was the genuine bug class (an
undelivered event's cash flipping to recognized for six hours each evening). That
leaves it deliberately inconsistent with `?period=mtd` in the same file — called
out in a comment there.

## What fixing it would involve

Roughly 15 sites. The shape is the same everywhere: derive period boundaries and
bucket keys from the Denver calendar instead of UTC. `worker/lib/eventTime.js`
already provides `denverDateFor(ms)`; month/quarter/week boundaries would need a
small extension in the same file (and its `src/utils/eventTime.js` mirror if any
client surface needs it).

The work is mechanical. The reason it is parked is not difficulty:

1. **Reported figures will change.** Not by much, and only near boundaries — but
   MTD, QTD, YTD, per-month revenue, the scorecard and the cash-flow forecast
   will all shift slightly. Anyone reconciling against previously-exported
   numbers needs to know the basis changed.
2. **It is an accounting-policy decision**, not a defect report. A business can
   legitimately keep books on UTC as long as it does so consistently, which this
   currently does.
3. **It should not ride along with a bug-fix PR.** Mixing a policy change into a
   correctness change makes both harder to review and harder to revert.

## Recommendation when it is picked up

Do it as its own PR, on a month boundary, with a short note to the operator
stating which figures moved and by how much. Consider exporting a
before/after comparison for the current quarter so the shift is visible rather
than discovered later.

## Related

- `worker/lib/eventTime.js` — the canonical Denver resolver
- memory `reminder-cron-timezone-bug` — the `date_iso` family this was found
  alongside
- [docs/admin-workflow-audit-2026-07.md](admin-workflow-audit-2026-07.md) —
  fully closed 2026-07-28 (all four sprints); read as history

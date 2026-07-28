# The reporting calendar is UTC, not the Denver business calendar

**Status: ✅ CLOSED 2026-07-28 — both parts shipped.** Part 1 (#414) moved the
period windows (mtd/qtd/ytd, the custom date pickers, analytics `?period=mtd`);
part 2 (#416) moved the buckets (the nine monthly charts via
`rollupByDenverMonth`, the scorecard's Denver-Monday weeks, the cash-flow
horizon + its budget day-walk). Every financial surface now windows AND buckets
on the Denver calendar. The rest of this doc is the history + the decisions,
kept because the "why JS not SQL" reasoning and the DST traps stay load-bearing
for any future consumer.

**One adjacent item deliberately NOT converted** (out of the parked scope): the
**daily** sales-series buckets (`date(paid_at/1000,'unixepoch')` in
analytics.js + the revenue-trends daily rows) still bucket on UTC days. Same
6-7h family, smaller stakes (a chart column, not a reconciled month). Convert
with `denverDateFor(ms)` per row if it ever matters.

Originally parked 2026-07-27 as a *policy* question about which calendar the
books run on rather than a bug, because fixing it moves numbers the operator has
been reconciling against. The operator un-parked it on 2026-07-28.

Surfaced by the completeness sweep during the `date_iso` timezone series
(PRs #391 + the follow-up). Everything below is code-verified.

---

## ✅ Measured impact before changing anything: ZERO

Run read-only against production on 2026-07-28, comparing both calendars over
all **83 payments to date** (plus 0 field-rental payments received):

| Check | Result |
|---|---|
| Payments whose month bucket changes | **none** |
| Per-month earned revenue | identical (2026-06 $2010.00, 2026-07 $1860.00) |
| MTD / QTD / YTD totals + booking counts | unchanged |
| Nearest payment to a reattribution band | **6.17h clear of it** |

So the doc's recommendation below to ship on a month boundary and export a
before/after comparison is **moot** — nothing to reconcile, no figure moves.
That is a fact about the CURRENT dataset, not a permanent property: a single
evening sale near a month end reintroduces the exposure.

## ✅ Part 1 — SHIPPED in #414 (2026-07-28)

Calendar **period boundaries** now resolve on the Denver calendar:

- `resolvePeriodWindow` — mtd / qtd / ytd
- `parseCustomBounds` — the operator's from/to date pickers
- `analytics.js` `?period=mtd`

New business-calendar helpers in `worker/lib/eventTime.js` (worker-only, like
`denverWallClockWindow` — no client surface needs them, so the `src/utils`
mirror is deliberately untouched): `denverMonthKey`, `denverDayStartMs`,
`denverAddDays`, `denverDayStartFor`, `denverWeekStartMs`, `denverMonthStartMs`,
`denverQuarterStartMs`, `denverYearStartMs`.

Rolling windows (`last_30d` / `last_90d`) are durations, not calendar
boundaries — deliberately unchanged.

## ✅ Part 2 — SHIPPED in #416 (2026-07-28): the buckets

What was still on the UTC calendar when part 2 started (all converted):

| Location | What |
|---|---|
| `worker/routes/admin/reports.js` :187, :252, :459, :472, :506, :624, :639, :814, :869 | nine `strftime('%Y-%m', <col>/1000, 'unixepoch')` month buckets |
| `worker/routes/admin/reports.js` (scorecard, ~:344) | Monday anchor via `getUTCDay()` + fixed `604800000` week buckets |
| `worker/routes/admin/cashFlow.js` | 13-week forecast week windows (`worker/lib/cashFlow.js` itself is pure — the caller supplies the weeks) |

> Note: an earlier version of this doc placed the nine buckets in
> `worker/lib/reports.js`. They are in `worker/routes/admin/reports.js`; the line
> numbers were right, the file was not.

### Why SQL cannot do this one

D1's SQLite has **no timezone database**, and its `'localtime'` modifier reads
the host process TZ — which in a Worker is UTC, so it is a **silent no-op**
(verified against production). Shifting by one bound offset would leave a
**1-hour** version of the same bug at every winter month boundary, which is the
hardcoded `-06:00` mistake `eventTime.js` exists to refuse.

### Chosen approach (operator-confirmed 2026-07-28, shipped in #416): bucket in JS

Raw rows aggregated in JS: the nine month buckets go through the pure
`rollupByDenverMonth(rows, tsField, spec, keyFields?)` in `worker/lib/reports.js`
(reproduces the old `{month, ...sums}` shape, so the compute helpers stayed
byte-untouched); the scorecard buckets by boundary scan over 13 Denver-Monday
windows; the cash-flow lib walks budget days as Denver calendar dates. Exact
across DST, nothing clever to get wrong. Performance is a non-issue at AAS
volume — the widest of these queries reads 83 bookings / 79 customers lifetime.

The rejected alternative was a DST-aware SQL `CASE` built from transition
instants passed as binds. Also exact and it keeps aggregation server-side, but it
means interpolated SQL, and the real-schema guard
(`tests/unit/schema/workerSql.test.js`) only compiles **static** literals — so it
would silently drop those statements from the guard. Worth revisiting only if
row counts ever make JS aggregation untenable.

### Traps that were confirmed real during part 2 (all pinned by tests)

- **A week grid cannot use fixed `604800000` steps** once anchored to Denver
  Mondays: a DST week is 6d23h or 7d1h, so fixed stepping duplicates or skips a
  week. `denverAddDays(monday, 7)` — pinned by the 13-distinct-Mondays test.
- **A fixed `dayMs += 86400000` walk takes EIGHT steps through the 25-hour
  fall-back week** and allocates a day of budget twice — why the cash-flow lib
  walks calendar dates. Pinned by the exactly-$70-across-that-week test.
- **`Number(null) === 0`** (the M5.5 lesson-#7 quirk) bit `rollupByDenverMonth`
  in authoring: a NULL timestamp coerced to epoch-0 and bucketed into 1969-12.
  Nullish-check before `Number()`; a NULL row is filed NOWHERE.
- **`denverMonthKey` is strict** and returns `null` rather than defaulting to
  now, so a guessed bucket key can never happen. Callers must handle `null`.

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

## Affected sites — ORIGINAL SURVEY (2026-07-27)

Kept as written for provenance. See "Part 1 / Part 2" above for what has since
shipped; the first four rows are **done**, the rest remain.

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

## Recommendation when it is picked up — SUPERSEDED

> Original text: *"Do it as its own PR, on a month boundary, with a short note to
> the operator stating which figures moved and by how much."*
>
> The before/after comparison **was** run (see the top of this doc) and the
> answer was that **nothing moves** — all 83 payments are clear of every
> reattribution band, the nearest by 6.17h. So the month-boundary timing and the
> reconciliation note were unnecessary, and #414 shipped mid-month.
>
> Re-run that comparison before shipping Part 2 if meaningful time has passed:
> the zero-impact result is a property of the current dataset, not of the change.
> The script shape is: pull `paid_at` / `received_at`, compare
> `denverMonthKey(ms)` against `new Date(ms).toISOString().slice(0,7)`, and
> report any row where they differ plus the smallest margin to a band.

## Related

- `worker/lib/eventTime.js` — the canonical Denver resolver
- memory `reminder-cron-timezone-bug` — the `date_iso` family this was found
  alongside
- [docs/admin-workflow-audit-2026-07.md](admin-workflow-audit-2026-07.md) —
  fully closed 2026-07-28 (all four sprints); read as history

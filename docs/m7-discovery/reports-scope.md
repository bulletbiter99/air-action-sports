# M7 Reports — Scope summary (17 reports across 4 personas)

`docs/surfaces/surface-6-reports.md` does NOT exist in the repo as of M7 Batch 0 (verified via Glob). This document provides the scope for M7 Batches 1-5 in lieu of the Phase 3 Surface 6 design doc.

**Source:** M7 milestone prompt; reconciled against schemas captured in `docs/m7-pre-flight-verification.md`.

**Goal:** 17 reports total across 4 personas (Owner / Bookkeeper / Marketing / Site Coordinator) under a unified `/admin/reports` route with persona-aware tab navigation, period selectors (MTD/QTD/YTD/Custom), comparison toggle (vs prior period), event-scope filter (all/specific), and CSV export.

---

## Personas + capabilities

Migration 0062 (Batch 1) seeds these capabilities + bindings:

| Capability | Description |
|---|---|
| `reports.read` | Gates `/admin/reports` nav item |
| `reports.read.owner` | Owner tab visibility |
| `reports.read.bookkeeper` | Bookkeeper tab visibility |
| `reports.read.marketing` | Marketing tab visibility |
| `reports.read.site_coordinator` | Site Coordinator tab visibility |
| `reports.export` | Per-report CSV export button |

**Role preset bundles:**
- `owner`: all `reports.*` capabilities + `reports.export`
- `bookkeeper`: `reports.read` + `reports.read.bookkeeper` + `reports.read.owner` + `reports.export` (also sees Owner tab)
- `marketing_manager`: `reports.read` + `reports.read.marketing` + `reports.export`
- `site_coordinator`: `reports.read` + `reports.read.site_coordinator` + `reports.export`

Personas WITHOUT any reports capability (no nav entry visible): `booking_coordinator`, `generic_manager`, `staff`, `event_director`, `read_only_auditor`. If they navigate to `/admin/reports` directly, layout renders an empty state.

---

## Owner reports (5 — Batch 2)

### 1. Revenue trends (MTD / QTD / YTD)
- **Tables:** `bookings`, `field_rentals`, `field_rental_payments`
- **Query shape:** SUM(total_cents) GROUP BY day/week/month — period-windowed via `paid_at >= window_start AND paid_at <= window_end`
- **Comparison:** vs prior period (same number of days backward)
- **Render:** LineChart over time + delta % vs prior
- **Filter:** all events / specific event
- **Excludes:** `customer_id = '__needs_backfill__'` rows for booking aggregations

### 2. Retention by event series
- **Tables:** `bookings`, `events`
- **Query shape:** % of customers from event series N who also booked event series N+1. Series identification via `events.series` field (M5.5 B2 introduced).
- **Comparison:** vs prior series
- **Render:** BarChart per series + retention %
- **Filter:** all series / specific series

### 3. Refund rate by period
- **Tables:** `bookings`
- **Query shape:** `COUNT(refunded_at IS NOT NULL OR refund_external = 1) / COUNT(status = 'paid')` per period
- **Comparison:** vs prior period
- **Render:** LineChart + MetricCard with delta indicator
- **Note:** counts both Stripe refunds (`refunded_at`) and external refunds (`refund_external = 1`) introduced in M4 B3a

### 4. Repeat customers
- **Tables:** `customers`, `bookings`
- **Query shape:** `customers WHERE total_bookings >= 2` — denormalized field already computed by `recomputeCustomerDenormalizedFields` (M3 B5). Bucket by total_bookings (2-3, 4-9, 10+).
- **Comparison:** vs prior period for new-repeat count
- **Render:** BarChart distribution + MetricCard with % of total
- **Filter:** all / by acquisition year

### 5. AOV trend (Average Order Value)
- **Tables:** `bookings`
- **Query shape:** `AVG(total_cents) WHERE status = 'paid'` per period
- **Comparison:** vs prior period
- **Render:** LineChart + MetricCard
- **Filter:** all events / specific event

---

## Bookkeeper reports (4 — Batch 3)

### 1. Payouts summary
- **Tables:** `bookings`, `field_rental_payments`
- **Query shape:** Cross-payment summary — Stripe payouts (booking-side via `bookings.paid_at` aggregated by week/month) + field rental payments (`field_rental_payments.status = 'received'` grouped by `payment_kind`)
- **Render:** Table with columns: Period | Stripe Gross | Field Rental Gross | Refunds | Net
- **Filter:** by month / by quarter
- **Comparison:** vs prior period

### 2. 1099 thresholds rollup → links to existing M5 page
- **NOT a new report.** Tab content is a deep-link to `/admin/staff/1099-thresholds` (the existing M5 R11 page).
- **Behavior:** When operator clicks the "1099 Thresholds" sub-nav, navigate to existing page rather than duplicate the data here.

### 3. Tax/fee summary by period
- **Tables:** `bookings`, `taxes_fees`, `field_rentals`
- **Query shape:** SUM(tax_cents) + SUM(fee_cents) GROUP BY period, plus JOIN to `taxes_fees` for current rates context
- **Render:** Table per tax/fee type + MetricCard for totals
- **Filter:** by month / by quarter / by year
- **Comparison:** vs prior period

### 4. Period comparison (current vs prior, side-by-side)
- **Tables:** `bookings`
- **Query shape:** Two aggregations side-by-side (current period + prior period of same length) with delta indicators
- **Metrics:** Gross | Refunds | Net | Tax | Fees | Booking count | AOV
- **Render:** Side-by-side table with delta % per row + sparkline per metric
- **Filter:** custom period selection

---

## Marketing reports (4 — Batch 4)

### 1. Conversion funnel by event
- **Tables:** `bookings`, `attendees`
- **Query shape:** Per event — counts for pending bookings → paid bookings → attendees with `checked_in_at IS NOT NULL` → attendees with `checked_in_at` AND `waiver_id IS NOT NULL`
- **Render:** Funnel chart per event with stage-to-stage drop-off rates
- **Filter:** select event(s) / event series

### 2. Promo code performance
- **Tables:** `promo_codes`, `bookings` (via `promo_code_id`)
- **Query shape:** Per promo code — uses, redemptions, total discount given, revenue attributed
- **Render:** Table sortable by uses / revenue / redemption rate
- **Filter:** active / inactive / expired

### 3. Customer cohorts (acquisition month)
- **Tables:** `customers`
- **Query shape:** GROUP BY first_booking acquisition month — show retention curve (% still active per subsequent month after first booking)
- **Render:** Heatmap or stepped LineChart
- **Filter:** by acquisition year range

### 4. Channel attribution
- **Tables:** `bookings.referral` (referral source field; used historically inconsistently)
- **Query shape:** GROUP BY `referral` text values for paid bookings; aggregate revenue + count
- **Render:** Table or pie chart
- **Fallback:** If `bookings.referral` is mostly null (high cardinality test data not yet captured), render empty state with explanation: "Channel attribution requires referral source capture. M8 will extend the booking flow with a Referral field — until then this report shows only manually-tagged historical data."

---

## Site Coordinator reports (4 — Batch 5; NEW from M5.5 persona)

### 1. Field rental revenue by site
- **Tables:** `field_rentals`, `sites`, `field_rental_payments`
- **Query shape:** Per site (Ghost Town / Foxtrot Fields) — SUM(total_cents) for `status = 'paid'`. Per month + per client_type breakdown.
- **Render:** BarChart per site with month-over-month delta + table with site_fee / addons / tax breakdown
- **Filter:** by site / by month / by client_type (individual / business / both)
- **Comparison:** vs prior period

### 2. COI compliance status
- **Tables:** `field_rentals`
- **Query shape:** Counts of active rentals (status NOT IN ('cancelled','refunded','draft','lead') AND archived_at IS NULL) grouped by:
  - COI valid (coi_status='received' AND coi_expires_at > now)
  - Expiring within 30 days
  - Expiring within 60 days
  - Missing (coi_status='not_required' OR coi_status='pending')
  - Expired (coi_status='expired' OR coi_expires_at <= now)
- **Render:** MetricCards (5 statuses) + table of expiring soon with deep-links

### 3. Lead-to-booking conversion rate
- **Tables:** `field_rentals` (status progression)
- **Query shape:** Per period (window by `created_at` of `lead` status) — `lead → quote → contract → agreed → paid` funnel rates
- **Render:** Funnel chart with stage rates + MetricCard per stage
- **Filter:** by period / by site
- **Comparison:** vs prior period

### 4. Recurrence retention
- **Tables:** `field_rental_recurrences`, `field_rentals` (recurrence_id linkage)
- **Query shape:** Per recurrence series — % of expected recurrences still active after 90/180/365 days (active = NOT cancelled, NOT archived, generated_through extending forward)
- **Render:** Per-series MetricCards (90d / 180d / 365d retention %) + table of expired series
- **Filter:** by site / by client_type

---

## Performance budgets (per Phase 4 §6, M7 prompt)

| Surface | Target |
|---|---|
| First report visible | ≤ 800ms p50 / ≤ 1.5s p95 (current production data volumes) |
| All reports settled | ≤ 2.0s p50 / ≤ 3.0s p95 |
| CSV export response | ≤ 3s for up to 10k rows |

**Optimization strategies if budgets miss:**
- Add aggregate tables for hot reports (revenue_trends_daily, etc.) refreshed via cron
- Cache-Control: max-age=60 for reports endpoints (operator-facing; 60s freshness acceptable)
- Defer heavy reports to async background fetch with skeleton state

---

## Persona dashboard integration (out of scope for M7)

M4 persona widgets already surface lightweight versions of some reports (RevenueSummary, RecentFeedback, etc.) on the dashboard. M7 reports are deeper drilldowns; the widgets stay. Future M8 polish: link widgets to corresponding reports via "See full report →" affordances.

---

## Sign-off

Ready for **Batch 1 — Reports infrastructure shell**. Capability seeds drafted above; will be authored in `migrations/0062_reports_capabilities.sql` per Batch 1 plan.

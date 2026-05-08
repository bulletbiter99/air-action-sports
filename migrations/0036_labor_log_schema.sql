-- M5 Batch 10 — Labor log schema (Surface 4b).
--
-- Tracks per-person labor entries for compensation reconciliation.
-- Drives the Schedule & Pay tab on staff detail + the 1099 thresholds
-- rollup. Manual labor entries (not tied to event_staffing) require
-- approval gating per docs/decisions.md (HR self-approval cap $200).

CREATE TABLE labor_entries (
  id              TEXT PRIMARY KEY,                    -- le_<random12>
  person_id       TEXT NOT NULL REFERENCES persons(id),
  -- Source: an entry can come from event_staffing.completed flow OR
  -- be a manual ad-hoc entry by HR
  event_staffing_id TEXT REFERENCES event_staffing(id),
  source          TEXT NOT NULL CHECK (source IN ('event_completion', 'manual_entry', 'adjustment')),
  -- Labor period
  worked_at       INTEGER NOT NULL,                    -- ms; primary date for tax-year bucketing
  hours           REAL,                                -- nullable for per-event flat-rate
  -- Compensation
  pay_kind        TEXT NOT NULL CHECK (pay_kind IN ('w2_hourly', '1099_per_event', '1099_hourly', 'volunteer', 'comp')),
  amount_cents    INTEGER NOT NULL,                    -- 0 allowed for volunteer
  notes           TEXT,
  -- Approval (manual entries above $200 cap require approval)
  approval_required INTEGER NOT NULL DEFAULT 0,
  approved_at     INTEGER,
  approved_by_user_id TEXT REFERENCES users(id),
  rejected_at     INTEGER,
  rejection_reason TEXT,
  -- Payment lifecycle
  paid_at         INTEGER,
  paid_by_user_id TEXT REFERENCES users(id),
  payment_reference TEXT,                              -- venmo / check / ach / etc.
  -- Disputes
  disputed_at     INTEGER,
  disputed_by_user_id TEXT REFERENCES users(id),       -- the person OR an admin
  dispute_note    TEXT,
  resolved_at     INTEGER,
  resolved_by_user_id TEXT REFERENCES users(id),
  resolution_note TEXT,
  -- Metadata
  created_by_user_id TEXT REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  -- Tax year derivation: floor(worked_at to year start) — denormalized
  -- here for fast 1099 threshold rollups (1099 thresholds rollup is
  -- by tax year × pay_kind × person).
  tax_year        INTEGER NOT NULL                     -- e.g. 2026
);
CREATE INDEX idx_labor_entries_person ON labor_entries(person_id);
CREATE INDEX idx_labor_entries_event_staffing ON labor_entries(event_staffing_id);
CREATE INDEX idx_labor_entries_paid ON labor_entries(paid_at);
CREATE INDEX idx_labor_entries_tax_year ON labor_entries(tax_year, person_id, pay_kind);
CREATE INDEX idx_labor_entries_approval ON labor_entries(approval_required, approved_at);

-- Tax year locks: once a year is closed (end of year accounting),
-- no further labor entries can be created or modified for that year.
-- Auto-locks on March 1 of the following year if not done manually.
CREATE TABLE tax_year_locks (
  tax_year        INTEGER PRIMARY KEY,
  locked_at       INTEGER NOT NULL,
  locked_by_user_id TEXT REFERENCES users(id),
  locked_reason   TEXT,                                -- 'manual_close' / 'auto_march_1'
  total_w2_cents  INTEGER NOT NULL DEFAULT 0,          -- snapshot at lock time
  total_1099_cents INTEGER NOT NULL DEFAULT 0,
  notes           TEXT
);

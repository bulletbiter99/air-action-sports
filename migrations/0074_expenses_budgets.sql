-- 0074 — Expenses + Budgets (operating-cost tracking + monthly budgets).
--
-- Foundation for per-event P&L margin, P&L-vs-budget, and cash-flow
-- forecasting. Two additive tables + a `finances` capability pair bound
-- to the owner + bookkeeper presets.
--
-- PRE-MIGRATION SPOT-CHECK (against production air-action-sports-db):
-- - events + users tables exist (M1); bookings carries the earned-revenue
--   columns (total_cents / tax_cents / fee_cents).
-- - capabilities columns: (key, category, description, requires_capability_key, created_at)
--   — the column is `category`, NOT `scope` (D1 quirk #5).
-- - role_preset_capabilities columns: (role_preset_key, capability_key, created_at).
-- - owner + bookkeeper role presets exist (M5 / 0049).
-- - no expenses / budgets tables on remote (clear to create).
--
-- DESIGN NOTES:
-- - category is free TEXT (NO CHECK enum) on purpose: categories can be
--   added/renamed in code without a table rebuild. (D1 cannot ALTER a CHECK
--   without a rebuild, and a rebuild trips FK-enforcement-during-DROP.) The
--   route validates category against the canonical list in
--   worker/routes/admin/finances.js; the client mirrors it.
-- - event_id is a nullable SOFT reference (no FK constraint) — an expense may
--   be tied to one event (per-event P&L) or be general overhead (NULL).
--   Runtime FK enforcement is off anyway; the route validates inputs.
-- - Money in INTEGER cents; all timestamps INTEGER ms epoch.
-- - budgets are keyed UNIQUE on (period, category): one monthly target per
--   category. period is 'YYYY-MM'.
--
-- D1 quirks: no BEGIN/COMMIT (even in comments — the parser keyword-scans);
-- additive CREATE / INSERT only.

CREATE TABLE expenses (
  id            TEXT PRIMARY KEY,
  category      TEXT NOT NULL,
  description   TEXT,
  amount_cents  INTEGER NOT NULL,
  incurred_at   INTEGER NOT NULL,
  vendor        TEXT,
  event_id      TEXT,
  notes         TEXT,
  created_by    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_expenses_incurred ON expenses(incurred_at);
CREATE INDEX idx_expenses_category ON expenses(category);
CREATE INDEX idx_expenses_event ON expenses(event_id);

CREATE TABLE budgets (
  id             TEXT PRIMARY KEY,
  period         TEXT NOT NULL,
  category       TEXT NOT NULL,
  budgeted_cents INTEGER NOT NULL,
  notes          TEXT,
  created_by     TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_budgets_period_category ON budgets(period, category);
CREATE INDEX idx_budgets_period ON budgets(period);

-- Capabilities: finances.read (section gate) + finances.write (mutations).
-- finances.write depends on finances.read via requires_capability_key.
INSERT INTO capabilities (key, category, description, requires_capability_key, created_at) VALUES
  ('finances.read',  'finances', 'View expenses, budgets, and financial reports', NULL,            strftime('%s','now') * 1000),
  ('finances.write', 'finances', 'Create / edit / delete expenses and budgets',   'finances.read', strftime('%s','now') * 1000);

-- Bind both to owner + bookkeeper (the financial-visibility presets).
INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  ('owner',      'finances.read',  strftime('%s','now') * 1000),
  ('owner',      'finances.write', strftime('%s','now') * 1000),
  ('bookkeeper', 'finances.read',  strftime('%s','now') * 1000),
  ('bookkeeper', 'finances.write', strftime('%s','now') * 1000);

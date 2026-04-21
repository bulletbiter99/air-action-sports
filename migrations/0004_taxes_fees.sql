-- Phase 5.75: reusable taxes and fees configurable from admin.
-- Each entry renders as a separate line item internally; the customer
-- booking page collapses them into a single "Taxes & Fees" row.

CREATE TABLE taxes_fees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    short_label TEXT,
    category TEXT NOT NULL CHECK (category IN ('tax', 'fee')),
    percent_bps INTEGER NOT NULL DEFAULT 0,
    fixed_cents INTEGER NOT NULL DEFAULT 0,
    per_unit TEXT NOT NULL DEFAULT 'booking' CHECK (per_unit IN ('booking', 'ticket', 'attendee')),
    applies_to TEXT NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'tickets', 'addons')),
    active INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_taxes_fees_active ON taxes_fees(active, sort_order);

-- Seed three defaults (inactive until admin sets real values).
INSERT INTO taxes_fees (id, name, short_label, category, percent_bps, fixed_cents, per_unit, applies_to, active, sort_order, description, created_at, updated_at) VALUES
('tf_city_tax',        'City Tax',        'City',   'tax', 0,   0,  'booking', 'all', 0, 10, 'Municipal sales tax — set your city rate.',                   unixepoch()*1000, unixepoch()*1000),
('tf_state_tax',       'State Tax',       'State',  'tax', 0,   0,  'booking', 'all', 0, 20, 'State sales tax — set your state rate.',                      unixepoch()*1000, unixepoch()*1000),
('tf_processing_fees', 'Processing Fees', 'Stripe', 'fee', 290, 30, 'booking', 'all', 0, 30, 'Stripe 2.9% + $0.30 passed to customer. Turn off to absorb.', unixepoch()*1000, unixepoch()*1000);

-- Phase 1.5: expanded schema
-- Adds ticket types, per-attendee model, promo codes, email templates,
-- rental equipment tracking, audit log. Modifies events/bookings/waivers.

-- ───── ALTERs on existing tables ─────

ALTER TABLE events ADD COLUMN tax_rate_bps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN pass_fees_to_customer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN cover_image_url TEXT;
ALTER TABLE events ADD COLUMN short_description TEXT;
ALTER TABLE events ADD COLUMN slug TEXT;

ALTER TABLE bookings ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN promo_code_id TEXT;
ALTER TABLE bookings ADD COLUMN fee_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE waivers ADD COLUMN attendee_id TEXT;

-- ───── New tables ─────

CREATE TABLE ticket_types (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id),
    name TEXT NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL,
    capacity INTEGER,
    sold INTEGER NOT NULL DEFAULT 0,
    min_per_order INTEGER NOT NULL DEFAULT 1,
    max_per_order INTEGER,
    sale_starts_at INTEGER,
    sale_ends_at INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_ticket_types_event ON ticket_types(event_id, active, sort_order);

CREATE TABLE attendees (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL REFERENCES bookings(id),
    ticket_type_id TEXT NOT NULL REFERENCES ticket_types(id),
    first_name TEXT NOT NULL,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    qr_token TEXT NOT NULL UNIQUE,
    waiver_id TEXT,
    checked_in_at INTEGER,
    checked_in_by TEXT REFERENCES users(id),
    cancelled_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_attendees_booking ON attendees(booking_id);
CREATE INDEX idx_attendees_ticket_type ON attendees(ticket_type_id);
CREATE INDEX idx_attendees_qr ON attendees(qr_token);

CREATE TABLE promo_codes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    event_id TEXT REFERENCES events(id),
    discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
    discount_value INTEGER NOT NULL,
    max_uses INTEGER,
    uses_count INTEGER NOT NULL DEFAULT 0,
    min_order_cents INTEGER,
    starts_at INTEGER,
    expires_at INTEGER,
    applies_to_json TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    created_by TEXT REFERENCES users(id)
);

CREATE INDEX idx_promo_codes_event ON promo_codes(event_id, active);

CREATE TABLE email_templates (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    variables_json TEXT,
    updated_by TEXT REFERENCES users(id),
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE rental_items (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL,
    serial_number TEXT,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('rifle', 'mask', 'vest', 'magazine', 'battery', 'other')),
    condition TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('new', 'good', 'fair', 'damaged', 'retired')),
    purchase_date TEXT,
    purchase_cost_cents INTEGER,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    retired_at INTEGER
);

CREATE INDEX idx_rental_items_sku ON rental_items(sku, active);
CREATE INDEX idx_rental_items_category ON rental_items(category, active);

CREATE TABLE rental_assignments (
    id TEXT PRIMARY KEY,
    rental_item_id TEXT NOT NULL REFERENCES rental_items(id),
    attendee_id TEXT NOT NULL REFERENCES attendees(id),
    booking_id TEXT NOT NULL REFERENCES bookings(id),
    checked_out_at INTEGER NOT NULL,
    checked_out_by TEXT REFERENCES users(id),
    checked_in_at INTEGER,
    checked_in_by TEXT REFERENCES users(id),
    condition_on_return TEXT CHECK (condition_on_return IN ('good', 'fair', 'damaged', 'lost', NULL)),
    damage_notes TEXT,
    replacement_fee_cents INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_rental_assignments_item ON rental_assignments(rental_item_id, checked_in_at);
CREATE INDEX idx_rental_assignments_attendee ON rental_assignments(attendee_id);
CREATE INDEX idx_rental_assignments_booking ON rental_assignments(booking_id);

CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    meta_json TEXT,
    ip_address TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at);
CREATE INDEX idx_audit_log_target ON audit_log(target_type, target_id);

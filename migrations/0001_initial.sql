-- Air Action Sports — initial schema
-- Phase 1: events, bookings, waivers, users, admin_sessions, inventory_adjustments

CREATE TABLE events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date_iso TEXT NOT NULL,
    display_date TEXT,
    display_day TEXT,
    display_month TEXT,
    location TEXT,
    site TEXT,
    type TEXT,
    time_range TEXT,
    check_in TEXT,
    first_game TEXT,
    end_time TEXT,
    base_price_cents INTEGER NOT NULL,
    total_slots INTEGER NOT NULL,
    addons_json TEXT NOT NULL DEFAULT '[]',
    game_modes_json TEXT NOT NULL DEFAULT '[]',
    details_json TEXT,
    sales_close_at INTEGER,
    published INTEGER NOT NULL DEFAULT 1,
    past INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_events_published_date ON events(published, date_iso);

CREATE TABLE bookings (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    player_count INTEGER NOT NULL,
    line_items_json TEXT NOT NULL,
    subtotal_cents INTEGER NOT NULL,
    tax_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL,
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT,
    referral TEXT,
    created_at INTEGER NOT NULL,
    paid_at INTEGER,
    refunded_at INTEGER,
    cancelled_at INTEGER
);

CREATE INDEX idx_bookings_event_status ON bookings(event_id, status);
CREATE INDEX idx_bookings_email ON bookings(email);
CREATE INDEX idx_bookings_created ON bookings(created_at);
CREATE INDEX idx_bookings_stripe_session ON bookings(stripe_session_id);

CREATE TABLE waivers (
    id TEXT PRIMARY KEY,
    booking_id TEXT REFERENCES bookings(id),
    player_name TEXT NOT NULL,
    dob TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    emergency_name TEXT NOT NULL,
    emergency_phone TEXT NOT NULL,
    relationship TEXT,
    signature TEXT NOT NULL,
    signed_at INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    is_minor INTEGER NOT NULL DEFAULT 0,
    parent_name TEXT,
    parent_relationship TEXT,
    parent_signature TEXT,
    parent_consent INTEGER NOT NULL DEFAULT 0,
    privacy_consent INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_waivers_booking ON waivers(booking_id);
CREATE INDEX idx_waivers_email ON waivers(email);

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
);

CREATE TABLE admin_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT
);

CREATE INDEX idx_sessions_user ON admin_sessions(user_id);
CREATE INDEX idx_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE inventory_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL REFERENCES events(id),
    sku TEXT,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    admin_user_id TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_inv_adj_event ON inventory_adjustments(event_id);

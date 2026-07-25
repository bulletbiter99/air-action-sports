-- Suppress the mistimed 1-hour reminder for the last Operation Fire Storm
-- booking. Applied 2026-07-25 (event day), operator-approved.
--
-- THE BUG (pre-existing, NOT introduced today)
-- --------------------------------------------
-- runReminderSweepWindow (worker/index.js) selects candidates with:
--     AND (unixepoch(e.date_iso) * 1000) BETWEEN ? AND ?
-- events.date_iso stores LOCAL Mountain wall-clock with no timezone suffix
-- ("2026-07-25T08:30:00"), but SQLite's unixepoch() reads a naked ISO datetime
-- as UTC. During MDT (UTC-6) every timed event therefore looks 6 hours earlier
-- than it is, and the reminder windows fire ~6-7 hours early.
--
-- Verified: unixepoch('2026-07-25T08:30:00') = 1784968200 = 08:30 UTC
--           = 2:30 AM MDT, but Operation Last Light actually starts 8:30 AM MDT.
--
-- ALREADY HAPPENED: 18 Last Light bookings received the "T-MINUS 1 HOUR — BOOTS
-- ON THE GROUND / kicks off in about an hour" email at 07:15-07:30 UTC
-- (1:15-1:30 AM MDT), ~7 hours early, while the same email body printed
-- "Check-in: 8:00 AM". Their reminder_1hr_sent_at sentinels are now set and the
-- window can't match again, so they get nothing at the correct time. Not
-- recoverable — noted here as the record of what happened.
--
-- STILL PENDING (what this script prevents): bk_Th57RDmqT0HUUD (John Monroe II,
-- 2 players, Operation Fire Storm, check-in 7:45 PM MDT). Its date_iso
-- 2026-07-25T19:45:00 parses to 19:45 UTC = 1:45 PM MDT, so the sweep would
-- send his "starts in about an hour" email at ~12:45 PM MDT — about 7 hours
-- early. Operator chose to suppress it and contact him directly instead.
--
-- Stamping the sentinel is exactly how the sweep records "already handled"
-- (sentinel-first idempotency), so this is a supported no-side-effect
-- suppression, not a hack. It does NOT affect his booking, waiver, QR code or
-- check-in — only whether this one automated email sends.
--
-- The cron fix itself is deliberately NOT done today: scheduled() is Critical
-- do-not-touch and both events' reminders have already fired, so a fix changes
-- nothing for today. Tracked for the next session.

UPDATE bookings
SET reminder_1hr_sent_at = strftime('%s','now') * 1000
WHERE id = 'bk_Th57RDmqT0HUUD'
  AND event_id = 'ghost-town-18hr-milsim'
  AND status = 'paid'
  AND reminder_1hr_sent_at IS NULL;   -- guard: no-op if it already fired

INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
VALUES (
  'u_HGjSvaIWPIBl',
  'booking.reminder_suppressed',
  'booking',
  'bk_Th57RDmqT0HUUD',
  '{"reminder":"1hr","reason":"cron_timezone_bug_would_send_7h_early","event_id":"ghost-town-18hr-milsim","event_check_in_local":"7:45 PM MDT","would_have_sent_utc":"~18:45","root_cause":"unixepoch(events.date_iso) reads local wall-clock as UTC in runReminderSweepWindow","operator_action":"contacting the customer directly instead","applied_via":"scripts/suppress-firestorm-1hr-reminder.sql"}',
  strftime('%s','now') * 1000
);

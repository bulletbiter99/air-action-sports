-- Phase 2: holds attendee data from checkout form until Stripe webhook confirms payment.
-- Webhook parses this JSON and creates proper attendee rows.
ALTER TABLE bookings ADD COLUMN pending_attendees_json TEXT;

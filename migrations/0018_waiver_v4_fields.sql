-- Phase B: extend the waivers table to capture the additional fields
-- promised by Waiver Document v4.
--
-- New fields:
--   medical_conditions                    optional free text (PDF page 8)
--   age_tier                              '12-15' | '16-17' | '18+'
--                                         (computed from dob, stored explicit
--                                         so we can audit which policy applied)
--   parent_phone_day_of_event             phone we can reach parent on event day
--   parent_initials                       parent acknowledges the age-tier policy
--   supervising_adult_name                ON-SITE supervising adult — REQUIRED
--                                         only when age_tier='12-15'. May or may
--                                         not be the same person as the parent.
--   supervising_adult_signature           typed signature for the on-site adult
--   supervising_adult_relationship        e.g. "uncle", "family friend"
--   supervising_adult_phone_day_of_event  phone reach on event day
--   jury_trial_initials                   separate initials per Waiver §22
--   claim_period_expires_at               ms epoch; = signed_at + 365 days
--                                         drives the "do they need to re-sign?"
--                                         check on incoming bookings (Phase C).
--
-- All new columns are nullable so existing signed waivers (4 smoke/dogfood
-- rows on wd_v1) survive the migration without touching them.

ALTER TABLE waivers ADD COLUMN medical_conditions TEXT;
ALTER TABLE waivers ADD COLUMN age_tier TEXT;
ALTER TABLE waivers ADD COLUMN parent_phone_day_of_event TEXT;
ALTER TABLE waivers ADD COLUMN parent_initials TEXT;
ALTER TABLE waivers ADD COLUMN supervising_adult_name TEXT;
ALTER TABLE waivers ADD COLUMN supervising_adult_signature TEXT;
ALTER TABLE waivers ADD COLUMN supervising_adult_relationship TEXT;
ALTER TABLE waivers ADD COLUMN supervising_adult_phone_day_of_event TEXT;
ALTER TABLE waivers ADD COLUMN jury_trial_initials TEXT;
ALTER TABLE waivers ADD COLUMN claim_period_expires_at INTEGER;

-- Index for the Phase C "do they have a non-expired waiver?" lookup.
-- We'll match on (lower(email), lower(player_name)) → claim_period_expires_at,
-- so the index covers email + player_name first, expiry second.
CREATE INDEX IF NOT EXISTS idx_waivers_claim_lookup
    ON waivers(email, player_name, claim_period_expires_at);

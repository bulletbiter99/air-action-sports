-- 0077_reviews.sql
-- Attendee-verified post-event reviews.
--
-- Each paid/comp booking gets a daily-cron-emailed "rate your game" link ~24h
-- after the event ends; possessing the unguessable link IS proof of attendance.
-- ONE review per booking (the buyer reviews for their group). Reviews AUTO-PUBLISH
-- on submit; admins with reviews.moderate hide/restore via /admin/reviews. They
-- feed a REAL aggregateRating (replacing the fabricated 4.9/50), home testimonials,
-- per-event detail pages, and a dedicated /reviews page.
--
-- SEPARATE concern from the feedback table (internal bug/idea triage). Own table.
-- Mirrors feedback's moderation + honeypot + writeAudit + ip-hash posture.
--
-- This is Batch 1 of the reviews feature (operator applies this migration ALONE;
-- the consuming code lands in later batches). Full design + the 28 red-team
-- findings it resolves are in docs/reviews-feature-spec.md.
--
-- ============================================================
-- PRE-MIGRATION SPOT-CHECK (run read-only --command on remote before applying)
-- ============================================================
--   SELECT sql FROM sqlite_master
--     WHERE name IN ('bookings','events','email_templates','capabilities',
--                    'role_presets','role_preset_capabilities');
-- Verified against migrations 0001/0002/0031/0056/0073/0076 (this session):
--   - bookings: id TEXT PK (bk_*), event_id, full_name, email,
--       status IN ('pending','paid','comp','refunded','cancelled'),
--       paid_at/refunded_at/cancelled_at INTEGER, plus the
--       reminder_sent_at / reminder_1hr_sent_at sentinel precedent.
--       No review_* columns yet (grep confirmed).
--   - events: id PK, slug, title, date_iso TEXT NOT NULL (HAS a time component),
--       end_date_iso TEXT NULL (0076; NULL = single-day), display_date, published.
--   - email_templates: id TEXT PK, slug TEXT NOT NULL UNIQUE, subject NOT NULL,
--       body_html NOT NULL, body_text, variables_json, updated_by,
--       updated_at NOT NULL, created_at NOT NULL,
--       status TEXT NOT NULL DEFAULT 'published' (0056).
--       => Lesson #7: id='tpl_<slug>', slug='<slug>', created_at=updated_at in MS.
--   - capabilities: (key, category, description, requires_capability_key, created_at)
--       — column is `category`, NOT `scope` (D1 quirk #5). VERIFIED in 0031.
--   - role_preset_capabilities: (role_preset_key, capability_key, created_at),
--       PK(role_preset_key, capability_key); role_preset_key REFERENCES
--       role_presets(key) — runtime FK on INSERT.
--       VALID preset keys (grep of every role_presets seed): owner, event_director,
--       booking_coordinator, marketing_manager, bookkeeper, site_coordinator,
--       hr_coordinator, compliance_reviewer, read_only_auditor, event_day_*,
--       staff_legacy.
--       *** 'generic_manager' / 'manager' are NOT preset keys (a persona value,
--           0028) — binding to them would FK-abort the whole INSERT. NOT used. ***
--
-- ============================================================
-- D1 quirks (per CLAUDE.md) honored
-- ============================================================
-- - All bookings changes are additive ADD COLUMN (nullable) — no table-rebuild,
--   so the FK-enforcement-on-DROP trap (quirk #2 / column-rename) does NOT apply.
-- - reviews is a brand-new CREATE TABLE with NO outbound FKs — can never trip the
--   rebuild trap on a future migration, and won't block a booking hard-delete.
-- - No manual BEGIN/COMMIT (D1 wraps each statement).
-- - The email_templates INSERT is Lesson #7 compliant (id/slug/created_at-ms).

-- ───── 1. reviews table ─────
-- One row per SUBMITTED review (rows are created on submit, never pre-created at
-- invite time — the token lives on bookings.review_token, so a row's mere
-- existence means it was submitted). The SINGLE shared visibility predicate used
-- by the public route, the SSR JSON-LD injectors, and the admin average is:
--   status = 'published'.
-- created_at = the submit instant.
CREATE TABLE reviews (
    id TEXT PRIMARY KEY,                       -- rv_<14 base62>
    event_id TEXT NOT NULL,                    -- denormalized from the booking at submit
    booking_id TEXT NOT NULL,                  -- the reviewing booking (one review per booking)
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title TEXT,                                -- optional headline (raw text; escaped at render)
    comment TEXT,                              -- optional body (raw text; escaped at render)
    author_name TEXT NOT NULL,                 -- public DISPLAY name; default first + last-initial
    email TEXT,                                -- buyer email at submit (audit/contact; NEVER public)
    verified INTEGER NOT NULL DEFAULT 1,       -- 1 = arrived via the emailed token. Always 1 in v1.
    status TEXT NOT NULL DEFAULT 'published'   -- 'published' | 'hidden'
        CHECK (status IN ('published','hidden')),
    hidden_at INTEGER,                         -- admin takedown ms (NULL = never hidden)
    hidden_reason TEXT,                        -- admin note (audit trail)
    hidden_by TEXT,                            -- admin users.id who hid it
    edit_count INTEGER NOT NULL DEFAULT 0,     -- author edits applied (hard cap, abuse guard)
    ip_hash TEXT,                              -- abuse forensics (hashed like feedback)
    created_at INTEGER NOT NULL,               -- submit instant, ms
    updated_at INTEGER NOT NULL                -- ms
);

-- ONE-REVIEW-PER-BOOKING is a schema invariant, not just an app convention.
-- The submit route does INSERT ... ON CONFLICT(booking_id) DO UPDATE (edit path)
-- or 409; this index is the hard backstop against a double-submit / token-replay race.
CREATE UNIQUE INDEX idx_reviews_booking_unique ON reviews(booking_id);

-- Per-event visible feed + aggregate: WHERE event_id=? AND status='published'.
CREATE INDEX idx_reviews_event_status ON reviews(event_id, status, created_at);

-- Site-wide visible feed (home / /reviews / org aggregate): WHERE status='published'.
CREATE INDEX idx_reviews_status_recent ON reviews(status, created_at);

-- ───── 2. bookings token + cron sentinel (additive, nullable, no backfill) ─────
-- review_token: unguessable per-booking secret minted by the 03:00 cron at invite
-- time (sentinel-first). Possession proves attendance. Nullable + no backfill —
-- only bookings that get an invite ever carry one (mirrors the reminder_sent_at /
-- reminder_1hr_sent_at sentinel precedent). Partial UNIQUE skips NULLs.
ALTER TABLE bookings ADD COLUMN review_token TEXT;

-- review_invite_sent_at: the idempotency SENTINEL for runReviewInviteSweep.
-- NULL = invite not yet sent. Stamped sentinel-FIRST, rolled back on send failure.
ALTER TABLE bookings ADD COLUMN review_invite_sent_at INTEGER;

CREATE UNIQUE INDEX idx_bookings_review_token
    ON bookings(review_token) WHERE review_token IS NOT NULL;

CREATE INDEX idx_bookings_review_invite_pending
    ON bookings(review_invite_sent_at, status);

-- ───── 3. review_invite email template (Lesson #7 compliant) ─────
-- variables_json names MUST match the {{tokens}} in the body AND the sender's
-- vars object exactly: player_name, event_name, event_date, review_link.
INSERT INTO email_templates (
    id, slug, subject, body_html, body_text, variables_json,
    updated_by, updated_at, created_at
) VALUES (
    'tpl_review_invite',
    'review_invite',
    'How was {{event_name}}? Drop a quick rating',
    '<div style="font-family:system-ui,sans-serif;background:#1a1c18;color:#f2ede4;padding:32px;max-width:600px;margin:0 auto;">
<div style="color:#d4541a;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">&#9632; Rate Your Game</div>
<h1 style="font-size:24px;margin:8px 0 24px;">How was it out there, {{player_name}}?</h1>
<p>Thanks for rolling out to <strong>{{event_name}}</strong> on {{event_date}}. A 30-second rating helps other players know what to expect &mdash; and helps us run a better op next time.</p>
<p style="margin:28px 0;"><a href="{{review_link}}" style="display:inline-block;background:#d4541a;color:#fff;padding:14px 28px;text-decoration:none;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:13px;">&#9733; Rate {{event_name}}</a></p>
<p style="color:#6b7560;font-size:12px;">This link is just for your booking &mdash; one rating per booking, and it&#39;s only for you, so please don&#39;t forward it. Your name shows as first name + last initial by default; you can change it on the form.</p>
<p style="color:#6b7560;font-size:12px;margin-top:24px;"><strong style="color:#d4541a;">&mdash; Air Action Sports</strong></p>
</div>',
    'RATE YOUR GAME — {{event_name}}

How was it out there, {{player_name}}?

Thanks for rolling out to {{event_name}} on {{event_date}}. A 30-second rating helps other players know what to expect — and helps us run a better op next time.

Rate {{event_name}}: {{review_link}}

This link is just for your booking — one rating per booking, and it''s only for you, so please don''t forward it. Your name shows as first name + last initial by default; you can change it on the form.

— Air Action Sports',
    '["player_name","event_name","event_date","review_link"]',
    NULL,
    1782604800000,
    1782604800000
);

-- ───── 4. reviews.moderate capability + bindings ─────
-- Reading reviews is PUBLIC (no cap). Only takedown/restore is gated. Standalone
-- (no requires_capability_key), matching feedback's moderation posture.
INSERT INTO capabilities (key, category, description, requires_capability_key, created_at) VALUES
  ('reviews.moderate',
   'reviews',
   'Hide / take down or restore published event reviews (admin moderation)',
   NULL,
   strftime('%s','now') * 1000);

-- VALID preset keys only (owner + the two manager-tier ops presets). NOT
-- generic_manager (no such preset; the FK would abort the whole INSERT).
INSERT INTO role_preset_capabilities (role_preset_key, capability_key, created_at) VALUES
  ('owner',               'reviews.moderate', strftime('%s','now') * 1000),
  ('event_director',      'reviews.moderate', strftime('%s','now') * 1000),
  ('booking_coordinator', 'reviews.moderate', strftime('%s','now') * 1000);

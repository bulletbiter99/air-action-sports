-- Polish: per-event custom questions asked of each attendee at booking.
-- Event stores the question schema (array of {key, label, type, required, options, sortOrder}).
-- Attendee stores the answers keyed by question.key.

ALTER TABLE events ADD COLUMN custom_questions_json TEXT;
ALTER TABLE attendees ADD COLUMN custom_answers_json TEXT;

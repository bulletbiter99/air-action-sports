// Pure helpers for the email-template status field introduced in M6 B3
// (migration 0056). These are stateless predicates + validators — DB
// fetching with the draft filter lives in worker/lib/templates.js
// loadTemplate(db, slug, { includeDrafts }).
//
// Why pure helpers instead of bundling with the route? Two reasons:
//   1. M6 B4's admin UI for the status toggle wants the same validation
//      surface — keeping it here avoids duplicating the enum.
//   2. Future milestones may add a third value (e.g. 'archived'); the
//      single source of truth is the STATUS_VALUES array below.

export const STATUS_VALUES = Object.freeze(['draft', 'published']);

export const DEFAULT_STATUS = 'published';

// True iff the row has no status field at all (legacy, pre-M6 B3) OR
// has status='published'. Returns false for explicit 'draft' or any
// other unrecognized value (defensive — an unknown status is treated
// as not-sendable).
export function isPublishedTemplate(row) {
    if (!row || typeof row !== 'object') return false;
    if (row.status === undefined || row.status === null) return true;
    return row.status === 'published';
}

// True iff `value` is one of the recognized enum strings. Casing and
// whitespace are NOT normalized — the caller is responsible for
// normalizing input before validation (so the validator stays predictable
// for round-trips of stored values).
export function isValidStatus(value) {
    return typeof value === 'string' && STATUS_VALUES.includes(value);
}

// Trim + lowercase + validate. Returns the canonical value on success,
// null on invalid input. Use this on user-supplied status strings from
// the admin route's PUT body.
export function normalizeStatus(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase();
    return STATUS_VALUES.includes(trimmed) ? trimmed : null;
}

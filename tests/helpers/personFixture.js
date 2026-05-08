// M5 Batch 4 — fixture + helpers for admin staff route tests.
//
// Mirrors the M2 adminBookingFixture pattern: pre-binds mockD1 handlers
// for the persons table query shapes the staff routes issue, plus the
// capability-system queries that requireCapability invokes.

/**
 * Returns a default persons row matching the M5 0030 schema.
 */
export function defaultPerson(overrides = {}) {
    const now = Date.now();
    return {
        id: 'prs_test_001',
        user_id: 'u_test_admin',
        full_name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '5551234567',
        preferred_name: null,
        pronouns: null,
        mailing_address_ciphertext: null,
        compensation_kind: null,
        compensation_rate_cents: null,
        notes: null,
        notes_sensitive: null,
        status: 'active',
        archived_at: null,
        archived_reason: null,
        hired_at: now - 30 * 86400000,
        separated_at: null,
        created_at: now - 30 * 86400000,
        updated_at: now,
        ...overrides,
    };
}

/**
 * Binds the capability-system handlers required by requireCapability.
 * Caller passes a `capabilities` array — the handler returns it as
 * the role_preset_capabilities query result so the user's effective
 * cap set matches what the test wants to assert.
 */
export function bindCapabilities(db, userId, capabilities, roleResetKey = 'event_director') {
    db.__on(/FROM users WHERE id = \?/, {
        id: userId,
        role: 'owner',
        role_preset_key: roleResetKey,
    }, 'first');
    db.__on(/FROM role_preset_capabilities WHERE role_preset_key = \?/, {
        results: capabilities.map((c) => ({ capability_key: c })),
    }, 'all');
    db.__on(/FROM user_capability_overrides/, { results: [] }, 'all');
    // capabilities table dependency lookup (used by userHasCapability)
    db.__on(/FROM capabilities WHERE key = \?/, {
        key: 'placeholder',
        requires_capability_key: null,
    }, 'first');
}

/**
 * Binds default GET-list handlers (count + rows). Pass an array of
 * person rows that the LIST query should return.
 */
export function bindStaffList(db, persons, total = persons.length) {
    db.__on(/SELECT COUNT\(\*\) AS n FROM persons/, { n: total }, 'first');
    db.__on(/SELECT p\.id, p\.user_id/, { results: persons }, 'all');
}

/**
 * Binds detail-endpoint handlers: persons SELECT + person_roles + person_tags.
 */
export function bindStaffDetail(db, person, roles = [], tags = []) {
    db.__on(/SELECT \* FROM persons WHERE id = \?/, person, 'first');
    db.__on(/FROM person_roles pr/, { results: roles }, 'all');
    db.__on(/FROM person_tags WHERE person_id = \?/, { results: tags }, 'all');
}

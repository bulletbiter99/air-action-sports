// M5 Batch 2 — Users helpers, primarily the legacy-role -> role_preset
// mapping used during the migration window.
//
// Why this lives separately from worker/lib/auth.js: auth.js is on the
// do-not-touch high-tier list (handles auth). This file is additive and
// admin-only (no public surface), so it stays out of the gated path.

/**
 * Maps the legacy users.role enum to the M5 role_preset_key. Used by:
 *   - worker/routes/admin/users.js (M5 B3 backfill) when assigning a
 *     preset to existing users
 *   - The persons backfill script (scripts/backfill-persons.js M5 B3)
 *     when inferring a primary role for the persons row from the user
 *
 * The mapping is deliberately conservative — owner / manager users get
 * the closest M5 preset, but the operator can review and reassign post-
 * backfill if a user actually fits a richer preset (e.g., Bookkeeper
 * was previously a generic 'manager').
 *
 *   owner   -> 'event_director'   (closest match for a single-admin org)
 *   manager -> 'booking_coordinator' (most generic Tier-1 op preset)
 *   staff   -> 'staff_legacy'     (preserves M4 zero-capability default)
 *
 * @param {string|null|undefined} legacyRole
 * @returns {string} role_preset_key, or 'staff_legacy' for unknown roles
 */
export function legacyRoleToRolePreset(legacyRole) {
    if (!legacyRole) return 'staff_legacy';
    switch (legacyRole) {
        case 'owner':
            return 'event_director';
        case 'manager':
            return 'booking_coordinator';
        case 'staff':
            return 'staff_legacy';
        default:
            return 'staff_legacy';
    }
}

/**
 * Migrates a single user row to an explicit role_preset_key based on
 * their legacy role. Idempotent: if role_preset_key is already set,
 * the function returns early without modification.
 *
 * Usage:
 *   const result = await migrateUserToRolePreset(env, userId);
 *   // result: { migrated: true, fromRole: 'owner', toPreset: 'event_director' }
 *           // OR { migrated: false, reason: 'already_assigned' }
 *
 * @param {object} env - Worker env
 * @param {string} userId
 * @returns {Promise<{ migrated: boolean, fromRole?: string, toPreset?: string, reason?: string }>}
 */
export async function migrateUserToRolePreset(env, userId) {
    if (!env?.DB || !userId) {
        return { migrated: false, reason: 'invalid_input' };
    }

    const user = await env.DB
        .prepare('SELECT id, role, role_preset_key FROM users WHERE id = ?')
        .bind(userId)
        .first()
        .catch(() => null);
    if (!user) return { migrated: false, reason: 'user_not_found' };

    if (user.role_preset_key) {
        return { migrated: false, reason: 'already_assigned', toPreset: user.role_preset_key };
    }

    const targetPreset = legacyRoleToRolePreset(user.role);

    await env.DB
        .prepare('UPDATE users SET role_preset_key = ? WHERE id = ?')
        .bind(targetPreset, userId)
        .run();

    return { migrated: true, fromRole: user.role, toPreset: targetPreset };
}

/**
 * Migrates every user that lacks a role_preset_key. Returns a summary
 * with counts. Used by M5 B3's bulk migration step.
 *
 * @param {object} env
 * @returns {Promise<{ migrated: number, alreadyAssigned: number, errors: number, breakdown: object }>}
 */
export async function migrateAllUsersToRolePresets(env) {
    if (!env?.DB) {
        return { migrated: 0, alreadyAssigned: 0, errors: 1, breakdown: {} };
    }

    let users;
    try {
        users = await env.DB
            .prepare('SELECT id, role, role_preset_key FROM users')
            .all();
    } catch {
        return { migrated: 0, alreadyAssigned: 0, errors: 1, breakdown: {} };
    }

    const summary = {
        migrated: 0,
        alreadyAssigned: 0,
        errors: 0,
        breakdown: {},
    };

    for (const user of users.results || []) {
        if (user.role_preset_key) {
            summary.alreadyAssigned += 1;
            continue;
        }

        try {
            const targetPreset = legacyRoleToRolePreset(user.role);
            await env.DB
                .prepare('UPDATE users SET role_preset_key = ? WHERE id = ?')
                .bind(targetPreset, user.id)
                .run();
            summary.migrated += 1;
            summary.breakdown[targetPreset] = (summary.breakdown[targetPreset] || 0) + 1;
        } catch {
            summary.errors += 1;
        }
    }

    return summary;
}

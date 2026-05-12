// M5 Batch 3 — runtime helpers that mirror scripts/backfill-persons.js
// for new user creation. When an admin invites a user (worker/routes/admin/users.js
// invitation-accept flow), createPersonForUser() runs immediately so every
// new user lands with a corresponding persons row + primary role assignment.
//
// Idempotent: if a persons row already exists for the user_id, returns
// the existing row without modification.

import { writeAudit } from '../../lib/auditLog.js';

/**
 * Mirrors scripts/backfill-persons.js legacyRoleToPersonRoleId. Kept inline
 * here (not imported from the CLI script) because Cloudflare Workers
 * cannot load the `node:*` modules that script's CLI portion pulls in
 * (node:child_process, node:fs, etc.). Duplicating 13 lines of a pure
 * switch is cheaper than the coupling.
 */
function legacyRoleToPersonRoleId(legacyRole) {
    if (!legacyRole) return null;
    switch (legacyRole) {
        case 'owner':
            return 'role_event_director';
        case 'manager':
            return 'role_booking_coordinator';
        case 'staff':
            return 'role_check_in_staff';
        default:
            return null;
    }
}

/**
 * Generates a 12-char random alphanumeric ID with the given prefix.
 * Same shape as worker/lib/ids.js but kept inline here so the public
 * personsHelpers surface doesn't pull in the gated ids module.
 */
function randomPersonId(prefix) {
    const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let out = '';
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) {
        out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return `${prefix}_${out}`;
}

/**
 * Creates a persons row for a user, plus a person_roles row marking the
 * primary role inferred from legacy users.role. Audit-logs the creation.
 *
 * Idempotent: returns the existing person row if one is already linked
 * to the user_id. Returns null on insufficient input or DB failure.
 *
 * @param {object} env - Worker env binding (env.DB)
 * @param {object} user - { id, role, email, display_name }
 * @param {object} [options]
 * @param {string} [options.actorUserId] - The admin who triggered the create (for audit_log.actor_user_id)
 * @returns {Promise<{ person_id: string, role_id: string|null, alreadyExists: boolean } | null>}
 */
export async function createPersonForUser(env, user, options = {}) {
    if (!env?.DB || !user?.id) return null;

    const existing = await env.DB
        .prepare('SELECT id FROM persons WHERE user_id = ? LIMIT 1')
        .bind(user.id)
        .first()
        .catch(() => null);
    if (existing?.id) {
        return { person_id: existing.id, role_id: null, alreadyExists: true };
    }

    const roleId = legacyRoleToPersonRoleId(user.role);
    const personId = randomPersonId('prs');
    const now = Date.now();

    try {
        await env.DB
            .prepare(
                `INSERT INTO persons (id, user_id, full_name, email, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'active', ?, ?)`
            )
            .bind(
                personId,
                user.id,
                user.display_name || user.email || user.id,
                user.email || null,
                now,
                now,
            )
            .run();
    } catch {
        return null;
    }

    if (roleId) {
        try {
            await env.DB
                .prepare(
                    `INSERT INTO person_roles (id, person_id, role_id, is_primary, effective_from, created_at)
                     VALUES (?, ?, ?, 1, ?, ?)`
                )
                .bind(randomPersonId('pr'), personId, roleId, now, now)
                .run();
        } catch {
            // Role assign failed (perhaps role catalog not yet seeded). The
            // persons row is still created; operator can assign role later.
        }
    }

    // Audit log — best effort, via the shared writeAudit helper (uses the
    // 6-col shape matching the production audit_log schema: AUTOINCREMENT
    // id, user_id, meta_json).
    try {
        await writeAudit(env, {
            userId: options.actorUserId || null,
            action: 'person.created_via_invite',
            targetType: 'person',
            targetId: personId,
            meta: { user_id: user.id, primary_role: roleId },
        });
    } catch {
        /* audit best-effort */
    }

    return { person_id: personId, role_id: roleId, alreadyExists: false };
}

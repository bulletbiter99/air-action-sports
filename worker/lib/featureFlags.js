// Feature-flag substrate. Backed by feature_flags + feature_flag_user_overrides
// tables (migration 0021_feature_flags.sql).
//
// Four flag states (CHECK constraint on the `state` column):
//   off          — always false
//   on           — always true
//   user_opt_in  — falls through to feature_flag_user_overrides if a row
//                  exists for (flag_key, user_id); otherwise to
//                  user_opt_in_default
//   role_scoped  — true if user.role is in the comma-separated role_scope
//                  list; false otherwise
//
// Graceful "table doesn't exist yet" handling: between Worker deploy and
// `npx wrangler d1 migrations apply`, the tables may not exist on the
// remote D1. The reader functions (isEnabled, listFlags) catch
// "no such table" SQLite errors and return safe defaults (false / []).
// The writer (setUserOverride) re-throws such errors loudly so the
// operator can see the migration is unapplied. This pattern lets the
// Worker deploy ahead of the migration without breaking — the visible
// UI feature (e.g. the density toggle) just stays hidden until the
// tables exist.
//
// Audit-log emission for setUserOverride is the route handler's
// responsibility (B5b), not this lib's. Keeping the lib pure of side
// effects beyond the SQL it issues.

function isTableMissingError(err) {
    if (!err || typeof err.message !== 'string') return false;
    return err.message.includes('no such table');
}

/**
 * Returns whether `flagKey` is enabled for `user`.
 *
 * @param {object} env       - { DB } worker env
 * @param {string} flagKey   - flag identifier
 * @param {object|null} user - { id, role } or null (unauthenticated)
 * @returns {Promise<boolean>}
 */
export async function isEnabled(env, flagKey, user) {
    if (!flagKey) return false;

    let flag;
    try {
        flag = await env.DB.prepare(
            `SELECT key, state, user_opt_in_default, role_scope
             FROM feature_flags
             WHERE key = ?`,
        )
            .bind(flagKey)
            .first();
    } catch (err) {
        if (isTableMissingError(err)) return false;
        throw err;
    }

    if (!flag) return false;

    if (flag.state === 'off') return false;
    if (flag.state === 'on') return true;

    if (flag.state === 'role_scoped') {
        if (!user || !user.role) return false;
        const allowedRoles = String(flag.role_scope || '')
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean);
        return allowedRoles.includes(user.role);
    }

    if (flag.state === 'user_opt_in') {
        const defaultEnabled = Boolean(flag.user_opt_in_default);
        if (!user || !user.id) return defaultEnabled;

        let override;
        try {
            override = await env.DB.prepare(
                `SELECT enabled
                 FROM feature_flag_user_overrides
                 WHERE flag_key = ? AND user_id = ?`,
            )
                .bind(flagKey, user.id)
                .first();
        } catch (err) {
            if (isTableMissingError(err)) return defaultEnabled;
            throw err;
        }

        if (override) return Boolean(override.enabled);
        return defaultEnabled;
    }

    // Unknown state — fail safe to false.
    return false;
}

/**
 * Returns all flags scoped to `user`'s perspective. Each entry includes
 * the resolved boolean (computed via the same logic as isEnabled).
 *
 * NOTE: N+1 query — one row-list query plus one per-flag override
 * lookup via isEnabled. Acceptable for M2 (1 seeded flag); revisit if
 * flag count grows large.
 *
 * @param {object} env
 * @param {object|null} user
 * @returns {Promise<Array<{ key, description, state, enabled }>>}
 */
export async function listFlags(env, user) {
    let result;
    try {
        result = await env.DB.prepare(
            `SELECT key, description, state, user_opt_in_default, role_scope
             FROM feature_flags
             ORDER BY key`,
        ).all();
    } catch (err) {
        if (isTableMissingError(err)) return [];
        throw err;
    }

    const rows = (result && result.results) || [];
    const out = [];
    for (const row of rows) {
        const enabled = await isEnabled(env, row.key, user);
        out.push({
            key: row.key,
            description: row.description,
            state: row.state,
            enabled,
        });
    }
    return out;
}

/**
 * Sets a user's per-flag override. INSERT OR REPLACE upserts.
 * Throws if feature_flag_user_overrides table doesn't exist (intentional
 * — writes can't degrade gracefully, and a failed write tells the
 * operator the migration is unapplied).
 *
 * @param {object} env
 * @param {string} flagKey
 * @param {string} userId
 * @param {boolean} enabled
 * @returns {Promise<{ changes: number }>}
 */
export async function setUserOverride(env, flagKey, userId, enabled) {
    if (!flagKey) throw new Error('setUserOverride: flagKey is required');
    if (!userId) throw new Error('setUserOverride: userId is required');

    const now = Date.now();
    const result = await env.DB.prepare(
        `INSERT OR REPLACE INTO feature_flag_user_overrides
            (flag_key, user_id, enabled, set_at)
         VALUES (?, ?, ?, ?)`,
    )
        .bind(flagKey, userId, enabled ? 1 : 0, now)
        .run();

    return { changes: result?.meta?.changes ?? 0 };
}

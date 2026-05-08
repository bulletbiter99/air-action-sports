// M5 Batch 2 — DB-backed capability check.
//
// Replaces the M4 stub. Looks up a user's effective capabilities by:
//   1. Joining users.role_preset_key -> role_preset_capabilities -> capabilities
//   2. Applying user_capability_overrides on top (granted=1 adds, granted=0 removes)
//   3. Falling back to LEGACY_ROLE_CAPABILITIES if the user has role_preset_key=NULL
//      (preserves M4 behavior for un-migrated users)
//
// API:
//   listCapabilities(env, userId)         — async; full effective capability set
//   userHasCapability(env, userId, key)   — async DB check; walks dependency chain
//   hasCapability(user, key)              — sync; checks user.capabilities array
//                                            populated by requireCapability or
//                                            an explicit pre-load step
//   requireCapability(key)                — Hono middleware factory; analogous
//                                            to requireRole; lazy-loads capability
//                                            set on first call per request
//
// Caching: per-request, attached to c.get('user').capabilities. Once a route
// uses requireCapability or explicitly calls listCapabilities, subsequent
// hasCapability calls in the same request use the cached array.

// ────────────────────────────────────────────────────────────────────
// Legacy fallback — preserves M4 stub behavior
// ────────────────────────────────────────────────────────────────────
//
// Users with role_preset_key=NULL (pre-M5 backfill) get this mapping.
// Mirrors the M4 ROLE_CAPABILITIES exactly so M4 behavior is preserved
// during the migration window. M5 Batch 3 backfills role_preset_key for
// every existing user, after which this fallback exits production use
// (kept in code as a safety net for any future user without a preset).
const LEGACY_ROLE_CAPABILITIES = {
    owner: [
        'bookings.read.pii',
        'bookings.email',
        'bookings.export',
        'bookings.refund',
        'bookings.refund.external',
    ],
    manager: [
        'bookings.read.pii',
        'bookings.email',
        'bookings.export',
        'bookings.refund',
        'bookings.refund.external',
    ],
    staff: [],
};

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Loads the effective capability list for a user (async; DB-backed).
 *
 * Order:
 *   1. If users.role_preset_key is set, join role_preset_capabilities.
 *   2. If NULL, fall back to LEGACY_ROLE_CAPABILITIES[users.role].
 *   3. Apply user_capability_overrides (granted=1 add, granted=0 remove).
 *
 * Defensive: graceful when the M5 capability tables don't exist yet (the
 * migration hasn't been applied to the local D1 fixture under wrangler dev).
 * In that case, returns the legacy fallback.
 *
 * @param {object} env - Worker env binding (env.DB)
 * @param {string} userId
 * @returns {Promise<string[]>} effective capability keys
 */
export async function listCapabilities(env, userId) {
    if (!env || !env.DB || !userId) return [];

    const user = await env.DB
        .prepare('SELECT id, role, role_preset_key FROM users WHERE id = ?')
        .bind(userId)
        .first()
        .catch(() => null);
    if (!user) return [];

    const result = new Set();

    if (user.role_preset_key) {
        try {
            const rows = await env.DB.prepare(
                'SELECT capability_key FROM role_preset_capabilities WHERE role_preset_key = ?'
            ).bind(user.role_preset_key).all();
            for (const r of rows.results || []) {
                result.add(r.capability_key);
            }
        } catch {
            // Table missing (migration 0031 not applied locally) — fall through
            // to legacy mapping below.
        }
    }

    // If we got nothing from the preset path (NULL preset key OR table
    // missing), fall back to the legacy role mapping. Both situations
    // converge on the M4 behavior.
    if (result.size === 0) {
        const legacyCaps = LEGACY_ROLE_CAPABILITIES[user.role] || [];
        for (const c of legacyCaps) result.add(c);
    }

    // Apply per-user overrides on top.
    try {
        const overrides = await env.DB.prepare(
            'SELECT capability_key, granted FROM user_capability_overrides WHERE user_id = ?'
        ).bind(userId).all();
        for (const o of overrides.results || []) {
            if (o.granted === 1) result.add(o.capability_key);
            else result.delete(o.capability_key);
        }
    } catch {
        // user_capability_overrides table missing — no overrides apply.
    }

    return [...result];
}

/**
 * Async DB check. Use this when you need a guarded check outside a Hono
 * middleware chain (e.g., from a script or a one-off route). Walks the
 * capability dependency chain — if X requires Y, X is held only if both
 * are in the user's effective list.
 *
 * @param {object} env
 * @param {string} userId
 * @param {string} capabilityKey
 * @returns {Promise<boolean>}
 */
export async function userHasCapability(env, userId, capabilityKey) {
    if (!env || !env.DB || !userId || !capabilityKey) return false;
    const caps = await listCapabilities(env, userId);
    if (!caps.includes(capabilityKey)) return false;

    // Dependency chain walk (e.g., bookings.refund requires bookings.read.pii? — current
    // schema doesn't enforce that one but generally walking the chain is correct).
    try {
        const dependency = await env.DB.prepare(
            'SELECT requires_capability_key FROM capabilities WHERE key = ?'
        ).bind(capabilityKey).first();
        if (dependency?.requires_capability_key) {
            // Recurse on the dependency (depth-1 walk; chains are short).
            return userHasCapability(env, userId, dependency.requires_capability_key);
        }
    } catch {
        // capabilities table missing — assume no dependency. Caller's check
        // already passed against the legacy or preset list, which is the
        // best we can do.
    }
    return true;
}

/**
 * Sync check. Used by routes that have already pre-loaded the user's
 * capabilities array (via requireCapability middleware or an explicit
 * `user.capabilities = await listCapabilities(env, user.id)`).
 *
 * Falls back to the legacy role mapping if user.capabilities is undefined,
 * preserving M4 behavior for any caller that hasn't migrated to the new
 * pattern yet.
 *
 * @param {object|null|undefined} user - { role?, capabilities? }
 * @param {string} capability
 * @returns {boolean}
 */
export function hasCapability(user, capability) {
    if (!user || !capability) return false;

    if (Array.isArray(user.capabilities)) {
        return user.capabilities.includes(capability);
    }

    // Legacy fallback: no capabilities array on the user object yet.
    if (user.role) {
        const caps = LEGACY_ROLE_CAPABILITIES[user.role] || [];
        return caps.includes(capability);
    }

    return false;
}

/**
 * Hono middleware factory — analogous to requireRole. Returns 403 with
 * the missing capability key if the user doesn't hold it. Lazy-loads
 * the capability list onto c.get('user').capabilities so subsequent
 * synchronous hasCapability checks in the same request hit the cache.
 *
 * Usage:
 *   bookings.post('/:id/refund', requireCapability('bookings.refund'), async (c) => {...})
 *
 * @param {string} capabilityKey
 * @returns {(c: any, next: () => Promise<void>) => Promise<any>}
 */
export function requireCapability(capabilityKey) {
    return async (c, next) => {
        const user = c.get('user');
        if (!user) return c.json({ error: 'Not authenticated' }, 401);

        if (!Array.isArray(user.capabilities)) {
            user.capabilities = await listCapabilities(c.env, user.id);
            c.set('user', user);
        }

        if (!user.capabilities.includes(capabilityKey)) {
            return c.json({
                error: 'Forbidden',
                requiresCapability: capabilityKey,
            }, 403);
        }
        await next();
    };
}

/**
 * Backward-compat alias for the M4 stub's userCapabilities() — returns the
 * sync legacy-mapping list for a user object. Frontend callers that read
 * /api/admin/auth/me should switch to the async listCapabilities + send
 * the array down with the user payload, but until then this preserves the
 * M4 import surface.
 *
 * @param {object|null|undefined} user
 * @returns {string[]}
 */
export function userCapabilities(user) {
    if (!user) return [];
    if (Array.isArray(user.capabilities)) return [...user.capabilities];
    if (user.role) return [...(LEGACY_ROLE_CAPABILITIES[user.role] || [])];
    return [];
}

// Test-only export.
export { LEGACY_ROLE_CAPABILITIES as __LEGACY_ROLE_CAPABILITIES };

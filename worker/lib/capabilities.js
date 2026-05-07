// Capability stub for the M3-era 3-role hierarchy (owner / manager / staff).
//
// M5 will formalize the role hierarchy (per-role capability lists, possibly
// per-user overrides, formal capability admin UI). Until then, this module
// gives the M4 codebase a single import point for capability checks so the
// M5 refactor doesn't have to chase down hardcoded `user.role === 'owner'`
// checks across the route layer.
//
// Capabilities introduced in M4:
//   bookings.read.pii           — see full email + phone on booking detail
//                                  (D05 — Marketing role, when M5 ships, lacks this)
//   bookings.email              — send emails (resend confirmation / waiver)
//   bookings.export             — CSV export of filter result
//   bookings.refund             — Stripe refund
//   bookings.refund.external    — out-of-band refund (cash/venmo/paypal/comp/waived)
//
// Owner + Manager have all 5; staff has none. When M5 introduces the
// Marketing role, the role→capability map here will add an entry for
// marketing with `bookings.email` + `bookings.export` only (no `.pii`,
// no `.refund.*`).

const ROLE_CAPABILITIES = {
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

/**
 * Returns true when `user` has `capability`. Defensive against null user
 * (returns false). Defensive against unknown role (returns false — staff-
 * equivalent default rather than implicit owner-grant).
 *
 * @param {{ role?: string } | null | undefined} user
 * @param {string} capability
 * @returns {boolean}
 */
export function hasCapability(user, capability) {
    if (!user || !user.role || !capability) return false;
    const caps = ROLE_CAPABILITIES[user.role];
    if (!caps) return false;
    return caps.includes(capability);
}

/**
 * Returns the full list of capabilities for `user`'s role. Used by the
 * frontend when it needs to gate visibility client-side. Returns [] for
 * unknown role or null user.
 *
 * @param {{ role?: string } | null | undefined} user
 * @returns {string[]}
 */
export function userCapabilities(user) {
    if (!user || !user.role) return [];
    return [...(ROLE_CAPABILITIES[user.role] || [])];
}

// Test-only: exposes the static map. M5 will replace this with a DB-
// backed query, at which point the test should rewrite to mock that.
export { ROLE_CAPABILITIES as __ROLE_CAPABILITIES };

// Phase C annual-renewal lookup. Find a non-expired signed waiver matching
// this attendee's email + full name (lowercased + whitespace-collapsed). If
// found, the attendee skips the waiver step entirely. Returns the waiver id
// or null. Designed to be cheap — covered by idx_waivers_claim_lookup.
//
// Match identity: (email, full_name). Two siblings booking with the same
// parent's email but different names get different waivers (correct). One
// person rebooking with the same email + name gets their existing waiver
// linked (correct).
//
// Relocated from worker/routes/webhooks.js in M2 batch 4a (Phase 2 cleanup
// of the cross-route import smell from audit §08 #7 — admin/bookings.js
// imported into a public-route file). Function body is verbatim from the
// pre-relocation source; no behavior change. Group D's 25 characterization
// tests in tests/unit/auto-link/ gate this file's behavior.

export async function findExistingValidWaiver(db, email, firstName, lastName, asOfMs) {
    if (!email) return null;
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    if (!fullName) return null;
    const normEmail = email.trim().toLowerCase();
    const normName = fullName.toLowerCase().replace(/\s+/g, ' ');
    const row = await db.prepare(
        `SELECT id FROM waivers
         WHERE LOWER(TRIM(email)) = ?
           AND LOWER(TRIM(player_name)) = ?
           AND claim_period_expires_at IS NOT NULL
           AND claim_period_expires_at > ?
         ORDER BY signed_at DESC
         LIMIT 1`
    ).bind(normEmail, normName, asOfMs).first();
    return row?.id || null;
}

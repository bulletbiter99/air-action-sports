// M5 R10 — labor entry helpers.
//
// Pure helpers (taxYearOf, requiresApproval, classifyStatus,
// computeTotalsByTaxYear) are exported for testability. I/O wrappers
// (getEntriesForPerson, recomputePersonAggregates) consume env.DB.
//
// Decision register #54: HR self-approval cap is $200 — manual entries
// above the cap require an approving capability holder before payment.

const SELF_APPROVAL_CAP_CENTS = 20000;

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Returns the UTC year of the given ms timestamp. Used for the
 * tax_year denormalized column on labor_entries.
 */
export function taxYearOf(workedAtMs) {
    if (workedAtMs == null) return null;
    return new Date(workedAtMs).getUTCFullYear();
}

/**
 * Returns true if a manual entry's amount exceeds the HR self-approval
 * cap. event_completion entries always pass through (cap doesn't apply
 * because they're system-generated from event RSVPs, not ad-hoc entries).
 */
export function requiresApproval({ source, amountCents, capCents = SELF_APPROVAL_CAP_CENTS }) {
    if (source !== 'manual_entry') return false;
    if (amountCents == null || amountCents <= capCents) return false;
    return true;
}

/**
 * Pure: classify a labor entry row into a single user-facing status.
 * Priority order: rejected > disputed > paid > approved > pending_approval > recorded.
 */
export function classifyStatus(entry) {
    if (!entry) return 'unknown';
    if (entry.rejected_at) return 'rejected';
    if (entry.disputed_at && !entry.resolved_at) return 'disputed';
    if (entry.paid_at) return 'paid';
    if (entry.approved_at) return 'approved';
    if (entry.approval_required && !entry.approved_at) return 'pending_approval';
    return 'recorded';
}

/**
 * Rollup an array of labor_entries rows by tax year. Returns an object
 * keyed by tax_year with paidCents, unpaidCents, and entry counts. Used
 * by the 1099 thresholds rollup view + the Schedule & Pay tab summary.
 */
export function computeTotalsByTaxYear(entries) {
    const out = {};
    if (!Array.isArray(entries)) return out;
    for (const e of entries) {
        const year = e.tax_year ?? taxYearOf(e.worked_at);
        if (year == null) continue;
        if (!out[year]) {
            out[year] = {
                taxYear: year,
                paidCents: 0,
                unpaidCents: 0,
                pendingApprovalCount: 0,
                disputedCount: 0,
                totalEntries: 0,
            };
        }
        out[year].totalEntries++;
        if (e.paid_at) {
            out[year].paidCents += e.amount_cents || 0;
        } else if (!e.rejected_at) {
            out[year].unpaidCents += e.amount_cents || 0;
        }
        if (e.approval_required && !e.approved_at && !e.rejected_at) {
            out[year].pendingApprovalCount++;
        }
        if (e.disputed_at && !e.resolved_at) {
            out[year].disputedCount++;
        }
    }
    return out;
}

// ────────────────────────────────────────────────────────────────────
// I/O wrappers
// ────────────────────────────────────────────────────────────────────

/**
 * Fetch all labor entries for a person, ordered by worked_at desc.
 * Used by the Schedule & Pay tab.
 */
export async function getEntriesForPerson(env, personId) {
    const rows = await env.DB.prepare(
        `SELECT * FROM labor_entries WHERE person_id = ? ORDER BY worked_at DESC`,
    ).bind(personId).all();
    return rows.results || [];
}

/**
 * Recompute denormalized fields on the persons row from this person's
 * labor entries. Idempotent: safe to call multiple times. Currently
 * recomputes:
 *   - persons.lifetime_pay_cents (sum of paid amounts)
 *   - persons.last_paid_at (max paid_at timestamp)
 *
 * Schema additions for these denormalized columns ship in a future
 * migration; this helper writes only when those columns exist (it's
 * a no-op pre-migration). Returns the computed values.
 */
export async function recomputePersonAggregates(env, personId) {
    const rows = await env.DB.prepare(
        `SELECT amount_cents, paid_at FROM labor_entries WHERE person_id = ? AND paid_at IS NOT NULL`,
    ).bind(personId).all();

    let lifetimePayCents = 0;
    let lastPaidAt = 0;
    for (const r of rows.results || []) {
        lifetimePayCents += r.amount_cents || 0;
        if (r.paid_at && r.paid_at > lastPaidAt) lastPaidAt = r.paid_at;
    }
    if (lastPaidAt === 0) lastPaidAt = null;

    // Best-effort UPDATE: tolerate missing columns (pre-future-migration).
    try {
        await env.DB.prepare(
            `UPDATE persons SET lifetime_pay_cents = ?, last_paid_at = ?, updated_at = ?
             WHERE id = ?`,
        ).bind(lifetimePayCents, lastPaidAt, Date.now(), personId).run();
    } catch (err) {
        // The persons table doesn't have these columns yet — that's expected.
        // We compute the values for callers anyway; the UPDATE is just a
        // forward-compat write. Log to surface schema gaps without crashing.
        console.warn('persons aggregate UPDATE skipped (columns may be missing):', err?.message);
    }

    return { personId, lifetimePayCents, lastPaidAt };
}

// Re-export the cap so tests + UI can reference the same constant.
export { SELF_APPROVAL_CAP_CENTS };

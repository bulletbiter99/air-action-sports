// M3 Batch 10 — system tag computation + nightly cron sweep.
//
// Tags live in customer_tags with tag_type ∈ {'manual', 'system'}.
//   'manual' tags are admin-set via the customer detail UI (future
//            B-batch / M4 work); the cron NEVER touches these.
//   'system' tags are computed from each customer's denormalized
//            booking aggregates (lifetime_value_cents, total_bookings,
//            first_booking_at, last_booking_at) and fully refreshed
//            on every cron tick.
//
// Refresh strategy: clear-and-reinsert. The cron deletes ALL system
// tags in one statement, then re-inserts every customer's current
// system-tag set in a single db.batch() so the operation is atomic.
// This is O(customers × tags-per-customer) writes per sweep — fine
// for the current production size (low single digits), and
// acceptable up to ~hundreds of customers. At thousands+ we'd want
// to compute the delta against the existing rows instead; B10 ships
// the simple variant and leaves the optimization marker in
// docs/decisions.md scope.
//
// Sweep schedule: 03:00 UTC nightly (per wrangler.toml triggers.crons).
// The 15-minute reminder cron runs separately and does not touch tags.

// Tunable thresholds — kept as named constants so the test file can
// reference the same values.
export const TAG_THRESHOLDS = {
    // Lifetime value over $500 → 'vip'.
    VIP_LTV_CENTS: 50000,
    // 5 or more bookings (regardless of status) → 'frequent'.
    FREQUENT_BOOKINGS: 5,
    // Last booking 180+ days ago AND has at least one booking → 'lapsed'.
    LAPSED_DAYS: 180,
    // First booking within last 30 days → 'new'.
    NEW_DAYS: 30,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Computes the set of system tags for a single customer based on
 * their denormalized aggregate fields.
 *
 * Pure function — no I/O. The cron sweep below applies the result.
 *
 * @param {object} customer - row from customers table (snake_case columns)
 * @param {number} now - current time in ms epoch
 * @returns {string[]} ordered, deduplicated tag list
 */
export function computeSystemTags(customer, now) {
    if (!customer) return [];
    const tags = [];

    const ltv = Number(customer.lifetime_value_cents || 0);
    if (ltv > TAG_THRESHOLDS.VIP_LTV_CENTS) tags.push('vip');

    const bookings = Number(customer.total_bookings || 0);
    if (bookings >= TAG_THRESHOLDS.FREQUENT_BOOKINGS) tags.push('frequent');

    const lastAt = Number(customer.last_booking_at || 0);
    if (
        bookings > 0 &&
        lastAt > 0 &&
        now - lastAt > TAG_THRESHOLDS.LAPSED_DAYS * DAY_MS
    ) {
        tags.push('lapsed');
    }

    const firstAt = Number(customer.first_booking_at || 0);
    if (
        firstAt > 0 &&
        now - firstAt <= TAG_THRESHOLDS.NEW_DAYS * DAY_MS
    ) {
        tags.push('new');
    }

    return tags;
}

/**
 * Cron sweep — clears every system tag and re-inserts the current
 * computed set for every active (non-archived) customer.
 *
 * Returns a summary object suitable for the cron.swept audit row's
 * meta_json so the operator can see how much work was done.
 *
 * @param {object} env - worker env (uses env.DB)
 * @param {{ now?: number }} [opts] - injection seam for tests
 * @returns {Promise<{ customersProcessed: number, tagsInserted: number, durationMs: number }>}
 */
export async function runCustomerTagsSweep(env, opts = {}) {
    const startedAt = Date.now();
    const now = opts.now ?? startedAt;

    const result = await env.DB.prepare(
        `SELECT id, lifetime_value_cents, total_bookings,
                first_booking_at, last_booking_at
         FROM customers
         WHERE archived_at IS NULL`,
    ).all();
    const customers = result?.results || [];

    // Build the batch: one DELETE for all system tags, then one INSERT
    // per (customer, tag). db.batch wraps the whole thing in an atomic
    // operation so a partial failure leaves customer_tags in either the
    // pre-sweep state or the fully-refreshed state — never half-applied.
    const statements = [
        env.DB.prepare(`DELETE FROM customer_tags WHERE tag_type = 'system'`),
    ];
    let tagsInserted = 0;

    for (const c of customers) {
        const tags = computeSystemTags(c, now);
        for (const tag of tags) {
            statements.push(
                env.DB.prepare(
                    `INSERT INTO customer_tags (customer_id, tag, tag_type, created_at, created_by)
                     VALUES (?, ?, 'system', ?, NULL)`,
                ).bind(c.id, tag, now),
            );
            tagsInserted += 1;
        }
    }

    if (typeof env.DB.batch === 'function') {
        await env.DB.batch(statements);
    } else {
        // mockD1 in tests doesn't implement batch; fall through to
        // sequential .run() so the wrapper is still exercisable.
        for (const stmt of statements) {
            await stmt.run();
        }
    }

    return {
        customersProcessed: customers.length,
        tagsInserted,
        durationMs: Date.now() - startedAt,
    };
}

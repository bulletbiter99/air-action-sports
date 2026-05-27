// Marketing milestone Batch 1 — customer segment filter engine.
//
// Filter spec → SQL translation for the segments table (created in
// migration 0022, type='customer_segment'). The spec lives in
// segments.query_json and locks the contract for B2 (campaigns) +
// B5 (automations) to consume.
//
// query_json shape (versioned for forward-compat):
//
//   {
//     "v": 1,
//     "tags": {
//       "any": ["vip", "frequent"],   // (any of these tags)
//       "all": [],                     // (all of these tags)
//       "none": ["lapsed"]             // (none of these tags)
//     },
//     "ltvCents":      { "min": 50000, "max": null },
//     "totalBookings": { "min": 1,     "max": null }
//   }
//
// CONTRACT RULES (locked in B1):
//   - Top-level `v: 1` is mandatory. Reader rejects unknown versions
//     with 400. Bumping `v` requires a migration story for B2 readers.
//   - All criteria AND-combined at the top level.
//   - Within `tags`: ANY OF any AND ALL OF all AND NONE OF none.
//     Empty arrays = clause omitted entirely.
//   - ltvCents / totalBookings each accept min / max independently
//     (inclusive). Either can be null/omitted.
//   - The helper ALWAYS appends `customers.email_marketing = 1 AND
//     customers.archived_at IS NULL`. This is non-overridable in v1.
//   - Unknown top-level keys are ignored (forward-compat).
//
// CACHE FIELDS (post-write side):
//   `query_json._cache = { count, at }` may be stored by previewSegmentCount
//   after a preview hit, so the list page can show "47 customers" without
//   re-running COUNT for every row. Underscore prefix signals "computed,
//   not configured" — the validator ignores _cache.
//
// Tests: tests/unit/lib/segments.test.js
// Routes: worker/routes/admin/segments.js

const SUPPORTED_VERSIONS = new Set([1]);

/**
 * Validate + normalize an incoming filter spec from the admin UI or
 * a stored row's query_json. Returns { valid: true, normalized } or
 * { valid: false, error }.
 *
 * @param {any} rawSpec
 * @returns {{valid: true, normalized: object} | {valid: false, error: string}}
 */
export function validateFilterSpec(rawSpec) {
    let spec = rawSpec;
    if (typeof spec === 'string') {
        try { spec = JSON.parse(spec); } catch { return { valid: false, error: 'query_json is not valid JSON' }; }
    }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
        return { valid: false, error: 'query must be an object' };
    }
    if (!SUPPORTED_VERSIONS.has(Number(spec.v))) {
        return { valid: false, error: `unsupported segment version: ${spec.v} (expected v=1)` };
    }

    const out = { v: 1, tags: { any: [], all: [], none: [] }, ltvCents: {}, totalBookings: {} };

    if (spec.tags) {
        if (typeof spec.tags !== 'object' || Array.isArray(spec.tags)) {
            return { valid: false, error: 'tags must be an object' };
        }
        for (const k of ['any', 'all', 'none']) {
            const arr = spec.tags[k];
            if (arr === undefined) continue;
            if (!Array.isArray(arr)) {
                return { valid: false, error: `tags.${k} must be an array` };
            }
            for (const t of arr) {
                if (typeof t !== 'string' || !t.trim()) {
                    return { valid: false, error: `tags.${k} entries must be non-empty strings` };
                }
                out.tags[k].push(t.trim());
            }
        }
    }

    for (const field of ['ltvCents', 'totalBookings']) {
        const range = spec[field];
        if (!range) continue;
        if (typeof range !== 'object' || Array.isArray(range)) {
            return { valid: false, error: `${field} must be an object` };
        }
        for (const bound of ['min', 'max']) {
            if (range[bound] == null) continue;
            const n = Number(range[bound]);
            if (!Number.isFinite(n) || n < 0) {
                return { valid: false, error: `${field}.${bound} must be a non-negative number` };
            }
            out[field][bound] = Math.floor(n);
        }
        if (out[field].min != null && out[field].max != null && out[field].min > out[field].max) {
            return { valid: false, error: `${field}.min (${out[field].min}) cannot exceed ${field}.max (${out[field].max})` };
        }
    }

    return { valid: true, normalized: out };
}

/**
 * Build a SELECT for a validated spec. Caller chooses the projection
 * via `selectClause` (e.g. 'COUNT(*) AS n' for preview, full columns
 * for resolution). Returns { sql, binds }.
 *
 * The enforced clauses (email_marketing = 1 AND archived_at IS NULL)
 * are appended FIRST so the rest of the WHERE accumulates with AND.
 *
 * @param {object} spec - validated filter object (output of validateFilterSpec)
 * @param {{selectClause?: string}} [opts]
 * @returns {{sql: string, binds: any[]}}
 */
export function buildSegmentSql(spec, { selectClause = 'COUNT(*) AS n' } = {}) {
    const binds = [];
    const where = [
        'customers.email_marketing = 1',
        'customers.archived_at IS NULL',
    ];

    if (spec?.tags?.any?.length) {
        const placeholders = spec.tags.any.map(() => '?').join(',');
        where.push(`EXISTS (SELECT 1 FROM customer_tags ct
            WHERE ct.customer_id = customers.id AND ct.tag IN (${placeholders}))`);
        binds.push(...spec.tags.any);
    }

    if (spec?.tags?.all?.length) {
        // One EXISTS per tag — keeps the simple list-page query
        // single-pass; avoids the GROUP BY + HAVING rewrite for
        // small tag counts (typical: 1-3 required tags).
        for (const t of spec.tags.all) {
            where.push(`EXISTS (SELECT 1 FROM customer_tags ct
                WHERE ct.customer_id = customers.id AND ct.tag = ?)`);
            binds.push(t);
        }
    }

    if (spec?.tags?.none?.length) {
        const placeholders = spec.tags.none.map(() => '?').join(',');
        where.push(`NOT EXISTS (SELECT 1 FROM customer_tags ct
            WHERE ct.customer_id = customers.id AND ct.tag IN (${placeholders}))`);
        binds.push(...spec.tags.none);
    }

    if (spec?.ltvCents?.min != null) { where.push('customers.lifetime_value_cents >= ?'); binds.push(spec.ltvCents.min); }
    if (spec?.ltvCents?.max != null) { where.push('customers.lifetime_value_cents <= ?'); binds.push(spec.ltvCents.max); }
    if (spec?.totalBookings?.min != null) { where.push('customers.total_bookings >= ?'); binds.push(spec.totalBookings.min); }
    if (spec?.totalBookings?.max != null) { where.push('customers.total_bookings <= ?'); binds.push(spec.totalBookings.max); }

    const sql = `SELECT ${selectClause} FROM customers WHERE ${where.join(' AND ')}`;
    return { sql, binds };
}

/**
 * Run a COUNT preview against D1 and return the matched-customer count.
 * Used by the list page (per-row cached count) + the create/edit modal
 * (live preview as filters change).
 *
 * @param {object} db - D1 binding
 * @param {object} spec - validated filter
 * @returns {Promise<number>}
 */
export async function previewSegmentCount(db, spec) {
    const { sql, binds } = buildSegmentSql(spec, { selectClause: 'COUNT(*) AS n' });
    const row = await db.prepare(sql).bind(...binds).first();
    return Number(row?.n ?? 0);
}

/**
 * Resolve a segment to a paginated customer list. Each row is the
 * id-email-name-LTV summary the UI needs to render the sample.
 *
 * @param {object} db
 * @param {object} spec - validated filter
 * @param {{limit?: number, offset?: number}} [opts]
 * @returns {Promise<{customers: Array<object>}>}
 */
export async function resolveSegmentToCustomerList(db, spec, { limit = 50, offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const { sql: baseSql, binds } = buildSegmentSql(spec, {
        selectClause: 'customers.id, customers.email, customers.name, customers.lifetime_value_cents, customers.total_bookings',
    });
    const finalSql = `${baseSql} ORDER BY customers.lifetime_value_cents DESC LIMIT ? OFFSET ?`;
    const result = await db.prepare(finalSql).bind(...binds, safeLimit, safeOffset).all();
    return {
        customers: (result.results || []).map((r) => ({
            id: r.id,
            email: r.email,
            name: r.name,
            lifetimeValueCents: r.lifetime_value_cents,
            totalBookings: r.total_bookings,
        })),
    };
}

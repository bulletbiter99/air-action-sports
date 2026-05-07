// writeAudit — single helper for INSERT INTO audit_log writes.
//
// Replaces the duplicated raw INSERT pattern across 19 admin / webhook /
// waiver call sites identified in audit §08 #15. M2 batch 2 refactors 5
// of those sites; the remaining 14 are touched by their respective
// milestones (M3 customers writes, M5 staff/incidents writes).
//
// Two SQL shapes exist in the codebase:
//
//   6-col (most admin routes):
//     INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
//     VALUES (?, ?, ?, ?, ?, ?)
//
//   7-col (webhook + waiver routes — they capture the request IP):
//     INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
//     VALUES (?, ?, ?, ?, ?, ?, ?)
//
// The helper picks the shape based on whether `ipAddress` is provided.
// Pass `ipAddress: null` to use the 7-col shape with NULL; omit
// `ipAddress` (or pass undefined) to use the 6-col shape.
//
// Action strings ARE preserved verbatim from existing call sites — the
// `/admin/audit-log` filter dropdown derives its options from distinct
// existing `action` values (per docs/audit/06-do-not-touch.md High tier
// `audit_log` D1 table protocol).

export async function writeAudit(env, config) {
    const { userId, action, targetType, targetId, meta, ipAddress } = config || {};

    if (!action || typeof action !== 'string') {
        throw new Error('writeAudit: action is required and must be a string');
    }
    if (!env || !env.DB) {
        throw new Error('writeAudit: env.DB is required');
    }

    const metaJson = meta === null || meta === undefined ? null : JSON.stringify(meta);
    const now = Date.now();

    let result;
    if (ipAddress === undefined) {
        // 6-col shape (admin routes)
        result = await env.DB.prepare(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        )
            .bind(
                userId ?? null,
                action,
                targetType ?? null,
                targetId ?? null,
                metaJson,
                now,
            )
            .run();
    } else {
        // 7-col shape (webhook / waivers — used in M3+ refactors)
        result = await env.DB.prepare(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
            .bind(
                userId ?? null,
                action,
                targetType ?? null,
                targetId ?? null,
                metaJson,
                ipAddress,
                now,
            )
            .run();
    }

    return {
        id: result?.meta?.last_row_id ?? null,
        changes: result?.meta?.changes ?? 0,
    };
}

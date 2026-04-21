import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';

const adminAuditLog = new Hono();
adminAuditLog.use('*', requireAuth);

// GET /api/admin/audit-log
// Filters: action (prefix or exact), target_type, user_id, from, to
// Pagination: limit (default 50, max 200), offset
adminAuditLog.get('/', requireRole('owner', 'manager'), async (c) => {
    const url = new URL(c.req.url);
    const action = url.searchParams.get('action')?.trim();
    const targetType = url.searchParams.get('target_type')?.trim();
    const userId = url.searchParams.get('user_id')?.trim();
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const q = url.searchParams.get('q')?.trim();
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));

    const where = [];
    const binds = [];
    if (action) {
        if (action.endsWith('*')) {
            where.push(`action LIKE ?`);
            binds.push(`${action.slice(0, -1)}%`);
        } else {
            where.push(`action = ?`);
            binds.push(action);
        }
    }
    if (targetType) { where.push(`target_type = ?`); binds.push(targetType); }
    if (userId) { where.push(`user_id = ?`); binds.push(userId); }
    if (from) { where.push(`created_at >= ?`); binds.push(Number(from)); }
    if (to) { where.push(`created_at <= ?`); binds.push(Number(to)); }
    if (q) {
        where.push(`(target_id LIKE ? OR meta_json LIKE ?)`);
        binds.push(`%${q}%`, `%${q}%`);
    }
    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM audit_log ${whereSQL}`
    ).bind(...binds).first();

    const rows = await c.env.DB.prepare(
        `SELECT al.*, u.display_name AS user_name, u.email AS user_email
         FROM audit_log al
         LEFT JOIN users u ON u.id = al.user_id
         ${whereSQL}
         ORDER BY al.created_at DESC
         LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all();

    return c.json({
        total: countRow?.n ?? 0,
        limit,
        offset,
        entries: (rows.results || []).map((r) => ({
            id: r.id,
            userId: r.user_id,
            userName: r.user_name,
            userEmail: r.user_email,
            action: r.action,
            targetType: r.target_type,
            targetId: r.target_id,
            meta: r.meta_json ? safeJson(r.meta_json) : null,
            ipAddress: r.ip_address,
            createdAt: r.created_at,
        })),
    });
});

// GET /api/admin/audit-log/actions — distinct action values (for filter dropdown)
adminAuditLog.get('/actions', requireRole('owner', 'manager'), async (c) => {
    const rows = await c.env.DB.prepare(
        `SELECT DISTINCT action FROM audit_log ORDER BY action ASC`
    ).all();
    return c.json({ actions: (rows.results || []).map((r) => r.action) });
});

function safeJson(s) {
    try { return JSON.parse(s); } catch { return null; }
}

export default adminAuditLog;

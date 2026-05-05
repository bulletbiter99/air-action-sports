// Admin feedback triage: list, detail, update (status/priority/note), delete.
// Every mutating action writes to audit_log.

import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { clientIp } from '../../lib/rateLimit.js';
import { sendFeedbackResolutionNotice, renderFeedbackResolutionNotice } from '../../lib/emailSender.js';

const adminFeedback = new Hono();
adminFeedback.use('*', requireAuth);

const ALLOWED_STATUS = new Set(['new', 'triaged', 'in-progress', 'resolved', 'wont-fix', 'duplicate']);
const TERMINAL_STATUS = new Set(['resolved', 'wont-fix', 'duplicate']);
const ALLOWED_PRIORITY = new Set(['low', 'medium', 'high', 'critical']);

async function writeAudit(env, userId, action, targetId, meta, ip) {
    await env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
         VALUES (?, ?, 'feedback', ?, ?, ?, ?)`
    ).bind(userId, action, targetId, meta ? JSON.stringify(meta) : null, ip, Date.now()).run();
}

function rowToDto(r) {
    return {
        id: r.id,
        type: r.type,
        title: r.title,
        description: r.description,
        email: r.email,
        pageUrl: r.page_url,
        userAgent: r.user_agent,
        viewport: r.viewport,
        status: r.status,
        priority: r.priority,
        adminNote: r.admin_note,
        resolvedAt: r.resolved_at,
        attachmentUrl: r.attachment_url,
        attachmentSizeBytes: r.attachment_size_bytes,
        attachmentDeletedAt: r.attachment_deleted_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

// Extract R2 key from a same-origin /uploads/<key> URL, or return null.
function attachmentKey(url, siteUrl) {
    if (!url || !siteUrl) return null;
    const prefix = `${siteUrl}/uploads/`;
    if (!url.startsWith(prefix)) return null;
    const key = url.slice(prefix.length);
    if (!/^feedback\/[a-zA-Z0-9_-]+\.(jpg|png|webp|gif)$/.test(key)) return null;
    return key;
}

// GET /api/admin/feedback — list with filters. Also returns a status summary.
adminFeedback.get('/', requireRole('owner', 'manager', 'staff'), async (c) => {
    const url = new URL(c.req.url);
    const status = url.searchParams.get('status')?.trim();
    const type = url.searchParams.get('type')?.trim();
    const priority = url.searchParams.get('priority')?.trim();
    const q = url.searchParams.get('q')?.trim();
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));

    const where = [];
    const binds = [];
    if (status && ALLOWED_STATUS.has(status)) { where.push(`status = ?`); binds.push(status); }
    if (type) { where.push(`type = ?`); binds.push(type); }
    if (priority && ALLOWED_PRIORITY.has(priority)) { where.push(`priority = ?`); binds.push(priority); }
    if (from) { where.push(`created_at >= ?`); binds.push(Number(from)); }
    if (to) { where.push(`created_at <= ?`); binds.push(Number(to)); }
    if (q) {
        where.push(`(title LIKE ? OR description LIKE ? OR email LIKE ?)`);
        binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM feedback ${whereSQL}`
    ).bind(...binds).first();

    const rows = await c.env.DB.prepare(
        `SELECT * FROM feedback ${whereSQL} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all();

    // Status summary (unfiltered) — for sidebar badge + quick tabs.
    const summaryRow = await c.env.DB.prepare(
        `SELECT
            SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count,
            SUM(CASE WHEN status = 'triaged' THEN 1 ELSE 0 END) AS triaged_count,
            SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) AS in_progress_count,
            SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
            COUNT(*) AS total_count
         FROM feedback`
    ).first();

    return c.json({
        total: countRow?.n ?? 0,
        limit,
        offset,
        summary: {
            new: summaryRow?.new_count ?? 0,
            triaged: summaryRow?.triaged_count ?? 0,
            inProgress: summaryRow?.in_progress_count ?? 0,
            resolved: summaryRow?.resolved_count ?? 0,
            total: summaryRow?.total_count ?? 0,
        },
        items: (rows.results || []).map(rowToDto),
    });
});

// GET /api/admin/feedback/summary — lightweight count for sidebar badge
adminFeedback.get('/summary', requireRole('owner', 'manager', 'staff'), async (c) => {
    const row = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'`
    ).first();
    return c.json({ newCount: row?.n ?? 0 });
});

// GET /api/admin/feedback/:id
adminFeedback.get('/:id', requireRole('owner', 'manager', 'staff'), async (c) => {
    const row = await c.env.DB.prepare(
        `SELECT * FROM feedback WHERE id = ?`
    ).bind(c.req.param('id')).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({ item: rowToDto(row) });
});

// PUT /api/admin/feedback/:id — update status / priority / admin_note
// Status changes require manager+, note-only edits allow staff+.
adminFeedback.put('/:id', requireRole('owner', 'manager', 'staff'), async (c) => {
    const id = c.req.param('id');
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await c.env.DB.prepare(`SELECT * FROM feedback WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);

    const updates = [];
    const binds = [];
    const metaChanges = {};

    let shouldDeleteAttachment = false;
    if (body.status !== undefined) {
        if (!ALLOWED_STATUS.has(body.status)) return c.json({ error: 'Invalid status' }, 400);
        if (body.status !== existing.status && user.role === 'staff') {
            return c.json({ error: 'Status changes require manager role' }, 403);
        }
        if (body.status !== existing.status) {
            updates.push(`status = ?`); binds.push(body.status);
            metaChanges.status = { from: existing.status, to: body.status };
            if (TERMINAL_STATUS.has(body.status) && !existing.resolved_at) {
                updates.push(`resolved_at = ?`); binds.push(Date.now());
                // Terminal transition → retire any attached screenshot.
                if (existing.attachment_url && !existing.attachment_deleted_at) {
                    shouldDeleteAttachment = true;
                }
            } else if (!TERMINAL_STATUS.has(body.status) && existing.resolved_at) {
                updates.push(`resolved_at = NULL`);
            }
        }
    }

    if (body.priority !== undefined) {
        if (!ALLOWED_PRIORITY.has(body.priority)) return c.json({ error: 'Invalid priority' }, 400);
        if (body.priority !== existing.priority && user.role === 'staff') {
            return c.json({ error: 'Priority changes require manager role' }, 403);
        }
        if (body.priority !== existing.priority) {
            updates.push(`priority = ?`); binds.push(body.priority);
            metaChanges.priority = { from: existing.priority, to: body.priority };
        }
    }

    if (body.adminNote !== undefined) {
        const note = body.adminNote == null ? null : String(body.adminNote).slice(0, 4000);
        if (note !== existing.admin_note) {
            updates.push(`admin_note = ?`); binds.push(note);
            metaChanges.noteChanged = true;
        }
    }

    if (updates.length === 0) {
        return c.json({ item: rowToDto(existing) });
    }

    updates.push(`updated_at = ?`); binds.push(Date.now());
    binds.push(id);

    await c.env.DB.prepare(
        `UPDATE feedback SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    // After status change: if terminal, delete R2 object + stamp deletion timestamp.
    // Best-effort — DB state must stay consistent even if R2 hiccups.
    if (shouldDeleteAttachment) {
        const key = attachmentKey(existing.attachment_url, c.env.SITE_URL || '');
        if (key && c.env.UPLOADS) {
            try { await c.env.UPLOADS.delete(key); }
            catch (err) { console.error('R2 delete failed for feedback attachment', err); }
        }
        await c.env.DB.prepare(
            `UPDATE feedback SET attachment_url = NULL, attachment_deleted_at = ? WHERE id = ?`
        ).bind(Date.now(), id).run();
        metaChanges.attachmentDeleted = true;
    }

    await writeAudit(c.env, user.id, 'feedback.updated', id, metaChanges, clientIp(c));

    const updated = await c.env.DB.prepare(`SELECT * FROM feedback WHERE id = ?`).bind(id).first();
    return c.json({ item: rowToDto(updated) });
});

// GET /api/admin/feedback/:id/notify-preview — render the resolution-notice
// email with this ticket's actual status + admin_note (not sample data),
// so the preview-before-send modal shows exactly what would be sent.
// Manager+ — same role gate as the send endpoint.
adminFeedback.get('/:id/notify-preview', requireRole('owner', 'manager'), async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(`SELECT * FROM feedback WHERE id = ?`).bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (!row.email) return c.json({ error: 'No submitter email on this ticket' }, 400);

    const result = await renderFeedbackResolutionNotice(c.env, { feedback: rowToDto(row) });
    if (result?.skipped) {
        return c.json({ error: `Cannot render preview (${result.skipped})` }, 500);
    }
    return c.json({ rendered: result.rendered, recipient: row.email });
});

// POST /api/admin/feedback/:id/notify-submitter — opt-in email to the submitter.
// Requires: ticket has email, manager+ role. Uses current status + admin_note.
adminFeedback.post('/:id/notify-submitter', requireRole('owner', 'manager'), async (c) => {
    const id = c.req.param('id');
    const user = c.get('user');

    const row = await c.env.DB.prepare(`SELECT * FROM feedback WHERE id = ?`).bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (!row.email) return c.json({ error: 'No submitter email on this ticket' }, 400);

    const result = await sendFeedbackResolutionNotice(c.env, { feedback: rowToDto(row) });
    if (result?.skipped) {
        return c.json({ error: `Email not sent (${result.skipped})` }, 500);
    }

    await writeAudit(c.env, user.id, 'feedback.notified_submitter', id, {
        to: row.email, status: row.status,
    }, clientIp(c));

    return c.json({ ok: true });
});

// DELETE /api/admin/feedback/:id — owner-only (spam removal). Also deletes R2 attachment.
adminFeedback.delete('/:id', requireRole('owner'), async (c) => {
    const id = c.req.param('id');
    const user = c.get('user');

    const existing = await c.env.DB.prepare(`SELECT id, title, type, attachment_url FROM feedback WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Not found' }, 404);

    if (existing.attachment_url) {
        const key = attachmentKey(existing.attachment_url, c.env.SITE_URL || '');
        if (key && c.env.UPLOADS) {
            try { await c.env.UPLOADS.delete(key); }
            catch (err) { console.error('R2 delete failed on feedback ticket delete', err); }
        }
    }

    await c.env.DB.prepare(`DELETE FROM feedback WHERE id = ?`).bind(id).run();
    await writeAudit(c.env, user.id, 'feedback.deleted', id, { title: existing.title, type: existing.type }, clientIp(c));

    return c.json({ ok: true });
});

export default adminFeedback;

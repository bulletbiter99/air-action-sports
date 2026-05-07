import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { sendEmail } from '../../lib/email.js';
import { renderTemplate } from '../../lib/templates.js';
import { writeAudit } from '../../lib/auditLog.js';

const adminEmailTemplates = new Hono();
adminEmailTemplates.use('*', requireAuth);

function formatTemplate(r) {
    let variables = [];
    try { variables = r.variables_json ? JSON.parse(r.variables_json) : []; } catch {}
    return {
        id: r.id,
        slug: r.slug,
        subject: r.subject,
        bodyHtml: r.body_html,
        bodyText: r.body_text,
        variables,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by,
        createdAt: r.created_at,
    };
}

// Sample variable values for preview + test emails.
function sampleVars() {
    return {
        player_name: 'Jane Player',
        event_name: 'Operation Nightfall',
        event_date: '9 May 2026',
        event_location: 'Ghost Town — Rural Neighborhood',
        player_count: 4,
        total_paid: '320.00',
        booking_id: 'bk_SAMPLE12345',
        waiver_link: 'https://air-action-sports.bulletbiter99.workers.dev/booking/success?token=bk_SAMPLE12345',
        player_email: 'jane@example.com',
        player_phone: '+1 555 0123',
        admin_link: 'https://air-action-sports.bulletbiter99.workers.dev/admin',
        check_in: '6:30 AM – 8:00 AM',
        first_game: '8:30 AM',
        display_name: 'Jane',
        reset_link: 'https://air-action-sports.bulletbiter99.workers.dev/admin/reset-password?token=SAMPLE',
        inviter_name: 'Paul',
        role: 'staff',
        accept_link: 'https://air-action-sports.bulletbiter99.workers.dev/admin/accept-invite?token=SAMPLE',
    };
}

// GET /api/admin/email-templates — list (manager+)
adminEmailTemplates.get('/', requireRole('owner', 'manager'), async (c) => {
    const rows = await c.env.DB.prepare(
        `SELECT * FROM email_templates ORDER BY slug ASC`
    ).all();
    return c.json({ templates: (rows.results || []).map(formatTemplate) });
});

// GET /api/admin/email-templates/:slug — single
adminEmailTemplates.get('/:slug', requireRole('owner', 'manager'), async (c) => {
    const row = await c.env.DB.prepare(
        `SELECT * FROM email_templates WHERE slug = ?`
    ).bind(c.req.param('slug')).first();
    if (!row) return c.json({ error: 'Template not found' }, 404);
    return c.json({ template: formatTemplate(row) });
});

// GET /api/admin/email-templates/:slug/preview — render with sample vars
adminEmailTemplates.get('/:slug/preview', requireRole('owner', 'manager'), async (c) => {
    const row = await c.env.DB.prepare(`SELECT * FROM email_templates WHERE slug = ?`).bind(c.req.param('slug')).first();
    if (!row) return c.json({ error: 'Template not found' }, 404);
    const rendered = renderTemplate(row, sampleVars());
    return c.json({ rendered });
});

// PUT /api/admin/email-templates/:slug — update (owner only; these control real transactional email)
adminEmailTemplates.put('/:slug', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const slug = c.req.param('slug');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await c.env.DB.prepare(`SELECT * FROM email_templates WHERE slug = ?`).bind(slug).first();
    if (!existing) return c.json({ error: 'Template not found' }, 404);

    const patch = {};
    if (body.subject !== undefined) {
        const s = String(body.subject).trim();
        if (!s) return c.json({ error: 'subject cannot be empty' }, 400);
        patch.subject = s;
    }
    if (body.bodyHtml !== undefined) {
        const s = String(body.bodyHtml);
        if (!s.trim()) return c.json({ error: 'bodyHtml cannot be empty' }, 400);
        patch.body_html = s;
    }
    if (body.bodyText !== undefined) {
        patch.body_text = body.bodyText ? String(body.bodyText) : null;
    }

    const keys = Object.keys(patch);
    if (!keys.length) return c.json({ error: 'No changes' }, 400);

    keys.push('updated_at', 'updated_by');
    patch.updated_at = Date.now();
    patch.updated_by = user.id;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const binds = keys.map((k) => patch[k]);
    binds.push(slug);
    await c.env.DB.prepare(`UPDATE email_templates SET ${sets} WHERE slug = ?`).bind(...binds).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'email_template.updated',
        targetType: 'email_template',
        targetId: slug,
        meta: { fields: keys.filter((k) => k !== 'updated_at' && k !== 'updated_by') },
    });

    const row = await c.env.DB.prepare(`SELECT * FROM email_templates WHERE slug = ?`).bind(slug).first();
    return c.json({ template: formatTemplate(row) });
});

// POST /api/admin/email-templates/:slug/send-test
// Body: { to: 'email@example.com' }
// Renders the template with sample vars and sends to the given address.
adminEmailTemplates.post('/:slug/send-test', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const slug = c.req.param('slug');
    const body = await c.req.json().catch(() => null);
    const to = body?.to?.trim();
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
        return c.json({ error: 'Valid "to" email required' }, 400);
    }
    const row = await c.env.DB.prepare(`SELECT * FROM email_templates WHERE slug = ?`).bind(slug).first();
    if (!row) return c.json({ error: 'Template not found' }, 404);

    const rendered = renderTemplate(row, sampleVars());
    try {
        await sendEmail({
            apiKey: c.env.RESEND_API_KEY,
            from: c.env.FROM_EMAIL || 'Air Action Sports <noreply@airactionsport.com>',
            to,
            replyTo: c.env.REPLY_TO_EMAIL,
            subject: `[TEST] ${rendered.subject}`,
            html: rendered.html,
            text: rendered.text,
            tags: [
                { name: 'type', value: 'template_test' },
                { name: 'slug', value: slug },
            ],
        });
    } catch (err) {
        console.error('send-test failed', err);
        return c.json({ error: 'Send failed' }, 502);
    }

    await writeAudit(c.env, {
        userId: user.id,
        action: 'email_template.test_sent',
        targetType: 'email_template',
        targetId: slug,
        meta: { to },
    });

    return c.json({ success: true, sentTo: to });
});

export default adminEmailTemplates;

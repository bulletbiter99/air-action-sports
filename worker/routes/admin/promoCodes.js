import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { promoCodeDbId } from '../../lib/ids.js';
import { isValidEmail } from '../../lib/email.js';
import { sendPromoCodeIssued } from '../../lib/emailSender.js';

const adminPromoCodes = new Hono();
adminPromoCodes.use('*', requireAuth);

function formatPromo(row) {
    return {
        id: row.id,
        code: row.code,
        eventId: row.event_id,
        discountType: row.discount_type,
        discountValue: row.discount_value,
        maxUses: row.max_uses,
        usesCount: row.uses_count || 0,
        minOrderCents: row.min_order_cents,
        startsAt: row.starts_at,
        expiresAt: row.expires_at,
        appliesTo: row.applies_to_json ? JSON.parse(row.applies_to_json) : null,
        restrictedToEmail: row.restricted_to_email || null,
        active: !!row.active,
        createdAt: row.created_at,
        createdBy: row.created_by,
    };
}

function parseBody(body, { partial = false } = {}) {
    const patch = {};
    if (body.code !== undefined) {
        const c = String(body.code).trim().toUpperCase();
        if (!/^[A-Z0-9_-]{2,32}$/.test(c)) return { error: 'Code must be 2–32 chars, A–Z / 0–9 / - / _' };
        patch.code = c;
    }
    if (body.eventId !== undefined) patch.event_id = body.eventId || null;
    if (body.discountType !== undefined) {
        if (!['percent', 'fixed'].includes(body.discountType)) return { error: "discountType must be 'percent' or 'fixed'" };
        patch.discount_type = body.discountType;
    }
    if (body.discountValue !== undefined) {
        const n = Number(body.discountValue);
        if (!Number.isFinite(n) || n <= 0) return { error: 'discountValue must be a positive number' };
        patch.discount_value = Math.round(n);
    }
    if (body.maxUses !== undefined) {
        if (body.maxUses === null || body.maxUses === '') patch.max_uses = null;
        else {
            const n = Number(body.maxUses);
            if (!Number.isFinite(n) || n < 1) return { error: 'maxUses must be ≥ 1' };
            patch.max_uses = Math.round(n);
        }
    }
    if (body.minOrderCents !== undefined) {
        if (body.minOrderCents === null || body.minOrderCents === '') patch.min_order_cents = null;
        else {
            const n = Number(body.minOrderCents);
            if (!Number.isFinite(n) || n < 0) return { error: 'minOrderCents must be ≥ 0' };
            patch.min_order_cents = Math.round(n);
        }
    }
    if (body.startsAt !== undefined) patch.starts_at = body.startsAt || null;
    if (body.expiresAt !== undefined) patch.expires_at = body.expiresAt || null;
    if (body.appliesTo !== undefined) {
        patch.applies_to_json = body.appliesTo ? JSON.stringify(body.appliesTo) : null;
    }
    if (body.restrictedToEmail !== undefined) {
        if (body.restrictedToEmail === null || body.restrictedToEmail === '') {
            patch.restricted_to_email = null;
        } else {
            const email = String(body.restrictedToEmail).trim().toLowerCase();
            if (!isValidEmail(email)) return { error: 'restrictedToEmail is not a valid email address' };
            patch.restricted_to_email = email;
        }
    }
    if (body.active !== undefined) patch.active = body.active ? 1 : 0;

    if (!partial) {
        if (!patch.code) return { error: 'code is required' };
        if (!patch.discount_type) return { error: 'discountType is required' };
        if (patch.discount_value == null) return { error: 'discountValue is required' };
        if (patch.discount_type === 'percent' && patch.discount_value > 100) {
            return { error: 'percent discountValue cannot exceed 100' };
        }
    }
    return { patch };
}

// GET /api/admin/promo-codes — list (filters: active, event_id, q)
adminPromoCodes.get('/', async (c) => {
    const url = new URL(c.req.url);
    const active = url.searchParams.get('active'); // '1' | '0' | null
    const eventId = url.searchParams.get('event_id');
    const q = url.searchParams.get('q')?.trim();

    const clauses = [];
    const binds = [];
    if (active === '1') clauses.push(`active = 1`);
    else if (active === '0') clauses.push(`active = 0`);
    if (eventId) { clauses.push(`event_id = ?`); binds.push(eventId); }
    if (q) { clauses.push(`code LIKE ?`); binds.push(`%${q.toUpperCase()}%`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await c.env.DB.prepare(
        `SELECT * FROM promo_codes ${where} ORDER BY active DESC, created_at DESC`
    ).bind(...binds).all();
    return c.json({ promoCodes: (rows.results || []).map(formatPromo) });
});

// GET /api/admin/promo-codes/:id
adminPromoCodes.get('/:id', async (c) => {
    const row = await c.env.DB.prepare(`SELECT * FROM promo_codes WHERE id = ?`).bind(c.req.param('id')).first();
    if (!row) return c.json({ error: 'Promo code not found' }, 404);
    return c.json({ promoCode: formatPromo(row) });
});

// POST /api/admin/promo-codes — create (manager+)
adminPromoCodes.post('/', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const { patch, error } = parseBody(body, { partial: false });
    if (error) return c.json({ error }, 400);

    const dupe = await c.env.DB.prepare(`SELECT id FROM promo_codes WHERE code = ?`).bind(patch.code).first();
    if (dupe) return c.json({ error: 'Code already exists' }, 409);

    const id = promoCodeDbId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO promo_codes (
            id, code, event_id, discount_type, discount_value,
            max_uses, uses_count, min_order_cents, starts_at, expires_at,
            applies_to_json, restricted_to_email, active, created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        id, patch.code, patch.event_id ?? null, patch.discount_type, patch.discount_value,
        patch.max_uses ?? null, patch.min_order_cents ?? null,
        patch.starts_at ?? null, patch.expires_at ?? null,
        patch.applies_to_json ?? null, patch.restricted_to_email ?? null,
        patch.active ?? 1, now, user.id,
    ).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'promo_code.created', 'promo_code', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ code: patch.code, type: patch.discount_type, value: patch.discount_value }), now).run();

    const row = await c.env.DB.prepare(`SELECT * FROM promo_codes WHERE id = ?`).bind(id).first();
    return c.json({ promoCode: formatPromo(row) }, 201);
});

// PUT /api/admin/promo-codes/:id — update (manager+)
adminPromoCodes.put('/:id', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await c.env.DB.prepare(`SELECT * FROM promo_codes WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Promo code not found' }, 404);

    const { patch, error } = parseBody(body, { partial: true });
    if (error) return c.json({ error }, 400);

    if (patch.code && patch.code !== existing.code) {
        const dupe = await c.env.DB.prepare(`SELECT id FROM promo_codes WHERE code = ? AND id != ?`)
            .bind(patch.code, id).first();
        if (dupe) return c.json({ error: 'Code already exists' }, 409);
    }

    const keys = Object.keys(patch);
    if (!keys.length) return c.json({ error: 'No changes' }, 400);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const binds = keys.map((k) => patch[k]);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE promo_codes SET ${sets} WHERE id = ?`).bind(...binds).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'promo_code.updated', 'promo_code', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ fields: keys }), Date.now()).run();

    const row = await c.env.DB.prepare(`SELECT * FROM promo_codes WHERE id = ?`).bind(id).first();
    return c.json({ promoCode: formatPromo(row) });
});

// POST /api/admin/promo-codes/batch — generate N single-use codes, one per
// email in the recipients list, and optionally email each recipient their
// code immediately. Used by the AdminPromoCodes "Batch create" modal for
// past-attendee VIP campaigns.
//
// Body:
//   recipients:        Array<{ email: string, name?: string }>  required (1+)
//   discountType:      'percent' | 'fixed'                       required
//   discountValue:     number                                    required
//   expiresAt:         number (epoch ms) | null
//   minOrderCents:     number | null
//   eventId:           string | null                             (event scope)
//   codePrefix:        string (2-12 chars)                       default 'AAS'
//   sendEmails:        boolean                                   default true
//   sendToSelfFirst:   boolean                                   default false
//     If true, generates +1 extra code addressed to the requesting admin's
//     own email (treated like any other batch recipient) before fanning
//     out to the recipients list. Useful as a dry-run preview.
adminPromoCodes.post('/batch', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const recipients = Array.isArray(body.recipients) ? body.recipients : [];
    if (recipients.length === 0) return c.json({ error: 'recipients is required (1+)' }, 400);
    if (recipients.length > 500) return c.json({ error: 'max 500 recipients per batch' }, 400);

    if (!['percent', 'fixed'].includes(body.discountType)) {
        return c.json({ error: "discountType must be 'percent' or 'fixed'" }, 400);
    }
    const discountValue = Math.round(Number(body.discountValue));
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
        return c.json({ error: 'discountValue must be a positive number' }, 400);
    }
    if (body.discountType === 'percent' && discountValue > 100) {
        return c.json({ error: 'percent discountValue cannot exceed 100' }, 400);
    }

    const expiresAt = body.expiresAt ? Number(body.expiresAt) : null;
    if (expiresAt != null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
        return c.json({ error: 'expiresAt must be a future epoch-ms timestamp' }, 400);
    }
    const minOrderCents = body.minOrderCents ? Math.round(Number(body.minOrderCents)) : null;
    const eventId = body.eventId || null;
    const sendEmails = body.sendEmails !== false; // default true
    const prefixRaw = String(body.codePrefix || 'AAS').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const codePrefix = prefixRaw.slice(0, 12) || 'AAS';

    // Normalize the recipients list. Dedupe + validate emails. Optionally
    // prepend the requesting admin's email for a self-test dry-run.
    const queue = [];
    const seen = new Set();
    if (body.sendToSelfFirst && user?.email) {
        const selfEmail = String(user.email).trim().toLowerCase();
        queue.push({ email: selfEmail, name: user.display_name || 'You', isSelf: true });
        seen.add(selfEmail);
    }
    for (const r of recipients) {
        if (!r || typeof r !== 'object') continue;
        const email = String(r.email || '').trim().toLowerCase();
        if (!isValidEmail(email)) continue;
        if (seen.has(email)) continue;
        seen.add(email);
        queue.push({ email, name: r.name ? String(r.name).trim() : null, isSelf: false });
    }
    if (queue.length === 0) return c.json({ error: 'no valid recipient emails after de-dup' }, 400);

    // Generate codes. Random suffix (6 alphanumeric chars) keeps them
    // unguessable + short enough to type if the recipient has trouble
    // copy/pasting. Collisions checked against existing rows.
    const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // skip 0/O/1/I
    function randomSuffix() {
        const bytes = new Uint8Array(6);
        crypto.getRandomValues(bytes);
        return Array.from(bytes).map((b) => ALPHA[b % ALPHA.length]).join('');
    }

    const now = Date.now();
    const created = [];
    const emailResults = [];

    for (const recipient of queue) {
        // Generate a unique code (retry up to 5 times on collision; extremely rare).
        let code = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = `${codePrefix}-${randomSuffix()}`;
            const dupe = await c.env.DB.prepare('SELECT id FROM promo_codes WHERE code = ?').bind(candidate).first();
            if (!dupe) { code = candidate; break; }
        }
        if (!code) {
            emailResults.push({ email: recipient.email, error: 'code_collision' });
            continue;
        }

        const id = promoCodeDbId();
        try {
            await c.env.DB.prepare(
                `INSERT INTO promo_codes (
                    id, code, event_id, discount_type, discount_value,
                    max_uses, uses_count, min_order_cents, starts_at, expires_at,
                    applies_to_json, restricted_to_email, active, created_at, created_by
                ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, NULL, ?, NULL, ?, 1, ?, ?)`
            ).bind(
                id, code, eventId, body.discountType, discountValue,
                minOrderCents, expiresAt, recipient.email, now, user.id,
            ).run();
            created.push({ id, code, email: recipient.email });
        } catch (err) {
            emailResults.push({ email: recipient.email, error: 'insert_failed', detail: err?.message });
            continue;
        }

        if (sendEmails) {
            const discountDisplay = body.discountType === 'percent'
                ? `${discountValue}% off`
                : `$${(discountValue / 100).toFixed(2)} off`;
            try {
                const sendRes = await sendPromoCodeIssued(c.env, {
                    toEmail: recipient.email,
                    recipientName: recipient.name,
                    code,
                    discountDisplay,
                    expiresAtMs: expiresAt,
                    eventName: eventId ? null : 'any event',
                });
                emailResults.push({ email: recipient.email, code, sent: !sendRes?.skipped && !sendRes?.error, skipped: sendRes?.skipped, error: sendRes?.error });
            } catch (err) {
                emailResults.push({ email: recipient.email, code, sent: false, error: err?.message || 'send_failed' });
            }
        }
    }

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'promo_code.batch_created', 'promo_code', ?, ?, ?)`
    ).bind(
        user.id,
        created[0]?.id || 'none',
        JSON.stringify({
            count: created.length,
            recipients_input: recipients.length,
            send_to_self_first: !!body.sendToSelfFirst,
            sent_emails: sendEmails,
            discount_type: body.discountType,
            discount_value: discountValue,
            event_id: eventId,
        }),
        now,
    ).run();

    return c.json({
        created: created.length,
        emailsSent: sendEmails ? emailResults.filter((r) => r.sent).length : 0,
        codes: created,
        emailResults: sendEmails ? emailResults : [],
    });
});

// DELETE /api/admin/promo-codes/:id — deactivate if used, else delete (owner)
adminPromoCodes.delete('/:id', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(`SELECT * FROM promo_codes WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Promo code not found' }, 404);

    const now = Date.now();
    if ((existing.uses_count || 0) > 0) {
        await c.env.DB.prepare(`UPDATE promo_codes SET active = 0 WHERE id = ?`).bind(id).run();
        await c.env.DB.prepare(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
             VALUES (?, 'promo_code.deactivated', 'promo_code', ?, ?, ?)`
        ).bind(user.id, id, JSON.stringify({ reason: 'has_uses', uses: existing.uses_count }), now).run();
        return c.json({ deactivated: true });
    }
    await c.env.DB.prepare(`DELETE FROM promo_codes WHERE id = ?`).bind(id).run();
    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'promo_code.deleted', 'promo_code', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ code: existing.code }), now).run();
    return c.json({ deleted: true });
});

export default adminPromoCodes;

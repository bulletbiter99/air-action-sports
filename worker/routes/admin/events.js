import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { formatEvent, formatTicketType } from '../../lib/formatters.js';
import { eventId as newEventId, ticketTypeId as newTicketTypeId, slugify } from '../../lib/ids.js';
import { instantiateChecklists } from '../../lib/eventChecklists.js';
import { detectEventConflicts, hasAnyConflict, dateIsoToDayWindow } from '../../lib/eventConflicts.js';

const adminEvents = new Hono();
adminEvents.use('*', requireAuth);

// Fields accepted by create/update. Missing fields preserved on update.
const EVENT_STRING_FIELDS = [
    'title', 'slug', 'date_iso', 'display_date', 'display_day', 'display_month',
    'location', 'site', 'site_id', 'type', 'time_range', 'check_in', 'first_game', 'end_time',
    'cover_image_url', 'card_image_url', 'hero_image_url', 'banner_image_url', 'og_image_url',
    'short_description',
];
const EVENT_INT_FIELDS = [
    'base_price_cents', 'total_slots', 'sales_close_at',
];

function parseEventBody(body, { partial = false } = {}) {
    const patch = {};
    // camelCase → snake_case fields
    const map = {
        title: 'title', slug: 'slug', dateIso: 'date_iso',
        displayDate: 'display_date', displayDay: 'display_day', displayMonth: 'display_month',
        location: 'location', site: 'site', siteId: 'site_id', type: 'type', timeRange: 'time_range',
        checkIn: 'check_in', firstGame: 'first_game', endTime: 'end_time',
        coverImageUrl: 'cover_image_url',
        cardImageUrl: 'card_image_url', heroImageUrl: 'hero_image_url',
        bannerImageUrl: 'banner_image_url', ogImageUrl: 'og_image_url',
        shortDescription: 'short_description',
        basePriceCents: 'base_price_cents', totalSlots: 'total_slots',
        salesCloseAt: 'sales_close_at',
        published: 'published', past: 'past', featured: 'featured',
    };
    for (const [k, col] of Object.entries(map)) {
        if (body[k] === undefined) continue;
        if (EVENT_STRING_FIELDS.includes(col)) {
            let v = body[k] === null ? null : String(body[k]).trim();
            // slug must be URL-safe. Enforced on both create and update so it
            // can't ever contain characters that'd break the /events/:slug
            // HTML rewriter or the OG URL in meta tags.
            if (col === 'slug' && v !== null && v !== '' && !/^[a-z0-9-]+$/.test(v)) {
                return { error: 'slug must contain only lowercase letters, numbers, and hyphens' };
            }
            patch[col] = v;
        } else if (EVENT_INT_FIELDS.includes(col)) {
            if (body[k] === null || body[k] === '') patch[col] = null;
            else {
                const n = Number(body[k]);
                if (!Number.isFinite(n)) return { error: `${k} must be a number` };
                patch[col] = Math.round(n);
            }
        } else if (col === 'published' || col === 'past' || col === 'featured') {
            patch[col] = body[k] ? 1 : 0;
        }
    }
    if (body.addons !== undefined) {
        if (!Array.isArray(body.addons)) return { error: 'addons must be an array' };
        patch.addons_json = JSON.stringify(body.addons);
    }
    if (body.gameModes !== undefined) {
        if (!Array.isArray(body.gameModes)) return { error: 'gameModes must be an array' };
        patch.game_modes_json = JSON.stringify(body.gameModes);
    }
    if (body.details !== undefined) {
        patch.details_json = body.details === null ? null : JSON.stringify(body.details);
    }
    if (body.customQuestions !== undefined) {
        if (!Array.isArray(body.customQuestions)) return { error: 'customQuestions must be an array' };
        const QUESTION_TYPES = ['text', 'textarea', 'select', 'checkbox'];
        const keys = new Set();
        const cleaned = [];
        for (const q of body.customQuestions) {
            if (!q || typeof q !== 'object') continue;
            const key = String(q.key || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
            const label = String(q.label || '').trim();
            const type = QUESTION_TYPES.includes(q.type) ? q.type : 'text';
            if (!key || !label) continue;
            if (keys.has(key)) return { error: `Duplicate question key: ${key}` };
            keys.add(key);
            cleaned.push({
                key,
                label,
                type,
                required: !!q.required,
                options: Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : [],
                sortOrder: Number.isFinite(Number(q.sortOrder)) ? Number(q.sortOrder) : cleaned.length,
            });
        }
        cleaned.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        patch.custom_questions_json = cleaned.length ? JSON.stringify(cleaned) : null;
    }

    if (!partial) {
        if (!patch.title) return { error: 'title is required' };
        if (!patch.date_iso) return { error: 'dateIso is required (ISO 8601)' };
        if (patch.base_price_cents == null) return { error: 'basePriceCents is required' };
        if (patch.total_slots == null) return { error: 'totalSlots is required' };
        // Sensible defaults for required JSON columns
        if (patch.addons_json === undefined) patch.addons_json = '[]';
        if (patch.game_modes_json === undefined) patch.game_modes_json = '[]';
    }
    return { patch };
}

// All events (including unpublished) with ticket types + counts.
adminEvents.get('/', async (c) => {
    const events = await c.env.DB.prepare(
        `SELECT e.*,
         (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.id AND b.status = 'paid') AS paid_bookings,
         (SELECT COALESCE(SUM(b.player_count), 0) FROM bookings b WHERE b.event_id = e.id AND b.status IN ('paid', 'comp')) AS attendees_count,
         (SELECT COALESCE(SUM(b.total_cents), 0) FROM bookings b WHERE b.event_id = e.id AND b.status = 'paid') AS gross_cents
         FROM events e
         ORDER BY e.date_iso DESC`
    ).all();

    const eventRows = events.results || [];
    if (eventRows.length === 0) return c.json({ events: [] });

    const placeholders = eventRows.map(() => '?').join(',');
    const tt = await c.env.DB.prepare(
        `SELECT * FROM ticket_types WHERE event_id IN (${placeholders}) AND active = 1 ORDER BY event_id, sort_order`
    ).bind(...eventRows.map((e) => e.id)).all();
    const typesByEvent = {};
    for (const row of (tt.results || [])) {
        (typesByEvent[row.event_id] ||= []).push(formatTicketType(row));
    }

    return c.json({
        events: eventRows.map((row) => ({
            ...formatEvent(row),
            ticketTypes: typesByEvent[row.id] || [],
            paidBookings: row.paid_bookings || 0,
            attendeesCount: row.attendees_count || 0,
            grossCents: row.gross_cents || 0,
        })),
    });
});

// Full roster for a single event: every attendee + waiver + check-in + addons they bought.
adminEvents.get('/:id/roster', async (c) => {
    const eventId = c.req.param('id');
    const eventRow = await c.env.DB.prepare(
        `SELECT * FROM events WHERE id = ?`
    ).bind(eventId).first();
    if (!eventRow) return c.json({ error: 'Event not found' }, 404);

    const attendees = await c.env.DB.prepare(
        `SELECT a.*,
                b.id AS booking_id, b.status AS booking_status, b.full_name AS buyer_name,
                b.email AS buyer_email, b.phone AS buyer_phone, b.line_items_json,
                tt.name AS ticket_type_name,
                w.signed_at, w.is_minor
         FROM attendees a
         JOIN bookings b ON b.id = a.booking_id
         LEFT JOIN ticket_types tt ON tt.id = a.ticket_type_id
         LEFT JOIN waivers w ON w.id = a.waiver_id
         WHERE b.event_id = ? AND b.status IN ('paid', 'comp')
         ORDER BY b.created_at ASC, a.created_at ASC`
    ).bind(eventId).all();

    const ticketTypes = await c.env.DB.prepare(
        `SELECT * FROM ticket_types WHERE event_id = ? ORDER BY sort_order`
    ).bind(eventId).all();

    const formattedEvent = formatEvent(eventRow);
    return c.json({
        event: formattedEvent,
        ticketTypes: (ticketTypes.results || []).map(formatTicketType),
        attendees: (attendees.results || []).map((a) => ({
            id: a.id,
            firstName: a.first_name,
            lastName: a.last_name,
            email: a.email || a.buyer_email,
            phone: a.phone || a.buyer_phone,
            qrToken: a.qr_token,
            ticketType: a.ticket_type_name,
            bookingId: a.booking_id,
            bookingStatus: a.booking_status,
            buyerName: a.buyer_name,
            waiverSigned: !!a.waiver_id,
            waiverSignedAt: a.signed_at,
            isMinor: !!a.is_minor,
            checkedInAt: a.checked_in_at,
            customAnswers: (() => { try { return a.custom_answers_json ? JSON.parse(a.custom_answers_json) : {}; } catch { return {}; } })(),
        })),
    });
});

adminEvents.get('/:id/roster.csv', async (c) => {
    const eventId = c.req.param('id');
    const eventRow = await c.env.DB.prepare(`SELECT title, date_iso FROM events WHERE id = ?`)
        .bind(eventId).first();
    if (!eventRow) return c.json({ error: 'Event not found' }, 404);

    const questions = eventRow.custom_questions_json ? JSON.parse(eventRow.custom_questions_json) : [];

    const rows = await c.env.DB.prepare(
        `SELECT a.first_name, a.last_name, a.email, a.phone,
                a.custom_answers_json,
                COALESCE(b.full_name, '') AS buyer,
                COALESCE(b.email, '') AS buyer_email,
                COALESCE(b.phone, '') AS buyer_phone,
                b.status AS booking_status,
                tt.name AS ticket_type,
                CASE WHEN a.waiver_id IS NULL THEN 'no' ELSE 'yes' END AS waiver_signed,
                CASE WHEN a.checked_in_at IS NULL THEN '' ELSE datetime(a.checked_in_at/1000, 'unixepoch') END AS checked_in_at,
                b.id AS booking_id
         FROM attendees a
         JOIN bookings b ON b.id = a.booking_id
         LEFT JOIN ticket_types tt ON tt.id = a.ticket_type_id
         WHERE b.event_id = ? AND b.status IN ('paid', 'comp')
         ORDER BY b.created_at ASC, a.created_at ASC`
    ).bind(eventId).all();

    const baseHeader = ['first_name', 'last_name', 'email', 'phone', 'ticket_type', 'buyer', 'buyer_email', 'buyer_phone', 'booking_status', 'waiver_signed', 'checked_in_at', 'booking_id'];
    const questionKeys = questions.map((q) => q.key);
    const header = [...baseHeader, ...questionKeys.map((k) => `q_${k}`)];
    const lines = [header.join(',')];
    for (const r of (rows.results || [])) {
        let answers = {};
        try { answers = r.custom_answers_json ? JSON.parse(r.custom_answers_json) : {}; } catch {}
        const row = baseHeader.map((k) => csvCell(r[k]));
        for (const k of questionKeys) row.push(csvCell(answers[k]));
        lines.push(row.join(','));
    }

    const slug = String(eventRow.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `roster-${slug || 'event'}-${eventRow.date_iso?.slice(0, 10) || 'nodate'}.csv`;
    return new Response(lines.join('\n'), {
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
        },
    });
});

function csvCell(v) {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

// ───── Event CRUD ─────

// GET /api/admin/events/:id — single event + ticket types (including inactive)
adminEvents.get('/:id/detail', async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(id).first();
    if (!row) return c.json({ error: 'Event not found' }, 404);
    const tt = await c.env.DB.prepare(
        `SELECT * FROM ticket_types WHERE event_id = ? ORDER BY sort_order, name`
    ).bind(id).all();
    return c.json({
        event: { ...formatEvent(row), published: !!row.published },
        ticketTypes: (tt.results || []).map((t) => ({ ...formatTicketType(t), active: !!t.active })),
    });
});

// Validate any image URL with a HEAD request — fail fast on 404 / wrong type.
// Skipped for any URL pointing to our own /uploads/* path (R2-backed assets
// we minted ourselves). The upload endpoint returns a full absolute URL
// (`${SITE_URL}/uploads/${key}`), so we check both relative paths and
// absolute URLs whose pathname starts with /uploads/. Without this check
// the preflight would HEAD a URL that resolves back to this same Worker —
// causing a self-referential subrequest loop and a 522 timeout.
async function preflightCoverImage(url) {
    if (!url) return { ok: true };
    if (url.startsWith('/uploads/')) return { ok: true };
    try {
        const parsed = new URL(url);
        if (parsed.pathname.startsWith('/uploads/')) return { ok: true };
    } catch {
        // Not a parseable URL — fall through to the unreachable branch below.
    }
    try {
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok) return { ok: false, error: `Cover image URL returned ${res.status}` };
        const ct = res.headers.get('content-type') || '';
        if (!/^image\//i.test(ct)) return { ok: false, error: `Cover image URL is not an image (got ${ct || 'unknown'})` };
        return { ok: true };
    } catch (err) {
        return { ok: false, error: 'Cover image URL is unreachable' };
    }
}

// POST /api/admin/events — create event (manager+).
// Defaults: published=false, sales_close_at=dateIso-2hrs (configurable per event).
// Side effect: auto-creates one "General Admission" ticket type so the event is
// immediately bookable instead of silently empty.
adminEvents.post('/', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const { patch, error } = parseEventBody(body, { partial: false });
    if (error) return c.json({ error }, 400);

    // M5.5 B3 — Conflict detection on whole-day window when site_id + date_iso
    // are provided. Operator override via body.acknowledgeConflicts: true.
    // Per requireRole gate above, only owner/manager reach this handler, and
    // both can acknowledge (operator's "owner + operations director" decision).
    let conflictsToAudit = null;
    if (patch.site_id && patch.date_iso) {
        const dayWindow = dateIsoToDayWindow(patch.date_iso);
        if (dayWindow) {
            const conflicts = await detectEventConflicts(c.env, {
                siteId: patch.site_id,
                startsAt: dayWindow.startMs,
                endsAt: dayWindow.endMs,
            });
            if (hasAnyConflict(conflicts)) {
                if (!body.acknowledgeConflicts) {
                    return c.json({ error: 'Schedule conflict', conflicts }, 409);
                }
                conflictsToAudit = conflicts;
            }
        }
    }

    // Image preflight on every URL the admin set — reject before insert so the
    // editor surfaces the failure inline. Each surface column is independent.
    for (const col of ['cover_image_url', 'card_image_url', 'hero_image_url', 'banner_image_url', 'og_image_url']) {
        if (patch[col]) {
            const pf = await preflightCoverImage(patch[col]);
            if (!pf.ok) return c.json({ error: `${col}: ${pf.error}` }, 400);
        }
    }

    // ID strategy: if caller provides a slug, use it (lowercase-hyphen). Otherwise generate.
    let id = body.id ? slugify(body.id) : (patch.slug ? slugify(patch.slug) : slugify(patch.title));
    const existing = await c.env.DB.prepare(`SELECT id FROM events WHERE id = ?`).bind(id).first();
    if (existing) id = `${id}-${newEventId().slice(3, 9)}`;
    patch.slug = patch.slug || id;

    // Default sales_close_at to event start − 2 hours when caller didn't set it.
    // Caller can still pass null explicitly (parseEventBody preserves null) to
    // mean "never auto-close".
    let salesCloseAt = patch.sales_close_at;
    if (salesCloseAt === undefined && patch.date_iso) {
        const startMs = new Date(patch.date_iso).getTime();
        if (Number.isFinite(startMs)) salesCloseAt = startMs - (2 * 60 * 60 * 1000);
    }

    const now = Date.now();
    const cols = [
        'id', 'title', 'date_iso', 'display_date', 'display_day', 'display_month',
        'location', 'site', 'site_id', 'type', 'time_range', 'check_in', 'first_game', 'end_time',
        'base_price_cents', 'total_slots', 'addons_json', 'game_modes_json', 'details_json',
        'sales_close_at', 'published', 'past', 'featured',
        'cover_image_url', 'card_image_url', 'hero_image_url', 'banner_image_url', 'og_image_url',
        'short_description', 'slug', 'created_at', 'updated_at',
    ];
    const vals = {
        id,
        title: patch.title,
        date_iso: patch.date_iso,
        display_date: patch.display_date || null,
        display_day: patch.display_day || null,
        display_month: patch.display_month || null,
        location: patch.location || null,
        site: patch.site || null,
        site_id: patch.site_id || null,
        type: patch.type || null,
        time_range: patch.time_range || null,
        check_in: patch.check_in || null,
        first_game: patch.first_game || null,
        end_time: patch.end_time || null,
        base_price_cents: patch.base_price_cents,
        total_slots: patch.total_slots,
        addons_json: patch.addons_json,
        game_modes_json: patch.game_modes_json,
        details_json: patch.details_json ?? null,
        sales_close_at: salesCloseAt ?? null,
        published: patch.published ?? 0, // default UNPUBLISHED — admin must explicitly publish
        past: patch.past ?? 0,
        featured: patch.featured ?? 0,
        cover_image_url: patch.cover_image_url || null,
        card_image_url: patch.card_image_url || null,
        hero_image_url: patch.hero_image_url || null,
        banner_image_url: patch.banner_image_url || null,
        og_image_url: patch.og_image_url || null,
        short_description: patch.short_description || null,
        slug: patch.slug,
        created_at: now,
        updated_at: now,
    };
    const placeholders = cols.map(() => '?').join(', ');
    await c.env.DB.prepare(
        `INSERT INTO events (${cols.join(', ')}) VALUES (${placeholders})`
    ).bind(...cols.map((k) => vals[k])).run();

    // Auto-create a default ticket type so the event is immediately bookable.
    // Admin can rename / re-price / add tiers afterwards.
    const defaultTtId = newTicketTypeId();
    await c.env.DB.prepare(
        `INSERT INTO ticket_types (id, event_id, name, description, price_cents, capacity, sold, min_per_order, max_per_order, sort_order, active, created_at, updated_at)
         VALUES (?, ?, 'General Admission', NULL, ?, ?, 0, 1, ?, 0, 1, ?, ?)`
    ).bind(defaultTtId, id, vals.base_price_cents, vals.total_slots, vals.total_slots, now, now).run();

    // M5 R15: auto-instantiate event_checklists from active templates.
    // Failure is non-fatal — the event is still created. Operator can
    // re-run by editing the event_checklists table (helper is idempotent
    // via the UNIQUE(event_id, slug) constraint), or via a future
    // /admin/checklists CRUD page. Kept inside the create-event handler
    // so any future template refresh applies on the next event create.
    await instantiateChecklists(c.env, id).catch((err) => {
        console.error('checklist instantiate failed for event', id, err?.message);
    });

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'event.created', 'event', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ title: vals.title, defaultTicketTypeId: defaultTtId }), now).run();

    // M5.5 B3 — Audit-log conflict acknowledgment if operator chose to override.
    if (conflictsToAudit) {
        await c.env.DB.prepare(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
             VALUES (?, 'event.conflict_acknowledged', 'event', ?, ?, ?)`
        ).bind(user.id, id, JSON.stringify({ conflicts: conflictsToAudit }), Date.now()).run();
    }

    const row = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(id).first();
    return c.json({ event: { ...formatEvent(row), published: !!row.published } }, 201);
});

// PUT /api/admin/events/:id — update (manager+).
// Publish guard: refuses to set published=1 unless the event has at least one
// active ticket type. Prevents accidentally exposing an unbuyable event.
adminEvents.put('/:id', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await c.env.DB.prepare(`SELECT id, site_id, date_iso FROM events WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Event not found' }, 404);

    const { patch, error } = parseEventBody(body, { partial: true });
    if (error) return c.json({ error }, 400);

    // M5.5 B3 — Conflict detection on schedule changes. Uses existing values
    // for fields not in the patch (operator may be changing only site_id OR
    // only date_iso). Operator override via body.acknowledgeConflicts: true.
    let conflictsToAudit = null;
    const checkSiteId = patch.site_id ?? existing.site_id;
    const checkDateIso = patch.date_iso ?? existing.date_iso;
    const isScheduleChange = patch.site_id !== undefined || patch.date_iso !== undefined;
    if (isScheduleChange && checkSiteId && checkDateIso) {
        const dayWindow = dateIsoToDayWindow(checkDateIso);
        if (dayWindow) {
            const conflicts = await detectEventConflicts(c.env, {
                siteId: checkSiteId,
                startsAt: dayWindow.startMs,
                endsAt: dayWindow.endMs,
                excludeEventId: id,
            });
            if (hasAnyConflict(conflicts)) {
                if (!body.acknowledgeConflicts) {
                    return c.json({ error: 'Schedule conflict', conflicts }, 409);
                }
                conflictsToAudit = conflicts;
            }
        }
    }

    // Publish guard — block publish when there are zero active ticket types.
    if (patch.published === 1) {
        const tt = await c.env.DB.prepare(
            `SELECT COUNT(*) AS n FROM ticket_types WHERE event_id = ? AND active = 1`
        ).bind(id).first();
        if (!tt || (tt.n ?? 0) === 0) {
            return c.json({ error: 'Cannot publish: event has no active ticket types. Add at least one ticket type before publishing.' }, 400);
        }
    }

    // Image preflight, same as POST. Skip null values (clearing is fine).
    for (const col of ['cover_image_url', 'card_image_url', 'hero_image_url', 'banner_image_url', 'og_image_url']) {
        if (patch[col]) {
            const pf = await preflightCoverImage(patch[col]);
            if (!pf.ok) return c.json({ error: `${col}: ${pf.error}` }, 400);
        }
    }

    const keys = Object.keys(patch);
    if (keys.length === 0) return c.json({ error: 'No changes' }, 400);

    keys.push('updated_at');
    patch.updated_at = Date.now();
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const binds = keys.map((k) => patch[k]);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE events SET ${sets} WHERE id = ?`).bind(...binds).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'event.updated', 'event', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ fields: keys.filter((k) => k !== 'updated_at') }), Date.now()).run();

    // M5.5 B3 — Audit-log conflict acknowledgment if operator chose to override.
    if (conflictsToAudit) {
        await c.env.DB.prepare(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
             VALUES (?, 'event.conflict_acknowledged', 'event', ?, ?, ?)`
        ).bind(user.id, id, JSON.stringify({ conflicts: conflictsToAudit }), Date.now()).run();
    }

    const row = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(id).first();
    return c.json({ event: { ...formatEvent(row), published: !!row.published } });
});

// DELETE /api/admin/events/:id — delete if no bookings, else archive (owner)
adminEvents.delete('/:id', requireRole('owner'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(`SELECT id, title FROM events WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Event not found' }, 404);

    const bookingCount = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM bookings WHERE event_id = ?`
    ).bind(id).first();

    const now = Date.now();
    if (bookingCount?.n > 0) {
        // Soft-archive: unpublish + mark past
        await c.env.DB.prepare(
            `UPDATE events SET published = 0, past = 1, updated_at = ? WHERE id = ?`
        ).bind(now, id).run();
        await c.env.DB.prepare(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
             VALUES (?, 'event.archived', 'event', ?, ?, ?)`
        ).bind(user.id, id, JSON.stringify({ reason: 'has_bookings', count: bookingCount.n }), now).run();
        return c.json({ archived: true, reason: 'Event has bookings — archived instead of deleted' });
    }

    // No bookings → safe hard delete including ticket types
    await c.env.DB.prepare(`DELETE FROM ticket_types WHERE event_id = ?`).bind(id).run();
    await c.env.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'event.deleted', 'event', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ title: existing.title }), now).run();
    return c.json({ deleted: true });
});

// POST /api/admin/events/:id/duplicate — clone event + ticket types (manager+)
adminEvents.post('/:id/duplicate', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const sourceId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const src = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(sourceId).first();
    if (!src) return c.json({ error: 'Source event not found' }, 404);

    const newTitle = body.title?.trim() || `${src.title} (copy)`;
    const desiredId = body.id ? slugify(body.id) : slugify(newTitle);
    const collision = await c.env.DB.prepare(`SELECT id FROM events WHERE id = ?`).bind(desiredId).first();
    const newId = collision ? `${desiredId}-${newEventId().slice(3, 9)}` : desiredId;
    const now = Date.now();

    await c.env.DB.prepare(
        `INSERT INTO events (
            id, title, date_iso, display_date, display_day, display_month,
            location, site, type, time_range, check_in, first_game, end_time,
            base_price_cents, total_slots, addons_json, game_modes_json, details_json,
            sales_close_at, published, past,
            cover_image_url, card_image_url, hero_image_url, banner_image_url, og_image_url,
            short_description, slug, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        newId,
        newTitle,
        body.dateIso || src.date_iso,
        body.displayDate || src.display_date,
        body.displayDay || src.display_day,
        body.displayMonth || src.display_month,
        src.location, src.site, src.type, src.time_range, src.check_in, src.first_game, src.end_time,
        src.base_price_cents, src.total_slots, src.addons_json, src.game_modes_json, src.details_json,
        src.sales_close_at, // published forced to 0 above
        src.cover_image_url, src.card_image_url, src.hero_image_url, src.banner_image_url, src.og_image_url,
        src.short_description, newId,
        now, now,
    ).run();

    // Clone active ticket types with sold=0
    const tt = await c.env.DB.prepare(
        `SELECT * FROM ticket_types WHERE event_id = ? AND active = 1`
    ).bind(sourceId).all();
    for (const t of (tt.results || [])) {
        await c.env.DB.prepare(
            `INSERT INTO ticket_types (
                id, event_id, name, description, price_cents, capacity, sold,
                min_per_order, max_per_order, sale_starts_at, sale_ends_at, sort_order, active,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 1, ?, ?)`
        ).bind(
            newTicketTypeId(), newId, t.name, t.description, t.price_cents, t.capacity,
            t.min_per_order, t.max_per_order, t.sale_starts_at, t.sale_ends_at, t.sort_order,
            now, now,
        ).run();
    }

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'event.duplicated', 'event', ?, ?, ?)`
    ).bind(user.id, newId, JSON.stringify({ source_id: sourceId }), now).run();

    const row = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(newId).first();
    return c.json({ event: { ...formatEvent(row), published: !!row.published } }, 201);
});

// ───── Ticket Types ─────

function parseTicketTypeBody(body, { partial = false } = {}) {
    const patch = {};
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.description !== undefined) patch.description = body.description ? String(body.description).trim() : null;
    if (body.priceCents !== undefined) {
        const n = Number(body.priceCents);
        if (!Number.isFinite(n) || n < 0) return { error: 'priceCents must be a non-negative number' };
        patch.price_cents = Math.round(n);
    }
    if (body.capacity !== undefined) {
        if (body.capacity === null || body.capacity === '') patch.capacity = null;
        else {
            const n = Number(body.capacity);
            if (!Number.isFinite(n) || n < 0) return { error: 'capacity must be a non-negative number' };
            patch.capacity = Math.round(n);
        }
    }
    if (body.minPerOrder !== undefined) patch.min_per_order = Math.max(1, Number(body.minPerOrder) || 1);
    if (body.maxPerOrder !== undefined) {
        if (body.maxPerOrder === null || body.maxPerOrder === '') patch.max_per_order = null;
        else patch.max_per_order = Math.max(1, Number(body.maxPerOrder) || 1);
    }
    if (body.saleStartsAt !== undefined) patch.sale_starts_at = body.saleStartsAt || null;
    if (body.saleEndsAt !== undefined) patch.sale_ends_at = body.saleEndsAt || null;
    if (body.sortOrder !== undefined) patch.sort_order = Number(body.sortOrder) || 0;
    if (body.active !== undefined) patch.active = body.active ? 1 : 0;

    if (!partial) {
        if (!patch.name) return { error: 'name is required' };
        if (patch.price_cents == null) return { error: 'priceCents is required' };
    }
    return { patch };
}

// POST /api/admin/events/:id/ticket-types — create (manager+)
adminEvents.post('/:id/ticket-types', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const eventId = c.req.param('id');
    const eventRow = await c.env.DB.prepare(`SELECT id FROM events WHERE id = ?`).bind(eventId).first();
    if (!eventRow) return c.json({ error: 'Event not found' }, 404);

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const { patch, error } = parseTicketTypeBody(body, { partial: false });
    if (error) return c.json({ error }, 400);

    const id = body.id && typeof body.id === 'string' && body.id.startsWith('tt_')
        ? body.id : newTicketTypeId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO ticket_types (
            id, event_id, name, description, price_cents, capacity, sold,
            min_per_order, max_per_order, sale_starts_at, sale_ends_at, sort_order, active,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        id, eventId, patch.name, patch.description ?? null, patch.price_cents, patch.capacity ?? null,
        patch.min_per_order ?? 1, patch.max_per_order ?? null,
        patch.sale_starts_at ?? null, patch.sale_ends_at ?? null,
        patch.sort_order ?? 0, patch.active ?? 1,
        now, now,
    ).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'ticket_type.created', 'ticket_type', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ event_id: eventId, name: patch.name }), now).run();

    const row = await c.env.DB.prepare(`SELECT * FROM ticket_types WHERE id = ?`).bind(id).first();
    return c.json({ ticketType: { ...formatTicketType(row), active: !!row.active } }, 201);
});

// PUT /api/admin/ticket-types/:id — update (manager+). Mounted at /ticket-types below.
// DELETE /api/admin/ticket-types/:id — deactivate if sold>0, else hard delete (manager+).
const ticketTypes = new Hono();
ticketTypes.use('*', requireAuth);

ticketTypes.put('/:id', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

    const existing = await c.env.DB.prepare(`SELECT * FROM ticket_types WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Ticket type not found' }, 404);

    const { patch, error } = parseTicketTypeBody(body, { partial: true });
    if (error) return c.json({ error }, 400);

    // Don't let capacity go below already-sold count
    if (patch.capacity != null && patch.capacity < (existing.sold || 0)) {
        return c.json({ error: `Capacity cannot be less than already-sold count (${existing.sold})` }, 400);
    }

    const keys = Object.keys(patch);
    if (keys.length === 0) return c.json({ error: 'No changes' }, 400);
    keys.push('updated_at'); patch.updated_at = Date.now();
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const binds = keys.map((k) => patch[k]);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE ticket_types SET ${sets} WHERE id = ?`).bind(...binds).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'ticket_type.updated', 'ticket_type', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ fields: keys.filter((k) => k !== 'updated_at') }), Date.now()).run();

    const row = await c.env.DB.prepare(`SELECT * FROM ticket_types WHERE id = ?`).bind(id).first();
    return c.json({ ticketType: { ...formatTicketType(row), active: !!row.active } });
});

ticketTypes.delete('/:id', requireRole('owner', 'manager'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(`SELECT * FROM ticket_types WHERE id = ?`).bind(id).first();
    if (!existing) return c.json({ error: 'Ticket type not found' }, 404);

    const now = Date.now();
    if ((existing.sold || 0) > 0) {
        // Soft deactivate — can't hard delete, bookings reference it
        await c.env.DB.prepare(
            `UPDATE ticket_types SET active = 0, updated_at = ? WHERE id = ?`
        ).bind(now, id).run();
        await c.env.DB.prepare(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
             VALUES (?, 'ticket_type.deactivated', 'ticket_type', ?, ?, ?)`
        ).bind(user.id, id, JSON.stringify({ reason: 'has_sales' }), now).run();
        return c.json({ deactivated: true });
    }
    await c.env.DB.prepare(`DELETE FROM ticket_types WHERE id = ?`).bind(id).run();
    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'ticket_type.deleted', 'ticket_type', ?, ?, ?)`
    ).bind(user.id, id, JSON.stringify({ name: existing.name }), now).run();
    return c.json({ deleted: true });
});

export { ticketTypes };
export default adminEvents;

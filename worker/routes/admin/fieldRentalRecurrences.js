// Sprint 4 B4 — field-rental recurrence series management.
//
// The M5.5 B10a cron (worker/lib/fieldRentalRecurrences.js) has generated
// instances from field_rental_recurrences rows since it shipped — but no
// API or UI could ever CREATE, pause, or end a series, so recurring rentals
// were SQL-only. The capabilities were seeded in migration 0049 waiting for
// exactly this: recurrence_create / recurrence_modify / recurrence_end.
//
// Endpoints:
//   GET  /api/admin/field-rental-recurrences        list (open read)
//   GET  /api/admin/field-rental-recurrences/:id    detail + generated instances
//   POST /api/admin/field-rental-recurrences        create a series
//   POST /:id/pause    stop generating (resumable)
//   POST /:id/resume   resume WITHOUT backfilling the paused gap (see below)
//   POST /:id/end      permanent: deactivate + cancel future cancellable instances
//
// Resume semantics: the cron generates from recurrence_generated_through + 1,
// so a naive resume after a long pause would retro-generate rentals for dates
// inside the paused gap (possibly in the past). Resume therefore bumps the
// sentinel to yesterday — generation continues from today, the gap stays a gap.
//
// The runbook (docs/runbooks/field-rental-recurrences.md) documents the UI
// path plus SQL fallback recipes.

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';
import { requireCapability, requireReadAccess } from '../../lib/capabilities.js';
import { writeAudit } from '../../lib/auditLog.js';
import { recurrenceId as newRecurrenceId } from '../../lib/ids.js';
import { FIELD_RENTAL_ENGAGEMENT_TYPES, validateStatusTransition } from '../../lib/fieldRentals.js';
import { parseWeekdayMask, parseMonthlyPattern, parseCustomDates, isoDate } from '../../lib/fieldRentalRecurrences.js';

const adminFieldRentalRecurrences = new Hono();
adminFieldRentalRecurrences.use('*', requireAuth);

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function formatRecurrence(row) {
    if (!row) return null;
    return {
        id: row.id,
        customerId: row.customer_id,
        siteId: row.site_id,
        frequency: row.frequency,
        weekdayMask: row.weekday_mask,
        monthlyPattern: row.monthly_pattern ? JSON.parse(row.monthly_pattern) : null,
        customDates: row.custom_dates_json ? JSON.parse(row.custom_dates_json) : null,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        maxOccurrences: row.max_occurrences,
        template: {
            engagementType: row.template_engagement_type,
            siteFieldIds: row.template_site_field_ids,
            startsLocal: row.template_starts_local,
            endsLocal: row.template_ends_local,
            siteFeeCents: row.template_site_fee_cents,
            pricingNotes: row.template_pricing_notes,
        },
        generatedThrough: row.recurrence_generated_through,
        active: row.active === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// ────────────────────────────────────────────────────────────────────
// GET / — list series with customer/site names + instance counts
// ────────────────────────────────────────────────────────────────────
adminFieldRentalRecurrences.get('/', requireReadAccess, async (c) => {
    const rows = await c.env.DB.prepare(
        `SELECT r.*, cu.name AS customer_name, s.name AS site_name,
                (SELECT COUNT(*) FROM field_rentals fr WHERE fr.recurrence_id = r.id) AS instance_count
         FROM field_rental_recurrences r
         LEFT JOIN customers cu ON cu.id = r.customer_id
         LEFT JOIN sites s ON s.id = r.site_id
         ORDER BY r.active DESC, r.created_at DESC`,
    ).all();
    return c.json({
        recurrences: (rows.results || []).map((row) => ({
            ...formatRecurrence(row),
            customerName: row.customer_name,
            siteName: row.site_name,
            instanceCount: row.instance_count || 0,
        })),
    });
});

// ────────────────────────────────────────────────────────────────────
// GET /:id — series detail + its generated instances
// ────────────────────────────────────────────────────────────────────
adminFieldRentalRecurrences.get('/:id', requireReadAccess, async (c) => {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
        `SELECT r.*, cu.name AS customer_name, s.name AS site_name
         FROM field_rental_recurrences r
         LEFT JOIN customers cu ON cu.id = r.customer_id
         LEFT JOIN sites s ON s.id = r.site_id
         WHERE r.id = ?`,
    ).bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);

    const instances = await c.env.DB.prepare(
        `SELECT id, recurrence_instance_index, scheduled_starts_at, scheduled_ends_at, status
         FROM field_rentals WHERE recurrence_id = ?
         ORDER BY recurrence_instance_index ASC`,
    ).bind(id).all();

    return c.json({
        recurrence: {
            ...formatRecurrence(row),
            customerName: row.customer_name,
            siteName: row.site_name,
        },
        instances: (instances.results || []).map((r) => ({
            id: r.id,
            index: r.recurrence_instance_index,
            scheduledStartsAt: r.scheduled_starts_at,
            scheduledEndsAt: r.scheduled_ends_at,
            status: r.status,
        })),
    });
});

// ────────────────────────────────────────────────────────────────────
// POST / — create a series. The nightly cron generates the instances
// (90-day horizon), so nothing appears instantly — the response says so.
// ────────────────────────────────────────────────────────────────────
adminFieldRentalRecurrences.post('/', requireCapability('field_rentals.recurrence_create'), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));

    const customerId = String(body.customerId || '').trim();
    const siteId = String(body.siteId || '').trim();
    if (!customerId || !siteId) return c.json({ error: 'customerId and siteId are required' }, 400);

    const [customer, site] = await Promise.all([
        c.env.DB.prepare('SELECT id FROM customers WHERE id = ?').bind(customerId).first(),
        c.env.DB.prepare('SELECT id FROM sites WHERE id = ?').bind(siteId).first(),
    ]);
    if (!customer) return c.json({ error: 'Unknown customerId' }, 400);
    if (!site) return c.json({ error: 'Unknown siteId' }, 400);

    const frequency = String(body.frequency || '');
    if (!['weekly', 'monthly', 'custom'].includes(frequency)) {
        return c.json({ error: 'frequency must be weekly, monthly or custom' }, 400);
    }

    // Frequency-specific rules — validated with the SAME lib parsers the
    // generation cron uses, so a series that saves is a series that generates.
    let weekdayMask = null;
    let monthlyPattern = null;
    let customDatesJson = null;
    if (frequency === 'weekly') {
        weekdayMask = Number(body.weekdayMask);
        if (!Number.isInteger(weekdayMask) || parseWeekdayMask(weekdayMask).length === 0) {
            return c.json({ error: 'weekdayMask must select at least one weekday (bitmask, 1=Sun … 64=Sat)' }, 400);
        }
    } else if (frequency === 'monthly') {
        const parsed = parseMonthlyPattern(body.monthlyPattern);
        if (!parsed) {
            return c.json({ error: 'monthlyPattern must be {"kind":"nth_weekday","n":1-5,"weekday":0-6} or {"kind":"day_of_month","day":1-31}' }, 400);
        }
        monthlyPattern = JSON.stringify(parsed);
    } else {
        const dates = parseCustomDates(body.customDates);
        if (!dates || dates.length === 0) {
            return c.json({ error: 'customDates must be a non-empty array of YYYY-MM-DD strings' }, 400);
        }
        customDatesJson = JSON.stringify(dates);
    }

    const startsOn = String(body.startsOn || '');
    if (!DATE_RE.test(startsOn)) return c.json({ error: 'startsOn must be YYYY-MM-DD' }, 400);
    const endsOn = body.endsOn ? String(body.endsOn) : null;
    if (endsOn && (!DATE_RE.test(endsOn) || endsOn < startsOn)) {
        return c.json({ error: 'endsOn must be YYYY-MM-DD on or after startsOn' }, 400);
    }
    let maxOccurrences = null;
    if (body.maxOccurrences != null && body.maxOccurrences !== '') {
        maxOccurrences = Number(body.maxOccurrences);
        if (!Number.isInteger(maxOccurrences) || maxOccurrences < 1) {
            return c.json({ error: 'maxOccurrences must be a positive integer' }, 400);
        }
    }

    const t = body.template || {};
    if (!FIELD_RENTAL_ENGAGEMENT_TYPES.includes(t.engagementType)) {
        return c.json({ error: `template.engagementType must be one of ${FIELD_RENTAL_ENGAGEMENT_TYPES.join(', ')}` }, 400);
    }
    const siteFieldIds = String(t.siteFieldIds || '').trim();
    if (!siteFieldIds) return c.json({ error: 'template.siteFieldIds is required (comma-separated fld_* ids)' }, 400);
    const startsLocal = String(t.startsLocal || '');
    const endsLocal = String(t.endsLocal || '');
    if (!HHMM_RE.test(startsLocal) || !HHMM_RE.test(endsLocal)) {
        return c.json({ error: 'template.startsLocal / endsLocal must be HH:MM (24h, America/Denver wall clock)' }, 400);
    }
    // HH:MM strings compare correctly lexicographically. Same-day only —
    // combineDateAndLocal anchors both times to the occurrence date, so an
    // overnight span would generate ends-before-starts and be skipped.
    if (endsLocal <= startsLocal) {
        return c.json({ error: 'template.endsLocal must be after startsLocal (same-day rentals only)' }, 400);
    }
    const siteFeeCents = Number(t.siteFeeCents);
    if (!Number.isInteger(siteFeeCents) || siteFeeCents < 0) {
        return c.json({ error: 'template.siteFeeCents must be a non-negative integer' }, 400);
    }

    const id = newRecurrenceId();
    const now = Date.now();
    await c.env.DB.prepare(
        `INSERT INTO field_rental_recurrences (
            id, customer_id, site_id, frequency, weekday_mask, monthly_pattern, custom_dates_json,
            starts_on, ends_on, max_occurrences,
            template_engagement_type, template_site_field_ids, template_starts_local,
            template_ends_local, template_site_fee_cents, template_pricing_notes,
            recurrence_generated_through, active, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?)`,
    ).bind(
        id, customerId, siteId, frequency, weekdayMask, monthlyPattern, customDatesJson,
        startsOn, endsOn, maxOccurrences,
        t.engagementType, siteFieldIds, startsLocal, endsLocal, siteFeeCents,
        t.pricingNotes ? String(t.pricingNotes) : null,
        user.id, now, now,
    ).run();

    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental_recurrence.created',
        targetType: 'field_rental_recurrence',
        targetId: id,
        meta: { customerId, siteId, frequency, startsOn, endsOn, maxOccurrences },
    });

    return c.json({
        ok: true,
        id,
        note: 'Instances are generated by the nightly 03:00 UTC sweep (90-day horizon) — nothing appears immediately.',
    }, 201);
});

async function getSeries(env, id) {
    return env.DB.prepare('SELECT * FROM field_rental_recurrences WHERE id = ?').bind(id).first();
}

// ────────────────────────────────────────────────────────────────────
// POST /:id/pause — stop generating; resumable
// ────────────────────────────────────────────────────────────────────
adminFieldRentalRecurrences.post('/:id/pause', requireCapability('field_rentals.recurrence_modify'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const series = await getSeries(c.env, id);
    if (!series) return c.json({ error: 'Not found' }, 404);
    if (series.active !== 1) return c.json({ error: 'Series is not active' }, 409);

    await c.env.DB.prepare(
        'UPDATE field_rental_recurrences SET active = 0, updated_at = ? WHERE id = ?',
    ).bind(Date.now(), id).run();
    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental_recurrence.paused',
        targetType: 'field_rental_recurrence',
        targetId: id,
    });
    return c.json({ ok: true, active: false });
});

// ────────────────────────────────────────────────────────────────────
// POST /:id/resume — reactivate WITHOUT backfilling the paused gap
// ────────────────────────────────────────────────────────────────────
adminFieldRentalRecurrences.post('/:id/resume', requireCapability('field_rentals.recurrence_modify'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const series = await getSeries(c.env, id);
    if (!series) return c.json({ error: 'Not found' }, 404);
    if (series.active === 1) return c.json({ error: 'Series is already active' }, 409);
    if (series.ends_on && series.ends_on < isoDate(Date.now())) {
        return c.json({ error: 'Series has ended (ends_on is in the past) — create a new series instead' }, 409);
    }

    // The cron generates from recurrence_generated_through + 1. Left alone
    // after a long pause, that would retro-generate rentals for dates inside
    // the gap — some already in the past. Bump the sentinel to yesterday so
    // generation continues from TODAY; the paused gap stays a gap.
    const yesterday = isoDate(Date.now() - DAY_MS);
    const newSentinel = (series.recurrence_generated_through && series.recurrence_generated_through > yesterday)
        ? series.recurrence_generated_through
        : yesterday;

    await c.env.DB.prepare(
        'UPDATE field_rental_recurrences SET active = 1, recurrence_generated_through = ?, updated_at = ? WHERE id = ?',
    ).bind(newSentinel, Date.now(), id).run();
    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental_recurrence.resumed',
        targetType: 'field_rental_recurrence',
        targetId: id,
        meta: { sentinelBumpedTo: newSentinel },
    });
    return c.json({ ok: true, active: true, generatedThrough: newSentinel });
});

// ────────────────────────────────────────────────────────────────────
// POST /:id/end — permanent: deactivate + cancel future cancellable instances
// ────────────────────────────────────────────────────────────────────
adminFieldRentalRecurrences.post('/:id/end', requireCapability('field_rentals.recurrence_end'), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const reason = body.reason ? String(body.reason) : 'Series ended';

    const series = await getSeries(c.env, id);
    if (!series) return c.json({ error: 'Not found' }, 404);

    const now = Date.now();
    const today = isoDate(now);

    // Deactivate + close the window so a later resume cannot revive it.
    await c.env.DB.prepare(
        'UPDATE field_rental_recurrences SET active = 0, ends_on = ?, updated_at = ? WHERE id = ?',
    ).bind(today, now, id).run();

    // Cancel FUTURE generated instances that are still in a cancellable
    // status. Paid/completed instances are deliberately untouched — money
    // has moved; those follow the per-rental cancel/refund flows with their
    // deposit semantics. Mirrors the per-rental cancel UPDATE (status matrix:
    // lead/draft/sent/agreed → cancelled).
    const future = await c.env.DB.prepare(
        `SELECT id, status FROM field_rentals
         WHERE recurrence_id = ? AND scheduled_starts_at > ? AND archived_at IS NULL`,
    ).bind(id, now).all();

    let cancelled = 0;
    let skipped = 0;
    for (const inst of (future.results || [])) {
        if (!validateStatusTransition(inst.status, 'cancelled')) { skipped++; continue; }
        await c.env.DB.prepare(
            `UPDATE field_rentals
             SET status = 'cancelled', status_changed_at = ?, status_change_reason = ?,
                 cancelled_at = ?, cancellation_reason = ?, lead_stale_at = NULL, updated_at = ?
             WHERE id = ?`,
        ).bind(now, reason, now, reason, now, inst.id).run();
        cancelled++;
    }

    await writeAudit(c.env, {
        userId: user.id,
        action: 'field_rental_recurrence.ended',
        targetType: 'field_rental_recurrence',
        targetId: id,
        meta: { reason, futureCancelled: cancelled, futureSkipped: skipped },
    });

    return c.json({ ok: true, futureCancelled: cancelled, futureSkipped: skipped });
});

export default adminFieldRentalRecurrences;

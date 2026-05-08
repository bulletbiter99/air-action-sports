// M5 R15 — Event-day checklists lib (Surface 5).
//
// Pure helpers + I/O wrappers backing /api/event-day/checklists and
// /api/event-day/hq plus the auto-instantiate hook in
// worker/routes/admin/events.js.
//
// Schema reference: migrations/0042_event_checklists.sql
//   checklist_templates, checklist_template_items,
//   event_checklists, event_checklist_items
//
// Design:
//   - Templates live in DB; M5 ships SQL-only management.
//   - On event creation, instantiateChecklists() snapshots the
//     active templates into per-event rows. Idempotent — UNIQUE
//     (event_id, slug) means re-running skips already-instantiated
//     templates.
//   - Toggle endpoint flips done_at on an item, then recomputes
//     parent checklist's completed_at via computeCompletedAt.
//   - HQ aggregate combines roster, staffing, and checklist counts
//     into one event-day-auth endpoint (replacing EventHQ's
//     silent-401 admin-side fetches).

import { writeAudit } from './auditLog.js';

// ────────────────────────────────────────────────────────────────────
// Internal id generator
// ────────────────────────────────────────────────────────────────────

export function randomChecklistId(prefix) {
    const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return `${prefix}_${out}`;
}

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Returns `now` (epoch ms) when EVERY required item in `items` has a
 * non-null done_at. Returns null otherwise.
 *
 * Non-required items are ignored — they don't gate completion. This
 * matches the M5 prompt's checklist semantics: marshals can complete
 * a checklist without filling in optional weather notes etc.
 *
 * @param {Array<{required: number|boolean, done_at: number|null}>} items
 * @param {number} now - epoch ms (injected for testability)
 * @returns {number|null}
 */
export function computeCompletedAt(items, now = Date.now()) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const requiredItems = items.filter((i) => i.required === 1 || i.required === true);
    if (requiredItems.length === 0) {
        // No required items — all items are optional. Treat as
        // completed when EVERY item is done (rare edge case).
        if (items.every((i) => i.done_at != null)) return now;
        return null;
    }
    if (requiredItems.every((i) => i.done_at != null)) return now;
    return null;
}

// ────────────────────────────────────────────────────────────────────
// I/O wrappers
// ────────────────────────────────────────────────────────────────────

/**
 * Instantiates active templates as event_checklists + event_checklist_items
 * rows for the given event. Idempotent: if a template's slug is already
 * instantiated for this event (UNIQUE constraint), it is skipped.
 *
 * Called from worker/routes/admin/events.js POST /api/admin/events
 * after the event row is INSERTed. Failure is non-fatal at the call
 * site (wrapped in .catch).
 *
 * @param {object} env
 * @param {string} eventId
 * @returns {Promise<{instantiated: number, skipped: number}>}
 */
export async function instantiateChecklists(env, eventId) {
    if (!eventId) throw new Error('instantiateChecklists: eventId required');

    const now = Date.now();
    const result = { instantiated: 0, skipped: 0 };

    // Load all active, non-archived templates plus their items in one
    // shot. We keep these queries simple (no joins) so the mock-D1
    // tests can match on substring patterns cleanly.
    const tplResult = await env.DB.prepare(
        `SELECT id, slug, title, role_key
         FROM checklist_templates
         WHERE active = 1 AND archived_at IS NULL
         ORDER BY slug`,
    ).all();

    for (const tpl of (tplResult.results || [])) {
        // Idempotency check before INSERT — UNIQUE constraint would
        // also catch this, but checking up front keeps audit + items
        // inserts atomic-ish per template.
        const existing = await env.DB.prepare(
            'SELECT id FROM event_checklists WHERE event_id = ? AND slug = ?',
        ).bind(eventId, tpl.slug).first();
        if (existing) {
            result.skipped++;
            continue;
        }

        const checklistId = randomChecklistId('echk');
        await env.DB.prepare(
            `INSERT INTO event_checklists (
                id, event_id, template_id, slug, title, role_key,
                completed_at, completed_by_person_id, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
        ).bind(checklistId, eventId, tpl.id, tpl.slug, tpl.title, tpl.role_key, now).run();

        // Snapshot the template's items into event_checklist_items.
        const itemsResult = await env.DB.prepare(
            `SELECT id, position, label, required
             FROM checklist_template_items
             WHERE template_id = ?
             ORDER BY position`,
        ).bind(tpl.id).all();

        for (const it of (itemsResult.results || [])) {
            await env.DB.prepare(
                `INSERT INTO event_checklist_items (
                    id, event_checklist_id, template_item_id, position,
                    label, required, done_at, done_by_person_id, notes, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
            ).bind(
                randomChecklistId('echki'),
                checklistId,
                it.id,
                it.position,
                it.label,
                it.required,
                now,
            ).run();
        }

        result.instantiated++;
    }

    return result;
}

/**
 * Returns the per-event checklists with nested item arrays. Shape
 * mirrors what EventChecklist.jsx renders.
 */
export async function listChecklistsForEvent(env, eventId) {
    const checklistsResult = await env.DB.prepare(
        `SELECT id, template_id, slug, title, role_key, completed_at, completed_by_person_id, created_at
         FROM event_checklists
         WHERE event_id = ?
         ORDER BY slug`,
    ).bind(eventId).all();

    const checklists = checklistsResult.results || [];
    const out = [];
    for (const cl of checklists) {
        const itemsResult = await env.DB.prepare(
            `SELECT id, template_item_id, position, label, required, done_at, done_by_person_id, notes
             FROM event_checklist_items
             WHERE event_checklist_id = ?
             ORDER BY position`,
        ).bind(cl.id).all();

        out.push({
            id: cl.id,
            slug: cl.slug,
            title: cl.title,
            roleKey: cl.role_key,
            completedAt: cl.completed_at,
            completedByPersonId: cl.completed_by_person_id,
            items: (itemsResult.results || []).map((i) => ({
                id: i.id,
                templateItemId: i.template_item_id,
                position: i.position,
                label: i.label,
                required: !!i.required,
                doneAt: i.done_at,
                doneByPersonId: i.done_by_person_id,
                notes: i.notes,
            })),
        });
    }
    return out;
}

/**
 * Toggle a single item's done state. Looks up the item, verifies it
 * belongs to a checklist for the given event (security), updates
 * done_at + done_by, then recomputes the parent checklist's
 * completed_at via computeCompletedAt.
 *
 * Returns the updated item shape + parent's completedAt.
 */
export async function toggleChecklistItem(env, opts) {
    const { itemId, eventId, personId, done, notes } = opts;
    if (!itemId) throw new Error('toggleChecklistItem: itemId required');
    if (!eventId) throw new Error('toggleChecklistItem: eventId required');

    // Look up item + parent checklist + scope check.
    const item = await env.DB.prepare(
        `SELECT eci.id, eci.event_checklist_id, eci.position, eci.label, eci.required,
                eci.done_at, ec.event_id
         FROM event_checklist_items eci
         INNER JOIN event_checklists ec ON ec.id = eci.event_checklist_id
         WHERE eci.id = ?`,
    ).bind(itemId).first();
    if (!item) return { error: 'item_not_found' };
    if (item.event_id !== eventId) return { error: 'wrong_event' };

    const now = Date.now();
    const newDoneAt = done ? now : null;
    const newDoneBy = done ? (personId || null) : null;
    const newNotes = notes !== undefined ? (notes ? String(notes) : null) : null;

    await env.DB.prepare(
        `UPDATE event_checklist_items
         SET done_at = ?, done_by_person_id = ?, notes = ?
         WHERE id = ?`,
    ).bind(newDoneAt, newDoneBy, newNotes, itemId).run();

    // Recompute parent's completed_at.
    const siblingsResult = await env.DB.prepare(
        `SELECT id, required, done_at FROM event_checklist_items WHERE event_checklist_id = ?`,
    ).bind(item.event_checklist_id).all();

    // Patch the toggled item's done_at into the snapshot before
    // computing — the UPDATE above might not be visible in the same
    // logical read on D1 mocks.
    const siblings = (siblingsResult.results || []).map((s) =>
        s.id === itemId ? { ...s, done_at: newDoneAt } : s,
    );
    const completedAt = computeCompletedAt(siblings, now);

    await env.DB.prepare(
        `UPDATE event_checklists
         SET completed_at = ?, completed_by_person_id = ?
         WHERE id = ?`,
    ).bind(
        completedAt,
        completedAt && personId ? personId : null,
        item.event_checklist_id,
    ).run();

    await writeAudit(env, {
        userId: null,
        action: done ? 'event_day.checklist_item_done' : 'event_day.checklist_item_undone',
        targetType: 'event_checklist_item',
        targetId: itemId,
        meta: {
            eventId,
            personId: personId || null,
            checklistId: item.event_checklist_id,
            label: item.label,
        },
    });

    return {
        item: {
            id: itemId,
            label: item.label,
            required: !!item.required,
            doneAt: newDoneAt,
            doneByPersonId: newDoneBy,
            notes: newNotes,
        },
        checklistId: item.event_checklist_id,
        completedAt,
    };
}

/**
 * Aggregate dashboard counts for HQ. Returns roster total / checked-in,
 * staffing total / present, checklists total / completed, plus the last
 * 10 audit_log rows scoped to this event.
 */
export async function getEventHqAggregate(env, eventId) {
    if (!eventId) throw new Error('getEventHqAggregate: eventId required');

    // Roster: paid + comp attendees.
    const rosterRow = await env.DB.prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN a.checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checked_in
         FROM attendees a
         INNER JOIN bookings b ON b.id = a.booking_id
         WHERE b.event_id = ? AND b.status IN ('paid', 'comp')`,
    ).bind(eventId).first();

    // Staffing: count assignments and "present" = rsvp accepted + not no-show.
    const staffRow = await env.DB.prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN rsvp = 'accepted' AND no_show_at IS NULL THEN 1 ELSE 0 END) AS present
         FROM event_staffing
         WHERE event_id = ?`,
    ).bind(eventId).first().catch(() => ({ total: 0, present: 0 }));

    // Checklists: count instances and completed.
    const checklistRow = await env.DB.prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed
         FROM event_checklists
         WHERE event_id = ?`,
    ).bind(eventId).first().catch(() => ({ total: 0, completed: 0 }));

    // Recent activity: last 10 audit_log rows. Filter on action prefix
    // event_day.* OR target_id matching event_id where target_type='event'.
    const activityResult = await env.DB.prepare(
        `SELECT action, target_type, target_id, meta_json, created_at
         FROM audit_log
         WHERE (
             (target_type = 'event' AND target_id = ?)
             OR (action LIKE 'event_day.%' AND meta_json LIKE ?)
         )
         ORDER BY created_at DESC
         LIMIT 10`,
    ).bind(eventId, `%${eventId}%`).all().catch(() => ({ results: [] }));

    return {
        eventId,
        rosterTotal: Number(rosterRow?.total || 0),
        rosterCheckedIn: Number(rosterRow?.checked_in || 0),
        staffTotal: Number(staffRow?.total || 0),
        staffPresent: Number(staffRow?.present || 0),
        checklistsTotal: Number(checklistRow?.total || 0),
        checklistsCompleted: Number(checklistRow?.completed || 0),
        recentActivity: (activityResult.results || []).map((r) => ({
            at: r.created_at,
            action: r.action,
            targetType: r.target_type,
            targetId: r.target_id,
        })),
    };
}

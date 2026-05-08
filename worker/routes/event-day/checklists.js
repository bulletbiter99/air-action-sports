// M5 R15 — Event-day checklists endpoints (Surface 5).
//
// Mounted at /api/event-day/checklists. Routes:
//   GET   /                      — list active event's checklists
//                                  with nested item arrays.
//   POST  /:id/items/:itemId/toggle — flip an item's done state.
//                                     Recomputes parent checklist's
//                                     completed_at via lib helper.
//
// All routes gated by R12's requireEventDayAuth.

import { Hono } from 'hono';
import { requireEventDayAuth } from '../../lib/eventDaySession.js';
import {
    listChecklistsForEvent,
    toggleChecklistItem,
} from '../../lib/eventChecklists.js';

const eventDayChecklists = new Hono();
eventDayChecklists.use('*', requireEventDayAuth);

// ────────────────────────────────────────────────────────────────────
// GET /api/event-day/checklists
// ────────────────────────────────────────────────────────────────────

eventDayChecklists.get('/', async (c) => {
    const event = c.get('event');
    const checklists = await listChecklistsForEvent(c.env, event.id);
    return c.json({
        eventId: event.id,
        checklists,
        total: checklists.length,
        completed: checklists.filter((cl) => cl.completedAt).length,
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/event-day/checklists/:id/items/:itemId/toggle
// ────────────────────────────────────────────────────────────────────
//
// `:id` is the event_checklist_id (parent). `:itemId` is the
// event_checklist_item_id. The lib's wrong_event check uses the item's
// joined event_id, so the URL `:id` is informational — but we still
// validate it matches to surface a clean 404 if the URL is malformed.

eventDayChecklists.post('/:id/items/:itemId/toggle', async (c) => {
    const event = c.get('event');
    const person = c.get('person');
    const checklistId = c.req.param('id');
    const itemId = c.req.param('itemId');
    const body = await c.req.json().catch(() => ({}));

    if (typeof body.done !== 'boolean') {
        return c.json({ error: 'done_required', message: 'body.done must be a boolean' }, 400);
    }

    const result = await toggleChecklistItem(c.env, {
        itemId,
        eventId: event.id,
        personId: person?.id || null,
        done: body.done,
        notes: body.notes,
    });

    if (result.error === 'item_not_found') {
        return c.json({ error: 'item_not_found' }, 404);
    }
    if (result.error === 'wrong_event') {
        return c.json({ error: 'wrong_event' }, 404);
    }
    // Defensive: lib's wrong_event check is canonical, but if a
    // malformed URL passed a different :id we surface that too.
    if (checklistId && checklistId !== result.checklistId) {
        return c.json({ error: 'checklist_id_mismatch' }, 400);
    }

    return c.json({
        ok: true,
        item: result.item,
        checklistId: result.checklistId,
        checklistCompletedAt: result.completedAt,
    });
});

export default eventDayChecklists;

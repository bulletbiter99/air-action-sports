// M5 R15 — Event-day HQ aggregate dashboard (Surface 5).
//
// Mounted at /api/event-day/hq. Single endpoint:
//   GET / — return roster / staffing / checklist counts + recent
//           activity. Aggregate scoped to the active event-day
//           session's event. Replaces EventHQ.jsx's original
//           two-fetch admin pattern (which silent-401'd under
//           portal cookies — same fix R14 applied to roster +
//           equipment-return).
//
// Gated by R12's requireEventDayAuth.

import { Hono } from 'hono';
import { requireEventDayAuth } from '../../lib/eventDaySession.js';
import { getEventHqAggregate } from '../../lib/eventChecklists.js';

const eventDayHq = new Hono();
eventDayHq.use('*', requireEventDayAuth);

eventDayHq.get('/', async (c) => {
    const event = c.get('event');
    const aggregate = await getEventHqAggregate(c.env, event.id);
    return c.json(aggregate);
});

export default eventDayHq;

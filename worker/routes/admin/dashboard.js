// M4 B4b — admin dashboard endpoints.
//
// Currently ships one endpoint:
//
//   GET /api/admin/today/active
//
//        Returns { activeEventToday, eventId, checkInOpen } — used by
//        the dashboard's refresh-cadence primitive (src/hooks/useWidgetData.js)
//        to promote polling rate from 5min default → 30s when an event
//        runs today → 10s during the check-in window. M4 B5 (sidebar
//        dynamic Today nav item) and M4 B6 (walk-up active-checkin
//        banner) also consume this endpoint, so its response shape is a
//        contract — don't change `activeEventToday` / `eventId` /
//        `checkInOpen` field names without coordinating with B5/B6.
//
//        Auth: requireAuth — any role tier (owner/manager/staff). The
//        endpoint reveals only "is there an event today" + the id; same
//        sensitivity as /api/admin/events?include_past=0 which staff
//        already see for the event-day roster.
//
//        Today's date: computed in UTC via SQLite's
//        date('now','unixepoch') — matches how events.date_iso is
//        stored (a literal 'YYYY-MM-DD' string set at event-creation
//        time in the venue's local timezone, conventionally UTC-naïve).
//        Near midnight UTC vs midnight venue-local can produce a brief
//        mismatch; refining to true venue-tz is deferred (no venue_tz
//        column on events today; out of scope for B4b).
//
//        checkInOpen: stub returns false in B4b. Refining to true
//        check-in-window logic requires parsing events.check_in /
//        events.first_game time strings into a tz-aware instant; that
//        complexity is deferred to a later batch where the cadence
//        primitive's 10s tier becomes useful (no widgets in B4b
//        currently rely on the 10s tier — only TodayCheckIns in B4c
//        will).

import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';

const adminDashboard = new Hono();
adminDashboard.use('*', requireAuth);

adminDashboard.get('/today/active', async (c) => {
    // Today in UTC YYYY-MM-DD format. SQLite's date('now') already
    // returns this format, so we hand it directly to the comparison.
    const todayRow = await c.env.DB.prepare(
        `SELECT date('now') AS today`,
    ).first();
    const today = todayRow?.today || new Date().toISOString().slice(0, 10);

    // Find published, non-past events scheduled for today. Limit 2 so we
    // can detect the multiple-events-today case without scanning the
    // whole day's rows.
    const eventsResult = await c.env.DB.prepare(
        `SELECT id FROM events
         WHERE date_iso = ? AND published = 1 AND past = 0
         ORDER BY id
         LIMIT 2`,
    ).bind(today).all();

    const events = eventsResult.results || [];
    const activeEventToday = events.length > 0;
    // eventId is null when there's 0 or 2+ events today (ambiguous —
    // caller can fetch the list endpoint if it needs to disambiguate).
    const eventId = events.length === 1 ? events[0].id : null;

    return c.json({
        activeEventToday,
        eventId,
        checkInOpen: false,
    });
});

export default adminDashboard;

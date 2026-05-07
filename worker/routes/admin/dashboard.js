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

// ────────────────────────────────────────────────────────────────────
// M4 B4d — owner persona endpoints
// ────────────────────────────────────────────────────────────────────

// GET /api/admin/dashboard/upcoming-readiness
//
// Returns top-3 upcoming events with capacity + waiver readiness for the
// owner's UpcomingEventsReadiness widget.
//
// Response shape: { events: [ { eventId, title, dateIso, totalSlots,
//   paidCount, attendeeCount, waiverSignedCount, capacityPct, waiverPct } ] }
//
// Auth: any admin role (matches /today/active — read-only event metadata).
adminDashboard.get('/dashboard/upcoming-readiness', async (c) => {
    // Today in UTC; events with date_iso strictly greater than today are
    // the "upcoming" set. (Today's events live on the dashboard already
    // via TodayEvents — no need to surface them here too.)
    const todayRow = await c.env.DB.prepare(`SELECT date('now') AS today`).first();
    const today = todayRow?.today || new Date().toISOString().slice(0, 10);

    const eventsResult = await c.env.DB.prepare(
        `SELECT id, title, date_iso, total_slots
         FROM events
         WHERE date_iso > ? AND published = 1 AND past = 0
         ORDER BY date_iso ASC
         LIMIT 3`,
    ).bind(today).all();

    const events = eventsResult.results || [];
    if (events.length === 0) return c.json({ events: [] });

    const ids = events.map((e) => e.id);
    const placeholders = ids.map(() => '?').join(',');

    // Two parallel queries: paid-booking counts + attendee/waiver counts.
    // Both filter to status IN ('paid', 'comp') so unpaid placeholders
    // don't inflate the readiness numbers.
    const [bookingStats, attendeeStats] = await Promise.all([
        c.env.DB.prepare(
            `SELECT event_id, COUNT(*) AS paid_count
             FROM bookings
             WHERE event_id IN (${placeholders}) AND status = 'paid'
             GROUP BY event_id`,
        ).bind(...ids).all(),
        c.env.DB.prepare(
            `SELECT b.event_id,
                    COUNT(a.id) AS attendees,
                    COUNT(CASE WHEN a.waiver_id IS NOT NULL THEN 1 END) AS waivers_signed
             FROM attendees a
             JOIN bookings b ON b.id = a.booking_id
             WHERE b.event_id IN (${placeholders}) AND b.status IN ('paid', 'comp')
             GROUP BY b.event_id`,
        ).bind(...ids).all(),
    ]);

    const bookingByEvent = {};
    for (const r of (bookingStats.results || [])) bookingByEvent[r.event_id] = r;
    const attendeeByEvent = {};
    for (const r of (attendeeStats.results || [])) attendeeByEvent[r.event_id] = r;

    const result = events.map((e) => {
        const b = bookingByEvent[e.id] || {};
        const a = attendeeByEvent[e.id] || {};
        const totalSlots = e.total_slots || 0;
        const paidCount = b.paid_count || 0;
        const attendees = a.attendees || 0;
        const waiversSigned = a.waivers_signed || 0;
        return {
            eventId: e.id,
            title: e.title,
            dateIso: e.date_iso,
            totalSlots,
            paidCount,
            attendeeCount: attendees,
            waiverSignedCount: waiversSigned,
            capacityPct: totalSlots > 0
                ? Math.min(100, Math.round((paidCount / totalSlots) * 100))
                : 0,
            waiverPct: attendees > 0
                ? Math.min(100, Math.round((waiversSigned / attendees) * 100))
                : 0,
        };
    });

    return c.json({ events: result });
});

// GET /api/admin/dashboard/action-queue
//
// Returns aggregated counts of items needing owner attention, for the
// ActionQueue widget. Each count is a single COUNT query; runs in
// parallel via Promise.all.
//
// Response shape: { missingWaiversCount, pendingVendorCountersignsCount,
//   feedbackUntriagedCount, recentRefundsCount }
//
// Definitions:
//   - missingWaivers: paid bookings with at least one attendee missing
//     a waiver_id. Some attendees may not legally need a waiver (age tier),
//     so this can overcount — close enough for an at-a-glance triage badge.
//   - pendingVendorCountersigns: vendor_signatures rows where the owner
//     hasn't yet countersigned (countersigned_at IS NULL).
//   - feedbackUntriaged: feedback rows still in 'new' status.
//   - recentRefunds: bookings refunded in the last 7 days. Indicator of
//     refund volume rather than "needs action" — but useful pulse for
//     owner triage. Audit's prescribed "Pending refunds" + "COIs expiring"
//     are conservatively replaced (no refund-request flag exists in
//     schema today; COI expiration would need a vendor_documents query
//     scoped to expires_at — deferred refinement).
//
// Auth: any admin role (matches /today/active — read-only counts).
adminDashboard.get('/dashboard/action-queue', async (c) => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const [missingWaivers, pendingCountersigns, feedbackUntriaged, recentRefunds] = await Promise.all([
        c.env.DB.prepare(
            `SELECT COUNT(DISTINCT b.id) AS n
             FROM bookings b
             JOIN attendees a ON a.booking_id = b.id
             WHERE b.status = 'paid' AND a.waiver_id IS NULL`,
        ).first(),
        c.env.DB.prepare(
            `SELECT COUNT(*) AS n
             FROM vendor_signatures
             WHERE countersigned_at IS NULL`,
        ).first(),
        c.env.DB.prepare(
            `SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'`,
        ).first(),
        c.env.DB.prepare(
            `SELECT COUNT(*) AS n
             FROM bookings
             WHERE refunded_at IS NOT NULL AND refunded_at >= ?`,
        ).bind(sevenDaysAgo).first(),
    ]);

    return c.json({
        missingWaiversCount: missingWaivers?.n || 0,
        pendingVendorCountersignsCount: pendingCountersigns?.n || 0,
        feedbackUntriagedCount: feedbackUntriaged?.n || 0,
        recentRefundsCount: recentRefunds?.n || 0,
    });
});

export default adminDashboard;

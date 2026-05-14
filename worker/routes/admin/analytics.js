import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth.js';

const adminAnalytics = new Hono();
adminAnalytics.use('*', requireAuth);

// GET /api/admin/analytics/overview
// Top-line metrics across all time OR constrained to an event via ?event_id=
//
// M4 B4d: ?period=mtd filters bookings to the current month
// (paid_at >= month_start_ms, computed in UTC). Default 'lifetime'
// preserves the pre-B4d behavior — RevenueSummary widget passes
// ?period=mtd; legacy callers (none modified) continue to see lifetime
// numbers. attendees / checkedIn / waiversSigned stay all-time even in
// MTD mode (they're not time-scoped concepts; they reflect cumulative
// state of paid/comp bookings).
adminAnalytics.get('/overview', async (c) => {
    const url = new URL(c.req.url);
    const eventId = url.searchParams.get('event_id');
    const period = url.searchParams.get('period') || 'lifetime';

    if (!['lifetime', 'mtd'].includes(period)) {
        return c.json({ error: "period must be 'lifetime' or 'mtd'" }, 400);
    }

    // Compute MTD start (1st of current UTC month at midnight, in ms).
    const monthStartMs = period === 'mtd'
        ? Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
        : null;

    const whereClauses = [];
    const binds = [];
    if (eventId) { whereClauses.push('event_id = ?'); binds.push(eventId); }
    if (monthStartMs !== null) { whereClauses.push('paid_at >= ?'); binds.push(monthStartMs); }
    const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // M4 B4f: extend the byStatus aggregation with tax_cents + fee_cents
    // SUMs so the Bookkeeper persona's TaxFeeSummary widget can read them
    // off the same response. Existing callers ignore unfamiliar fields.
    const byStatus = await c.env.DB.prepare(
        `SELECT status,
                COUNT(*) AS n,
                COALESCE(SUM(total_cents), 0) AS gross_cents,
                COALESCE(SUM(tax_cents), 0) AS tax_cents,
                COALESCE(SUM(fee_cents), 0) AS fee_cents
         FROM bookings ${where}
         GROUP BY status`
    ).bind(...binds).all();

    const status = {};
    for (const row of (byStatus.results || [])) {
        status[row.status] = {
            count: row.n,
            grossCents: row.gross_cents,
            taxCents: row.tax_cents,
            feeCents: row.fee_cents,
        };
    }

    // Attendee counts across paid/comp — in MTD mode, also scope to bookings
    // paid this month so the count reflects the same time window.
    const attClauses = [`b.status IN ('paid', 'comp')`];
    const attBinds = [];
    if (eventId) { attClauses.push('b.event_id = ?'); attBinds.push(eventId); }
    if (monthStartMs !== null) { attClauses.push('b.paid_at >= ?'); attBinds.push(monthStartMs); }

    const attendeeRow = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n,
                COUNT(CASE WHEN a.checked_in_at IS NOT NULL THEN 1 END) AS checked_in,
                COUNT(CASE WHEN a.waiver_id IS NOT NULL THEN 1 END) AS waivers_signed
         FROM attendees a
         JOIN bookings b ON b.id = a.booking_id
         WHERE ${attClauses.join(' AND ')}`
    ).bind(...attBinds).first();

    // Revenue — bookkeeping shape:
    //   Gross = all money that flowed in historically (paid + refunded bookings'
    //           original totals, since refunding flips status='paid' → 'refunded'
    //           but the total_cents is preserved on the row).
    //   Refunded = totals on currently-refunded rows.
    //   Net = Gross − Refunded = paidGross (what's still on the books).
    // Subtracting refundedGross from paidGross directly would double-count,
    // because the two CASE WHEN buckets are mutually exclusive — a refund
    // already removed the booking from paidGross, so subtracting it again
    // makes net go negative (showed as -$320 with $0 paid / $320 refunded).
    const paidGross = status.paid?.grossCents || 0;
    const refundedGross = status.refunded?.grossCents || 0;
    const grossRevenueCents = paidGross + refundedGross;
    const netRevenueCents = paidGross;

    const paidCount = status.paid?.count || 0;
    const refundedCount = status.refunded?.count || 0;
    const totalBookings = Object.values(status).reduce((s, v) => s + v.count, 0);

    // M4 B4f: tax + fees collected across paid/comp bookings for the
    // current scope (event_id and/or period filters apply via the byStatus
    // WHERE). Used by the Bookkeeper persona's TaxFeeSummary widget.
    const paidTax = status.paid?.taxCents || 0;
    const compTax = status.comp?.taxCents || 0;
    const paidFee = status.paid?.feeCents || 0;
    const compFee = status.comp?.feeCents || 0;

    return c.json({
        byStatus: status,
        totals: {
            bookings: totalBookings,
            paidCount,
            netRevenueCents,
            grossRevenueCents,
            refundedCents: refundedGross,
            taxCents: paidTax + compTax,
            feeCents: paidFee + compFee,
            avgOrderCents: paidCount > 0 ? Math.round(paidGross / paidCount) : 0,
            refundRate: paidCount > 0 ? refundedCount / paidCount : 0,
            attendees: attendeeRow?.n || 0,
            checkedIn: attendeeRow?.checked_in || 0,
            waiversSigned: attendeeRow?.waivers_signed || 0,
        },
    });
});

// GET /api/admin/analytics/sales-series?event_id=&days=30
// Daily paid-booking count + gross revenue for the trailing window. Fills
// missing days with zeros so the chart is continuous.
adminAnalytics.get('/sales-series', async (c) => {
    const url = new URL(c.req.url);
    const eventId = url.searchParams.get('event_id');
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days') || 30)));

    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);

    const clauses = [`status IN ('paid', 'comp')`, `paid_at IS NOT NULL`, `paid_at >= ?`, `paid_at <= ?`];
    const binds = [start.getTime(), end.getTime()];
    if (eventId) { clauses.push(`event_id = ?`); binds.push(eventId); }

    const rows = await c.env.DB.prepare(
        `SELECT date(paid_at / 1000, 'unixepoch') AS d,
                COUNT(*) AS bookings,
                COALESCE(SUM(player_count), 0) AS players,
                COALESCE(SUM(CASE WHEN status = 'paid' THEN total_cents ELSE 0 END), 0) AS gross_cents
         FROM bookings
         WHERE ${clauses.join(' AND ')}
         GROUP BY d
         ORDER BY d ASC`
    ).bind(...binds).all();

    const byDate = new Map();
    for (const r of (rows.results || [])) byDate.set(r.d, r);

    const series = [];
    const cursor = new Date(start);
    while (cursor <= end) {
        const key = cursor.toISOString().slice(0, 10);
        const r = byDate.get(key);
        series.push({
            date: key,
            bookings: r?.bookings || 0,
            players: r?.players || 0,
            grossCents: r?.gross_cents || 0,
        });
        cursor.setDate(cursor.getDate() + 1);
    }

    return c.json({ days, series });
});

// GET /api/admin/analytics/per-event
// Per-event metrics: sold, capacity, fill rate, gross, refunded, attendance, waiver rate.
adminAnalytics.get('/per-event', async (c) => {
    const events = await c.env.DB.prepare(
        `SELECT id, title, date_iso, display_date, total_slots, published, past
         FROM events
         ORDER BY date_iso DESC`
    ).all();

    const rows = events.results || [];
    if (rows.length === 0) return c.json({ events: [] });

    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');

    const [bookingStats, attendeeStats, capacityStats] = await Promise.all([
        c.env.DB.prepare(
            // gross_cents includes refunded rows' original totals — refunding
            // flips status='paid' → 'refunded' but preserves total_cents. This
            // keeps gross showing the lifetime money received, so the
            // gross − refunded = paid math at the consumer downstream stays
            // correct (instead of going negative when everything is refunded).
            `SELECT event_id,
                    SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
                    SUM(CASE WHEN status = 'comp' THEN 1 ELSE 0 END) AS comp_count,
                    SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS refunded_count,
                    SUM(CASE WHEN status IN ('paid', 'refunded') THEN total_cents ELSE 0 END) AS gross_cents,
                    SUM(CASE WHEN status = 'refunded' THEN total_cents ELSE 0 END) AS refunded_cents,
                    SUM(CASE WHEN status IN ('paid', 'comp') THEN player_count ELSE 0 END) AS seats_sold
             FROM bookings WHERE event_id IN (${placeholders})
             GROUP BY event_id`
        ).bind(...ids).all(),
        c.env.DB.prepare(
            `SELECT b.event_id,
                    COUNT(a.id) AS attendees,
                    COUNT(CASE WHEN a.checked_in_at IS NOT NULL THEN 1 END) AS checked_in,
                    COUNT(CASE WHEN a.waiver_id IS NOT NULL THEN 1 END) AS waivers_signed
             FROM attendees a
             JOIN bookings b ON b.id = a.booking_id
             WHERE b.event_id IN (${placeholders}) AND b.status IN ('paid', 'comp')
             GROUP BY b.event_id`
        ).bind(...ids).all(),
        c.env.DB.prepare(
            `SELECT event_id, COALESCE(SUM(capacity), 0) AS tt_capacity
             FROM ticket_types WHERE event_id IN (${placeholders}) AND active = 1
             GROUP BY event_id`
        ).bind(...ids).all(),
    ]);

    const bookingByEvent = {};
    for (const r of (bookingStats.results || [])) bookingByEvent[r.event_id] = r;
    const attByEvent = {};
    for (const r of (attendeeStats.results || [])) attByEvent[r.event_id] = r;
    const capByEvent = {};
    for (const r of (capacityStats.results || [])) capByEvent[r.event_id] = r.tt_capacity;

    const result = rows.map((e) => {
        const b = bookingByEvent[e.id] || {};
        const a = attByEvent[e.id] || {};
        const ttCap = capByEvent[e.id] || 0;
        const capacity = ttCap || e.total_slots || 0;
        const seatsSold = b.seats_sold || 0;
        return {
            id: e.id,
            title: e.title,
            dateIso: e.date_iso,
            displayDate: e.display_date,
            published: !!e.published,
            past: !!e.past,
            capacity,
            seatsSold,
            fillRate: capacity > 0 ? seatsSold / capacity : 0,
            paidBookings: b.paid_count || 0,
            compBookings: b.comp_count || 0,
            refundedBookings: b.refunded_count || 0,
            grossCents: b.gross_cents || 0,
            refundedCents: b.refunded_cents || 0,
            netCents: (b.gross_cents || 0) - (b.refunded_cents || 0),
            attendees: a.attendees || 0,
            checkedIn: a.checked_in || 0,
            waiversSigned: a.waivers_signed || 0,
            checkInRate: a.attendees > 0 ? a.checked_in / a.attendees : 0,
            waiverRate: a.attendees > 0 ? a.waivers_signed / a.attendees : 0,
        };
    });

    return c.json({ events: result });
});

// GET /api/admin/analytics/attendance/:event_id
// Check-in rate over time on event day (for "show-up curve"). Returns hourly buckets.
adminAnalytics.get('/attendance/:eventId', async (c) => {
    const eventId = c.req.param('eventId');
    const rows = await c.env.DB.prepare(
        `SELECT a.checked_in_at
         FROM attendees a
         JOIN bookings b ON b.id = a.booking_id
         WHERE b.event_id = ? AND b.status IN ('paid', 'comp') AND a.checked_in_at IS NOT NULL
         ORDER BY a.checked_in_at ASC`
    ).bind(eventId).all();

    const checkIns = (rows.results || []).map((r) => r.checked_in_at);
    // Bucket by hour from the first check-in.
    const buckets = [];
    if (checkIns.length) {
        const first = new Date(checkIns[0]);
        first.setMinutes(0, 0, 0);
        const last = new Date(checkIns[checkIns.length - 1]);
        last.setMinutes(59, 59, 999);
        const cursor = new Date(first);
        while (cursor <= last) {
            const start = cursor.getTime();
            const end = start + 60 * 60 * 1000;
            const count = checkIns.filter((t) => t >= start && t < end).length;
            buckets.push({ hour: cursor.toISOString(), count });
            cursor.setHours(cursor.getHours() + 1);
        }
    }
    return c.json({ checkIns: checkIns.length, buckets });
});

// GET /api/admin/analytics/funnel?days=30
//
// M4 B4e — 4-step "checkout funnel" computed from bookings + attendees
// for the trailing N-day window. Powers the Marketing persona's
// ConversionFunnel widget.
//
// Step definitions:
//   - Created:    bookings WHERE created_at >= window_start_ms
//   - Paid:       bookings WHERE status IN ('paid', 'comp') AND
//                 paid_at >= window_start_ms
//   - Waivers:    attendees WHERE waiver_id IS NOT NULL JOIN bookings
//                 WHERE status IN ('paid', 'comp') AND
//                 paid_at >= window_start_ms
//   - Checked in: attendees WHERE checked_in_at IS NOT NULL JOIN
//                 bookings WHERE status IN ('paid', 'comp') AND
//                 paid_at >= window_start_ms
//
// Caveat: step 4 (Checked in) lags reality because future events
// inside the window haven't happened yet. Acceptable for a trend
// indicator; not a precise per-event metric. M5+ refinements could
// scope step 4 by event_date <= now() for stricter accuracy.
adminAnalytics.get('/funnel', async (c) => {
    const url = new URL(c.req.url);
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days') || 30)));
    const windowStartMs = Date.now() - days * 24 * 60 * 60 * 1000;

    const [createdRow, paidRow, waiversRow, checkedInRow] = await Promise.all([
        c.env.DB.prepare(
            `SELECT COUNT(*) AS n FROM bookings WHERE created_at >= ?`,
        ).bind(windowStartMs).first(),
        c.env.DB.prepare(
            `SELECT COUNT(*) AS n FROM bookings
             WHERE status IN ('paid', 'comp') AND paid_at >= ?`,
        ).bind(windowStartMs).first(),
        c.env.DB.prepare(
            `SELECT COUNT(*) AS n
             FROM attendees a
             JOIN bookings b ON b.id = a.booking_id
             WHERE a.waiver_id IS NOT NULL
               AND b.status IN ('paid', 'comp')
               AND b.paid_at >= ?`,
        ).bind(windowStartMs).first(),
        c.env.DB.prepare(
            `SELECT COUNT(*) AS n
             FROM attendees a
             JOIN bookings b ON b.id = a.booking_id
             WHERE a.checked_in_at IS NOT NULL
               AND b.status IN ('paid', 'comp')
               AND b.paid_at >= ?`,
        ).bind(windowStartMs).first(),
    ]);

    return c.json({
        days,
        steps: [
            { name: 'Created', count: createdRow?.n || 0 },
            { name: 'Paid', count: paidRow?.n || 0 },
            { name: 'Waivers', count: waiversRow?.n || 0 },
            { name: 'Checked in', count: checkedInRow?.n || 0 },
        ],
    });
});

// GET /api/admin/analytics/cron-status — proves the reminder cron is alive.
// Returns:
//   - lastSweepAt: ms epoch of the most recent scheduled() run (audit row)
//   - lastSweepMeta: JSON-parsed meta from that row (reminders/pending/vendor counts)
//   - reminders24h: { sent24hr, sent1hr } — count of reminder.sent events in last 24h
// Lightweight enough to call on the admin dashboard mount.
adminAnalytics.get('/cron-status', async (c) => {
    const last = await c.env.DB.prepare(
        `SELECT created_at, meta_json
         FROM audit_log
         WHERE action = 'cron.swept'
         ORDER BY created_at DESC
         LIMIT 1`
    ).first();

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const counts = await c.env.DB.prepare(
        `SELECT action, COUNT(*) AS n
         FROM audit_log
         WHERE action IN ('reminder.sent', 'reminder_1hr.sent')
           AND created_at >= ?
         GROUP BY action`
    ).bind(cutoff).all();

    const counts24h = { 'reminder.sent': 0, 'reminder_1hr.sent': 0 };
    for (const row of (counts.results || [])) counts24h[row.action] = row.n;

    let lastSweepMeta = null;
    if (last?.meta_json) {
        try { lastSweepMeta = JSON.parse(last.meta_json); }
        catch { /* shrug */ }
    }

    return c.json({
        lastSweepAt: last?.created_at || null,
        lastSweepMeta,
        reminders24h: {
            sent24hr: counts24h['reminder.sent'],
            sent1hr: counts24h['reminder_1hr.sent'],
        },
    });
});

export default adminAnalytics;

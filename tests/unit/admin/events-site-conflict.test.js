// Event site_id ↔ conflict detection (audit B3).
//
// The M5.5 conflict engine, the 409, and the three-section override banner in
// AdminEvents were all built and working — and unreachable, because nothing in
// the admin ever sent `siteId`. Every UI-created event had site_id NULL, and
// detectEventConflicts short-circuits on a falsy siteId, so the guard at
// `if (patch.site_id && patch.date_iso)` never even called it.
//
// The server already accepted siteId; the gap was the client. These tests pin
// the server half of the contract — including the 409 that the newly-reachable
// banner renders — so the path can't silently close again.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { parseEventBody } from '../../../worker/routes/admin/events.js';
import { formatEvent } from '../../../worker/lib/formatters.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

describe('parseEventBody — siteId', () => {
    it('maps siteId → site_id', () => {
        const { patch } = parseEventBody({ siteId: 'site_ghosttown' }, { partial: true });
        expect(patch.site_id).toBe('site_ghosttown');
    });

    it("coerces '' to NULL so the FK column never holds an empty string", () => {
        // The Venue picker's blank option posts ''. POST already coerced via
        // `patch.site_id || null`, but the PUT patch loop writes straight through.
        expect(parseEventBody({ siteId: '' }, { partial: true }).patch.site_id).toBeNull();
        expect(parseEventBody({ siteId: null }, { partial: true }).patch.site_id).toBeNull();
    });

    it('omits site_id entirely when absent (partial-update safety)', () => {
        const { patch } = parseEventBody({ title: 'X' }, { partial: true });
        expect('site_id' in patch).toBe(false);
    });
});

describe('formatEvent — siteId', () => {
    it('exposes site_id so the editor can read back the current venue', () => {
        // Without this the admin could set a venue but never see it again.
        expect(formatEvent({ site_id: 'site_ghosttown' }).siteId).toBe('site_ghosttown');
        expect(formatEvent({ site_id: null }).siteId).toBeNull();
        expect(formatEvent({}).siteId).toBeNull();
    });

    it('keeps `site` (series/brand) distinct from `siteId` (venue FK)', () => {
        const out = formatEvent({ site: 'Delta', site_id: 'site_ghosttown' });
        expect(out.site).toBe('Delta');
        expect(out.siteId).toBe('site_ghosttown');
    });
});

const CREATE_BODY = {
    title: 'Operation Overlap',
    dateIso: '2026-09-12T08:30:00',
    siteId: 'site_ghosttown',
    basePriceCents: 6000,
    totalSlots: 100,
};

/**
 * Wire the create path. `conflictingEvents` feeds the conflict engine's
 * same-venue/same-day scan.
 *
 * NOTE: mockD1 returns the FIRST registered handler that matches, so the two
 * `... FROM events WHERE id = ?` reads (collision check, then the post-insert
 * read-back) must be registered as distinct patterns.
 */
function bindCreate(env, { conflictingEvents = [] } = {}) {
    // Conflict engine (all three buckets).
    env.DB.__on(/FROM events/, { results: conflictingEvents }, 'all');
    env.DB.__on(/FROM site_blackouts/, { results: [] }, 'all');
    env.DB.__on(/FROM field_rentals/, { results: [] }, 'all');
    // Id-collision check → free.
    env.DB.__on(/SELECT id FROM events WHERE id = \?/, null, 'first');
    // Post-insert read-back, which the handler passes to formatEvent().
    env.DB.__on(/SELECT \* FROM events WHERE id = \?/, {
        id: 'operation-overlap', title: 'Operation Overlap', published: 0,
    }, 'first');
}

async function postEvent(env, cookieHeader, body) {
    const req = new Request('https://airactionsport.com/api/admin/events', {
        method: 'POST',
        headers: { cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return worker.fetch(req, env, {});
}

async function ownerEnv() {
    const env = createMockEnv();
    const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    return { env, cookieHeader };
}

describe('POST /api/admin/events — conflict detection is reachable via siteId', () => {
    it('409s with a conflicts payload when the venue is already booked that day', async () => {
        const { env, cookieHeader } = await ownerEnv();
        // An existing event at the same venue on the same day.
        bindCreate(env, {
            conflictingEvents: [{
                id: 'evt_existing',
                title: 'Operation Existing',
                date_iso: '2026-09-12T19:45:00',
                end_date_iso: null,
            }],
        });

        const res = await postEvent(env, cookieHeader, CREATE_BODY);
        expect(res.status).toBe(409);

        const body = await res.json();
        expect(body.error).toMatch(/conflict/i);
        // The banner renders these three buckets.
        expect(body.conflicts).toHaveProperty('events');
        expect(body.conflicts.events.length).toBeGreaterThan(0);

        // Nothing was written.
        expect(env.DB.__writes().some((w) => /INSERT INTO events/.test(w.sql))).toBe(false);
    });

    it('proceeds and audits the override when acknowledgeConflicts is set', async () => {
        const { env, cookieHeader } = await ownerEnv();
        bindCreate(env, {
            conflictingEvents: [{
                id: 'evt_existing',
                title: 'Operation Existing',
                date_iso: '2026-09-12T19:45:00',
                end_date_iso: null,
            }],
        });

        const res = await postEvent(env, cookieHeader, { ...CREATE_BODY, acknowledgeConflicts: true });
        expect(res.status).toBe(201);

        const writes = env.DB.__writes();
        expect(writes.some((w) => /INSERT INTO events/.test(w.sql))).toBe(true);
        // The action is a literal in the SQL, not a bind arg.
        expect(writes.some((w) => /event\.conflict_acknowledged/.test(w.sql))).toBe(true);
    });

    it('skips the check entirely when no venue is set (site_id NULL)', async () => {
        const { env, cookieHeader } = await ownerEnv();
        bindCreate(env);

        // '' is what the Venue picker's blank option posts.
        const res = await postEvent(env, cookieHeader, { ...CREATE_BODY, siteId: '' });
        expect(res.status).toBe(201);

        const inserted = env.DB.__writes().find((w) => /INSERT INTO events/.test(w.sql));
        const cols = inserted.sql.slice(inserted.sql.indexOf('(') + 1, inserted.sql.indexOf(')')).split(',').map((s) => s.trim());
        expect(inserted.args[cols.indexOf('site_id')]).toBeNull();
    });
});

// Sprint 4 C1 — the public event visibility contract.
//
//   upcoming listing (/api/events)                → published = 1 AND past = 0
//   archive listing  (/api/events?include_past=1) → upcoming OR past = 1
//                                                   (past=1 regardless of published)
//   detail           (/api/events/:idOrSlug)      → published = 1 OR past = 1
//
// The old shape gated everything on published=1 — but every natural
// end-of-life action (soft-archive, unpublish+mark-past) sets published=0,
// so nothing could EVER appear on /games and its detail links 404'd.
// Bookability is enforced separately at /quote + /checkout (see
// tests/unit/bookings/sales-close-gate.test.js).

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';

let env;
beforeEach(() => {
    env = createMockEnv();
    // Empty ticket-types / seats / archive-links sub-queries for any id set.
    env.DB.__on(/FROM ticket_types/, { results: [] }, 'all');
    env.DB.__on(/FROM bookings/, { results: [] }, 'all');
    env.DB.__on(/FROM event_archive_links/, { results: [] }, 'all');
});

describe('GET /api/events — listing WHERE clauses', () => {
    it('upcoming listing filters to published AND not past', async () => {
        env.DB.__on(/SELECT \* FROM events/, { results: [] }, 'all');
        const res = await worker.fetch(new Request('https://airactionsport.com/api/events'), env, {});
        expect(res.status).toBe(200);
        const listQuery = env.DB.__writes().find((e) => /SELECT \* FROM events/.test(e.sql));
        expect(listQuery.sql).toMatch(/published = 1 AND past = 0/);
        // The archive branch must NOT leak into the upcoming listing.
        expect(listQuery.sql).not.toMatch(/OR past = 1/);
    });

    it('include_past=1 also includes past=1 events regardless of published', async () => {
        env.DB.__on(/SELECT \* FROM events/, { results: [] }, 'all');
        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/events?include_past=1&archive=1'), env, {});
        expect(res.status).toBe(200);
        const listQuery = env.DB.__writes().find((e) => /SELECT \* FROM events/.test(e.sql));
        expect(listQuery.sql).toMatch(/\(published = 1 AND past = 0\) OR past = 1/);
    });

    it('serves an archived (published=0, past=1) event through the archive listing', async () => {
        env.DB.__on(/SELECT \* FROM events/, {
            results: [{
                id: 'evt_done', slug: 'operation-done', title: 'Operation Done',
                date_iso: '2026-07-25T08:30:00', published: 0, past: 1,
                base_price_cents: 6000, created_at: 1700000000000,
            }],
        }, 'all');
        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/events?include_past=1&archive=1'), env, {});
        const body = await res.json();
        expect(body.events).toHaveLength(1);
        expect(body.events[0].past).toBe(true);
        expect(body.events[0].archiveLinks).toEqual([]);
    });
});

describe('GET /api/events/:idOrSlug — detail visibility', () => {
    it('matches published OR past in the detail query (archived stays reachable from /games)', async () => {
        env.DB.__on(/FROM events WHERE \(id = \? OR slug = \?\)/, {
            id: 'evt_done', slug: 'operation-done', title: 'Operation Done',
            date_iso: '2026-07-25T08:30:00', published: 0, past: 1,
            base_price_cents: 6000, created_at: 1700000000000,
        }, 'first');
        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/events/operation-done'), env, {});
        expect(res.status).toBe(200);
        const detailQuery = env.DB.__writes().find((e) => /FROM events WHERE \(id = \? OR slug = \?\)/.test(e.sql));
        expect(detailQuery.sql).toMatch(/\(published = 1 OR past = 1\)/);
        const body = await res.json();
        expect(body.event.past).toBe(true);
    });
});

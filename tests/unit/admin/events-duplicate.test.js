// POST /api/admin/events/:id/duplicate — column carry-over contract (audit A6).
//
// The duplicate handler used to hand-list 31 of the events table's 40 columns,
// so every `ALTER TABLE events ADD COLUMN` since 0009 silently widened what a
// duplicate threw away: custom_questions_json (the live events' REQUIRED faction
// picker), site_id (which also made the clone invisible to conflict detection),
// featured, and all six *_overlay_opacity / *_image_position values.
//
// It now derives the carry set from the source row, so these tests are the pin
// that a future column is copied by default rather than dropped.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import { getSchemaDb } from '../../helpers/realSchema.js';

const SOURCE_ID = 'operation-source';
const START_ISO = '2026-09-12T08:30:00';
const START_MS = Date.parse(START_ISO);
const TWO_HOURS = 2 * 60 * 60 * 1000;

/** A source row carrying a distinctive value in every events column. */
function sourceRow(overrides = {}) {
    return {
        id: SOURCE_ID,
        title: 'Operation Source',
        slug: 'operation-source',
        date_iso: START_ISO,
        end_date_iso: null,
        display_date: '12 September 2026',
        display_day: '12',
        display_month: 'September 2026',
        location: 'Ghost Town - Hiawatha, UT',
        site: 'Delta',
        site_id: 'site_ghosttown',
        type: 'airsoft',
        time_range: '8:30 AM - 9:00 PM',
        check_in: '8:00 AM',
        first_game: '9:00 AM',
        end_time: '9:00 PM',
        base_price_cents: 6000,
        total_slots: 350,
        addons_json: '[{"name":"Rental"}]',
        game_modes_json: '["milsim"]',
        details_json: '{"missionBriefing":["Brief."]}',
        custom_questions_json: '[{"key":"faction","required":true}]',
        sales_close_at: START_MS - TWO_HOURS,
        published: 1,
        past: 1,
        featured: 1,
        cover_image_url: '/uploads/events/cover.jpg',
        card_image_url: '/uploads/events/card.jpg',
        hero_image_url: '/uploads/events/hero.jpg',
        banner_image_url: '/uploads/events/banner.jpg',
        og_image_url: '/uploads/events/og.jpg',
        card_overlay_opacity: 0.35,
        hero_overlay_opacity: 0.4,
        banner_overlay_opacity: 0.45,
        card_image_position: '50% 30%',
        hero_image_position: '40% 60%',
        banner_image_position: '20% 80%',
        short_description: 'A source event.',
        created_at: 1_700_000_000_000,
        updated_at: 1_700_000_000_000,
        ...overrides,
    };
}

/**
 * Wire up the queries the duplicate handler makes and capture the INSERT.
 * Returns a getter for the inserted { column: value } map.
 */
function bindDuplicate(env, src) {
    const inserted = {};
    // Both the source lookup and the post-insert read-back use
    // `SELECT * FROM events WHERE id = ?` — branch on the bound id.
    env.DB.__on(/SELECT \* FROM events WHERE id = \?/, (sql, args) => (
        args[0] === src.id ? src : { ...src, ...inserted }
    ), 'first');
    // Collision check for the new id → none.
    env.DB.__on(/SELECT id FROM events WHERE id = \?/, null, 'first');
    env.DB.__on(/SELECT \* FROM ticket_types WHERE event_id = \? AND active = 1/, { results: [] }, 'all');
    env.DB.__on(/INSERT INTO events \(/, (sql, args) => {
        const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map((s) => s.trim());
        cols.forEach((col, i) => { inserted[col] = args[i]; });
        return { meta: { changes: 1 } };
    }, 'run');
    return () => inserted;
}

async function duplicate(env, cookieHeader, body = {}) {
    const req = new Request(`https://airactionsport.com/api/admin/events/${SOURCE_ID}/duplicate`, {
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

describe('POST /api/admin/events/:id/duplicate', () => {
    it('carries EVERY events column that is not deliberately reset', async () => {
        const { env, cookieHeader } = await ownerEnv();
        const src = sourceRow();
        const getInserted = bindDuplicate(env, src);

        const res = await duplicate(env, cookieHeader, { title: 'Operation Copy' });
        expect(res.status).toBe(201);

        const inserted = getInserted();
        // Reset by design: identity, schedule, lifecycle, timestamps.
        const RESET = new Set([
            'id', 'slug', 'title', 'date_iso', 'end_date_iso',
            'display_date', 'display_day', 'display_month',
            'published', 'past', 'featured', 'sales_close_at',
            'created_at', 'updated_at',
        ]);
        for (const col of Object.keys(src)) {
            if (RESET.has(col)) continue;
            expect(inserted[col], `column ${col} must be carried to the duplicate`).toBe(src[col]);
        }
    });

    it('carries the columns the old hand-written INSERT silently dropped', async () => {
        const { env, cookieHeader } = await ownerEnv();
        const src = sourceRow();
        const getInserted = bindDuplicate(env, src);

        await duplicate(env, cookieHeader, { title: 'Operation Copy' });
        const inserted = getInserted();

        // The regression that motivated this fix, named explicitly.
        expect(inserted.custom_questions_json).toBe(src.custom_questions_json);
        expect(inserted.site_id).toBe('site_ghosttown');
        expect(inserted.card_overlay_opacity).toBe(0.35);
        expect(inserted.hero_overlay_opacity).toBe(0.4);
        expect(inserted.banner_overlay_opacity).toBe(0.45);
        expect(inserted.card_image_position).toBe('50% 30%');
        expect(inserted.hero_image_position).toBe('40% 60%');
        expect(inserted.banner_image_position).toBe('20% 80%');
    });

    it('resets the duplicate to an unfeatured, unpublished, not-past draft', async () => {
        const { env, cookieHeader } = await ownerEnv();
        const getInserted = bindDuplicate(env, sourceRow());

        await duplicate(env, cookieHeader, { title: 'Operation Copy' });
        const inserted = getInserted();

        expect(inserted.published).toBe(0);
        expect(inserted.past).toBe(0);
        expect(inserted.featured).toBe(0);
    });

    it('recomputes sales_close_at from the duplicate start, not the source', async () => {
        const { env, cookieHeader } = await ownerEnv();
        const getInserted = bindDuplicate(env, sourceRow());
        const newStart = '2026-11-07T18:00:00';

        await duplicate(env, cookieHeader, { title: 'Operation Copy', dateIso: newStart });
        const inserted = getInserted();

        expect(inserted.date_iso).toBe(newStart);
        // start − 2h, mirroring the create handler's default.
        expect(inserted.sales_close_at).toBe(Date.parse(newStart) - TWO_HOURS);
    });

    it('preserves an explicit "never auto-close" (NULL sales_close_at)', async () => {
        const { env, cookieHeader } = await ownerEnv();
        const getInserted = bindDuplicate(env, sourceRow({ sales_close_at: null }));

        await duplicate(env, cookieHeader, { title: 'Operation Copy' });
        expect(getInserted().sales_close_at).toBeNull();
    });

    it('derives id and slug from the new title', async () => {
        const { env, cookieHeader } = await ownerEnv();
        const getInserted = bindDuplicate(env, sourceRow());

        await duplicate(env, cookieHeader, { title: 'Operation Source (copy)' });
        const inserted = getInserted();

        expect(inserted.id).toBe('operation-source-copy');
        expect(inserted.slug).toBe(inserted.id);
        expect(inserted.title).toBe('Operation Source (copy)');
    });

    it('instantiates checklists for the duplicate, as event creation does', async () => {
        const { env, cookieHeader } = await ownerEnv();
        bindDuplicate(env, sourceRow());

        await duplicate(env, cookieHeader, { title: 'Operation Copy' });

        const touchedChecklists = env.DB.__writes()
            .some((w) => /checklist/i.test(w.sql));
        expect(touchedChecklists).toBe(true);
    });

    it('names only real columns (the carry set is the live events schema)', async () => {
        const { env, cookieHeader } = await ownerEnv();
        const getInserted = bindDuplicate(env, sourceRow());

        await duplicate(env, cookieHeader, { title: 'Operation Copy' });

        // The INSERT is built by interpolation, so the static-SQL schema guard
        // can't see it — check it here instead, against the real schema.
        const real = new Set(
            getSchemaDb().prepare('PRAGMA table_info(events)').all().map((r) => r.name),
        );
        for (const col of Object.keys(getInserted())) {
            expect(real.has(col), `duplicate INSERT names unknown column ${col}`).toBe(true);
        }
    });
});

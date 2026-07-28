// Sprint 4 B4 — field-rental recurrence series management routes.
//
// The generation cron has existed since M5.5 B10a; these routes are the
// first way to CREATE, pause, resume, or end a series without SQL. The
// capabilities (field_rentals.recurrence_create/_modify/_end) were seeded
// in migration 0049 with no consumer until now.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';
import { isoDate } from '../../../../worker/lib/fieldRentalRecurrences.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let env;
let cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

function post(path, body) {
    return worker.fetch(
        new Request(`https://airactionsport.com/api/admin/field-rental-recurrences${path}`, {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify(body || {}),
        }),
        env, {},
    );
}

function bindCustomerAndSite() {
    env.DB.__on(/SELECT id FROM customers WHERE id = \?/, { id: 'cus_1' }, 'first');
    env.DB.__on(/SELECT id FROM sites WHERE id = \?/, { id: 'site_1' }, 'first');
}

function seriesRow(extra = {}) {
    return {
        id: 'frr_1', customer_id: 'cus_1', site_id: 'site_1',
        frequency: 'weekly', weekday_mask: 4, monthly_pattern: null, custom_dates_json: null,
        starts_on: '2026-08-01', ends_on: null, max_occurrences: null,
        template_engagement_type: 'corporate', template_site_field_ids: 'fld_1',
        template_starts_local: '18:00', template_ends_local: '22:00',
        template_site_fee_cents: 50000, template_pricing_notes: null,
        recurrence_generated_through: null, active: 1,
        created_at: 1, updated_at: 1,
        ...extra,
    };
}

const GOOD_CREATE = {
    customerId: 'cus_1', siteId: 'site_1',
    frequency: 'weekly', weekdayMask: 4, // Tuesdays
    startsOn: '2026-08-04',
    template: {
        engagementType: 'corporate', siteFieldIds: 'fld_1',
        startsLocal: '18:00', endsLocal: '22:00', siteFeeCents: 50000,
    },
};

describe('POST /api/admin/field-rental-recurrences — create', () => {
    it('403 without field_rentals.recurrence_create', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read']);
        bindCustomerAndSite();
        expect((await post('', GOOD_CREATE)).status).toBe(403);
    });

    it('400 for an unknown customer', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.recurrence_create']);
        env.DB.__on(/SELECT id FROM customers WHERE id = \?/, null, 'first');
        env.DB.__on(/SELECT id FROM sites WHERE id = \?/, { id: 'site_1' }, 'first');
        expect((await post('', GOOD_CREATE)).status).toBe(400);
    });

    it('400 when weekly has an empty weekday mask', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.recurrence_create']);
        bindCustomerAndSite();
        const res = await post('', { ...GOOD_CREATE, weekdayMask: 0 });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/weekday/i);
    });

    it('400 when template end time is not after start (same-day rentals only)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.recurrence_create']);
        bindCustomerAndSite();
        const res = await post('', {
            ...GOOD_CREATE,
            template: { ...GOOD_CREATE.template, startsLocal: '22:00', endsLocal: '18:00' },
        });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/after startsLocal/);
    });

    it('happy weekly create: INSERTs the series, audits, 201 with the nightly-sweep note', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.recurrence_create']);
        bindCustomerAndSite();
        env.DB.__on(/INSERT INTO field_rental_recurrences/, { meta: { changes: 1 } }, 'run');

        const res = await post('', GOOD_CREATE);
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.id).toMatch(/^frr_/);
        expect(body.note).toMatch(/nightly/i);

        const insert = env.DB.__writes().find((w) => /INSERT INTO field_rental_recurrences/.test(w.sql));
        expect(insert).toBeDefined();
        expect(insert.args).toContain('weekly');
        expect(insert.args).toContain(4);          // weekday mask
        expect(insert.args).toContain('18:00');
        expect(insert.args).toContain(50000);

        const audit = env.DB.__writes().find((w) => w.args?.some?.((a) => a === 'field_rental_recurrence.created'));
        expect(audit).toBeDefined();
    });

    it('happy monthly day_of_month create (the pattern #206 unlocked)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.recurrence_create']);
        bindCustomerAndSite();
        env.DB.__on(/INSERT INTO field_rental_recurrences/, { meta: { changes: 1 } }, 'run');

        const res = await post('', {
            ...GOOD_CREATE,
            frequency: 'monthly',
            weekdayMask: undefined,
            monthlyPattern: { kind: 'day_of_month', day: 15 },
        });
        expect(res.status).toBe(201);
        const insert = env.DB.__writes().find((w) => /INSERT INTO field_rental_recurrences/.test(w.sql));
        expect(insert.args).toContain('{"kind":"day_of_month","day":15}');
    });
});

describe('pause / resume', () => {
    it('pause 403 without field_rentals.recurrence_modify', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read']);
        env.DB.__on(/SELECT \* FROM field_rental_recurrences WHERE id = \?/, seriesRow(), 'first');
        expect((await post('/frr_1/pause')).status).toBe(403);
    });

    it('pause flips active to 0 + audits', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.recurrence_modify']);
        env.DB.__on(/SELECT \* FROM field_rental_recurrences WHERE id = \?/, seriesRow(), 'first');
        env.DB.__on(/UPDATE field_rental_recurrences SET active = 0/, { meta: { changes: 1 } }, 'run');

        const res = await post('/frr_1/pause');
        expect(res.status).toBe(200);
        expect((await res.json()).active).toBe(false);
        expect(env.DB.__writes().some((w) => /UPDATE field_rental_recurrences SET active = 0/.test(w.sql))).toBe(true);
    });

    it('pause 409 when already paused', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.recurrence_modify']);
        env.DB.__on(/SELECT \* FROM field_rental_recurrences WHERE id = \?/, seriesRow({ active: 0 }), 'first');
        expect((await post('/frr_1/pause')).status).toBe(409);
    });

    it('resume bumps a stale sentinel to YESTERDAY — the paused gap is never backfilled', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.recurrence_modify']);
        // Paused months ago with generation stopped at an old date.
        env.DB.__on(/SELECT \* FROM field_rental_recurrences WHERE id = \?/,
            seriesRow({ active: 0, recurrence_generated_through: '2026-01-10' }), 'first');
        env.DB.__on(/UPDATE field_rental_recurrences SET active = 1/, { meta: { changes: 1 } }, 'run');

        const res = await post('/frr_1/resume');
        expect(res.status).toBe(200);
        const body = await res.json();
        const yesterday = isoDate(Date.now() - DAY_MS);
        expect(body.generatedThrough).toBe(yesterday);

        const update = env.DB.__writes().find((w) => /UPDATE field_rental_recurrences SET active = 1/.test(w.sql));
        expect(update.args[0]).toBe(yesterday);
    });

    it('resume 409 when the series window has already ended', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.recurrence_modify']);
        env.DB.__on(/SELECT \* FROM field_rental_recurrences WHERE id = \?/,
            seriesRow({ active: 0, ends_on: '2020-01-01' }), 'first');
        const res = await post('/frr_1/resume');
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/ended/i);
    });
});

describe('end — permanent, cancels future cancellable instances', () => {
    it('403 without field_rentals.recurrence_end', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.recurrence_modify']);
        env.DB.__on(/SELECT \* FROM field_rental_recurrences WHERE id = \?/, seriesRow(), 'first');
        expect((await post('/frr_1/end')).status).toBe(403);
    });

    it('deactivates, closes the window, cancels future agreed instances but SKIPS paid ones', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.recurrence_end']);
        env.DB.__on(/SELECT \* FROM field_rental_recurrences WHERE id = \?/, seriesRow(), 'first');
        env.DB.__on(/UPDATE field_rental_recurrences SET active = 0, ends_on/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/SELECT id, status FROM field_rentals\s+WHERE recurrence_id = \?/, {
            results: [
                { id: 'fr_a', status: 'agreed' },   // cancellable
                { id: 'fr_b', status: 'paid' },     // money moved — untouched
                { id: 'fr_c', status: 'draft' },    // cancellable
            ],
        }, 'all');
        env.DB.__on(/UPDATE field_rentals\s+SET status = 'cancelled'/, { meta: { changes: 1 } }, 'run');

        const res = await post('/frr_1/end', { reason: 'Client ended contract' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.futureCancelled).toBe(2);
        expect(body.futureSkipped).toBe(1);

        const writes = env.DB.__writes();
        const seriesUpdate = writes.find((w) => /UPDATE field_rental_recurrences SET active = 0, ends_on/.test(w.sql));
        expect(seriesUpdate.args[0]).toBe(isoDate(Date.now())); // window closes today

        const cancels = writes.filter((w) => /UPDATE field_rentals\s+SET status = 'cancelled'/.test(w.sql));
        expect(cancels).toHaveLength(2);
        expect(cancels.every((w) => w.args.includes('Client ended contract'))).toBe(true);
        // The paid instance's id never appears in a cancel UPDATE.
        expect(cancels.some((w) => w.args.includes('fr_b'))).toBe(false);

        const audit = writes.find((w) => w.args?.some?.((a) => a === 'field_rental_recurrence.ended'));
        const meta = JSON.parse(audit.args.find((a) => typeof a === 'string' && a.startsWith('{')));
        expect(meta.futureCancelled).toBe(2);
        expect(meta.futureSkipped).toBe(1);
    });
});

// GET /api/admin/analytics/cron-status — response-shape contract (audit A4).
//
// The owner dashboard's CronHealth widget is this endpoint's only consumer, and
// until now neither side had a test. The widget read `lastSweepAgeMs`,
// `last24hReminders24hCount` and `last24hReminders1hCount` while the endpoint
// emits `lastSweepAt` + `reminders24h.{sent24hr,sent1hr}`, so the tile rendered
// a permanent red STALE / "last sweep unknown ago" / 0 · 0.
//
// This file pins the worker end; tests/unit/admin/PersonaWidgetsCron.test.jsx
// pins the widget end against the same shape.

import { describe, it, expect } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

const PATH = '/api/admin/analytics/cron-status';

function makeReq(init = {}) {
    return new Request(`https://airactionsport.com${PATH}`, init);
}

async function get(env, cookieHeader) {
    const res = await worker.fetch(makeReq({ headers: { cookie: cookieHeader } }), env, {});
    return { res, body: await res.json() };
}

describe('GET /api/admin/analytics/cron-status', () => {
    it('returns lastSweepAt as an absolute epoch plus nested reminders24h counts', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
        const sweptAt = 1_700_000_000_000;

        env.DB.__on(/FROM audit_log\s+WHERE action = 'cron.swept'/, {
            created_at: sweptAt,
            meta_json: JSON.stringify({ reminders: 2 }),
        }, 'first');
        env.DB.__on(/WHERE action IN \('reminder\.sent', 'reminder_1hr\.sent'\)/, {
            results: [
                { action: 'reminder.sent', n: 7 },
                { action: 'reminder_1hr.sent', n: 3 },
            ],
        }, 'all');

        const { res, body } = await get(env, cookieHeader);
        expect(res.status).toBe(200);

        // The exact keys CronHealth destructures.
        expect(body.lastSweepAt).toBe(sweptAt);
        expect(body.reminders24h).toEqual({ sent24hr: 7, sent1hr: 3 });
        expect(body.lastSweepMeta).toEqual({ reminders: 2 });

        // Guard against a well-meaning "fix" that renames the contract rather
        // than the widget — these are the names the widget wrongly expected.
        expect(body).not.toHaveProperty('lastSweepAgeMs');
        expect(body).not.toHaveProperty('last24hReminders24hCount');
        expect(body).not.toHaveProperty('last24hReminders1hCount');
    });

    it('reports lastSweepAt null and zeroed counters when the cron has never run', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM audit_log\s+WHERE action = 'cron.swept'/, null, 'first');
        env.DB.__on(/WHERE action IN \('reminder\.sent', 'reminder_1hr\.sent'\)/, { results: [] }, 'all');

        const { res, body } = await get(env, cookieHeader);
        expect(res.status).toBe(200);
        expect(body.lastSweepAt).toBeNull();
        expect(body.reminders24h).toEqual({ sent24hr: 0, sent1hr: 0 });
    });

    it('tolerates unparseable sweep meta without failing the request', async () => {
        const env = createMockEnv();
        const { cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' });

        env.DB.__on(/FROM audit_log\s+WHERE action = 'cron.swept'/, {
            created_at: 1_700_000_000_000,
            meta_json: '{not json',
        }, 'first');
        env.DB.__on(/WHERE action IN \('reminder\.sent', 'reminder_1hr\.sent'\)/, { results: [] }, 'all');

        const { res, body } = await get(env, cookieHeader);
        expect(res.status).toBe(200);
        expect(body.lastSweepMeta).toBeNull();
        expect(body.lastSweepAt).toBe(1_700_000_000_000);
    });
});

// M5 R9 — runEventStaffingReminderSweep + runEventStaffingAutoDeclineSweep tests.
// The reminder sweep finds confirmed/pending event_staffing rows whose event
// is in the next 7 days, classifies into 7d/3d/1d/day_of windows, and emails
// each milestone once via the event_staffing_reminders sentinel table.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    runEventStaffingReminderSweep,
    runEventStaffingAutoDeclineSweep,
} from '../../../worker/lib/eventStaffing.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { mockResendFetch } from '../../helpers/mockResend.js';

let env;

beforeEach(() => {
    env = createMockEnv();
    env.RESEND_API_KEY = 'test-resend-key';
    env.RESEND_FROM_EMAIL = 'no-reply@airactionsport.com';
});

describe('runEventStaffingReminderSweep', () => {
    it('returns zero counts when no candidate rows exist', async () => {
        env.DB.__on(/FROM event_staffing es/, { results: [] }, 'all');

        const result = await runEventStaffingReminderSweep(env);
        expect(result.sent7).toBe(0);
        expect(result.sent3).toBe(0);
        expect(result.sent1).toBe(0);
        expect(result.sentDayOf).toBe(0);
        expect(result.skipped).toBe(0);
        expect(result.failed).toBe(0);
    });

    it('skips rows already in the sentinel table for the window', async () => {
        const oneDayMs = 86400000;
        const row = {
            id: 'es_001',
            event_id: 'evt_001',
            person_id: 'prs_1',
            person_name: 'Jane',
            person_email: 'jane@example.com',
            role_name: 'Field Marshal',
            event_title: 'Operation Nightfall',
            event_display_date: '9 May 2026',
            event_start_ms: Date.now() + 24 * 3600 * 1000, // 24 hours out → '1d'
            shift_start_at: Date.now() + 24 * 3600 * 1000,
            status: 'confirmed',
        };
        env.DB.__on(/FROM event_staffing es/, { results: [row] }, 'all');
        // Sentinel exists for this row + window
        env.DB.__on(/FROM event_staffing_reminders/, { '1': 1 }, 'first');

        const result = await runEventStaffingReminderSweep(env);
        expect(result.skipped).toBe(1);
        expect(result.sent1).toBe(0);
    });

    it('sends reminder + writes sentinel for unsent windows', async () => {
        const row = {
            id: 'es_002',
            event_id: 'evt_002',
            person_id: 'prs_2',
            person_name: 'Bob',
            person_email: 'bob@example.com',
            role_name: 'Lead Marshal',
            event_title: 'Op Nightfall',
            event_display_date: '9 May 2026',
            event_start_ms: Date.now() + 6 * 3600 * 1000, // 6 hours out → 'day_of'
            shift_start_at: Date.now() + 6 * 3600 * 1000,
            status: 'confirmed',
        };
        env.DB.__on(/FROM event_staffing es/, { results: [row] }, 'all');
        env.DB.__on(/FROM event_staffing_reminders/, null, 'first');
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, {
            slug: 'event_staff_reminder',
            subject: 'Reminder: {{eventTitle}} {{windowLabel}}',
            body_html: '<p>Hi {{personName}}, see you {{windowLabel}}.</p>',
            body_text: 'Hi {{personName}}, see you {{windowLabel}}.',
        }, 'first');
        env.DB.__on(/INSERT INTO event_staffing_reminders/, { meta: { changes: 1 } }, 'run');
        mockResendFetch({ id: 'msg_test' });

        const result = await runEventStaffingReminderSweep(env);
        expect(result.sentDayOf).toBe(1);
        expect(result.failed).toBe(0);

        const writes = env.DB.__writes();
        const sentinelWrite = writes.find((w) => /INSERT INTO event_staffing_reminders/.test(w.sql));
        expect(sentinelWrite).toBeDefined();
        expect(sentinelWrite.args).toContain('day_of');
        expect(sentinelWrite.args).toContain('es_002');
        expect(sentinelWrite.args).toContain('sent');
    });

    it('skips and writes "skipped" sentinel when template is missing', async () => {
        const row = {
            id: 'es_003',
            event_id: 'evt_003',
            person_id: 'prs_3',
            person_name: 'Carol',
            person_email: 'carol@example.com',
            role_name: 'Check-in',
            event_title: 'Op X',
            event_display_date: '15 May 2026',
            event_start_ms: Date.now() + 72 * 3600 * 1000, // 72 hours → '3d'
            shift_start_at: Date.now() + 72 * 3600 * 1000,
            status: 'confirmed',
        };
        env.DB.__on(/FROM event_staffing es/, { results: [row] }, 'all');
        env.DB.__on(/FROM event_staffing_reminders/, null, 'first');
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, null, 'first');
        env.DB.__on(/INSERT INTO event_staffing_reminders/, { meta: { changes: 1 } }, 'run');

        const result = await runEventStaffingReminderSweep(env);
        expect(result.skipped).toBe(1);
        expect(result.sent3).toBe(0);

        const writes = env.DB.__writes();
        const sentinelWrite = writes.find((w) => /INSERT INTO event_staffing_reminders/.test(w.sql));
        expect(sentinelWrite).toBeDefined();
        // Result column should be 'skipped' on missing template
        expect(sentinelWrite.args).toContain('skipped');
    });

    it('skips events outside the 7-day horizon', async () => {
        const farFutureRow = {
            id: 'es_far',
            event_id: 'evt_far',
            person_id: 'prs_4',
            person_name: 'Dave',
            person_email: 'dave@example.com',
            role_name: 'Field Marshal',
            event_title: 'Future event',
            event_start_ms: Date.now() + 30 * 86400000, // 30 days out
            shift_start_at: Date.now() + 30 * 86400000,
            status: 'confirmed',
        };
        env.DB.__on(/FROM event_staffing es/, { results: [farFutureRow] }, 'all');

        const result = await runEventStaffingReminderSweep(env);
        expect(result.skipped).toBe(1);
        expect(result.sent7).toBe(0);
    });

    it('skips past events (negative hoursUntil)', async () => {
        const pastRow = {
            id: 'es_past',
            event_id: 'evt_past',
            person_id: 'prs_5',
            person_name: 'Eve',
            person_email: 'eve@example.com',
            role_name: 'Field Marshal',
            event_title: 'Past event',
            event_start_ms: Date.now() - 86400000, // 1 day ago
            shift_start_at: Date.now() - 86400000,
            status: 'confirmed',
        };
        env.DB.__on(/FROM event_staffing es/, { results: [pastRow] }, 'all');

        const result = await runEventStaffingReminderSweep(env);
        expect(result.skipped).toBe(1);
    });
});

describe('runEventStaffingAutoDeclineSweep', () => {
    it('returns the rowcount from the UPDATE for tracking', async () => {
        env.DB.__on(/UPDATE event_staffing/, { meta: { changes: 3 } }, 'run');

        const result = await runEventStaffingAutoDeclineSweep(env);
        expect(result.autoDeclined).toBe(3);
    });

    it('returns 0 when no rows are auto-declined', async () => {
        env.DB.__on(/UPDATE event_staffing/, { meta: { changes: 0 } }, 'run');

        const result = await runEventStaffingAutoDeclineSweep(env);
        expect(result.autoDeclined).toBe(0);
    });

    it('binds current time as the cutoff for past events', async () => {
        env.DB.__on(/UPDATE event_staffing/, { meta: { changes: 0 } }, 'run');

        const beforeMs = Date.now();
        await runEventStaffingAutoDeclineSweep(env);
        const afterMs = Date.now();

        const writes = env.DB.__writes();
        const updateWrite = writes.find((w) => /UPDATE event_staffing/.test(w.sql));
        expect(updateWrite).toBeDefined();
        // Two timestamp args: now (for updated_at) and now (for cutoff)
        const tsArgs = updateWrite.args.filter((a) => typeof a === 'number');
        expect(tsArgs.length).toBe(2);
        for (const ts of tsArgs) {
            expect(ts).toBeGreaterThanOrEqual(beforeMs);
            expect(ts).toBeLessThanOrEqual(afterMs);
        }
    });
});

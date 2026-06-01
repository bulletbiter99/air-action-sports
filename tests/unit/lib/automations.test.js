// Marketing milestone B5 — automations lib + engine tests.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    AUTOMATION_TRIGGERS,
    validateTriggerConfig,
    validateAutomationInput,
    formatAutomation,
    formatAutomationSummary,
    recurringPeriod,
    dueForRecurring,
    resolveAutomationRecipients,
    runAutomationSweep,
} from '../../../worker/lib/automations.js';
import { createMockD1 } from '../../helpers/mockD1.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { mockResendFetch } from '../../helpers/mockResend.js';

const DAY = 24 * 60 * 60 * 1000;

describe('validateTriggerConfig', () => {
    it('recurring requires intervalDays >= 1', () => {
        expect(validateTriggerConfig('recurring', { intervalDays: 30 }).normalized).toEqual({ intervalDays: 30 });
        expect(validateTriggerConfig('recurring', { intervalDays: 0 }).valid).toBe(false);
        expect(validateTriggerConfig('recurring', {}).valid).toBe(false);
    });
    it('tag_added requires a non-empty tag', () => {
        expect(validateTriggerConfig('tag_added', { tag: ' vip ' }).normalized).toEqual({ tag: 'vip' });
        expect(validateTriggerConfig('tag_added', { tag: '' }).valid).toBe(false);
    });
    it('rejects unknown trigger types (date_relative is a documented follow-up)', () => {
        expect(validateTriggerConfig('date_relative', {}).valid).toBe(false);
        expect(AUTOMATION_TRIGGERS).toEqual(['recurring', 'tag_added']);
    });
});

describe('validateAutomationInput', () => {
    const base = { name: 'Welcome', subject: 'Hi', bodyHtml: '<p>hi</p>', triggerType: 'tag_added', triggerConfig: { tag: 'new' } };
    it('accepts a full valid input', () => {
        const v = validateAutomationInput(base);
        expect(v.valid).toBe(true);
        expect(v.normalized.triggerType).toBe('tag_added');
        expect(v.normalized.triggerConfig).toEqual({ tag: 'new' });
    });
    it('requires name/subject/bodyHtml + a valid trigger on create', () => {
        expect(validateAutomationInput({ ...base, name: '' }).valid).toBe(false);
        expect(validateAutomationInput({ ...base, triggerType: 'bogus' }).valid).toBe(false);
        expect(validateAutomationInput({ name: 'X', subject: 'Y', bodyHtml: 'Z' }).valid).toBe(false); // no trigger
    });
    it('partial: validates trigger as a pair only when present', () => {
        expect(validateAutomationInput({ subject: 'New' }, { partial: true }).valid).toBe(true);
        expect(validateAutomationInput({ triggerType: 'recurring', triggerConfig: { intervalDays: 14 } }, { partial: true }).valid).toBe(true);
        // triggerType present but config bad → rejected
        expect(validateAutomationInput({ triggerType: 'recurring', triggerConfig: {} }, { partial: true }).valid).toBe(false);
    });
});

describe('formatAutomation', () => {
    const row = {
        id: 'auto_1', name: 'N', trigger_type: 'recurring', trigger_config: '{"intervalDays":30}',
        segment_id: 'seg_1', subject: 'S', body_html: '<p>b</p>', body_text: null, from_name: null,
        status: 'paused', last_run_at: null, sent_count: 0, created_by: 'u1', created_at: 1, updated_at: 2,
    };
    it('parses trigger_config + maps columns', () => {
        const f = formatAutomation(row);
        expect(f.triggerConfig).toEqual({ intervalDays: 30 });
        expect(f.triggerType).toBe('recurring');
        expect(f.segmentId).toBe('seg_1');
    });
    it('summary drops the body', () => {
        const s = formatAutomationSummary(row);
        expect(s.bodyHtml).toBeUndefined();
        expect(s.triggerType).toBe('recurring');
    });
});

describe('recurringPeriod / dueForRecurring', () => {
    it('recurringPeriod buckets time by interval', () => {
        expect(recurringPeriod(0, 1)).toBe(0);
        expect(recurringPeriod(DAY, 1)).toBe(1);
        expect(recurringPeriod(DAY * 2.5, 1)).toBe(2);
        expect(recurringPeriod(DAY * 10, 7)).toBe(1);
    });
    it('dueForRecurring: never run → due; within interval → not due', () => {
        const now = 100 * DAY;
        expect(dueForRecurring({ last_run_at: null, trigger_config: '{"intervalDays":7}' }, now)).toBe(true);
        expect(dueForRecurring({ last_run_at: now - 3 * DAY, trigger_config: '{"intervalDays":7}' }, now)).toBe(false);
        expect(dueForRecurring({ last_run_at: now - 8 * DAY, trigger_config: '{"intervalDays":7}' }, now)).toBe(true);
    });
});

describe('resolveAutomationRecipients', () => {
    it('recurring → segment members with per-period dedup keys', async () => {
        const db = createMockD1();
        db.__on(/email_marketing = 1 AND archived_at IS NULL/, { results: [{ id: 'cus_a', email: 'a@x.com', name: 'A' }] }, 'all');
        const now = 10 * DAY;
        const out = await resolveAutomationRecipients(db, { id: 'auto_1', trigger_type: 'recurring', segment_id: null }, { intervalDays: 7 }, now);
        expect(out).toHaveLength(1);
        expect(out[0].customerId).toBe('cus_a');
        expect(out[0].dedupKey).toBe(`auto_1:cus_a:${recurringPeriod(now, 7)}`);
    });
    it('tag_added → tagged customers with once-ever dedup keys', async () => {
        const db = createMockD1();
        db.__on(/JOIN customer_tags ct ON ct\.customer_id = c\.id AND ct\.tag = \?/, { results: [{ id: 'cus_v', email: 'v@x.com', name: 'V' }] }, 'all');
        const out = await resolveAutomationRecipients(db, { id: 'auto_2', trigger_type: 'tag_added' }, { tag: 'vip' }, Date.now());
        expect(out).toEqual([{ customerId: 'cus_v', email: 'v@x.com', name: 'V', dedupKey: 'auto_2:cus_v' }]);
    });
});

describe('runAutomationSweep', () => {
    let env;
    beforeEach(() => {
        env = createMockEnv();
        env.RESEND_API_KEY = 're_test';
        env.MARKETING_POSTAL_ADDRESS = '123 Range Rd';
    });

    it('no-ops without the postal address', async () => {
        delete env.MARKETING_POSTAL_ADDRESS;
        const r = await runAutomationSweep(env, {});
        expect(r.skipped).toBe('no_postal_address');
    });

    it('sends to a not-yet-sent recipient + records the send (tag_added)', async () => {
        mockResendFetch({ id: 're_1' });
        env.DB.__on(/SELECT \* FROM automations WHERE status = 'active'/, {
            results: [{ id: 'auto_1', trigger_type: 'tag_added', trigger_config: '{"tag":"vip"}', segment_id: null, subject: 'Hi', body_html: '<p>x</p>', body_text: null, from_name: null, last_run_at: null }],
        }, 'all');
        env.DB.__on(/JOIN customer_tags ct/, { results: [{ id: 'cus_v', email: 'v@x.com', name: 'V' }] }, 'all');
        env.DB.__on(/SELECT id FROM automation_sends WHERE dedup_key = \?/, null, 'first');
        env.DB.__on(/INSERT OR IGNORE INTO automation_sends/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE automations SET last_run_at/, { meta: { changes: 1 } }, 'run');

        const r = await runAutomationSweep(env, {});
        expect(r.evaluated).toBe(1);
        expect(r.sent).toBe(1);
        const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(body.html).toContain('/api/unsubscribe?c=cus_v');
        expect(body.html).toContain('123 Range Rd');
    });

    it('skips a recipient already sent for this dedup key', async () => {
        mockResendFetch({ id: 're_1' });
        env.DB.__on(/SELECT \* FROM automations WHERE status = 'active'/, {
            results: [{ id: 'auto_1', trigger_type: 'tag_added', trigger_config: '{"tag":"vip"}', segment_id: null, subject: 'Hi', body_html: '<p>x</p>', body_text: null, from_name: null, last_run_at: null }],
        }, 'all');
        env.DB.__on(/JOIN customer_tags ct/, { results: [{ id: 'cus_v', email: 'v@x.com', name: 'V' }] }, 'all');
        env.DB.__on(/SELECT id FROM automation_sends WHERE dedup_key = \?/, { id: 'already' }, 'first');
        env.DB.__on(/UPDATE automations SET last_run_at/, { meta: { changes: 1 } }, 'run');

        const r = await runAutomationSweep(env, {});
        expect(r.sent).toBe(0);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});

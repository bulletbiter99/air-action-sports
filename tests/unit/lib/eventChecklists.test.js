// M5 R15 — pure helper + I/O wrapper tests for
// worker/lib/eventChecklists.js.
//
// instantiateChecklists is the centerpiece — exercised through the
// auto-instantiate hook in worker/routes/admin/events.js. The mock-D1
// pattern stays consistent with R12-R14: __on(regex, response, kind)
// + writeLog assertions for positional bind verification.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    randomChecklistId,
    computeCompletedAt,
    instantiateChecklists,
    listChecklistsForEvent,
    toggleChecklistItem,
    getEventHqAggregate,
} from '../../../worker/lib/eventChecklists.js';
import { createMockEnv } from '../../helpers/mockEnv.js';

describe('randomChecklistId', () => {
    it('produces ids matching `<prefix>_<12 alphanum>`', () => {
        for (let i = 0; i < 50; i++) {
            const id = randomChecklistId('echk');
            expect(id).toMatch(/^echk_[0-9A-Za-z]{12}$/);
        }
    });

    it('produces unique ids across many calls', () => {
        const set = new Set();
        for (let i = 0; i < 500; i++) set.add(randomChecklistId('echki'));
        expect(set.size).toBe(500);
    });
});

describe('computeCompletedAt', () => {
    const NOW = 1_700_000_000_000;

    it('returns null for empty / non-array input', () => {
        expect(computeCompletedAt([], NOW)).toBeNull();
        expect(computeCompletedAt(null, NOW)).toBeNull();
        expect(computeCompletedAt(undefined, NOW)).toBeNull();
    });

    it('returns now when all required items are done', () => {
        const items = [
            { required: 1, done_at: 1_699_000_000_000 },
            { required: 1, done_at: 1_699_500_000_000 },
        ];
        expect(computeCompletedAt(items, NOW)).toBe(NOW);
    });

    it('returns null when any required item is undone', () => {
        const items = [
            { required: 1, done_at: 1_699_000_000_000 },
            { required: 1, done_at: null },
        ];
        expect(computeCompletedAt(items, NOW)).toBeNull();
    });

    it('ignores non-required items in the gating decision', () => {
        const items = [
            { required: 1, done_at: NOW },
            { required: 0, done_at: null }, // optional-undone does NOT block
        ];
        expect(computeCompletedAt(items, NOW)).toBe(NOW);
    });

    it('treats required=true (boolean) the same as required=1 (int)', () => {
        const items = [
            { required: true, done_at: NOW },
            { required: false, done_at: null },
        ];
        expect(computeCompletedAt(items, NOW)).toBe(NOW);
    });

    it('all-optional checklist: completed only when every item done', () => {
        const allOptional = [
            { required: 0, done_at: null },
            { required: 0, done_at: null },
        ];
        expect(computeCompletedAt(allOptional, NOW)).toBeNull();

        const allOptionalDone = [
            { required: 0, done_at: NOW - 1000 },
            { required: 0, done_at: NOW - 500 },
        ];
        expect(computeCompletedAt(allOptionalDone, NOW)).toBe(NOW);
    });
});

describe('instantiateChecklists', () => {
    let env;
    beforeEach(() => { env = createMockEnv(); });

    it('throws when eventId missing', async () => {
        await expect(instantiateChecklists(env, '')).rejects.toThrow(/eventId required/);
        await expect(instantiateChecklists(env, null)).rejects.toThrow(/eventId required/);
    });

    it('returns zero counts when no active templates exist', async () => {
        env.DB.__on(/FROM checklist_templates/, { results: [] }, 'all');
        const result = await instantiateChecklists(env, 'evt_1');
        expect(result).toEqual({ instantiated: 0, skipped: 0 });
    });

    it('inserts event_checklists + items rows for each active template', async () => {
        env.DB.__on(/FROM checklist_templates/, {
            results: [
                { id: 'ckt_1', slug: 'pre_event_safety', title: 'Pre-event safety', role_key: 'lead_marshal' },
                { id: 'ckt_2', slug: 'medic_setup', title: 'Medic setup', role_key: 'safety_marshal' },
            ],
        }, 'all');

        // No existing instances for the event.
        env.DB.__on(/SELECT id FROM event_checklists WHERE event_id = \? AND slug = \?/, null, 'first');

        // Each template returns 2 items.
        env.DB.__on(/FROM checklist_template_items[\s\S]*WHERE template_id = \?/, () => ({
            results: [
                { id: 'cti_a', position: 10, label: 'Item A', required: 1 },
                { id: 'cti_b', position: 20, label: 'Item B', required: 0 },
            ],
        }), 'all');

        env.DB.__on(/INSERT INTO event_checklists/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO event_checklist_items/, { meta: { changes: 1 } }, 'run');

        const result = await instantiateChecklists(env, 'evt_1');
        expect(result.instantiated).toBe(2);
        expect(result.skipped).toBe(0);

        const writes = env.DB.__writes();
        const checklistInserts = writes.filter((w) => /INSERT INTO event_checklists/.test(w.sql));
        expect(checklistInserts).toHaveLength(2);
        // Verify positional binds: event_id + template_id + slug + title + role_key
        for (const w of checklistInserts) {
            expect(w.args).toContain('evt_1');
        }
        expect(checklistInserts[0].args).toContain('pre_event_safety');
        expect(checklistInserts[1].args).toContain('medic_setup');

        const itemInserts = writes.filter((w) => /INSERT INTO event_checklist_items/.test(w.sql));
        expect(itemInserts.length).toBe(4); // 2 templates × 2 items
    });

    it('is idempotent — skips templates already instantiated for the event', async () => {
        env.DB.__on(/FROM checklist_templates/, {
            results: [
                { id: 'ckt_1', slug: 'pre_event_safety', title: 'Pre-event safety', role_key: 'lead_marshal' },
            ],
        }, 'all');
        // Existing checklist for this event+slug.
        env.DB.__on(/SELECT id FROM event_checklists WHERE event_id = \? AND slug = \?/, {
            id: 'echk_existing',
        }, 'first');

        const result = await instantiateChecklists(env, 'evt_1');
        expect(result.instantiated).toBe(0);
        expect(result.skipped).toBe(1);

        const writes = env.DB.__writes();
        // No new INSERT INTO event_checklists rows.
        const inserts = writes.filter((w) => /INSERT INTO event_checklists\s*\(/.test(w.sql));
        expect(inserts).toHaveLength(0);
    });
});

describe('listChecklistsForEvent', () => {
    let env;
    beforeEach(() => { env = createMockEnv(); });

    it('returns nested checklists+items shape with camelCase keys', async () => {
        env.DB.__on(/FROM event_checklists\s+WHERE event_id = \?/, {
            results: [
                {
                    id: 'echk_1', template_id: 'ckt_1',
                    slug: 'pre_event_safety', title: 'Pre-event safety', role_key: 'lead_marshal',
                    completed_at: null, completed_by_person_id: null, created_at: 1700000000000,
                },
            ],
        }, 'all');
        env.DB.__on(/FROM event_checklist_items\s+WHERE event_checklist_id = \?/, {
            results: [
                {
                    id: 'echki_1', template_item_id: 'cti_a', position: 10,
                    label: 'Briefing delivered', required: 1,
                    done_at: 1700001000000, done_by_person_id: 'prs_1', notes: null,
                },
                {
                    id: 'echki_2', template_item_id: 'cti_b', position: 20,
                    label: 'Chronograph set', required: 1,
                    done_at: null, done_by_person_id: null, notes: null,
                },
            ],
        }, 'all');

        const result = await listChecklistsForEvent(env, 'evt_1');
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            id: 'echk_1',
            slug: 'pre_event_safety',
            title: 'Pre-event safety',
            roleKey: 'lead_marshal',
            completedAt: null,
        });
        expect(result[0].items).toHaveLength(2);
        expect(result[0].items[0]).toMatchObject({
            id: 'echki_1',
            label: 'Briefing delivered',
            required: true,
            doneAt: 1700001000000,
            doneByPersonId: 'prs_1',
        });
        expect(result[0].items[1].required).toBe(true);
        expect(result[0].items[1].doneAt).toBeNull();
    });

    it('returns empty array when no checklists for event', async () => {
        env.DB.__on(/FROM event_checklists\s+WHERE event_id = \?/, { results: [] }, 'all');
        const result = await listChecklistsForEvent(env, 'evt_1');
        expect(result).toEqual([]);
    });
});

describe('toggleChecklistItem', () => {
    let env;
    beforeEach(() => {
        env = createMockEnv();
        env.DB.__on(/UPDATE event_checklist_items/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/UPDATE event_checklists\s+SET completed_at/, { meta: { changes: 1 } }, 'run');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');
    });

    it('returns item_not_found when itemId does not exist', async () => {
        env.DB.__on(/FROM event_checklist_items eci[\s\S]+INNER JOIN event_checklists ec/, null, 'first');
        const result = await toggleChecklistItem(env, {
            itemId: 'echki_nope', eventId: 'evt_1', personId: 'prs_1', done: true,
        });
        expect(result.error).toBe('item_not_found');
    });

    it('returns wrong_event when item belongs to a different event', async () => {
        env.DB.__on(/FROM event_checklist_items eci[\s\S]+INNER JOIN event_checklists ec/, {
            id: 'echki_1', event_checklist_id: 'echk_1', position: 10, label: 'X', required: 1,
            done_at: null, event_id: 'evt_DIFFERENT',
        }, 'first');
        const result = await toggleChecklistItem(env, {
            itemId: 'echki_1', eventId: 'evt_1', personId: 'prs_1', done: true,
        });
        expect(result.error).toBe('wrong_event');
    });

    it('done=true sets done_at + done_by + writes audit + bumps parent completed_at', async () => {
        env.DB.__on(/FROM event_checklist_items eci[\s\S]+INNER JOIN event_checklists ec/, {
            id: 'echki_1', event_checklist_id: 'echk_1', position: 10, label: 'Briefing', required: 1,
            done_at: null, event_id: 'evt_1',
        }, 'first');
        // Sibling list: other items (just one more, already done) — together with our toggle, all required done.
        env.DB.__on(/SELECT id, required, done_at FROM event_checklist_items WHERE event_checklist_id = \?/, {
            results: [
                { id: 'echki_1', required: 1, done_at: null }, // patched in helper to newDoneAt
                { id: 'echki_2', required: 1, done_at: 1699000000000 },
            ],
        }, 'all');

        const result = await toggleChecklistItem(env, {
            itemId: 'echki_1', eventId: 'evt_1', personId: 'prs_marshal', done: true,
        });
        expect(result.error).toBeUndefined();
        expect(result.item.doneAt).toBeGreaterThan(0);
        expect(result.item.doneByPersonId).toBe('prs_marshal');
        expect(result.checklistId).toBe('echk_1');
        expect(result.completedAt).toBeGreaterThan(0); // parent now completed

        const writes = env.DB.__writes();
        const itemUpdate = writes.find((w) => /UPDATE event_checklist_items/.test(w.sql));
        expect(itemUpdate).toBeDefined();
        // 4 args: done_at, done_by_person_id, notes, itemId
        expect(itemUpdate.args).toContain('prs_marshal');
        expect(itemUpdate.args).toContain('echki_1');

        const parentUpdate = writes.find((w) => /UPDATE event_checklists\s+SET completed_at/.test(w.sql));
        expect(parentUpdate).toBeDefined();

        const audit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'event_day.checklist_item_done')
        );
        expect(audit).toBeDefined();
    });

    it('done=false clears done_at + writes _undone audit + clears parent completed_at', async () => {
        env.DB.__on(/FROM event_checklist_items eci[\s\S]+INNER JOIN event_checklists ec/, {
            id: 'echki_1', event_checklist_id: 'echk_1', position: 10, label: 'Briefing', required: 1,
            done_at: 1700000000000, event_id: 'evt_1',
        }, 'first');
        env.DB.__on(/SELECT id, required, done_at FROM event_checklist_items WHERE event_checklist_id = \?/, {
            results: [
                { id: 'echki_1', required: 1, done_at: 1700000000000 }, // patched to null
                { id: 'echki_2', required: 1, done_at: 1699000000000 },
            ],
        }, 'all');

        const result = await toggleChecklistItem(env, {
            itemId: 'echki_1', eventId: 'evt_1', personId: 'prs_marshal', done: false,
        });
        expect(result.item.doneAt).toBeNull();
        expect(result.item.doneByPersonId).toBeNull();
        expect(result.completedAt).toBeNull(); // parent no longer completed

        const writes = env.DB.__writes();
        const audit = writes.find((w) =>
            /INSERT INTO audit_log/.test(w.sql) &&
            w.args.some((a) => a === 'event_day.checklist_item_undone')
        );
        expect(audit).toBeDefined();
    });
});

describe('getEventHqAggregate', () => {
    let env;
    beforeEach(() => { env = createMockEnv(); });

    it('throws when eventId missing', async () => {
        await expect(getEventHqAggregate(env, '')).rejects.toThrow(/eventId required/);
    });

    it('combines roster + staffing + checklist counts + recent activity', async () => {
        env.DB.__on(/FROM attendees a[\s\S]+INNER JOIN bookings/, {
            total: 50, checked_in: 23,
        }, 'first');
        env.DB.__on(/FROM event_staffing\s+WHERE event_id = \?/, {
            total: 8, present: 6,
        }, 'first');
        env.DB.__on(/FROM event_checklists\s+WHERE event_id = \?/, {
            total: 3, completed: 1,
        }, 'first');
        env.DB.__on(/FROM audit_log[\s\S]+ORDER BY created_at DESC/, {
            results: [
                { action: 'event_day.checkin_bypass_waiver', target_type: 'attendee', target_id: 'att_1', meta_json: '{"eventId":"evt_1"}', created_at: 1700001000000 },
                { action: 'event.created', target_type: 'event', target_id: 'evt_1', meta_json: '{}', created_at: 1700000000000 },
            ],
        }, 'all');

        const result = await getEventHqAggregate(env, 'evt_1');
        expect(result).toMatchObject({
            eventId: 'evt_1',
            rosterTotal: 50,
            rosterCheckedIn: 23,
            staffTotal: 8,
            staffPresent: 6,
            checklistsTotal: 3,
            checklistsCompleted: 1,
        });
        expect(result.recentActivity).toHaveLength(2);
        expect(result.recentActivity[0].action).toBe('event_day.checkin_bypass_waiver');
    });

    it('handles missing event_staffing table gracefully (M5 RBAC tolerance)', async () => {
        env.DB.__on(/FROM attendees a[\s\S]+INNER JOIN bookings/, { total: 0, checked_in: 0 }, 'first');
        env.DB.__on(/FROM event_staffing/, () => {
            throw new Error('no such table');
        }, 'first');
        env.DB.__on(/FROM event_checklists\s+WHERE event_id = \?/, { total: 0, completed: 0 }, 'first');
        env.DB.__on(/FROM audit_log/, { results: [] }, 'all');

        const result = await getEventHqAggregate(env, 'evt_1');
        expect(result.staffTotal).toBe(0);
        expect(result.staffPresent).toBe(0);
    });
});

// M5.5 Batch 10a — runRecurrenceGenerationSweep I/O tests.
//
// Covers:
//   - Returns zero counts when no active series exist
//   - Generates child field_rentals rows for one weekly series in window
//   - Idempotency: existing (recurrence_id, instance_index) rows are skipped
//     when re-running the sweep
//   - Advances recurrence_generated_through sentinel after generation
//   - Auto-deactivates series when max_occurrences is hit
//   - Conflict on generated rental → writes
//     field_rental.recurrence_generated_with_conflict audit but rental
//     still inserts
//   - Skips series whose template_starts_local/ends_local is malformed
//     (continues to next candidate instead of throwing)
//   - Returns 0 counts gracefully when field_rental_recurrences table is
//     missing (defensive try/catch)
//   - Bumps recurrence_generated_through to seriesEndsOn even when no
//     candidate dates fall in window (so re-runs don't keep re-scanning)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runRecurrenceGenerationSweep } from '../../../worker/lib/fieldRentalRecurrences.js';
import { createMockEnv } from '../../helpers/mockEnv.js';

// All tests run with system time frozen at 2026-06-15 12:00 UTC so the
// 90-day horizon falls in well-known territory (2026-09-13). The Denver
// offset on that date is MDT (-360).
const FROZEN_NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

let env;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
    env = createMockEnv();
});

afterEach(() => {
    vi.useRealTimers();
});

function recurrenceRow(overrides = {}) {
    return {
        id: 'frr_test_001',
        customer_id: 'cus_acme',
        site_id: 'site_ghost_town',
        frequency: 'weekly',
        weekday_mask: 4, // Tuesday
        monthly_pattern: null,
        custom_dates_json: null,
        starts_on: '2026-06-15',
        ends_on: null,
        max_occurrences: null,
        template_engagement_type: 'paintball',
        template_site_field_ids: 'fld_main',
        template_starts_local: '09:00',
        template_ends_local: '17:00',
        template_site_fee_cents: 50000,
        template_pricing_notes: 'Cleanup included',
        recurrence_generated_through: null,
        active: 1,
        created_by: 'u_owner',
        created_at: 1000,
        updated_at: 1000,
        ...overrides,
    };
}

// Default mocks: no events / blackouts / overlapping rentals + audit log INSERTs
// + field_rentals INSERTs all return ok. Tests override specific binds to assert.
function bindNoConflicts(db) {
    db.__on(/FROM events/, { results: [] }, 'all');
    db.__on(/FROM site_blackouts/, { results: [] }, 'all');
    // Conflict-side field_rentals query is the one with WHERE site_id; bind empty.
    db.__on(/FROM field_rentals\s+WHERE site_id/, { results: [] }, 'all');
}

describe('runRecurrenceGenerationSweep', () => {
    it('returns zero counts when no active series exist', async () => {
        env.DB.__on(/FROM field_rental_recurrences\s+WHERE active = 1/, { results: [] }, 'all');

        const result = await runRecurrenceGenerationSweep(env);
        expect(result.seriesProcessed).toBe(0);
        expect(result.generatedCount).toBe(0);
        expect(result.seriesDeactivated).toBe(0);
        expect(result.conflictCount).toBe(0);
    });

    it('returns zero counts gracefully when field_rental_recurrences table missing', async () => {
        env.DB.__on(/FROM field_rental_recurrences/, () => {
            throw new Error('no such table: field_rental_recurrences');
        }, 'all');

        const result = await runRecurrenceGenerationSweep(env);
        expect(result.seriesProcessed).toBe(0);
        expect(result.generatedCount).toBe(0);
    });

    it('generates child field_rentals rows for a weekly series in window', async () => {
        env.DB.__on(/FROM field_rental_recurrences\s+WHERE active = 1/, {
            results: [recurrenceRow()],
        }, 'all');
        // No existing children for this recurrence yet
        env.DB.__on(/SELECT MAX\(recurrence_instance_index\)/, { max_idx: 0, cnt: 0 }, 'first');
        env.DB.__on(/SELECT id FROM field_rentals\s+WHERE recurrence_id/, null, 'first');
        bindNoConflicts(env.DB);

        const result = await runRecurrenceGenerationSweep(env);
        // Tuesdays in window 2026-06-15 to 2026-09-13: 16, 23, 30, Jul 7, 14, 21, 28,
        // Aug 4, 11, 18, 25, Sep 1, 8 = 13 Tuesdays
        expect(result.generatedCount).toBe(13);
        expect(result.seriesProcessed).toBe(1);
        expect(result.conflictCount).toBe(0);
        expect(result.seriesDeactivated).toBe(0);

        // Verify the INSERT bound MDT-aware schedule timestamps for the first
        // candidate (2026-06-16 09:00 MDT = 2026-06-16 15:00 UTC)
        const writes = env.DB.__writes();
        const inserts = writes.filter((w) => /INSERT INTO field_rentals/.test(w.sql));
        expect(inserts.length).toBe(13);
        const firstInsertArgs = inserts[0].args;
        // scheduled_starts_at is in the 8th position (0-indexed: id, cust, site,
        // field_ids, engagement, recurrence_id, idx, starts) but the binds are
        // positional — let's grep for the MDT-aware ms value instead.
        const expectedStartMs = Date.UTC(2026, 5, 16, 15, 0); // 09:00 MDT = 15:00 UTC
        expect(firstInsertArgs).toContain(expectedStartMs);
    });

    it('idempotency: skips occurrences when (recurrence_id, instance_index) row already exists', async () => {
        env.DB.__on(/FROM field_rental_recurrences\s+WHERE active = 1/, {
            results: [recurrenceRow()],
        }, 'all');
        // Pretend 13 instances are already generated
        env.DB.__on(/SELECT MAX\(recurrence_instance_index\)/, { max_idx: 13, cnt: 13 }, 'first');
        // Every existence check returns an existing row
        env.DB.__on(/SELECT id FROM field_rentals\s+WHERE recurrence_id/, { id: 'fr_existing' }, 'first');
        bindNoConflicts(env.DB);

        const result = await runRecurrenceGenerationSweep(env);
        expect(result.generatedCount).toBe(0); // all skipped as duplicates

        const writes = env.DB.__writes();
        const inserts = writes.filter((w) => /INSERT INTO field_rentals/.test(w.sql));
        expect(inserts.length).toBe(0); // no actual INSERTs fired
    });

    it('advances recurrence_generated_through sentinel after generation', async () => {
        env.DB.__on(/FROM field_rental_recurrences\s+WHERE active = 1/, {
            results: [recurrenceRow()],
        }, 'all');
        env.DB.__on(/SELECT MAX\(recurrence_instance_index\)/, { max_idx: 0, cnt: 0 }, 'first');
        env.DB.__on(/SELECT id FROM field_rentals\s+WHERE recurrence_id/, null, 'first');
        bindNoConflicts(env.DB);

        await runRecurrenceGenerationSweep(env);

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE field_rental_recurrences SET recurrence_generated_through/.test(w.sql));
        expect(update).toBeDefined();
        // Last generated Tuesday in the 90-day window is 2026-09-08
        expect(update.args).toContain('2026-09-08');
    });

    it('auto-deactivates series when max_occurrences is hit', async () => {
        env.DB.__on(/FROM field_rental_recurrences\s+WHERE active = 1/, {
            results: [recurrenceRow({ max_occurrences: 3 })],
        }, 'all');
        env.DB.__on(/SELECT MAX\(recurrence_instance_index\)/, { max_idx: 0, cnt: 0 }, 'first');
        env.DB.__on(/SELECT id FROM field_rentals\s+WHERE recurrence_id/, null, 'first');
        bindNoConflicts(env.DB);

        const result = await runRecurrenceGenerationSweep(env);
        expect(result.generatedCount).toBe(3); // capped at max
        expect(result.seriesDeactivated).toBe(1);

        const writes = env.DB.__writes();
        const deactivate = writes.find((w) => /UPDATE field_rental_recurrences SET active = 0/.test(w.sql));
        expect(deactivate).toBeDefined();
    });

    it('conflict on generated rental → field_rental.recurrence_generated_with_conflict audit + rental still inserts', async () => {
        env.DB.__on(/FROM field_rental_recurrences\s+WHERE active = 1/, {
            results: [recurrenceRow({ max_occurrences: 1 })], // only 1 child to keep test focused
        }, 'all');
        env.DB.__on(/SELECT MAX\(recurrence_instance_index\)/, { max_idx: 0, cnt: 0 }, 'first');
        env.DB.__on(/SELECT id FROM field_rentals\s+WHERE recurrence_id/, null, 'first');
        // Conflict source: an event on the same site
        env.DB.__on(/FROM events/, {
            results: [{ id: 'ev_conflict', title: 'Op Nightfall', date_iso: '2026-06-16', location: null }],
        }, 'all');
        env.DB.__on(/FROM site_blackouts/, { results: [] }, 'all');
        env.DB.__on(/FROM field_rentals\s+WHERE site_id/, { results: [] }, 'all');

        const result = await runRecurrenceGenerationSweep(env);
        expect(result.generatedCount).toBe(1);
        expect(result.conflictCount).toBe(1);

        const writes = env.DB.__writes();
        const inserts = writes.filter((w) => /INSERT INTO field_rentals/.test(w.sql));
        expect(inserts.length).toBe(1); // rental still inserted
        const conflictAudit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql)
            && w.args.includes('field_rental.recurrence_generated_with_conflict'));
        expect(conflictAudit).toBeDefined();
    });

    it('skips occurrences with malformed template times (continues sweep)', async () => {
        env.DB.__on(/FROM field_rental_recurrences\s+WHERE active = 1/, {
            results: [recurrenceRow({ template_starts_local: 'bogus', template_ends_local: '17:00' })],
        }, 'all');
        env.DB.__on(/SELECT MAX\(recurrence_instance_index\)/, { max_idx: 0, cnt: 0 }, 'first');
        env.DB.__on(/SELECT id FROM field_rentals\s+WHERE recurrence_id/, null, 'first');
        bindNoConflicts(env.DB);

        const result = await runRecurrenceGenerationSweep(env);
        // 13 candidate dates but all skipped because template_starts_local is unparseable
        expect(result.generatedCount).toBe(0);
        expect(result.seriesProcessed).toBe(1);
    });

    it('inactive series are excluded by the WHERE active = 1 SQL filter', async () => {
        let capturedSql = '';
        env.DB.__on(/FROM field_rental_recurrences/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        await runRecurrenceGenerationSweep(env);
        expect(capturedSql).toMatch(/active = 1/);
    });

    it('bumps recurrence_generated_through to seriesEndsOn when no candidates in window', async () => {
        env.DB.__on(/FROM field_rental_recurrences\s+WHERE active = 1/, {
            results: [recurrenceRow({
                // Custom frequency with no dates in the window → 0 candidates
                frequency: 'custom',
                weekday_mask: null,
                custom_dates_json: '[]',
            })],
        }, 'all');
        bindNoConflicts(env.DB);

        await runRecurrenceGenerationSweep(env);
        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE field_rental_recurrences SET recurrence_generated_through/.test(w.sql));
        expect(update).toBeDefined();
        // seriesEndsOn = horizon (2026-09-13) since ends_on is null
        expect(update.args).toContain('2026-09-13');
    });

    it('resumes numbering from MAX(recurrence_instance_index) + 1', async () => {
        env.DB.__on(/FROM field_rental_recurrences\s+WHERE active = 1/, {
            results: [recurrenceRow({ max_occurrences: 16 })], // allow new generation
        }, 'all');
        // 13 already exist
        env.DB.__on(/SELECT MAX\(recurrence_instance_index\)/, { max_idx: 13, cnt: 13 }, 'first');
        env.DB.__on(/SELECT id FROM field_rentals\s+WHERE recurrence_id/, null, 'first');
        bindNoConflicts(env.DB);

        await runRecurrenceGenerationSweep(env);

        const writes = env.DB.__writes();
        const inserts = writes.filter((w) => /INSERT INTO field_rentals/.test(w.sql));
        // First new insert should use idx=14
        const firstArgs = inserts[0].args;
        expect(firstArgs).toContain(14);
    });

    it('emits field_rental.created audit row with source=recurrence_cron per generated rental', async () => {
        env.DB.__on(/FROM field_rental_recurrences\s+WHERE active = 1/, {
            results: [recurrenceRow({ max_occurrences: 1 })],
        }, 'all');
        env.DB.__on(/SELECT MAX\(recurrence_instance_index\)/, { max_idx: 0, cnt: 0 }, 'first');
        env.DB.__on(/SELECT id FROM field_rentals\s+WHERE recurrence_id/, null, 'first');
        bindNoConflicts(env.DB);

        await runRecurrenceGenerationSweep(env);

        const writes = env.DB.__writes();
        const createdAudit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql)
            && w.args.includes('field_rental.created'));
        expect(createdAudit).toBeDefined();
        // meta_json field should include source=recurrence_cron
        const metaArg = createdAudit.args.find((a) => typeof a === 'string' && a.includes('"source":"recurrence_cron"'));
        expect(metaArg).toBeDefined();
    });
});

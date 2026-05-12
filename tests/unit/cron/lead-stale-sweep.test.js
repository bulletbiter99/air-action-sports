// M5.5 Batch 10b — runLeadStaleSweep cron tests.
//
// Covers: 14-day staleness threshold, 7-day re-notify cadence via
// lead_stale_at sentinel, status filter (only lead/draft), archived
// exclusion, recipient resolution, template-missing graceful,
// {alerted, suppressed, failed} summary.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    runLeadStaleSweep,
    shouldAlertLeadStale,
    daysSince,
} from '../../../worker/lib/fieldRentalCron.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { mockResendFetch } from '../../helpers/mockResend.js';

const FROZEN_NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15 12:00 UTC
const DAY_MS = 24 * 60 * 60 * 1000;

let env;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
    env = createMockEnv();
    env.ADMIN_NOTIFY_EMAIL = 'admin@example.com';
    mockResendFetch();
});

afterEach(() => {
    vi.useRealTimers();
});

function rentalRow(overrides = {}) {
    return {
        id: 'fr_001',
        customer_id: 'cus_acme',
        status: 'lead',
        updated_at: FROZEN_NOW - 20 * DAY_MS, // 20 days stale
        lead_stale_at: null,
        aas_site_coordinator_person_id: null,
        ...overrides,
    };
}

function bindTemplate(db) {
    db.__on(/SELECT \* FROM email_templates WHERE slug = \?/, {
        slug: 'field_rental_lead_stale',
        subject: 'Stale lead: {{rental_id}}',
        body_html: '<p>{{customer_name}} ({{status}}, {{days_since_last_update}}d)</p>',
        body_text: '{{customer_name}}',
    }, 'first');
    db.__on(/FROM customers WHERE id = \?/, { name: 'Acme Tactical' }, 'first');
}

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

describe('daysSince', () => {
    it('integer days between now and a past ms', () => {
        expect(daysSince(FROZEN_NOW - 14 * DAY_MS, FROZEN_NOW)).toBe(14);
        expect(daysSince(FROZEN_NOW - 0.5 * DAY_MS, FROZEN_NOW)).toBe(0);
    });

    it('returns 0 for null / non-finite input', () => {
        expect(daysSince(null, FROZEN_NOW)).toBe(0);
        expect(daysSince('abc', FROZEN_NOW)).toBe(0);
    });
});

describe('shouldAlertLeadStale', () => {
    it('rental in "lead" with updated_at 20d ago + null sentinel → alert', () => {
        expect(shouldAlertLeadStale(rentalRow(), FROZEN_NOW)).toBe(true);
    });

    it('rental in "draft" 20d stale → alert', () => {
        expect(shouldAlertLeadStale(rentalRow({ status: 'draft' }), FROZEN_NOW)).toBe(true);
    });

    it('rental in "sent" status → false (excluded)', () => {
        expect(shouldAlertLeadStale(rentalRow({ status: 'sent' }), FROZEN_NOW)).toBe(false);
    });

    it('rental updated 10d ago (< 14d threshold) → false', () => {
        expect(shouldAlertLeadStale(rentalRow({ updated_at: FROZEN_NOW - 10 * DAY_MS }), FROZEN_NOW)).toBe(false);
    });

    it('rental with lead_stale_at 3d ago → false (re-notify suppressed)', () => {
        expect(shouldAlertLeadStale(rentalRow({ lead_stale_at: FROZEN_NOW - 3 * DAY_MS }), FROZEN_NOW)).toBe(false);
    });

    it('rental with lead_stale_at 10d ago → true (cadence aged out)', () => {
        expect(shouldAlertLeadStale(rentalRow({ lead_stale_at: FROZEN_NOW - 10 * DAY_MS }), FROZEN_NOW)).toBe(true);
    });

    it('handles null/missing rental defensively', () => {
        expect(shouldAlertLeadStale(null, FROZEN_NOW)).toBe(false);
        expect(shouldAlertLeadStale(undefined, FROZEN_NOW)).toBe(false);
        expect(shouldAlertLeadStale({}, FROZEN_NOW)).toBe(false);
    });
});

// ────────────────────────────────────────────────────────────────────
// Sweep I/O
// ────────────────────────────────────────────────────────────────────

describe('runLeadStaleSweep', () => {
    it('returns zero counts when no candidates exist', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE status IN/, { results: [] }, 'all');
        const result = await runLeadStaleSweep(env);
        expect(result).toEqual({ alerted: 0, suppressed: 0, failed: 0, durationMs: expect.any(Number) });
    });

    it('alerts a stale lead rental + sets lead_stale_at sentinel + writes audit', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE status IN/, { results: [rentalRow()] }, 'all');
        bindTemplate(env.DB);

        const result = await runLeadStaleSweep(env);
        expect(result.alerted).toBe(1);
        expect(result.suppressed).toBe(0);
        expect(result.failed).toBe(0);

        const writes = env.DB.__writes();
        const sentinelUpdate = writes.find((w) => /UPDATE field_rentals SET lead_stale_at/.test(w.sql));
        expect(sentinelUpdate).toBeDefined();
        // First bind is the new lead_stale_at value (= FROZEN_NOW)
        expect(sentinelUpdate.args[0]).toBe(FROZEN_NOW);
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql)
            && w.args.includes('field_rental.lead_stale_alert'));
        expect(audit).toBeDefined();
    });

    it('alerts a stale draft rental', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE status IN/, {
            results: [rentalRow({ status: 'draft' })],
        }, 'all');
        bindTemplate(env.DB);

        const result = await runLeadStaleSweep(env);
        expect(result.alerted).toBe(1);
    });

    it('uses site coordinator email when set', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE status IN/, {
            results: [rentalRow({ aas_site_coordinator_person_id: 'prs_coord' })],
        }, 'all');
        env.DB.__on(/SELECT email FROM persons WHERE id = \?/, { email: 'coord@aas.example' }, 'first');
        bindTemplate(env.DB);

        await runLeadStaleSweep(env);

        const calls = globalThis.fetch.mock.calls;
        const payload = JSON.parse(calls[calls.length - 1][1].body);
        expect(payload.to).toEqual(['coord@aas.example']);
    });

    it('falls back to ADMIN_NOTIFY_EMAIL when no coordinator assigned', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE status IN/, { results: [rentalRow()] }, 'all');
        bindTemplate(env.DB);

        await runLeadStaleSweep(env);

        const calls = globalThis.fetch.mock.calls;
        const payload = JSON.parse(calls[calls.length - 1][1].body);
        expect(payload.to).toEqual(['admin@example.com']);
    });

    it('records failed count when template missing', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE status IN/, { results: [rentalRow()] }, 'all');
        env.DB.__on(/FROM customers WHERE id = \?/, { name: 'Acme' }, 'first');
        // No email_templates handler — loadTemplate returns null

        const result = await runLeadStaleSweep(env);
        expect(result.failed).toBe(1);
        expect(result.alerted).toBe(0);

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql)
            && w.args.includes('field_rental.lead_stale_template_missing'));
        expect(audit).toBeDefined();
    });

    it('records failed count when no recipient (empty ADMIN_NOTIFY_EMAIL + no coordinator)', async () => {
        env.ADMIN_NOTIFY_EMAIL = '';
        env.DB.__on(/FROM field_rentals\s+WHERE status IN/, { results: [rentalRow()] }, 'all');

        const result = await runLeadStaleSweep(env);
        expect(result.failed).toBe(1);

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql)
            && w.args.includes('field_rental.lead_stale_no_recipient'));
        expect(audit).toBeDefined();
    });

    it('SQL filter excludes archived rentals and selects only lead/draft status', async () => {
        let capturedSql = '';
        let capturedBinds = null;
        env.DB.__on(/FROM field_rentals\s+WHERE status IN/, (sql, args) => {
            capturedSql = sql;
            capturedBinds = args;
            return { results: [] };
        }, 'all');

        await runLeadStaleSweep(env);
        expect(capturedSql).toMatch(/status IN \('lead', 'draft'\)/);
        expect(capturedSql).toMatch(/archived_at IS NULL/);
        // First bind = 14-day threshold (now - 14d); second = 7-day renotify cutoff
        expect(capturedBinds[0]).toBe(FROZEN_NOW - 14 * DAY_MS);
        expect(capturedBinds[1]).toBe(FROZEN_NOW - 7 * DAY_MS);
    });

    it('returns zero counts gracefully when field_rentals table missing', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE status IN/, () => {
            throw new Error('no such table');
        }, 'all');

        const result = await runLeadStaleSweep(env);
        expect(result.alerted).toBe(0);
        expect(result.failed).toBe(0);
    });
});

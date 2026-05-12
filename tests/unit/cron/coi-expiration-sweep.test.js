// M5.5 Batch 10b — runCoiExpirationSweep cron tests.
//
// Covers the COI expiration alert sweep: bucket classifier, sentinel
// idempotency, recipient resolution (site coordinator → ADMIN_NOTIFY_EMAIL
// fallback), filter for archived/cancelled/non-received-COI rentals,
// template-missing graceful, and the {sent60,sent30,sent7,failed}
// summary contract.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    runCoiExpirationSweep,
    classifyCoiBucket,
    bucketSentinelColumn,
    bucketAuditAction,
    resolveAlertRecipient,
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
        site_id: 'site_ghost_town',
        scheduled_starts_at: FROZEN_NOW + 30 * DAY_MS,
        coi_expires_at: FROZEN_NOW + 25 * DAY_MS, // 25 days from now → 30d bucket
        coi_alert_60d_sent_at: null,
        coi_alert_30d_sent_at: null,
        coi_alert_7d_sent_at: null,
        aas_site_coordinator_person_id: null,
        ...overrides,
    };
}

function bindTemplateAndContext(db, slug = 'coi_alert_30d') {
    db.__on(/SELECT \* FROM email_templates WHERE slug = \?/, {
        slug,
        subject: 'COI alert: {{rental_id}}',
        body_html: '<p>{{customer_name}}</p>',
        body_text: '{{customer_name}}',
    }, 'first');
    db.__on(/FROM customers WHERE id = \?/, { name: 'Acme Tactical' }, 'first');
    db.__on(/FROM sites WHERE id = \?/, { name: 'Ghost Town' }, 'first');
}

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

describe('classifyCoiBucket', () => {
    it('returns 60 for 45 days out', () => {
        expect(classifyCoiBucket(FROZEN_NOW + 45 * DAY_MS, FROZEN_NOW)).toBe(60);
    });

    it('returns 30 for 25 days out (not 60)', () => {
        expect(classifyCoiBucket(FROZEN_NOW + 25 * DAY_MS, FROZEN_NOW)).toBe(30);
    });

    it('returns 7 for 5 days out (not 30)', () => {
        expect(classifyCoiBucket(FROZEN_NOW + 5 * DAY_MS, FROZEN_NOW)).toBe(7);
    });

    it('returns null for expired (diff < 0)', () => {
        expect(classifyCoiBucket(FROZEN_NOW - 1 * DAY_MS, FROZEN_NOW)).toBeNull();
    });

    it('returns null for more than 60 days out', () => {
        expect(classifyCoiBucket(FROZEN_NOW + 90 * DAY_MS, FROZEN_NOW)).toBeNull();
    });

    it('returns null for null/non-finite input', () => {
        expect(classifyCoiBucket(null, FROZEN_NOW)).toBeNull();
        expect(classifyCoiBucket('abc', FROZEN_NOW)).toBeNull();
    });
});

describe('bucketSentinelColumn', () => {
    it('maps bucket to column name', () => {
        expect(bucketSentinelColumn(60)).toBe('coi_alert_60d_sent_at');
        expect(bucketSentinelColumn(30)).toBe('coi_alert_30d_sent_at');
        expect(bucketSentinelColumn(7)).toBe('coi_alert_7d_sent_at');
        expect(bucketSentinelColumn(99)).toBeNull();
    });
});

describe('bucketAuditAction', () => {
    it('maps bucket to audit action string', () => {
        expect(bucketAuditAction(60)).toBe('field_rental.coi_alert.60d');
        expect(bucketAuditAction(30)).toBe('field_rental.coi_alert.30d');
        expect(bucketAuditAction(7)).toBe('field_rental.coi_alert.7d');
    });
});

describe('resolveAlertRecipient', () => {
    it('returns site coordinator email when set', async () => {
        env.DB.__on(/SELECT email FROM persons WHERE id = \?/, { email: 'coord@aas.example' }, 'first');
        const got = await resolveAlertRecipient(env, { aas_site_coordinator_person_id: 'prs_1' });
        expect(got).toBe('coord@aas.example');
    });

    it('falls back to ADMIN_NOTIFY_EMAIL when site coordinator has no email', async () => {
        env.DB.__on(/SELECT email FROM persons WHERE id = \?/, { email: null }, 'first');
        const got = await resolveAlertRecipient(env, { aas_site_coordinator_person_id: 'prs_1' });
        expect(got).toBe('admin@example.com');
    });

    it('falls back to ADMIN_NOTIFY_EMAIL when no coordinator assigned', async () => {
        const got = await resolveAlertRecipient(env, { aas_site_coordinator_person_id: null });
        expect(got).toBe('admin@example.com');
    });

    it('returns null when neither coordinator nor ADMIN_NOTIFY_EMAIL set', async () => {
        env.ADMIN_NOTIFY_EMAIL = '';
        const got = await resolveAlertRecipient(env, { aas_site_coordinator_person_id: null });
        expect(got).toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────────
// Sweep I/O
// ────────────────────────────────────────────────────────────────────

describe('runCoiExpirationSweep', () => {
    it('returns zero counts when no candidates exist', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE coi_status/, { results: [] }, 'all');
        const result = await runCoiExpirationSweep(env);
        expect(result).toEqual({ sent60: 0, sent30: 0, sent7: 0, failed: 0, durationMs: expect.any(Number) });
    });

    it('returns zero counts gracefully when field_rentals table missing', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE coi_status/, () => {
            throw new Error('no such table');
        }, 'all');
        const result = await runCoiExpirationSweep(env);
        expect(result.sent60).toBe(0);
    });

    it('30d bucket: alerts a rental in (now+7d, now+30d] with null sentinel and sets sentinel + audit', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE coi_status/, { results: [rentalRow()] }, 'all');
        bindTemplateAndContext(env.DB, 'coi_alert_30d');

        const result = await runCoiExpirationSweep(env);
        expect(result.sent30).toBe(1);
        expect(result.sent60).toBe(0);
        expect(result.sent7).toBe(0);

        const writes = env.DB.__writes();
        const sentinelUpdate = writes.find((w) => /UPDATE field_rentals SET coi_alert_30d_sent_at/.test(w.sql));
        expect(sentinelUpdate).toBeDefined();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('field_rental.coi_alert.30d'));
        expect(audit).toBeDefined();
    });

    it('60d bucket: alerts a rental in (now+30d, now+60d]', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE coi_status/, {
            results: [rentalRow({ coi_expires_at: FROZEN_NOW + 45 * DAY_MS })],
        }, 'all');
        bindTemplateAndContext(env.DB, 'coi_alert_60d');

        const result = await runCoiExpirationSweep(env);
        expect(result.sent60).toBe(1);

        const writes = env.DB.__writes();
        const sentinelUpdate = writes.find((w) => /UPDATE field_rentals SET coi_alert_60d_sent_at/.test(w.sql));
        expect(sentinelUpdate).toBeDefined();
    });

    it('7d bucket: alerts a rental in (now, now+7d] (urgent)', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE coi_status/, {
            results: [rentalRow({ coi_expires_at: FROZEN_NOW + 3 * DAY_MS })],
        }, 'all');
        bindTemplateAndContext(env.DB, 'coi_alert_7d');

        const result = await runCoiExpirationSweep(env);
        expect(result.sent7).toBe(1);
    });

    it('skips a rental whose sentinel is already set (idempotency)', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE coi_status/, {
            results: [rentalRow({ coi_alert_30d_sent_at: FROZEN_NOW - 86400000 })],
        }, 'all');
        bindTemplateAndContext(env.DB, 'coi_alert_30d');

        const result = await runCoiExpirationSweep(env);
        expect(result.sent30).toBe(0);

        const writes = env.DB.__writes();
        const sentinelUpdate = writes.find((w) => /UPDATE field_rentals SET coi_alert_30d_sent_at/.test(w.sql));
        expect(sentinelUpdate).toBeUndefined();
    });

    it('uses site coordinator email when set (recipient resolution)', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE coi_status/, {
            results: [rentalRow({ aas_site_coordinator_person_id: 'prs_coord' })],
        }, 'all');
        env.DB.__on(/SELECT email FROM persons WHERE id = \?/, { email: 'coord@aas.example' }, 'first');
        bindTemplateAndContext(env.DB, 'coi_alert_30d');

        await runCoiExpirationSweep(env);

        // Inspect the captured Resend fetch payload — `to` field is the recipient
        const calls = globalThis.fetch.mock.calls;
        const lastCall = calls[calls.length - 1];
        const payload = JSON.parse(lastCall[1].body);
        expect(payload.to).toEqual(['coord@aas.example']);
    });

    it('falls back to ADMIN_NOTIFY_EMAIL when no coordinator assigned', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE coi_status/, { results: [rentalRow()] }, 'all');
        bindTemplateAndContext(env.DB, 'coi_alert_30d');

        await runCoiExpirationSweep(env);

        const calls = globalThis.fetch.mock.calls;
        const payload = JSON.parse(calls[calls.length - 1][1].body);
        expect(payload.to).toEqual(['admin@example.com']);
    });

    it('records failed count + audit when template is missing', async () => {
        env.DB.__on(/FROM field_rentals\s+WHERE coi_status/, { results: [rentalRow()] }, 'all');
        // Don't bind email_templates → first() returns null → loadTemplate returns null
        env.DB.__on(/FROM customers WHERE id = \?/, { name: 'Acme Tactical' }, 'first');
        env.DB.__on(/FROM sites WHERE id = \?/, { name: 'Ghost Town' }, 'first');

        const result = await runCoiExpirationSweep(env);
        expect(result.failed).toBe(1);
        expect(result.sent30).toBe(0);

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql)
            && w.args.includes('field_rental.coi_alert_template_missing'));
        expect(audit).toBeDefined();
    });

    it('records failed count when no recipient resolved (no coordinator + no ADMIN_NOTIFY_EMAIL)', async () => {
        env.ADMIN_NOTIFY_EMAIL = '';
        env.DB.__on(/FROM field_rentals\s+WHERE coi_status/, { results: [rentalRow()] }, 'all');

        const result = await runCoiExpirationSweep(env);
        expect(result.failed).toBe(1);

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql)
            && w.args.includes('field_rental.coi_alert_no_recipient'));
        expect(audit).toBeDefined();
    });

    it('SQL filter excludes archived + cancelled + non-received-COI rentals', async () => {
        let capturedSql = '';
        env.DB.__on(/FROM field_rentals\s+WHERE coi_status/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        await runCoiExpirationSweep(env);
        expect(capturedSql).toMatch(/coi_status = 'received'/);
        expect(capturedSql).toMatch(/archived_at IS NULL/);
        expect(capturedSql).toMatch(/cancelled_at IS NULL/);
    });
});

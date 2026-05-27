// Post-M6 Track D-3 — verify all 4 transition endpoints (/status, /cancel,
// /archive, /reschedule) clear lead_stale_at to NULL on transition. Resolves
// the M5.5 polish item where revert-to-draft had a 7-day silence before
// re-alerting (operator preference: any movement should reset the clock).

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';

let env;
let cookieHeader;

const rentalRow = (overrides = {}) => ({
    id: 'fr_001',
    customer_id: 'cus_x',
    site_id: 'site_g',
    site_field_ids: 'fld_main',
    engagement_type: 'tactical_training',
    lead_source: 'email',
    recurrence_id: null,
    recurrence_instance_index: null,
    scheduled_starts_at: 1000,
    scheduled_ends_at: 2000,
    arrival_window_starts_at: null,
    cleanup_buffer_ends_at: null,
    status: 'lead',
    status_changed_at: 1000,
    status_change_reason: null,
    site_fee_cents: 50000,
    addon_fees_json: '[]',
    discount_cents: 0,
    discount_reason: null,
    tax_cents: 0,
    total_cents: 50000,
    deposit_required_cents: null,
    deposit_due_at: null,
    deposit_received_at: null,
    deposit_method: null,
    deposit_reference: null,
    deposit_received_by: null,
    balance_due_at: null,
    balance_received_at: null,
    balance_method: null,
    balance_reference: null,
    balance_received_by: null,
    coi_status: 'not_required',
    coi_expires_at: null,
    headcount_estimate: null,
    schedule_notes: null,
    equipment_notes: null,
    staffing_notes: null,
    special_permissions_json: '{}',
    requirements_coi_received: 0,
    requirements_agreement_signed: 0,
    requirements_deposit_received: 0,
    requirements_briefing_scheduled: 0,
    requirements_walkthrough_completed: 0,
    notes: 'private',
    notes_sensitive: null,
    aas_site_coordinator_person_id: null,
    archived_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    cancellation_deposit_retained: 0,
    lead_stale_at: 999000, // sentinel set by a prior cron alert; should clear on transition
    created_by: 'u_owner',
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
});

function req(path, init = {}) {
    return new Request(`https://airactionsport.com${path}`, init);
}

function jsonReq(path, body, init = {}) {
    return req(path, {
        method: init.method || 'POST',
        headers: { cookie: cookieHeader, 'content-type': 'application/json', ...(init.headers || {}) },
        body: JSON.stringify(body),
    });
}

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

describe('Post-M6 D-3 — lead_stale_at clears on transition', () => {
    it('/status UPDATE includes lead_stale_at = NULL', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.write']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'lead', lead_stale_at: 999000 }), 'first');
        env.DB.__on(/UPDATE field_rentals SET status/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/status', { to: 'draft', reason: 'next step' }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE field_rentals SET status/.test(w.sql) && w.kind === 'run');
        expect(update).toBeDefined();
        expect(update.sql).toMatch(/lead_stale_at\s*=\s*NULL/);
    });

    it('/cancel UPDATE includes lead_stale_at = NULL', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.cancel']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'sent', lead_stale_at: 999000 }), 'first');
        env.DB.__on(/UPDATE field_rentals\s+SET status = 'cancelled'/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/cancel', { reason: 'customer pulled out' }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE field_rentals\s+SET status = 'cancelled'/.test(w.sql) && w.kind === 'run');
        expect(update).toBeDefined();
        expect(update.sql).toMatch(/lead_stale_at\s*=\s*NULL/);
    });

    it('/archive UPDATE includes lead_stale_at = NULL', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.archive']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'completed', lead_stale_at: 999000 }), 'first');
        env.DB.__on(/UPDATE field_rentals SET archived_at/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/archive', {}), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE field_rentals SET archived_at/.test(w.sql) && w.kind === 'run');
        expect(update).toBeDefined();
        expect(update.sql).toMatch(/lead_stale_at\s*=\s*NULL/);
    });

    it('/reschedule UPDATE includes lead_stale_at = NULL', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.reschedule']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'sent', lead_stale_at: 999000 }), 'first');
        env.DB.__on(/FROM events/, { results: [] }, 'all');
        env.DB.__on(/FROM site_blackouts/, { results: [] }, 'all');
        env.DB.__on(/FROM field_rentals\s+WHERE site_id/, { results: [] }, 'all');
        env.DB.__on(/UPDATE field_rentals\s+SET scheduled_starts_at/, { meta: { changes: 1 } }, 'run');

        const startsAt = Date.parse('2026-06-20T00:00:00Z');
        const endsAt = Date.parse('2026-06-21T00:00:00Z');
        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/reschedule', {
            scheduled_starts_at: startsAt, scheduled_ends_at: endsAt,
        }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE field_rentals\s+SET scheduled_starts_at/.test(w.sql) && w.kind === 'run');
        expect(update).toBeDefined();
        expect(update.sql).toMatch(/lead_stale_at\s*=\s*NULL/);
    });

    it('/status with already-NULL lead_stale_at remains safe (clause still in SQL)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.write']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'lead', lead_stale_at: null }), 'first');
        env.DB.__on(/UPDATE field_rentals SET status/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/status', { to: 'draft' }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE field_rentals SET status/.test(w.sql) && w.kind === 'run');
        // Clause is unconditional — UPDATE setting NULL = NULL is a no-op but harmless.
        expect(update.sql).toMatch(/lead_stale_at\s*=\s*NULL/);
    });
});

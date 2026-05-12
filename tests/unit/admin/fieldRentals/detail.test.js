// M5.5 Batch 7a — detail + create + status-transition tests for the
// field rentals admin route. This file also exercises the dedicated
// /cancel, /archive, /reschedule endpoints + PUT update — every action
// that mutates a rental's state lives in /admin/field-rentals/:id/*.

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

// ────────────────────────────────────────────────────────────────────
// GET /:id detail
// ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/field-rentals/:id — detail', () => {
    it('returns 403 without field_rentals.read', async () => {
        bindCapabilities(env.DB, 'u_owner', []);
        const res = await worker.fetch(req('/api/admin/field-rentals/fr_001', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(403);
    });

    it('returns 404 when rental does not exist', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, null, 'first');

        const res = await worker.fetch(req('/api/admin/field-rentals/fr_missing', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(404);
    });

    it('returns rental + contacts + site + customer with masked PII by default', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow(), 'first');
        env.DB.__on(/FROM field_rental_contacts WHERE rental_id = \?/, {
            results: [
                {
                    id: 'frc_1', rental_id: 'fr_001', full_name: 'Jane Renter',
                    email: 'jane@acme.example', phone: '5550000', role: 'billing',
                    is_primary: 1, notes: null, created_at: 1000, updated_at: 1000,
                },
            ],
        }, 'all');
        env.DB.__on(/SELECT id, name, slug FROM sites WHERE id = \?/, { id: 'site_g', name: 'Ghost Town', slug: 'ghost-town' }, 'first');
        env.DB.__on(/SELECT id, email, name, client_type FROM customers WHERE id = \?/, {
            id: 'cus_x', email: 'admin@acme.example', name: 'Acme Tactical', client_type: 'business',
        }, 'first');

        const res = await worker.fetch(req('/api/admin/field-rentals/fr_001', { headers: { cookie: cookieHeader } }), env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.rental.id).toBe('fr_001');
        expect(body.rental.notes).toBe('***');
        expect(body.contacts).toHaveLength(1);
        expect(body.contacts[0].email).toBe('***');
        expect(body.contacts[0].phone).toBe('***');
        expect(body.customer.email).toBeNull(); // masked
        expect(body.customer.name).toBe('Acme Tactical');
        expect(body.site.name).toBe('Ghost Town');
    });

    it('unmasks PII + writes customer_pii.unmasked audit when viewer has read.pii', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read', 'field_rentals.read.pii']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow(), 'first');
        env.DB.__on(/FROM field_rental_contacts WHERE rental_id = \?/, {
            results: [
                {
                    id: 'frc_1', rental_id: 'fr_001', full_name: 'Jane',
                    email: 'jane@acme.example', phone: null, role: 'billing',
                    is_primary: 1, notes: null, created_at: 1000, updated_at: 1000,
                },
            ],
        }, 'all');
        env.DB.__on(/SELECT id, name, slug FROM sites WHERE id = \?/, { id: 'site_g', name: 'Ghost Town', slug: 'ghost-town' }, 'first');
        env.DB.__on(/SELECT id, email, name, client_type FROM customers WHERE id = \?/, {
            id: 'cus_x', email: 'admin@acme.example', name: 'Acme', client_type: 'business',
        }, 'first');

        const res = await worker.fetch(req('/api/admin/field-rentals/fr_001', { headers: { cookie: cookieHeader } }), env, {});
        const body = await res.json();
        expect(body.rental.notes).toBe('private');
        expect(body.contacts[0].email).toBe('jane@acme.example');
        expect(body.customer.email).toBe('admin@acme.example');

        // Verify audit row was written
        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        expect(audit).toBeDefined();
        expect(audit.args).toContain('customer_pii.unmasked');
    });
});

// ────────────────────────────────────────────────────────────────────
// POST / create
// ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/field-rentals — create', () => {
    it('returns 403 without field_rentals.create', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.read']);
        const res = await worker.fetch(jsonReq('/api/admin/field-rentals', {}), env, {});
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('field_rentals.create');
    });

    it('rejects 400 on missing required fields', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.create']);
        const res = await worker.fetch(jsonReq('/api/admin/field-rentals', {
            scheduled_starts_at: 1000,
            scheduled_ends_at: 2000,
            // missing customer_id, site_id, site_field_ids, engagement_type
        }), env, {});
        expect(res.status).toBe(400);
    });

    it('rejects 400 on missing schedule', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.create']);
        const res = await worker.fetch(jsonReq('/api/admin/field-rentals', {
            customer_id: 'cus_x', site_id: 'site_g',
            site_field_ids: ['fld_main'], engagement_type: 'paintball',
        }), env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/scheduled_starts_at and scheduled_ends_at/);
    });

    it('rejects 400 when customer_id does not exist', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.create']);
        env.DB.__on(/SELECT id FROM customers WHERE id = \?/, null, 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals', {
            customer_id: 'cus_unknown', site_id: 'site_g',
            site_field_ids: ['fld_main'], engagement_type: 'paintball',
            scheduled_starts_at: 1000, scheduled_ends_at: 2000,
        }), env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/customer_id does not exist/);
    });

    it('rejects 409 when site is archived', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.create']);
        env.DB.__on(/SELECT id FROM customers WHERE id = \?/, { id: 'cus_x' }, 'first');
        env.DB.__on(/SELECT id, archived_at FROM sites WHERE id = \?/, { id: 'site_g', archived_at: 1000 }, 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals', {
            customer_id: 'cus_x', site_id: 'site_g',
            site_field_ids: ['fld_main'], engagement_type: 'paintball',
            scheduled_starts_at: 1000, scheduled_ends_at: 2000,
        }), env, {});
        expect(res.status).toBe(409);
    });

    it('returns 409 with conflict details when conflicts exist + acknowledgeConflicts not set', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.create']);
        env.DB.__on(/SELECT id FROM customers WHERE id = \?/, { id: 'cus_x' }, 'first');
        env.DB.__on(/SELECT id, archived_at FROM sites WHERE id = \?/, { id: 'site_g', archived_at: null }, 'first');
        // detectEventConflicts queries: events, site_blackouts, field_rentals
        env.DB.__on(/FROM events/, { results: [{ id: 'ev_a', title: 'Op X', date_iso: '2026-06-15', location: null }] }, 'all');
        env.DB.__on(/FROM site_blackouts/, { results: [] }, 'all');
        env.DB.__on(/FROM field_rentals\b/, { results: [] }, 'all');

        // Use a date_iso-friendly window
        const startsAt = Date.parse('2026-06-15T00:00:00Z');
        const endsAt = Date.parse('2026-06-16T00:00:00Z');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals', {
            customer_id: 'cus_x', site_id: 'site_g',
            site_field_ids: ['fld_main'], engagement_type: 'paintball',
            scheduled_starts_at: startsAt, scheduled_ends_at: endsAt,
        }), env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toBe('Schedule conflict');
        expect(body.conflicts.events).toHaveLength(1);
    });

    it('returns 403 when acknowledgeConflicts: true but no bypass capability', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.create']);
        env.DB.__on(/SELECT id FROM customers WHERE id = \?/, { id: 'cus_x' }, 'first');
        env.DB.__on(/SELECT id, archived_at FROM sites WHERE id = \?/, { id: 'site_g', archived_at: null }, 'first');
        env.DB.__on(/FROM events/, { results: [{ id: 'ev_a', title: 'Op X', date_iso: '2026-06-15', location: null }] }, 'all');
        env.DB.__on(/FROM site_blackouts/, { results: [] }, 'all');
        env.DB.__on(/FROM field_rentals\b/, { results: [] }, 'all');

        const startsAt = Date.parse('2026-06-15T00:00:00Z');
        const endsAt = Date.parse('2026-06-16T00:00:00Z');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals', {
            customer_id: 'cus_x', site_id: 'site_g',
            site_field_ids: ['fld_main'], engagement_type: 'paintball',
            scheduled_starts_at: startsAt, scheduled_ends_at: endsAt,
            acknowledgeConflicts: true,
        }), env, {});
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('field_rentals.create.bypass_conflict');
    });

    it('creates 201 with bypass capability + acknowledgeConflicts; recomputes pricing server-side', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.create', 'field_rentals.create.bypass_conflict']);
        env.DB.__on(/SELECT id FROM customers WHERE id = \?/, { id: 'cus_x' }, 'first');
        env.DB.__on(/SELECT id, archived_at FROM sites WHERE id = \?/, { id: 'site_g', archived_at: null }, 'first');
        env.DB.__on(/FROM events/, { results: [{ id: 'ev_a', title: 'Op X', date_iso: '2026-06-15', location: null }] }, 'all');
        env.DB.__on(/FROM site_blackouts/, { results: [] }, 'all');
        env.DB.__on(/FROM field_rentals\b/, { results: [] }, 'all');
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ total_cents: 60000 }), 'first');

        let insertedBinds = null;
        env.DB.__on(/INSERT INTO field_rentals/, (sql, args) => {
            insertedBinds = args;
            return { meta: { changes: 1 } };
        }, 'run');

        const startsAt = Date.parse('2026-06-15T00:00:00Z');
        const endsAt = Date.parse('2026-06-16T00:00:00Z');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals', {
            customer_id: 'cus_x', site_id: 'site_g',
            site_field_ids: ['fld_main'], engagement_type: 'paintball',
            scheduled_starts_at: startsAt, scheduled_ends_at: endsAt,
            site_fee_cents: 50000,
            addon_fees: [{ label: 'Cleanup', cents: 5000 }, { label: 'Lighting', cents: 5000 }],
            tax_cents: 0,
            total_cents: 999999999, // CLIENT-PROVIDED; route MUST ignore this
            acknowledgeConflicts: true,
        }), env, {});

        expect(res.status).toBe(201);
        // Verify the INSERT bound the server-recomputed total: 50000 + 10000 + 0 + 0 = 60000
        expect(insertedBinds).toContain(60000);
        expect(insertedBinds).not.toContain(999999999);
    });

    it('writes field_rental.created + field_rental.conflict_acknowledged audit rows when acknowledged', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.create', 'field_rentals.create.bypass_conflict']);
        env.DB.__on(/SELECT id FROM customers WHERE id = \?/, { id: 'cus_x' }, 'first');
        env.DB.__on(/SELECT id, archived_at FROM sites WHERE id = \?/, { id: 'site_g', archived_at: null }, 'first');
        env.DB.__on(/FROM events/, { results: [{ id: 'ev_a', title: 'Op X', date_iso: '2026-06-15', location: null }] }, 'all');
        env.DB.__on(/FROM site_blackouts/, { results: [] }, 'all');
        env.DB.__on(/FROM field_rentals\b/, { results: [] }, 'all');
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow(), 'first');
        env.DB.__on(/INSERT INTO field_rentals/, { meta: { changes: 1 } }, 'run');

        const startsAt = Date.parse('2026-06-15T00:00:00Z');
        const endsAt = Date.parse('2026-06-16T00:00:00Z');

        await worker.fetch(jsonReq('/api/admin/field-rentals', {
            customer_id: 'cus_x', site_id: 'site_g',
            site_field_ids: ['fld_main'], engagement_type: 'paintball',
            scheduled_starts_at: startsAt, scheduled_ends_at: endsAt,
            acknowledgeConflicts: true,
        }), env, {});

        const writes = env.DB.__writes();
        const auditRows = writes.filter((w) => /INSERT INTO audit_log/.test(w.sql));
        const actions = auditRows.map((w) => w.args[1]);
        expect(actions).toContain('field_rental.created');
        expect(actions).toContain('field_rental.conflict_acknowledged');
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /:id/status — non-cancel transitions
// ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/field-rentals/:id/status', () => {
    it('rejects 400 when target is "cancelled" (use /cancel)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.write']);

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/status', { to: 'cancelled' }), env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/Use POST \/:id\/cancel/);
    });

    it('rejects 400 when target is "refunded" (use B7b refund flow)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.write']);

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/status', { to: 'refunded' }), env, {});
        expect(res.status).toBe(400);
    });

    it('rejects 400 when target is not a valid status', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.write']);

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/status', { to: 'bogus' }), env, {});
        expect(res.status).toBe(400);
    });

    it('returns 409 on invalid transition (lead → paid)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.write']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'lead' }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/status', { to: 'paid' }), env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.allowed).toContain('draft');
    });

    it('returns 200 on valid transition (lead → draft) and writes audit', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.write']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'lead' }), 'first');
        env.DB.__on(/UPDATE field_rentals SET status/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/status', { to: 'draft', reason: 'Drafting contract' }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('field_rental.status_changed'));
        expect(audit).toBeDefined();
    });

    it('rejects 409 when rental is archived', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.write']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ archived_at: 1000 }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/status', { to: 'draft' }), env, {});
        expect(res.status).toBe(409);
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /:id/cancel
// ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/field-rentals/:id/cancel', () => {
    it('returns 403 without field_rentals.cancel', async () => {
        bindCapabilities(env.DB, 'u_owner', []);
        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/cancel', {}), env, {});
        expect(res.status).toBe(403);
    });

    it('returns 404 when rental does not exist', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.cancel']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, null, 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_x/cancel', {}), env, {});
        expect(res.status).toBe(404);
    });

    it('returns 409 when already cancelled', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.cancel']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'cancelled' }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/cancel', {}), env, {});
        expect(res.status).toBe(409);
    });

    it('sets status + cancelled_at + cancellation_reason + deposit_retained, writes audit', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.cancel']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'sent' }), 'first');
        let updateBinds = null;
        env.DB.__on(/UPDATE field_rentals\s+SET status = 'cancelled'/, (sql, args) => {
            updateBinds = args;
            return { meta: { changes: 1 } };
        }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/cancel', {
            reason: 'Customer pulled out', deposit_retained: true,
        }), env, {});
        expect(res.status).toBe(200);
        expect(updateBinds).toContain('Customer pulled out');
        expect(updateBinds).toContain(1); // deposit_retained binary

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('field_rental.cancelled'));
        expect(audit).toBeDefined();
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /:id/archive
// ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/field-rentals/:id/archive', () => {
    it('rejects non-terminal status with 409', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.archive']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'lead' }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/archive', {}), env, {});
        expect(res.status).toBe(409);
    });

    it('archives completed rentals successfully', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.archive']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'completed' }), 'first');
        env.DB.__on(/UPDATE field_rentals SET archived_at/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/archive', {}), env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.archived).toBe(true);
    });

    it('rejects already-archived rentals with 409', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.archive']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'completed', archived_at: 1000 }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/archive', {}), env, {});
        expect(res.status).toBe(409);
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /:id/reschedule
// ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/field-rentals/:id/reschedule', () => {
    it('returns 404 when rental does not exist', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.reschedule']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, null, 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_x/reschedule', {
            scheduled_starts_at: 1000, scheduled_ends_at: 2000,
        }), env, {});
        expect(res.status).toBe(404);
    });

    it('rejects 409 when rental is cancelled', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.reschedule']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'cancelled' }), 'first');

        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/reschedule', {
            scheduled_starts_at: 1000, scheduled_ends_at: 2000,
        }), env, {});
        expect(res.status).toBe(409);
    });

    it('passes excludeFieldRentalId to conflict check (does NOT flag self)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.reschedule']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'sent' }), 'first');
        env.DB.__on(/FROM events/, { results: [] }, 'all');
        env.DB.__on(/FROM site_blackouts/, { results: [] }, 'all');

        let fieldRentalConflictBinds = null;
        env.DB.__on(/FROM field_rentals\s+WHERE site_id/, (sql, args) => {
            fieldRentalConflictBinds = args;
            return { results: [] };
        }, 'all');
        env.DB.__on(/UPDATE field_rentals\s+SET scheduled_starts_at/, { meta: { changes: 1 } }, 'run');

        const startsAt = Date.parse('2026-06-20T00:00:00Z');
        const endsAt = Date.parse('2026-06-21T00:00:00Z');
        const res = await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/reschedule', {
            scheduled_starts_at: startsAt, scheduled_ends_at: endsAt,
        }), env, {});
        expect(res.status).toBe(200);
        // Last bind should be the rental id (excludeFieldRentalId)
        expect(fieldRentalConflictBinds[fieldRentalConflictBinds.length - 1]).toBe('fr_001');
    });

    it('writes field_rental.rescheduled audit on success', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.reschedule']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ status: 'sent' }), 'first');
        env.DB.__on(/FROM events/, { results: [] }, 'all');
        env.DB.__on(/FROM site_blackouts/, { results: [] }, 'all');
        env.DB.__on(/FROM field_rentals\s+WHERE site_id/, { results: [] }, 'all');
        env.DB.__on(/UPDATE field_rentals\s+SET scheduled_starts_at/, { meta: { changes: 1 } }, 'run');

        const startsAt = Date.parse('2026-06-20T00:00:00Z');
        const endsAt = Date.parse('2026-06-21T00:00:00Z');
        await worker.fetch(jsonReq('/api/admin/field-rentals/fr_001/reschedule', {
            scheduled_starts_at: startsAt, scheduled_ends_at: endsAt,
        }), env, {});

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('field_rental.rescheduled'));
        expect(audit).toBeDefined();
    });
});

// ────────────────────────────────────────────────────────────────────
// PUT /:id update
// ────────────────────────────────────────────────────────────────────

describe('PUT /api/admin/field-rentals/:id', () => {
    it('rejects status changes (point to dedicated endpoints)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.write']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow(), 'first');

        const res = await worker.fetch(req('/api/admin/field-rentals/fr_001', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'draft' }),
        }), env, {});
        expect(res.status).toBe(400);
    });

    it('rejects schedule changes via PUT (point to /reschedule)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.write']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow(), 'first');

        const res = await worker.fetch(req('/api/admin/field-rentals/fr_001', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({ scheduled_starts_at: 5000 }),
        }), env, {});
        expect(res.status).toBe(400);
    });

    it('archived rental rejects update with 409', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.write']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({ archived_at: 1000 }), 'first');

        const res = await worker.fetch(req('/api/admin/field-rentals/fr_001', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({ notes: 'updated' }),
        }), env, {});
        expect(res.status).toBe(409);
    });

    it('recomputes total_cents when site_fee_cents changes', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.write']);
        env.DB.__on(/SELECT \* FROM field_rentals WHERE id = \?/, rentalRow({
            site_fee_cents: 50000, addon_fees_json: '[]', discount_cents: 0, tax_cents: 0, total_cents: 50000,
        }), 'first');

        let updateBinds = null;
        env.DB.__on(/UPDATE field_rentals SET/, (sql, args) => {
            updateBinds = args;
            return { meta: { changes: 1 } };
        }, 'run');

        const res = await worker.fetch(req('/api/admin/field-rentals/fr_001', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({ site_fee_cents: 75000 }),
        }), env, {});
        expect(res.status).toBe(200);
        // total_cents should be 75000 (75000 + 0 - 0 + 0)
        expect(updateBinds).toContain(75000);
    });
});

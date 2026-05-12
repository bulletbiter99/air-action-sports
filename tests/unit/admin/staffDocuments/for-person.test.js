// Post-M5.5 P2 — tests for /api/admin/staff-documents/for-person/:personId
// + /:id/acknowledge-for-person (admin override ack).
//
// Status derivation per doc:
//   required + ack-at-current-version       → 'required_acked'
//   required + ack-at-older-version         → 'required_stale'
//   required + no ack                       → 'required_pending'
//   not required for person + has ack       → 'optional_acked'
//   not required + no ack                   → 'available'

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';

let env;
let cookieHeader;
const PERSON_ID = 'prs_1';

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

function bindForPersonFixture({ person = { id: PERSON_ID }, roles = [], docs = [], requiredRoles = [], acks = [] } = {}) {
    env.DB.__on(/SELECT id FROM persons WHERE id = \?/, person, 'first');
    env.DB.__on(/FROM person_roles pr/, { results: roles }, 'all');
    env.DB.__on(/FROM staff_documents\s+WHERE retired_at IS NULL/, { results: docs }, 'all');
    env.DB.__on(/FROM staff_document_roles sdr/, { results: requiredRoles }, 'all');
    env.DB.__on(/FROM staff_document_acknowledgments\s+WHERE person_id = \?/, { results: acks }, 'all');
}

async function getForPerson() {
    return worker.fetch(
        new Request(`https://airactionsport.com/api/admin/staff-documents/for-person/${PERSON_ID}`, {
            headers: { cookie: cookieHeader },
        }),
        env, {},
    );
}

describe('GET /api/admin/staff-documents/for-person/:personId — gating + shape', () => {
    it('returns 403 when caller lacks staff.documents.read', async () => {
        bindCapabilities(env.DB, 'u_owner', []);
        const res = await getForPerson();
        expect(res.status).toBe(403);
    });

    it('returns 404 when person not found', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.read']);
        env.DB.__on(/SELECT id FROM persons WHERE id = \?/, null, 'first');
        const res = await getForPerson();
        expect(res.status).toBe(404);
    });

    it('returns empty documents array when library is empty', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.read']);
        bindForPersonFixture({ docs: [] });
        const res = await getForPerson();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.documents).toEqual([]);
    });

    it('classifies docs across all 5 statuses', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.read']);
        bindForPersonFixture({
            roles: [
                { role_id: 'role_event_director', key: 'event_director', name: 'Event Director' },
            ],
            docs: [
                { id: 'sd_pending', kind: 'jd', slug: 'a', title: 'Pending JD', version: 'v1.0', body_sha256: 'h1', description: null },
                { id: 'sd_acked', kind: 'sop', slug: 'b', title: 'Acked SOP', version: 'v2.0', body_sha256: 'h2', description: null },
                { id: 'sd_stale', kind: 'policy', slug: 'c', title: 'Stale Policy', version: 'v3.0', body_sha256: 'h3', description: null },
                { id: 'sd_optional_acked', kind: 'training', slug: 'd', title: 'Optional Acked', version: 'v1.0', body_sha256: 'h4', description: null },
                { id: 'sd_available', kind: 'checklist', slug: 'e', title: 'Available', version: 'v1.0', body_sha256: 'h5', description: null },
            ],
            requiredRoles: [
                // pending + acked + stale are required for ED; optional + available are not
                { staff_document_id: 'sd_pending', role_id: 'role_event_director', key: 'event_director', name: 'Event Director' },
                { staff_document_id: 'sd_acked',   role_id: 'role_event_director', key: 'event_director', name: 'Event Director' },
                { staff_document_id: 'sd_stale',   role_id: 'role_event_director', key: 'event_director', name: 'Event Director' },
            ],
            acks: [
                { staff_document_id: 'sd_acked',          document_version: 'v2.0', acknowledged_at: Date.now() - 86400000, source: 'portal_self_serve' },
                { staff_document_id: 'sd_stale',          document_version: 'v2.0', acknowledged_at: Date.now() - 1000000, source: 'portal_self_serve' }, // older than v3.0
                { staff_document_id: 'sd_optional_acked', document_version: 'v1.0', acknowledged_at: Date.now() - 100,     source: 'admin_assigned' },
            ],
        });

        const res = await getForPerson();
        expect(res.status).toBe(200);
        const body = await res.json();
        const byId = Object.fromEntries(body.documents.map((d) => [d.staffDocumentId, d]));

        expect(byId.sd_pending.status).toBe('required_pending');
        expect(byId.sd_acked.status).toBe('required_acked');
        expect(byId.sd_stale.status).toBe('required_stale');
        expect(byId.sd_optional_acked.status).toBe('optional_acked');
        expect(byId.sd_available.status).toBe('available');

        // requiredForRoles included only for required docs
        expect(byId.sd_pending.requiredForRoles).toHaveLength(1);
        expect(byId.sd_available.requiredForRoles).toHaveLength(0);

        // ack info attached when present
        expect(byId.sd_acked.acknowledged).toEqual({
            version: 'v2.0',
            at: expect.any(Number),
            source: 'portal_self_serve',
        });
        expect(byId.sd_pending.acknowledged).toBe(null);
    });

    it('does not surface required-tag for roles the person does not have', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.read']);
        bindForPersonFixture({
            roles: [
                { role_id: 'role_event_director', key: 'event_director', name: 'Event Director' },
            ],
            docs: [
                { id: 'sd_for_emt', kind: 'training', slug: 'cpr', title: 'CPR cert', version: 'v1.0', body_sha256: 'h', description: null },
            ],
            requiredRoles: [
                // This doc is required for role_event_emt — but person is ED, not EMT
                { staff_document_id: 'sd_for_emt', role_id: 'role_event_emt', key: 'event_emt', name: 'EMT' },
            ],
            acks: [],
        });

        const res = await getForPerson();
        const body = await res.json();
        expect(body.documents[0].status).toBe('available');
        expect(body.documents[0].requiredForRoles).toEqual([]);
    });
});

describe('POST /api/admin/staff-documents/:id/acknowledge-for-person', () => {
    it('returns 403 when caller lacks staff.documents.assign', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.read']);
        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/staff-documents/sd_1/acknowledge-for-person', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'content-type': 'application/json' },
                body: JSON.stringify({ personId: PERSON_ID }),
            }),
            env, {},
        );
        expect(res.status).toBe(403);
    });

    it('returns 400 when personId is missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.assign']);
        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/staff-documents/sd_1/acknowledge-for-person', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'content-type': 'application/json' },
                body: JSON.stringify({}),
            }),
            env, {},
        );
        expect(res.status).toBe(400);
    });

    it('returns 404 when document does not exist', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.assign']);
        env.DB.__on(/SELECT id, version, body_sha256, retired_at FROM staff_documents/, null, 'first');
        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/staff-documents/sd_unknown/acknowledge-for-person', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'content-type': 'application/json' },
                body: JSON.stringify({ personId: PERSON_ID }),
            }),
            env, {},
        );
        expect(res.status).toBe(404);
    });

    it('returns 409 when document is retired', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.assign']);
        env.DB.__on(/SELECT id, version, body_sha256, retired_at FROM staff_documents/, {
            id: 'sd_old', version: 'v1.0', body_sha256: 'h', retired_at: Date.now() - 1000,
        }, 'first');
        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/staff-documents/sd_old/acknowledge-for-person', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'content-type': 'application/json' },
                body: JSON.stringify({ personId: PERSON_ID }),
            }),
            env, {},
        );
        expect(res.status).toBe(409);
    });

    it('returns 409 when already acknowledged at the current version', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.assign']);
        env.DB.__on(/SELECT id, version, body_sha256, retired_at FROM staff_documents/, {
            id: 'sd_1', version: 'v1.0', body_sha256: 'h', retired_at: null,
        }, 'first');
        env.DB.__on(/SELECT id FROM persons WHERE id = \?/, { id: PERSON_ID }, 'first');
        env.DB.__on(/SELECT id FROM staff_document_acknowledgments/, { id: 'ack_existing' }, 'first');
        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/staff-documents/sd_1/acknowledge-for-person', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'content-type': 'application/json' },
                body: JSON.stringify({ personId: PERSON_ID }),
            }),
            env, {},
        );
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.ackId).toBe('ack_existing');
    });

    it('happy path: inserts ack with source=admin_assigned + version + body_sha256 snapshot, audits', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.documents.assign']);
        env.DB.__on(/SELECT id, version, body_sha256, retired_at FROM staff_documents/, {
            id: 'sd_1', version: 'v1.0', body_sha256: 'sha_pinned', retired_at: null,
        }, 'first');
        env.DB.__on(/SELECT id FROM persons WHERE id = \?/, { id: PERSON_ID }, 'first');
        env.DB.__on(/SELECT id FROM staff_document_acknowledgments/, null, 'first');
        env.DB.__on(/INSERT INTO staff_document_acknowledgments/, { meta: { changes: 1 } }, 'run');

        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/staff-documents/sd_1/acknowledge-for-person', {
                method: 'POST',
                headers: { cookie: cookieHeader, 'content-type': 'application/json' },
                body: JSON.stringify({ personId: PERSON_ID }),
            }),
            env, {},
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.version).toBe('v1.0');
        expect(body.ackId).toMatch(/^ack_[0-9A-Za-z]{12}$/);

        const inserts = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO staff_document_acknowledgments'));
        expect(inserts).toHaveLength(1);
        // (id, person_id, staff_document_id, document_version, body_sha256_snapshot, acknowledged_at), source is literal
        expect(inserts[0].args[1]).toBe(PERSON_ID);
        expect(inserts[0].args[2]).toBe('sd_1');
        expect(inserts[0].args[3]).toBe('v1.0');
        expect(inserts[0].args[4]).toBe('sha_pinned');
        expect(inserts[0].sql).toContain("'admin_assigned'");

        const audits = env.DB.__writes().filter((w) => w.sql.includes('INSERT INTO audit_log'));
        const ackAudit = audits.find((a) => a.args.some((x) => x === 'staff.document.acknowledged_by_admin'));
        expect(ackAudit).toBeDefined();
    });
});

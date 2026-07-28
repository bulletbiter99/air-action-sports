// Sprint 4 — PUT /api/admin/staff/:id/tax-identity + the einOnFile surface.
//
// Migration 0078 added persons.legal_name + ein_ciphertext for the 1099
// report, but nothing could ever WRITE them (PUT /:id's allow-list excludes
// both). This is the write path: legalName stored plain, EIN normalized to
// NN-NNNNNNN and stored ENCRYPTED. The plaintext EIN must never appear in
// the UPDATE binds, the audit meta, or any staff-detail response — the only
// decrypt lives in the 1099 report (staff.read.pii + per-view audit).

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';
import { decrypt } from '../../../../worker/lib/personEncryption.js';

let env;
let cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

// mockD1 registers the FIRST handler per pattern (documented trap) — so the
// person-exists bind lives in a helper called per test, never in beforeEach,
// or the 404 test's null re-bind would silently lose.
function bindPerson() {
    env.DB.__on(/SELECT id FROM persons WHERE id = \?/, { id: 'prs_1' }, 'first');
}

async function put(body) {
    return worker.fetch(
        new Request('https://airactionsport.com/api/admin/staff/prs_1/tax-identity', {
            method: 'PUT',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }),
        env, {},
    );
}

describe('PUT /api/admin/staff/:id/tax-identity — rails', () => {
    it('403 when caller lacks staff.write', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read']);
        bindPerson();
        expect((await put({ legalName: 'Jane Q Doe' })).status).toBe(403);
    });

    it('400 when neither field is present', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.write']);
        bindPerson();
        expect((await put({})).status).toBe(400);
    });

    it('404 for an unknown person', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.write']);
        env.DB.__on(/SELECT id FROM persons WHERE id = \?/, null, 'first');
        expect((await put({ legalName: 'X' })).status).toBe(404);
    });

    it('400 for an EIN that is not 9 digits', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.write']);
        bindPerson();
        const res = await put({ ein: '12-345678' }); // 8 digits
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/9 digits/);
    });
});

describe('PUT /api/admin/staff/:id/tax-identity — writes', () => {
    beforeEach(() => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.write']);
        bindPerson();
        env.DB.__on(/UPDATE persons SET/, { meta: { changes: 1 } }, 'run');
    });

    it('stores legalName plain and the EIN ENCRYPTED (plaintext never in binds or audit)', async () => {
        const res = await put({ legalName: '  Jane Q Doe  ', ein: '12 3456789' });
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const update = writes.find((w) => /UPDATE persons SET/.test(w.sql));
        expect(update.sql).toMatch(/legal_name = \?/);
        expect(update.sql).toMatch(/ein_ciphertext = \?/);
        expect(update.args).toContain('Jane Q Doe'); // trimmed

        // The plaintext EIN appears NOWHERE in any bind of any statement.
        for (const w of writes) {
            for (const a of (w.args || [])) {
                expect(String(a)).not.toContain('123456789');
                expect(String(a)).not.toContain('12-3456789');
            }
        }

        // The stored ciphertext round-trips to the NORMALIZED form.
        const ciphertext = update.args.find((a) => typeof a === 'string' && a.length > 40);
        expect(ciphertext).toBeDefined();
        expect(await decrypt(ciphertext, env.SESSION_SECRET)).toBe('12-3456789');

        const audit = writes.find((w) => w.args?.some?.((a) => a === 'staff.tax_identity_updated'));
        expect(audit).toBeDefined();
        const metaArg = audit.args.find((a) => typeof a === 'string' && a.startsWith('{'));
        expect(JSON.parse(metaArg)).toEqual({ legalNameSet: true, einSet: true });
    });

    it('clears the EIN with ein: null (einCleared in the audit)', async () => {
        const res = await put({ ein: null });
        expect(res.status).toBe(200);
        const update = env.DB.__writes().find((w) => /UPDATE persons SET/.test(w.sql));
        expect(update.sql).toMatch(/ein_ciphertext = \?/);
        expect(update.args[0]).toBeNull();
        const audit = env.DB.__writes().find((w) => w.args?.some?.((a) => a === 'staff.tax_identity_updated'));
        expect(JSON.parse(audit.args.find((a) => typeof a === 'string' && a.startsWith('{')))).toEqual({ einCleared: true });
    });

    it('legalName alone leaves ein_ciphertext untouched', async () => {
        await put({ legalName: 'Solo Change' });
        const update = env.DB.__writes().find((w) => /UPDATE persons SET/.test(w.sql));
        expect(update.sql).toMatch(/legal_name = \?/);
        expect(update.sql).not.toMatch(/ein_ciphertext/);
    });
});

describe('GET /api/admin/staff/:id — tax-identity surface', () => {
    it('returns legalName + einOnFile, never a plaintext ein field', async () => {
        bindCapabilities(env.DB, 'u_owner', ['staff.read', 'staff.read.pii']);
        env.DB.__on(/SELECT \* FROM persons WHERE id = \?/, {
            id: 'prs_1', full_name: 'Jane Doe', email: 'jane@example.com',
            status: 'active', legal_name: 'Jane Q Doe', ein_ciphertext: 'opaque-ciphertext-blob',
            created_at: 1, updated_at: 1,
        }, 'first');
        env.DB.__on(/FROM person_roles/, { results: [] }, 'all');
        env.DB.__on(/FROM person_tags/, { results: [] }, 'all');

        const res = await worker.fetch(
            new Request('https://airactionsport.com/api/admin/staff/prs_1', {
                headers: { cookie: cookieHeader },
            }),
            env, {},
        );
        expect(res.status).toBe(200);
        const { person } = await res.json();
        expect(person.legalName).toBe('Jane Q Doe');
        expect(person.einOnFile).toBe(true);
        expect(person.ein).toBeUndefined();
        expect(JSON.stringify(person)).not.toContain('opaque-ciphertext-blob');
    });
});

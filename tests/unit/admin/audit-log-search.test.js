// M7 Batch 6 — audit-log search route tests (FTS5 path + LIKE fallback + flag gate).
//
// mockD1 is a shape mock, not a SQL engine, so these assert which SQL the route
// ISSUES (via __writes) and that it degrades safely — true FTS5 matching is
// validated at operator-apply against real D1.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';

let env;
let cookieHeader;

function req(path, cookie = cookieHeader) {
    return new Request(`https://airactionsport.com${path}`, { headers: { cookie } });
}

// Clean 200-shape responses for the count + rows queries.
function bindAuditQueries(db) {
    db.__on(/SELECT COUNT\(\*\) AS n FROM audit_log/, { n: 0 }, 'first');
    db.__on(/FROM audit_log al/, { results: [] }, 'all');
}

// Drive isEnabled('audit_log_fts').
function bindFlag(db, state) {
    db.__on(/FROM feature_flags\s+WHERE key = \?/, {
        key: 'audit_log_fts', state, user_opt_in_default: 0, role_scope: null,
    }, 'first');
}

const argsOf = (db) => db.__writes().flatMap((w) => w.args);
const sqlOf = (db) => db.__writes().map((w) => w.sql).join('\n');

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

describe('GET /api/admin/audit-log — FTS5 search (Batch 6)', () => {
    it('uses the FTS MATCH path when the flag is on and q is present', async () => {
        bindFlag(env.DB, 'on');
        bindAuditQueries(env.DB);
        const res = await worker.fetch(req('/api/admin/audit-log?q=refund%20booking'), env, {});
        expect(res.status).toBe(200);

        expect(sqlOf(env.DB)).toContain('audit_log_fts');
        expect(sqlOf(env.DB)).toContain('MATCH');
        // the sanitized match expression is bound — NOT the raw q, NOT a LIKE
        expect(argsOf(env.DB)).toContain('"refund"* "booking"*');
        expect(argsOf(env.DB)).not.toContain('%refund booking%');
    });

    it('uses the LIKE path when the flag is off', async () => {
        bindFlag(env.DB, 'off');
        bindAuditQueries(env.DB);
        const res = await worker.fetch(req('/api/admin/audit-log?q=refund'), env, {});
        expect(res.status).toBe(200);

        expect(sqlOf(env.DB)).not.toContain('MATCH');
        expect(argsOf(env.DB)).toContain('%refund%');
    });

    it('falls back to LIKE when the FTS query throws (index not yet applied)', async () => {
        bindFlag(env.DB, 'on');
        // Registered FIRST so it wins for any SQL mentioning the FTS table.
        env.DB.__on(/audit_log_fts/, () => { throw new Error('no such table: audit_log_fts'); });
        // LIKE-retry queries (no audit_log_fts substring) get clean responses.
        env.DB.__on(/SELECT COUNT\(\*\) AS n FROM audit_log/, { n: 0 }, 'first');
        env.DB.__on(/FROM audit_log al/, { results: [] }, 'all');

        const res = await worker.fetch(req('/api/admin/audit-log?q=refund'), env, {});
        expect(res.status).toBe(200); // did not 500 — fell back to LIKE
    });

    it('does not use MATCH when there is no q (plain listing)', async () => {
        bindFlag(env.DB, 'on');
        bindAuditQueries(env.DB);
        const res = await worker.fetch(req('/api/admin/audit-log'), env, {});
        expect(res.status).toBe(200);
        expect(sqlOf(env.DB)).not.toContain('MATCH');
    });

    it('still applies structured filters alongside q in FTS mode', async () => {
        bindFlag(env.DB, 'on');
        bindAuditQueries(env.DB);
        await worker.fetch(req('/api/admin/audit-log?q=foo&action=booking.refunded'), env, {});
        expect(argsOf(env.DB)).toContain('booking.refunded');
        expect(argsOf(env.DB)).toContain('"foo"*');
    });

    it('returns 403 for a staff-role viewer', async () => {
        env.DB.__reset(); // drop the owner user-row handler from beforeEach
        const staff = await createAdminSession(env, { id: 'u_staff', role: 'staff' });
        bindFlag(env.DB, 'on');
        bindAuditQueries(env.DB);
        const res = await worker.fetch(req('/api/admin/audit-log?q=x', staff.cookieHeader), env, {});
        expect(res.status).toBe(403);
    });
});

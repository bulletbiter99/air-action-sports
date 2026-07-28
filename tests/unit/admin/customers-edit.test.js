// C3 (2026-07-27) — PUT /api/admin/customers/:id + manual tag write path.
//
// Before this, customers were create-only: name/phone/notes and all four
// comm-preference columns were writable exactly once, at creation. The
// operational consequence was a consent gap — a customer who phoned in asking
// to be removed from marketing could not be honoured, because the only writers
// of email_marketing are the customer's own emailed unsubscribe link and the
// bounce/complaint webhook.
//
// Consent asymmetry is the load-bearing behaviour here: opting OUT is
// frictionless, opting back IN requires a typed reason, because
// email_marketing = 0 is the only persisted trace that an unsubscribe ever
// happened (the unsubscribe token is a stateless HMAC with no DB row).

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createAdminSession } from '../../helpers/adminSession.js';
import { bindCapabilities } from '../../helpers/personFixture.js';
import { SYSTEM_TAG_NAMES } from '../../../worker/lib/customerTags.js';

const CUS = 'cus_edit';
const req = (path, init = {}) => new Request(`https://airactionsport.com${path}`, init);

let env, cookieHeader;

beforeEach(async () => {
    env = createMockEnv();
    ({ cookieHeader } = await createAdminSession(env, { id: 'u_owner', role: 'owner' }));
    bindCapabilities(env.DB, 'u_owner', ['customers.write']);
});

function bindCustomer({ archived_at = null, email_marketing = 1 } = {}) {
    env.DB.__on(/FROM customers WHERE id = \?/, { id: CUS, archived_at, email_marketing }, 'first');
}

function captureUpdates() {
    const writes = [];
    env.DB.__on(/UPDATE customers SET/, (sql, args) => { writes.push({ sql, args }); return {}; }, 'run');
    return writes;
}

function captureAudits() {
    const rows = [];
    env.DB.__on(/INSERT INTO audit_log/, (sql, args) => { rows.push(args); return {}; }, 'run');
    return rows;
}

const put = (body) => worker.fetch(
    req(`/api/admin/customers/${CUS}`, {
        method: 'PUT',
        headers: { cookie: cookieHeader, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }), env, {},
);

// mockD1 keeps the FIRST handler registered for a pattern, so re-binding
// capabilities inside a test after beforeEach already bound them is a silent
// no-op. A read-only actor needs its own env from scratch.
async function readOnlyActor() {
    const e = createMockEnv();
    const { cookieHeader: cookie } = await createAdminSession(e, { id: 'u_ro', role: 'owner' });
    bindCapabilities(e.DB, 'u_ro', ['customers.read']);
    e.DB.__on(/FROM customers WHERE id = \?/, { id: CUS, archived_at: null, email_marketing: 1 }, 'first');
    return { env: e, cookie };
}

describe('PUT /api/admin/customers/:id — contact + notes', () => {
    it('updates name, phone and notes, and audits which fields moved', async () => {
        bindCustomer();
        const writes = captureUpdates();
        const audits = captureAudits();

        const res = await put({ name: '  Dana Reyes ', phone: ' 555-0100 ', notes: ' called about gear ' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, customerId: CUS });

        expect(writes).toHaveLength(1);
        // Trimmed, and updated_at appended.
        expect(writes[0].args.slice(0, 3)).toEqual(['Dana Reyes', '555-0100', 'called about gear']);
        expect(writes[0].sql).toMatch(/name = \?/);
        expect(writes[0].sql).toMatch(/updated_at = \?/);

        const updated = audits.find((a) => a.includes('customer.updated'));
        expect(updated).toBeTruthy();
        const meta = JSON.parse(updated.find((v) => typeof v === 'string' && v.startsWith('{')));
        expect(meta.fields).toEqual(['name', 'phone', 'notes']);
    });

    it('distinguishes "not provided" from "clear to null" — empty string clears', async () => {
        bindCustomer();
        const writes = captureUpdates();

        const res = await put({ phone: '' });
        expect(res.status).toBe(200);
        // Only phone in the SET clause; null rather than ''.
        expect(writes[0].sql).toMatch(/phone = \?/);
        expect(writes[0].sql).not.toMatch(/name = \?/);
        expect(writes[0].args[0]).toBe(null);
    });

    it('400s when no recognised field is present', async () => {
        bindCustomer();
        const res = await put({ somethingElse: 1 });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/No fields to update/);
    });

    it('404s for an unknown customer', async () => {
        env.DB.__on(/FROM customers WHERE id = \?/, null, 'first');
        expect((await put({ name: 'X' })).status).toBe(404);
    });

    it('409s on an archived customer', async () => {
        bindCustomer({ archived_at: 123 });
        const res = await put({ name: 'X' });
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/archived/);
    });

    it('403s without customers.write (write stays gated under open reads)', async () => {
        const ro = await readOnlyActor();
        const res = await worker.fetch(
            req(`/api/admin/customers/${CUS}`, {
                method: 'PUT',
                headers: { cookie: ro.cookie, 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'X' }),
            }), ro.env, {},
        );
        expect(res.status).toBe(403);
    });
});

describe('PUT /api/admin/customers/:id — comm preferences', () => {
    it('writes all four preference columns as 0/1 integers', async () => {
        bindCustomer({ email_marketing: 1 });
        const writes = captureUpdates();

        const res = await put({
            emailTransactional: true, emailMarketing: true,
            smsTransactional: false, smsMarketing: true,
        });
        expect(res.status).toBe(200);
        // 1, 1, 0, 1 then updated_at — never JS booleans (CHECK IN (0,1)).
        expect(writes[0].args.slice(0, 4)).toEqual([1, 1, 0, 1]);
    });

    it('rejects a non-boolean rather than coercing — "false" is truthy in JS', async () => {
        bindCustomer({ email_marketing: 0 });
        const writes = captureUpdates();

        const res = await put({ emailMarketing: 'false' });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/emailMarketing must be a boolean/);
        // The whole point: a coercing implementation would have opted this
        // customer back IN off a client-side bug.
        expect(writes).toHaveLength(0);
    });
});

describe('PUT /api/admin/customers/:id — marketing consent', () => {
    it('opting OUT needs no reason and writes a dedicated consent audit row', async () => {
        bindCustomer({ email_marketing: 1 });
        captureUpdates();
        const audits = captureAudits();

        const res = await put({ emailMarketing: false });
        expect(res.status).toBe(200);

        const consent = audits.find((a) => a.includes('customer.marketing_consent_changed'));
        expect(consent).toBeTruthy();
        const meta = JSON.parse(consent.find((v) => typeof v === 'string' && v.startsWith('{')));
        expect(meta).toEqual({ from: 1, to: 0, via: 'admin', reason: null });
        // The general update row is emitted too — both, not either.
        expect(audits.some((a) => a.includes('customer.updated'))).toBe(true);
    });

    it('opting IN without a reason is refused, and nothing is written', async () => {
        bindCustomer({ email_marketing: 0 });
        const writes = captureUpdates();

        const res = await put({ emailMarketing: true });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/marketingOptInReason is required/);
        expect(writes).toHaveLength(0);
    });

    it('opting IN with a reason succeeds and records the reason in the audit', async () => {
        bindCustomer({ email_marketing: 0 });
        captureUpdates();
        const audits = captureAudits();

        const res = await put({ emailMarketing: true, marketingOptInReason: 'Called 7/27, asked to rejoin' });
        expect(res.status).toBe(200);

        const consent = audits.find((a) => a.includes('customer.marketing_consent_changed'));
        const meta = JSON.parse(consent.find((v) => typeof v === 'string' && v.startsWith('{')));
        expect(meta).toEqual({ from: 0, to: 1, via: 'admin', reason: 'Called 7/27, asked to rejoin' });
    });

    it('a whitespace-only reason does not satisfy the requirement', async () => {
        bindCustomer({ email_marketing: 0 });
        const res = await put({ emailMarketing: true, marketingOptInReason: '   ' });
        expect(res.status).toBe(400);
    });

    it('re-asserting the SAME consent value emits no consent audit row', async () => {
        bindCustomer({ email_marketing: 1 });
        captureUpdates();
        const audits = captureAudits();

        // Already opted in, and no reason supplied — this must NOT 400, because
        // nothing is changing, and must not claim a consent change happened.
        const res = await put({ emailMarketing: true, name: 'Dana' });
        expect(res.status).toBe(200);
        expect(audits.some((a) => a.includes('customer.marketing_consent_changed'))).toBe(false);
    });
});

describe('POST /api/admin/customers/:id/tags', () => {
    const addTag = (tag) => worker.fetch(
        req(`/api/admin/customers/${CUS}/tags`, {
            method: 'POST',
            headers: { cookie: cookieHeader, 'content-type': 'application/json' },
            body: JSON.stringify({ tag }),
        }), env, {},
    );

    function bindNoExistingTag() {
        env.DB.__on(/SELECT tag FROM customer_tags WHERE customer_id = \? AND tag = \?/, null, 'first');
    }

    it('adds a manual tag, lowercased and trimmed, attributed to the actor', async () => {
        bindCustomer();
        bindNoExistingTag();
        const inserts = [];
        env.DB.__on(/INSERT INTO customer_tags/, (sql, args) => { inserts.push(args); return {}; }, 'run');
        const audits = captureAudits();

        const res = await addTag('  Reunion-2027 ');
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ success: true, customerId: CUS, tag: 'reunion-2027' });

        expect(inserts).toHaveLength(1);
        expect(inserts[0][0]).toBe(CUS);
        expect(inserts[0][1]).toBe('reunion-2027');
        expect(inserts[0][3]).toBe('u_owner');   // created_by
        expect(audits.some((a) => a.includes('customer.tag_added'))).toBe(true);
    });

    it.each(SYSTEM_TAG_NAMES)('refuses the reserved system tag "%s"', async (tag) => {
        bindCustomer();
        bindNoExistingTag();
        const res = await addTag(tag);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/system tag/);
    });

    it('refuses a reserved name in different case — lowercasing happens first', async () => {
        bindCustomer();
        bindNoExistingTag();
        // Without normalise-then-check, "VIP" slips past the ban list and then
        // becomes the row that collides with the nightly sweep.
        const res = await addTag('VIP');
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/system tag/);
    });

    it('refuses an empty tag and an over-long tag', async () => {
        bindCustomer();
        bindNoExistingTag();
        expect((await addTag('   ')).status).toBe(400);
        expect((await addTag('a'.repeat(41))).status).toBe(400);
    });

    it('refuses punctuation that would not survive the segment builder', async () => {
        bindCustomer();
        bindNoExistingTag();
        expect((await addTag("o'brien, vip")).status).toBe(400);
    });

    it('409s when the customer already holds the tag', async () => {
        bindCustomer();
        env.DB.__on(/SELECT tag FROM customer_tags WHERE customer_id = \? AND tag = \?/, { tag: 'reunion-2027' }, 'first');
        const res = await addTag('reunion-2027');
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/already has this tag/);
    });

    it('403s without customers.write', async () => {
        const ro = await readOnlyActor();
        const res = await worker.fetch(
            req(`/api/admin/customers/${CUS}/tags`, {
                method: 'POST',
                headers: { cookie: ro.cookie, 'content-type': 'application/json' },
                body: JSON.stringify({ tag: 'vip-guest' }),
            }), ro.env, {},
        );
        expect(res.status).toBe(403);
    });
});

describe('DELETE /api/admin/customers/:id/tags/:tag', () => {
    const del = (tag) => worker.fetch(
        req(`/api/admin/customers/${CUS}/tags/${encodeURIComponent(tag)}`, {
            method: 'DELETE',
            headers: { cookie: cookieHeader },
        }), env, {},
    );

    it('removes a manual tag and audits it', async () => {
        env.DB.__on(/SELECT tag_type FROM customer_tags/, { tag_type: 'manual' }, 'first');
        const deletes = [];
        env.DB.__on(/DELETE FROM customer_tags/, (sql, args) => { deletes.push({ sql, args }); return {}; }, 'run');
        const audits = captureAudits();

        const res = await del('reunion-2027');
        expect(res.status).toBe(200);
        expect(deletes).toHaveLength(1);
        // Scoped to manual so a system row can never be removed by this path.
        expect(deletes[0].sql).toMatch(/tag_type = 'manual'/);
        expect(audits.some((a) => a.includes('customer.tag_removed'))).toBe(true);
    });

    it('409s on a system tag rather than pretending to remove it', async () => {
        env.DB.__on(/SELECT tag_type FROM customer_tags/, { tag_type: 'system' }, 'first');
        const deletes = [];
        env.DB.__on(/DELETE FROM customer_tags/, (sql, args) => { deletes.push(args); return {}; }, 'run');

        const res = await del('vip');
        expect(res.status).toBe(409);
        // It would just reappear on the next nightly sweep.
        expect((await res.json()).error).toMatch(/system tag/);
        expect(deletes).toHaveLength(0);
    });

    it('404s when the customer does not hold the tag', async () => {
        env.DB.__on(/SELECT tag_type FROM customer_tags/, null, 'first');
        expect((await del('nope')).status).toBe(404);
    });

    it('matches case-insensitively, since tags are stored lowercased', async () => {
        let boundTag = null;
        env.DB.__on(/SELECT tag_type FROM customer_tags/, (sql, args) => {
            boundTag = args[1];
            return { tag_type: 'manual' };
        }, 'first');
        env.DB.__on(/DELETE FROM customer_tags/, {}, 'run');

        await del('Reunion-2027');
        expect(boundTag).toBe('reunion-2027');
    });
});

describe('POST /api/admin/customers/merge — manual tag carryover', () => {
    // Merging never carried tags across. That was invisible while no manual
    // tags existed; the moment they do, merging a tagged duplicate silently
    // discards operator work.
    it('copies the duplicate\'s manual tags onto the primary, skipping system tags', async () => {
        const e = createMockEnv();
        const { cookieHeader: cookie } = await createAdminSession(e, { id: 'u_owner', role: 'owner' });

        // Bind-aware: a single fixture would hand back the primary for the
        // duplicate lookup too, and the carryover would silently read the
        // wrong source customer.
        e.DB.__on(/SELECT id, archived_at FROM customers WHERE id = \?/,
            (sql, args) => ({ id: args[0], archived_at: null }), 'first');
        e.DB.__on(/UPDATE bookings SET customer_id/, {}, 'run');
        e.DB.__on(/UPDATE attendees SET customer_id/, {}, 'run');
        e.DB.__on(/UPDATE customers SET/, {}, 'run');
        e.DB.__on(/INSERT INTO audit_log/, {}, 'run');
        e.DB.__on(/FROM bookings WHERE customer_id/, { results: [] }, 'all');

        const carries = [];
        e.DB.__on(/INSERT OR IGNORE INTO customer_tags/, (sql, args) => {
            carries.push({ sql, args });
            return {};
        }, 'run');

        const res = await worker.fetch(
            req('/api/admin/customers/merge', {
                method: 'POST',
                headers: { cookie, 'content-type': 'application/json' },
                body: JSON.stringify({ primaryId: 'cus_p', duplicateIds: ['cus_d'] }),
            }), e, {},
        );
        expect(res.status).toBe(200);

        expect(carries).toHaveLength(1);
        // Reads only the duplicate's manual rows; writes them to the primary.
        expect(carries[0].sql).toMatch(/tag_type = 'manual'/);
        expect(carries[0].sql).toMatch(/INSERT OR IGNORE/);
        expect(carries[0].args[0]).toBe('cus_p');   // target customer
        expect(carries[0].args[2]).toBe('cus_d');   // source customer
    });
});

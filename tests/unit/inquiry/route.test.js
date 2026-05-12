// M5.5 Batch 11 — public POST /api/inquiry route tests.
//
// Covers: validation, honeypot silent-drop, rate limit 429, general
// inquiry path (audit + email only), field-rental lead path (customer
// lookup-or-create + lead INSERT + 2 audits + email), customer dedup
// on email match, email template-missing graceful, subject-prefix
// routing, IP capture.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { mockResendFetch } from '../../helpers/mockResend.js';

function postReq(body, headers = {}) {
    return new Request('https://airactionsport.com/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
}

let env;

beforeEach(() => {
    env = createMockEnv();
    env.ADMIN_NOTIFY_EMAIL = 'admin@example.com';
    mockResendFetch();
});

function bindTemplate(db) {
    db.__on(/SELECT \* FROM email_templates WHERE slug = \?/, {
        slug: 'inquiry_notification',
        subject: '{{subject_prefix}} {{name}}',
        body_html: '<p>{{message}}</p>',
        body_text: '{{message}}',
    }, 'first');
}

function bindNoCustomerExists(db) {
    db.__on(/SELECT id FROM customers WHERE email_normalized = \? AND archived_at IS NULL/, null, 'first');
}

// ────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────

describe('POST /api/inquiry — validation', () => {
    it('returns 400 on invalid JSON', async () => {
        const req = new Request('https://airactionsport.com/api/inquiry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'not json',
        });
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(400);
    });

    it('returns 400 when name is missing', async () => {
        const res = await worker.fetch(postReq({ email: 'a@b.com', message: 'hi' }), env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/[Nn]ame/);
    });

    it('returns 400 when email is missing', async () => {
        const res = await worker.fetch(postReq({ name: 'Jane', message: 'hi' }), env, {});
        expect(res.status).toBe(400);
    });

    it('returns 400 on invalid email format', async () => {
        const res = await worker.fetch(postReq({ name: 'Jane', email: 'not-an-email', message: 'hi' }), env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/valid email/i);
    });

    it('returns 400 when message is missing', async () => {
        const res = await worker.fetch(postReq({ name: 'Jane', email: 'a@b.com' }), env, {});
        expect(res.status).toBe(400);
    });

    it('returns 400 when message exceeds 5000 chars', async () => {
        const res = await worker.fetch(postReq({
            name: 'Jane', email: 'a@b.com', message: 'x'.repeat(5001),
        }), env, {});
        expect(res.status).toBe(400);
    });
});

// ────────────────────────────────────────────────────────────────────
// Honeypot
// ────────────────────────────────────────────────────────────────────

describe('POST /api/inquiry — honeypot', () => {
    it('non-empty website field → 200 OK with NO D1 writes (silent drop)', async () => {
        const res = await worker.fetch(postReq({
            name: 'Bot McBotface',
            email: 'bot@spam.example',
            message: 'buy my stuff',
            website: 'https://bot.example/payload',
        }), env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);

        // No customer / lead / audit INSERTs should fire
        const writes = env.DB.__writes();
        const inserts = writes.filter((w) => /INSERT/.test(w.sql));
        expect(inserts.length).toBe(0);
    });

    it('empty website field is treated as a normal submission', async () => {
        bindNoCustomerExists(env.DB);
        bindTemplate(env.DB);
        const res = await worker.fetch(postReq({
            name: 'Jane Renter', email: 'jane@example.com', message: 'hi', website: '',
        }), env, {});
        expect(res.status).toBe(200);

        // audit.submitted should have fired
        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('inquiry.submitted'));
        expect(audit).toBeDefined();
    });
});

// ────────────────────────────────────────────────────────────────────
// Rate limit
// ────────────────────────────────────────────────────────────────────

describe('POST /api/inquiry — rate limit', () => {
    it('returns 429 when RL_FEEDBACK rejects the request', async () => {
        env.RL_FEEDBACK.limit.mockResolvedValueOnce({ success: false });
        // RL middleware no-ops when key is empty; supply a CF-Connecting-IP
        // so clientIp(c) returns a non-empty string and the limit check fires.
        const req = postReq(
            { name: 'Jane', email: 'jane@example.com', message: 'hi' },
            { 'CF-Connecting-IP': '203.0.113.5' },
        );
        const res = await worker.fetch(req, env, {});
        expect(res.status).toBe(429);

        // No D1 writes should fire after rate-limit rejection
        const writes = env.DB.__writes();
        const inserts = writes.filter((w) => /INSERT/.test(w.sql));
        expect(inserts.length).toBe(0);
    });
});

// ────────────────────────────────────────────────────────────────────
// General inquiry path (subject = general / booking / feedback / other)
// ────────────────────────────────────────────────────────────────────

describe('POST /api/inquiry — general inquiry path', () => {
    it("subject='general' writes inquiry.submitted audit + sends email; NO customer/lead INSERTs", async () => {
        bindTemplate(env.DB);
        const res = await worker.fetch(postReq({
            name: 'Jane',
            email: 'jane@example.com',
            phone: '555-1234',
            subject: 'general',
            message: 'just curious',
        }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        // NO INSERT INTO customers, NO INSERT INTO field_rentals
        const customerInserts = writes.filter((w) => /INSERT INTO customers/.test(w.sql));
        const rentalInserts = writes.filter((w) => /INSERT INTO field_rentals/.test(w.sql));
        expect(customerInserts.length).toBe(0);
        expect(rentalInserts.length).toBe(0);

        // Single inquiry.submitted audit
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('inquiry.submitted'));
        expect(audit).toBeDefined();

        // Email sent with [General Inquiry] prefix
        const fetchCalls = globalThis.fetch.mock.calls;
        const payload = JSON.parse(fetchCalls[fetchCalls.length - 1][1].body);
        expect(payload.subject).toMatch(/\[General Inquiry\]/);
    });

    it("unknown subject defaults to 'general' (no lead created)", async () => {
        bindTemplate(env.DB);
        const res = await worker.fetch(postReq({
            name: 'Jane', email: 'jane@example.com',
            subject: 'made-up-subject',
            message: 'hi',
        }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const rentalInserts = writes.filter((w) => /INSERT INTO field_rentals/.test(w.sql));
        expect(rentalInserts.length).toBe(0);
    });
});

// ────────────────────────────────────────────────────────────────────
// Field-rental lead path (subject = private-hire / corporate)
// ────────────────────────────────────────────────────────────────────

describe('POST /api/inquiry — field-rental lead path', () => {
    it("subject='private-hire' with new email: creates customer + lead + 2 audits + email", async () => {
        bindNoCustomerExists(env.DB);
        bindTemplate(env.DB);

        const res = await worker.fetch(postReq({
            name: 'Acme Tactical',
            email: 'ops@acme.example',
            phone: '555-9999',
            subject: 'private-hire',
            message: 'We want to rent a field for a 12-week paintball league.',
        }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const customerInsert = writes.find((w) => /INSERT INTO customers/.test(w.sql));
        expect(customerInsert).toBeDefined();
        // customer INSERT binds the trimmed name + lowercased email
        expect(customerInsert.args).toContain('Acme Tactical');
        expect(customerInsert.args).toContain('ops@acme.example');

        const rentalInsert = writes.find((w) => /INSERT INTO field_rentals/.test(w.sql));
        expect(rentalInsert).toBeDefined();
        // engagement_type derived from subject: private-hire → private_skirmish
        expect(rentalInsert.args).toContain('private_skirmish');

        // Audits: customer.created + field_rental.lead_created + inquiry.submitted
        const auditRows = writes.filter((w) => /INSERT INTO audit_log/.test(w.sql));
        const actions = auditRows.map((w) => w.args[1]);
        expect(actions).toContain('customer.created');
        expect(actions).toContain('field_rental.lead_created');
        expect(actions).toContain('inquiry.submitted');

        // Email subject prefix
        const fetchCalls = globalThis.fetch.mock.calls;
        const payload = JSON.parse(fetchCalls[fetchCalls.length - 1][1].body);
        expect(payload.subject).toMatch(/\[Field Rental Inquiry\]/);
    });

    it("subject='corporate' maps engagement_type to 'corporate'", async () => {
        bindNoCustomerExists(env.DB);
        bindTemplate(env.DB);

        await worker.fetch(postReq({
            name: 'Acme Tactical', email: 'ops@acme.example',
            subject: 'corporate', message: 'corporate team event',
        }), env, {});

        const writes = env.DB.__writes();
        const rentalInsert = writes.find((w) => /INSERT INTO field_rentals/.test(w.sql));
        expect(rentalInsert).toBeDefined();
        expect(rentalInsert.args).toContain('corporate');
    });

    it('existing customer with matching email: links lead to existing (no new customer row)', async () => {
        // Customer lookup returns existing
        env.DB.__on(/SELECT id FROM customers WHERE email_normalized = \? AND archived_at IS NULL/, {
            id: 'cus_existing',
        }, 'first');
        bindTemplate(env.DB);

        const res = await worker.fetch(postReq({
            name: 'Acme Tactical', email: 'ops@acme.example',
            subject: 'private-hire', message: 'returning renter',
        }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const customerInserts = writes.filter((w) => /INSERT INTO customers/.test(w.sql));
        expect(customerInserts.length).toBe(0); // no new customer

        const rentalInsert = writes.find((w) => /INSERT INTO field_rentals/.test(w.sql));
        expect(rentalInsert).toBeDefined();
        expect(rentalInsert.args).toContain('cus_existing'); // re-uses existing id

        // No customer.created audit since we re-used the row
        const customerCreated = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('customer.created'));
        expect(customerCreated).toBeUndefined();
    });

    it('email normalization: trims + lowercases before customer lookup', async () => {
        let lookupBinds = null;
        env.DB.__on(/SELECT id FROM customers WHERE email_normalized = \?/, (sql, args) => {
            lookupBinds = args;
            return null;
        }, 'first');
        bindTemplate(env.DB);

        await worker.fetch(postReq({
            name: 'Jane', email: '   Jane@Example.COM  ',
            subject: 'private-hire', message: 'hi',
        }), env, {});

        expect(lookupBinds).toEqual(['jane@example.com']);
    });
});

// ────────────────────────────────────────────────────────────────────
// Email best-effort behavior
// ────────────────────────────────────────────────────────────────────

describe('POST /api/inquiry — email best-effort', () => {
    it('template-missing → still returns 200 + writes inquiry.email_failed audit', async () => {
        bindNoCustomerExists(env.DB);
        // Don't bind email_templates → loadTemplate returns null

        const res = await worker.fetch(postReq({
            name: 'Jane', email: 'jane@example.com',
            subject: 'general', message: 'hi',
        }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql)
            && w.args.includes('inquiry.email_failed'));
        expect(audit).toBeDefined();
    });

    it('ADMIN_NOTIFY_EMAIL not set → inquiry.email_failed audit + still 200', async () => {
        env.ADMIN_NOTIFY_EMAIL = '';
        bindNoCustomerExists(env.DB);

        const res = await worker.fetch(postReq({
            name: 'Jane', email: 'jane@example.com',
            subject: 'general', message: 'hi',
        }), env, {});
        expect(res.status).toBe(200);

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql)
            && w.args.includes('inquiry.email_failed'));
        expect(audit).toBeDefined();
    });
});

// ────────────────────────────────────────────────────────────────────
// IP capture
// ────────────────────────────────────────────────────────────────────

describe('POST /api/inquiry — IP capture', () => {
    it('CF-Connecting-IP header → captured in audit meta', async () => {
        bindTemplate(env.DB);
        const req = postReq(
            { name: 'Jane', email: 'jane@example.com', subject: 'general', message: 'hi' },
            { 'CF-Connecting-IP': '203.0.113.5' },
        );
        await worker.fetch(req, env, {});

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql)
            && w.args.includes('inquiry.submitted'));
        expect(audit).toBeDefined();
        const meta = audit.args.find((a) => typeof a === 'string' && a.includes('"ip_address"'));
        expect(meta).toMatch(/203\.0\.113\.5/);
    });
});

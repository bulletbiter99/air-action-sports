// M5.5 Batch 7b — admin field rental documents route tests.
//
// Covers:
//   - POST upload: capability gating, size cap (413), magic-byte mismatch,
//     kind-specific metadata validation (coi/agreement), no-SUA 409,
//     SUA happy path + sha256_snapshot capture, versioning retires prior live row,
//     COI denormalizes onto rental
//   - GET list: capability gating, PII masking on COI fields, include_retired filter
//   - GET /:docId/download: streams R2 bytes with proper headers, audit
//     field_rental_document.downloaded
//   - POST /:docId/retire: 404, 409 already-retired, success path

import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../../../../worker/index.js';
import { createMockEnv } from '../../../helpers/mockEnv.js';
import { createAdminSession } from '../../../helpers/adminSession.js';
import { bindCapabilities } from '../../../helpers/personFixture.js';

let env;
let cookieHeader;

const baseRentalRow = (overrides = {}) => ({
    id: 'fr_test',
    archived_at: null,
    status: 'agreed',
    ...overrides,
});

const sampleDocRow = (overrides = {}) => ({
    id: 'frd_001',
    rental_id: 'fr_test',
    kind: 'coi',
    file_name: 'coi-acme.pdf',
    r2_key: 'field_rentals/fr_test/frd_001.pdf',
    content_type: 'application/pdf',
    bytes: 12345,
    coi_carrier_name: 'Acme Mutual',
    coi_policy_number: 'POL-12345',
    coi_amount_cents: 100000000,
    coi_effective_at: 1000,
    coi_expires_at: 2000,
    sua_document_id: null,
    sua_body_sha256_snapshot: null,
    sua_signer_typed_name: null,
    sua_signer_ip: null,
    sua_signer_ua: null,
    sua_signed_at: null,
    uploaded_by_user_id: 'u_owner',
    uploaded_at: 1000,
    retired_at: null,
    notes: null,
    ...overrides,
});

// Minimal valid PDF magic-byte preamble. The full body doesn't need to be
// a valid PDF — only the first 5 bytes are inspected by sniffDocExt.
function pdfBytes(extraSize = 100) {
    const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
    const padding = new Uint8Array(extraSize).fill(0x20);
    const combined = new Uint8Array(header.length + padding.length);
    combined.set(header, 0);
    combined.set(padding, header.length);
    return combined;
}

function multipartReq(path, formFields, init = {}) {
    const form = new FormData();
    for (const [k, v] of Object.entries(formFields)) {
        if (v instanceof Blob || (v && typeof v === 'object' && 'arrayBuffer' in v)) {
            form.append(k, v, v.name || k);
        } else if (v !== undefined && v !== null) {
            form.append(k, String(v));
        }
    }
    return new Request(`https://airactionsport.com${path}`, {
        method: 'POST',
        headers: { cookie: cookieHeader, ...(init.headers || {}) },
        body: form,
    });
}

function getReq(path) {
    return new Request(`https://airactionsport.com${path}`, { headers: { cookie: cookieHeader } });
}

function postReq(path, body) {
    return new Request(`https://airactionsport.com${path}`, {
        method: 'POST',
        headers: { cookie: cookieHeader, 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
    });
}

beforeEach(async () => {
    env = createMockEnv();
    const session = await createAdminSession(env, { id: 'u_owner', role: 'owner' });
    cookieHeader = session.cookieHeader;
});

// ────────────────────────────────────────────────────────────────────
// POST upload
// ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/field-rental-documents — upload', () => {
    it('returns 403 without field_rentals.documents.upload', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.read']);

        const pdf = new Blob([pdfBytes()], { type: 'application/pdf' });
        Object.defineProperty(pdf, 'name', { value: 'doc.pdf' });

        const res = await worker.fetch(multipartReq('/api/admin/field-rental-documents', {
            file: pdf, rental_id: 'fr_test', kind: 'other',
        }), env, {});
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.requiresCapability).toBe('field_rentals.documents.upload');
    });

    it('returns 400 when rental_id is missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.upload', 'field_rentals.documents.read']);

        const pdf = new Blob([pdfBytes()], { type: 'application/pdf' });
        Object.defineProperty(pdf, 'name', { value: 'doc.pdf' });

        const res = await worker.fetch(multipartReq('/api/admin/field-rental-documents', {
            file: pdf, kind: 'other',
        }), env, {});
        expect(res.status).toBe(400);
    });

    it('returns 400 when rental does not exist', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.upload', 'field_rentals.documents.read']);
        env.DB.__on(/SELECT id, archived_at, status FROM field_rentals WHERE id = \?/, null, 'first');

        const pdf = new Blob([pdfBytes()], { type: 'application/pdf' });
        Object.defineProperty(pdf, 'name', { value: 'doc.pdf' });

        const res = await worker.fetch(multipartReq('/api/admin/field-rental-documents', {
            file: pdf, rental_id: 'fr_unknown', kind: 'other',
        }), env, {});
        expect(res.status).toBe(400);
    });

    it('returns 413 on file > 10MB', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.upload', 'field_rentals.documents.read']);
        env.DB.__on(/SELECT id, archived_at, status FROM field_rentals WHERE id = \?/, baseRentalRow(), 'first');

        const bigPdf = new Blob([pdfBytes(11 * 1024 * 1024)], { type: 'application/pdf' });
        Object.defineProperty(bigPdf, 'name', { value: 'big.pdf' });

        const res = await worker.fetch(multipartReq('/api/admin/field-rental-documents', {
            file: bigPdf, rental_id: 'fr_test', kind: 'other',
        }), env, {});
        expect(res.status).toBe(413);
    });

    it('returns 400 on magic-byte mismatch (SVG masquerading as PDF)', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.upload', 'field_rentals.documents.read']);
        env.DB.__on(/SELECT id, archived_at, status FROM field_rentals WHERE id = \?/, baseRentalRow(), 'first');

        // SVG bytes labelled as PDF
        const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: 'application/pdf' });
        Object.defineProperty(svg, 'name', { value: 'tricky.pdf' });

        const res = await worker.fetch(multipartReq('/api/admin/field-rental-documents', {
            file: svg, rental_id: 'fr_test', kind: 'other',
        }), env, {});
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/valid PDF/);
    });

    it("returns 400 when kind='coi' but COI metadata is missing", async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.upload', 'field_rentals.documents.read']);
        env.DB.__on(/SELECT id, archived_at, status FROM field_rentals WHERE id = \?/, baseRentalRow(), 'first');

        const pdf = new Blob([pdfBytes()], { type: 'application/pdf' });
        Object.defineProperty(pdf, 'name', { value: 'coi.pdf' });

        const res = await worker.fetch(multipartReq('/api/admin/field-rental-documents', {
            file: pdf, rental_id: 'fr_test', kind: 'coi',
            // missing carrier/policy/amount/effective/expires
        }), env, {});
        expect(res.status).toBe(400);
    });

    it("kind='coi' success: writes row + denormalizes coi_status onto rental", async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.upload', 'field_rentals.documents.read']);
        env.DB.__on(/SELECT id, archived_at, status FROM field_rentals WHERE id = \?/, baseRentalRow(), 'first');
        env.DB.__on(/SELECT \* FROM field_rental_documents WHERE id = \?/, sampleDocRow(), 'first');
        env.UPLOADS.put = vi.fn().mockResolvedValue({});

        const pdf = new Blob([pdfBytes()], { type: 'application/pdf' });
        Object.defineProperty(pdf, 'name', { value: 'coi.pdf' });

        const future = Date.now() + 365 * 86400000;
        const res = await worker.fetch(multipartReq('/api/admin/field-rental-documents', {
            file: pdf, rental_id: 'fr_test', kind: 'coi',
            coi_carrier_name: 'Acme Mutual',
            coi_policy_number: 'POL-12345',
            coi_amount_cents: 100000000,
            coi_effective_at: Date.now(),
            coi_expires_at: future,
        }), env, {});
        expect(res.status).toBe(201);

        const writes = env.DB.__writes();
        // Verify the denormalize UPDATE fired
        const denorm = writes.find((w) => /UPDATE field_rentals\s+SET coi_status = 'received'/.test(w.sql));
        expect(denorm).toBeDefined();
        expect(denorm.args).toContain(future);

        // Verify R2 put was called with field_rentals/<rental_id>/...
        expect(env.UPLOADS.put).toHaveBeenCalled();
        const r2Args = env.UPLOADS.put.mock.calls[0];
        expect(r2Args[0]).toMatch(/^field_rentals\/fr_test\/frd_/);
    });

    it("kind='agreement' returns 409 when no live SUA template exists", async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.upload', 'field_rentals.documents.read']);
        env.DB.__on(/SELECT id, archived_at, status FROM field_rentals WHERE id = \?/, baseRentalRow(), 'first');
        env.DB.__on(/FROM site_use_agreement_documents/, null, 'first');

        const pdf = new Blob([pdfBytes()], { type: 'application/pdf' });
        Object.defineProperty(pdf, 'name', { value: 'signed-agreement.pdf' });

        const res = await worker.fetch(multipartReq('/api/admin/field-rental-documents', {
            file: pdf, rental_id: 'fr_test', kind: 'agreement',
        }), env, {});
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toMatch(/No active site-use agreement/);
        expect(body.hint).toMatch(/SUA template management/);
    });

    it("kind='agreement' captures sua_body_sha256_snapshot when live SUA exists", async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.upload', 'field_rentals.documents.read']);
        env.DB.__on(/SELECT id, archived_at, status FROM field_rentals WHERE id = \?/, baseRentalRow(), 'first');
        env.DB.__on(/FROM site_use_agreement_documents/, {
            id: 'sua_v1', body_html: '<p>Agreement v1</p>', body_sha256: 'a'.repeat(64),
        }, 'first');
        env.DB.__on(/SELECT \* FROM field_rental_documents WHERE id = \?/, sampleDocRow({
            kind: 'agreement', sua_document_id: 'sua_v1', sua_body_sha256_snapshot: 'a'.repeat(64),
        }), 'first');
        env.UPLOADS.put = vi.fn().mockResolvedValue({});

        const pdf = new Blob([pdfBytes()], { type: 'application/pdf' });
        Object.defineProperty(pdf, 'name', { value: 'signed-agreement.pdf' });

        const res = await worker.fetch(multipartReq('/api/admin/field-rental-documents', {
            file: pdf, rental_id: 'fr_test', kind: 'agreement',
            sua_signer_typed_name: 'Jane Renter',
            sua_signer_ip: '203.0.113.5',
            sua_signer_ua: 'Mozilla/5.0',
            sua_signed_at: Date.now(),
        }), env, {});
        expect(res.status).toBe(201);

        const writes = env.DB.__writes();
        const insert = writes.find((w) => /INSERT INTO field_rental_documents/.test(w.sql));
        expect(insert).toBeDefined();
        expect(insert.args).toContain('sua_v1');
        expect(insert.args).toContain('a'.repeat(64));
        // requirements_agreement_signed denormalize
        const denorm = writes.find((w) => /UPDATE field_rentals\s+SET requirements_agreement_signed = 1/.test(w.sql));
        expect(denorm).toBeDefined();
    });

    it("versioning: kind='agreement' upload retires prior live row before insert", async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.upload', 'field_rentals.documents.read']);
        env.DB.__on(/SELECT id, archived_at, status FROM field_rentals WHERE id = \?/, baseRentalRow(), 'first');
        env.DB.__on(/FROM site_use_agreement_documents/, {
            id: 'sua_v1', body_html: '<p>v1</p>', body_sha256: 'b'.repeat(64),
        }, 'first');
        env.DB.__on(/SELECT \* FROM field_rental_documents WHERE id = \?/, sampleDocRow({ kind: 'agreement' }), 'first');
        env.UPLOADS.put = vi.fn().mockResolvedValue({});

        const pdf = new Blob([pdfBytes()], { type: 'application/pdf' });
        Object.defineProperty(pdf, 'name', { value: 'v2.pdf' });

        await worker.fetch(multipartReq('/api/admin/field-rental-documents', {
            file: pdf, rental_id: 'fr_test', kind: 'agreement',
            sua_signer_typed_name: 'Jane', sua_signer_ip: '1.1.1.1',
            sua_signer_ua: 'UA/1', sua_signed_at: Date.now(),
        }), env, {});

        const writes = env.DB.__writes();
        const retire = writes.find((w) => /UPDATE field_rental_documents SET retired_at = \?/.test(w.sql));
        expect(retire).toBeDefined();
        expect(retire.args).toContain('fr_test');
        expect(retire.args).toContain('agreement');
    });

    it('archived rental → 409', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.upload', 'field_rentals.documents.read']);
        env.DB.__on(/SELECT id, archived_at, status FROM field_rentals WHERE id = \?/, baseRentalRow({ archived_at: 1000 }), 'first');

        const pdf = new Blob([pdfBytes()], { type: 'application/pdf' });
        Object.defineProperty(pdf, 'name', { value: 'doc.pdf' });

        const res = await worker.fetch(multipartReq('/api/admin/field-rental-documents', {
            file: pdf, rental_id: 'fr_test', kind: 'other',
        }), env, {});
        expect(res.status).toBe(409);
    });
});

// ────────────────────────────────────────────────────────────────────
// GET list
// ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/field-rental-documents — list', () => {
    it('returns 400 when rental_id query param missing', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.read']);
        const res = await worker.fetch(getReq('/api/admin/field-rental-documents'), env, {});
        expect(res.status).toBe(400);
    });

    it('masks COI carrier/policy fields when viewer lacks coi.read_pii', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.read']);
        env.DB.__on(/FROM field_rental_documents WHERE/, {
            results: [sampleDocRow()],
        }, 'all');

        const res = await worker.fetch(getReq('/api/admin/field-rental-documents?rental_id=fr_test'), env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.documents).toHaveLength(1);
        expect(body.documents[0].coiCarrierName).toBe('***');
        expect(body.documents[0].coiPolicyNumber).toBe('***');
        // Effective/expires dates remain visible
        expect(body.documents[0].coiExpiresAt).toBe(2000);
    });

    it('unmasks COI fields when viewer has coi.read_pii', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.read', 'field_rentals.coi.read_pii']);
        env.DB.__on(/FROM field_rental_documents WHERE/, {
            results: [sampleDocRow()],
        }, 'all');

        const res = await worker.fetch(getReq('/api/admin/field-rental-documents?rental_id=fr_test'), env, {});
        const body = await res.json();
        expect(body.documents[0].coiCarrierName).toBe('Acme Mutual');
        expect(body.documents[0].coiPolicyNumber).toBe('POL-12345');
    });

    it('include_retired=1 excludes the retired_at IS NULL filter', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.read']);
        let capturedSql = '';
        env.DB.__on(/FROM field_rental_documents WHERE/, (sql) => {
            capturedSql = sql;
            return { results: [] };
        }, 'all');

        await worker.fetch(getReq('/api/admin/field-rental-documents?rental_id=fr_test&include_retired=1'), env, {});
        expect(capturedSql).not.toMatch(/retired_at IS NULL/);
    });
});

// ────────────────────────────────────────────────────────────────────
// GET /:docId/download
// ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/field-rental-documents/:docId/download', () => {
    it('streams R2 bytes with proper Content-Type + Content-Disposition headers', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.read']);
        env.DB.__on(/SELECT \* FROM field_rental_documents WHERE id = \?/, sampleDocRow(), 'first');
        const fakeBody = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
        env.UPLOADS.get = vi.fn().mockResolvedValue({ body: fakeBody });

        const res = await worker.fetch(getReq('/api/admin/field-rental-documents/frd_001/download'), env, {});
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/pdf');
        expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="coi-acme\.pdf"/);
    });

    it('writes field_rental_document.downloaded audit row', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.read']);
        env.DB.__on(/SELECT \* FROM field_rental_documents WHERE id = \?/, sampleDocRow(), 'first');
        env.UPLOADS.get = vi.fn().mockResolvedValue({ body: new Uint8Array([0x25]) });

        await worker.fetch(getReq('/api/admin/field-rental-documents/frd_001/download'), env, {});
        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('field_rental_document.downloaded'));
        expect(audit).toBeDefined();
    });

    it('returns 404 when R2 object is missing even if DB row exists', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.read']);
        env.DB.__on(/SELECT \* FROM field_rental_documents WHERE id = \?/, sampleDocRow(), 'first');
        env.UPLOADS.get = vi.fn().mockResolvedValue(null);

        const res = await worker.fetch(getReq('/api/admin/field-rental-documents/frd_001/download'), env, {});
        expect(res.status).toBe(404);
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /:docId/retire
// ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/field-rental-documents/:docId/retire', () => {
    it('returns 404 when document not found', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.upload']);
        env.DB.__on(/SELECT \* FROM field_rental_documents WHERE id = \?/, null, 'first');

        const res = await worker.fetch(postReq('/api/admin/field-rental-documents/frd_x/retire', {}), env, {});
        expect(res.status).toBe(404);
    });

    it('returns 409 when already retired', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.upload']);
        env.DB.__on(/SELECT \* FROM field_rental_documents WHERE id = \?/, sampleDocRow({ retired_at: 1000 }), 'first');

        const res = await worker.fetch(postReq('/api/admin/field-rental-documents/frd_001/retire', {}), env, {});
        expect(res.status).toBe(409);
    });

    it('happy path: sets retired_at and writes audit', async () => {
        bindCapabilities(env.DB, 'u_owner', ['field_rentals.documents.upload']);
        env.DB.__on(/SELECT \* FROM field_rental_documents WHERE id = \?/, sampleDocRow(), 'first');

        const res = await worker.fetch(postReq('/api/admin/field-rental-documents/frd_001/retire', {}), env, {});
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.retired).toBe(true);

        const writes = env.DB.__writes();
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('field_rental_document.retired'));
        expect(audit).toBeDefined();
    });
});

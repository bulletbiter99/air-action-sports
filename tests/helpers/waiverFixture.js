// Test fixtures + D1 mock bindings for POST /api/waivers/:qrToken.
//
// The waiver POST handler in worker/routes/waivers.js issues these queries:
//   1. SELECT * FROM attendees WHERE qr_token = ?            → attendee row
//   2. SELECT id, version, body_html, body_sha256
//      FROM waiver_documents WHERE retired_at IS NULL
//      ORDER BY version DESC LIMIT 1                         → live document
//   3. INSERT INTO waivers (...)                             → run
//   4. UPDATE attendees SET waiver_id = ? WHERE id = ?       → run
//   5. INSERT INTO audit_log (...) 'waiver.signed' ...       → run
//
// bindWaiverFixture registers handlers (1) and (2). Writes (3)–(5) hit the
// mock D1's default `run` response. The fixture's doc body_sha256 is the real
// SHA-256 of body_html so the handler's integrity check passes by default.
// Pass opts to flip individual handlers:
//   { attendeeNotFound: true } → handler (1) returns null
//   { attendeeAlreadySigned: true } → handler (1) returns row with waiver_id
//   { docNotFound: true } → handler (2) returns null
//   { tamperedDoc: true } → handler (2) returns row with mismatched sha256
//
// The default payload is the 18+ adult happy path. Use validTeenPayload() and
// validYouthPayload() for 16-17 / 12-15 baselines.

import worker from '../../worker/index.js';

async function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

// Build a yyyy-mm-dd dob string for an attendee N years old at `asOf`. Adds a
// 30-day buffer past the would-be birthday so leap-year and month-boundary
// rounding never tips an attendee across a tier boundary mid-test.
export function dobYearsAgo(years, asOf = new Date()) {
    const d = new Date(asOf);
    d.setUTCFullYear(d.getUTCFullYear() - years);
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString().slice(0, 10);
}

export async function createWaiverFixture(overrides = {}) {
    const qrToken = overrides.qrToken || 'qr_test_aaaaaaaaaaaaaaaaaaaaaaaa';
    const attendee = {
        id: 'at_test_1',
        booking_id: 'bk_test_1',
        first_name: 'Alice',
        last_name: 'Smith',
        email: 'alice@example.com',
        phone: '5551234567',
        qr_token: qrToken,
        waiver_id: null,
        ...(overrides.attendeeFields || {}),
    };

    const bodyHtml = overrides.bodyHtml
        || '<h1>Air Action Sports - Liability Waiver v4</h1><p>Test body for fixture.</p>';
    const doc = {
        id: 'wd_test_1',
        version: 4,
        body_html: bodyHtml,
        body_sha256: await sha256Hex(bodyHtml),
        ...(overrides.docFields || {}),
    };

    const payload = {
        ...validAdultPayload(),
        ...(overrides.payload || {}),
    };

    return { qrToken, attendee, doc, payload };
}

// Default 18+ signer. Signature matches attendee.first_name + ' ' + last_name.
export function validAdultPayload() {
    return {
        name: 'Alice Smith',
        dob: dobYearsAgo(25),
        email: 'alice@example.com',
        phone: '5551234567',
        emergencyName: 'Bob Smith',
        emergencyPhone: '5557654321',
        relationship: 'Spouse',
        signature: 'Alice Smith',
        agree: true,
        privacy: true,
        erecordsConsent: true,
        juryTrialInitials: 'AS',
        medicalConditions: '',
    };
}

// 16-17 signer — needs parent fields, NOT supervising-adult fields.
export function validTeenPayload() {
    return {
        ...validAdultPayload(),
        dob: dobYearsAgo(17),
        parentName: 'Carol Smith',
        parentRelationship: 'Mother',
        parentSignature: 'Carol Smith',
        parentConsent: true,
        parentPhoneDayOfEvent: '5550001111',
        parentInitials: 'CS',
    };
}

// 12-15 signer — needs parent fields AND on-site supervising-adult fields.
export function validYouthPayload() {
    return {
        ...validTeenPayload(),
        dob: dobYearsAgo(14),
        supervisingAdultName: 'Carol Smith',
        supervisingAdultRelationship: 'Mother',
        supervisingAdultSignature: 'Carol Smith',
        supervisingAdultPhoneDayOfEvent: '5550001111',
    };
}

export function bindWaiverFixture(db, fixture, opts = {}) {
    let attendeeRow = fixture.attendee;
    if (opts.attendeeNotFound) attendeeRow = null;
    if (opts.attendeeAlreadySigned) {
        attendeeRow = { ...fixture.attendee, waiver_id: 'wv_existing' };
    }
    db.__on(/SELECT \* FROM attendees WHERE qr_token/, attendeeRow, 'first');

    let docRow = fixture.doc;
    if (opts.docNotFound) docRow = null;
    if (opts.tamperedDoc) docRow = { ...fixture.doc, body_sha256: 'a'.repeat(64) };
    db.__on(/FROM waiver_documents/, docRow, 'first');
}

// Issue a POST /api/waivers/:qrToken request through the real worker pipeline.
// `bodyOverrides` shallow-merges over `fixture.payload` so individual tests
// can flip a single field (e.g. `{ erecordsConsent: false }`) without
// rebuilding the entire payload.
export async function postWaiver(env, fixture, bodyOverrides = {}) {
    bindWaiverFixture(env.DB, fixture);
    const merged = { ...fixture.payload, ...bodyOverrides };
    const body = JSON.stringify(merged);
    const url = `https://airactionsport.com/api/waivers/${fixture.qrToken}`;
    const req = new Request(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': String(new TextEncoder().encode(body).byteLength),
            'CF-Connecting-IP': '203.0.113.1',
            'User-Agent': 'vitest-waiver-fixture/1.0',
        },
        body,
    });
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
    return worker.fetch(req, env, ctx);
}

// Variant that lets a test customize bindWaiverFixture opts (e.g. tampered
// doc, attendee already signed) and pass through bodyOverrides at the same
// time. Tests that need an "already signed" attendee or tampered doc reach
// for this; the simpler `postWaiver` covers the validation tests.
export async function postWaiverWithOpts(env, fixture, bindOpts = {}, bodyOverrides = {}) {
    bindWaiverFixture(env.DB, fixture, bindOpts);
    const merged = { ...fixture.payload, ...bodyOverrides };
    const body = JSON.stringify(merged);
    const url = `https://airactionsport.com/api/waivers/${fixture.qrToken}`;
    const req = new Request(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': String(new TextEncoder().encode(body).byteLength),
            'CF-Connecting-IP': '203.0.113.1',
            'User-Agent': 'vitest-waiver-fixture/1.0',
        },
        body,
    });
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
    return worker.fetch(req, env, ctx);
}

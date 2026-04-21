import { Hono } from 'hono';
import { formatEvent } from '../lib/formatters.js';
import { randomId } from '../lib/ids.js';
import { rateLimit } from '../lib/rateLimit.js';
import { readJson, BODY_LIMITS } from '../lib/bodyGuard.js';

const MAX_SIGNATURE_LEN = 200;
const MAX_FIELD_LEN = 200;

const waivers = new Hono();

// Hex SHA-256 of a UTF-8 string using Web Crypto.
async function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

// Fetch the currently-live waiver document (the one with retired_at IS NULL
// and the highest version — belt-and-suspenders in case multiple rows are
// unretired at once). Integrity-checks the stored hash against a recomputed
// hash; mismatch means the row was tampered with directly in D1.
async function getLiveWaiverDocument(env) {
    const doc = await env.DB.prepare(
        `SELECT id, version, body_html, body_sha256
         FROM waiver_documents
         WHERE retired_at IS NULL
         ORDER BY version DESC
         LIMIT 1`
    ).first();
    if (!doc) return null;
    const recomputed = await sha256Hex(doc.body_html);
    if (recomputed !== doc.body_sha256) {
        return { ...doc, _integrity: 'mismatch', _recomputed: recomputed };
    }
    return { ...doc, _integrity: 'ok' };
}

// GET /api/waivers/:qrToken
// Public lookup: returns attendee info pre-filled on the waiver page, plus
// the current live waiver document (body + version) so the page renders the
// exact text the server will snapshot on submit.
waivers.get('/:qrToken', rateLimit('RL_TOKEN_LOOKUP'), async (c) => {
    const qrToken = c.req.param('qrToken');
    const row = await c.env.DB.prepare(
        `SELECT a.*, b.event_id, b.full_name AS buyer_name, b.email AS buyer_email, b.phone AS buyer_phone
         FROM attendees a
         JOIN bookings b ON b.id = a.booking_id
         WHERE a.qr_token = ?`
    ).bind(qrToken).first();

    if (!row) return c.json({ error: 'Invalid waiver link' }, 404);

    const eventRow = await c.env.DB.prepare(
        `SELECT * FROM events WHERE id = ?`
    ).bind(row.event_id).first();

    const existingWaiver = row.waiver_id
        ? await c.env.DB.prepare(`SELECT signed_at FROM waivers WHERE id = ?`).bind(row.waiver_id).first()
        : null;

    const doc = await getLiveWaiverDocument(c.env);
    if (!doc) return c.json({ error: 'No waiver document is currently active' }, 500);
    if (doc._integrity === 'mismatch') {
        // Refuse to serve a tampered document. Log and fail loud.
        await c.env.DB.prepare(
            `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
             VALUES (NULL, 'waiver_document.integrity_failure', 'waiver_document', ?, ?, ?)`
        ).bind(doc.id, JSON.stringify({ expected: doc.body_sha256, recomputed: doc._recomputed }), Date.now()).run();
        return c.json({ error: 'Waiver document integrity check failed' }, 500);
    }

    return c.json({
        attendee: {
            id: row.id,
            firstName: row.first_name,
            lastName: row.last_name,
            email: row.email || row.buyer_email,
            phone: row.phone || row.buyer_phone,
            alreadySigned: !!row.waiver_id,
            signedAt: existingWaiver?.signed_at || null,
        },
        event: eventRow ? formatEvent(eventRow) : null,
        waiverDocument: {
            id: doc.id,
            version: doc.version,
            bodyHtml: doc.body_html,
        },
    });
});

// POST /api/waivers/:qrToken
// Accept and store a signed waiver. Ties to attendee via qr_token and captures
// an immutable snapshot of the exact waiver text the signer agreed to, plus a
// SHA-256 hash of that text, the document id+version, and the explicit ESIGN
// e-records consent bit.
waivers.post('/:qrToken', rateLimit('RL_TOKEN_LOOKUP'), async (c) => {
    const qrToken = c.req.param('qrToken');
    const p = await readJson(c, BODY_LIMITS.SMALL);
    if (p.error) return c.json({ error: p.error }, p.status);
    const body = p.body;
    if (!body) return c.json({ error: 'Invalid body' }, 400);
    if (typeof body.signature === 'string' && body.signature.length > MAX_SIGNATURE_LEN) {
        return c.json({ error: 'signature too long' }, 400);
    }
    // Cap other string fields as well so a 10MB "emergencyName" can't land.
    for (const k of ['name', 'email', 'phone', 'emergencyName', 'emergencyPhone', 'dob']) {
        if (typeof body[k] === 'string' && body[k].length > MAX_FIELD_LEN) {
            return c.json({ error: `${k} too long` }, 400);
        }
    }

    const attendee = await c.env.DB.prepare(
        `SELECT * FROM attendees WHERE qr_token = ?`
    ).bind(qrToken).first();

    if (!attendee) return c.json({ error: 'Invalid waiver link' }, 404);
    if (attendee.waiver_id) return c.json({ error: 'Waiver already signed for this player' }, 409);

    // Required fields
    const required = ['name', 'dob', 'email', 'phone', 'emergencyName', 'emergencyPhone', 'signature'];
    const missing = required.filter((f) => !body[f] || !String(body[f]).trim());
    if (missing.length) {
        return c.json({ error: `Missing required fields: ${missing.join(', ')}` }, 400);
    }
    if (body.agree !== true) {
        return c.json({ error: 'You must agree to the terms to submit' }, 400);
    }
    // ESIGN §7001(c) consumer-consent to electronic records — distinct from the
    // terms-agreement checkbox. Must be explicitly true; absence is a hard fail.
    if (body.erecordsConsent !== true) {
        return c.json({ error: 'You must consent to receive records electronically to sign online' }, 400);
    }

    // Signature must match the attendee's name on the ticket (case/space insensitive).
    const expectedName = [attendee.first_name, attendee.last_name].filter(Boolean).join(' ').trim();
    if (expectedName) {
        const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (norm(body.signature) !== norm(expectedName)) {
            return c.json({
                error: `Signature must match the name on your ticket: ${expectedName}`,
            }, 400);
        }
    }

    // Under-18 check — if minor, parent consent required
    const dobDate = new Date(body.dob);
    const now = new Date();
    const age = (now - dobDate) / (365.25 * 24 * 60 * 60 * 1000);
    const isMinor = age < 18;
    if (isMinor) {
        if (!body.parentName || !body.parentSignature || body.parentConsent !== true) {
            return c.json({ error: 'Parent or guardian consent is required for players under 18' }, 400);
        }
    }

    // Re-fetch the live document server-side at submit time so the snapshot
    // reflects exactly what our server treated as authoritative, not what the
    // client claims it rendered. Integrity-check before trusting it.
    const doc = await getLiveWaiverDocument(c.env);
    if (!doc) return c.json({ error: 'No waiver document is currently active' }, 500);
    if (doc._integrity === 'mismatch') {
        return c.json({ error: 'Waiver document integrity check failed' }, 500);
    }

    const waiverId = `wv_${randomId(14)}`;
    const nowMs = Date.now();
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
    const userAgent = c.req.header('user-agent') || null;

    await c.env.DB.prepare(
        `INSERT INTO waivers (
            id, booking_id, attendee_id,
            player_name, dob, email, phone,
            emergency_name, emergency_phone, relationship,
            signature, signed_at, ip_address, user_agent,
            is_minor, parent_name, parent_relationship, parent_signature, parent_consent,
            privacy_consent, created_at,
            waiver_document_id, waiver_document_version, body_html_snapshot, body_sha256, erecords_consent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        waiverId,
        attendee.booking_id,
        attendee.id,
        body.name.trim(),
        body.dob,
        body.email.trim(),
        body.phone.trim(),
        body.emergencyName.trim(),
        body.emergencyPhone.trim(),
        body.relationship || null,
        body.signature.trim(),
        nowMs,
        ip,
        userAgent,
        isMinor ? 1 : 0,
        body.parentName?.trim() || null,
        body.parentRelationship?.trim() || null,
        body.parentSignature?.trim() || null,
        body.parentConsent ? 1 : 0,
        body.privacy ? 1 : 0,
        nowMs,
        doc.id,
        doc.version,
        doc.body_html,
        doc.body_sha256,
        1,
    ).run();

    await c.env.DB.prepare(
        `UPDATE attendees SET waiver_id = ? WHERE id = ?`
    ).bind(waiverId, attendee.id).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, ip_address, created_at)
         VALUES (NULL, 'waiver.signed', 'attendee', ?, ?, ?, ?)`
    ).bind(
        attendee.id,
        JSON.stringify({
            waiver_id: waiverId,
            booking_id: attendee.booking_id,
            waiver_document_id: doc.id,
            waiver_document_version: doc.version,
            body_sha256: doc.body_sha256,
        }),
        ip,
        nowMs,
    ).run();

    return c.json({
        success: true,
        waiverId,
        signedAt: nowMs,
        waiverDocumentVersion: doc.version,
    });
});

export default waivers;

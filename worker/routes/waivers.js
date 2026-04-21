import { Hono } from 'hono';
import { formatEvent } from '../lib/formatters.js';
import { randomId } from '../lib/ids.js';
import { rateLimit } from '../lib/rateLimit.js';

const waivers = new Hono();

// GET /api/waivers/:qrToken
// Public lookup: returns attendee info pre-filled on the waiver page.
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
    });
});

// POST /api/waivers/:qrToken
// Accept and store a signed waiver. Ties to attendee via qr_token.
waivers.post('/:qrToken', rateLimit('RL_TOKEN_LOOKUP'), async (c) => {
    const qrToken = c.req.param('qrToken');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid body' }, 400);

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
            privacy_consent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    ).run();

    await c.env.DB.prepare(
        `UPDATE attendees SET waiver_id = ? WHERE id = ?`
    ).bind(waiverId, attendee.id).run();

    await c.env.DB.prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, meta_json, created_at)
         VALUES (NULL, 'waiver.signed', 'attendee', ?, ?, ?)`
    ).bind(
        attendee.id,
        JSON.stringify({ waiver_id: waiverId, booking_id: attendee.booking_id }),
        nowMs,
    ).run();

    return c.json({ success: true, waiverId, signedAt: nowMs });
});

export default waivers;

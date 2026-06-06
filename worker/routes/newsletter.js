// Public newsletter signup — captures an email into the customers table with
// email_marketing = 1 so the subscriber is reachable by marketing campaigns
// and targetable by segments (e.g. query on email_marketing = 1). Replaces the
// footer's placeholder alert().
//
// POST /api/newsletter  { email, name?, website? }
//   - Honeypot ('website' filled) → silent 200 OK (don't tip off the bot).
//   - Rate-limited via RL_FEEDBACK (the shared public-form binding).
//   - New email        → INSERT a customer (email_marketing = 1) + audit.
//   - Existing + opted-out (email_marketing = 0) → re-opt-in + audit.
//   - Existing + already subscribed → idempotent 200 (no write).
//   - 200 on success; 400 on invalid email; 429 on rate limit; 500 on DB error.
//
// Mirrors the customer-create shape in routes/inquiry.js (source = 'newsletter'
// in the audit meta). Consent model matches routes/unsubscribe.js, which flips
// the same email_marketing flag off.
//
// Tests: tests/unit/marketing/newsletter-route.test.js

import { Hono } from 'hono';
import { writeAudit } from '../lib/auditLog.js';
import { rateLimit, clientIp } from '../lib/rateLimit.js';
import { customerId as newCustomerId } from '../lib/ids.js';

const newsletter = new Hono();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;
const MAX_NAME_LEN = 200;

function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_EMAIL_LEN || !EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

newsletter.post('/', rateLimit('RL_FEEDBACK'), async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid body' }, 400);
  }

  // Honeypot — bots fill the hidden 'website' field. Return 200 so the bot
  // doesn't learn it was blocked; do nothing.
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return c.json({ ok: true });
  }

  const emailRaw = typeof body.email === 'string' ? body.email.trim() : '';
  const normalizedEmail = normalizeEmail(emailRaw);
  if (!normalizedEmail) return c.json({ error: 'Please enter a valid email.' }, 400);

  let name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length > MAX_NAME_LEN) name = name.slice(0, MAX_NAME_LEN);

  const now = Date.now();
  const ip = clientIp(c) || null;

  try {
    const existing = await c.env.DB.prepare(
      `SELECT id, email_marketing FROM customers WHERE email_normalized = ? AND archived_at IS NULL`,
    ).bind(normalizedEmail).first();

    if (existing?.id) {
      // Already an active customer. If they'd opted out, re-opt-in; otherwise
      // it's a no-op success (idempotent — a repeat signup shouldn't error).
      if (Number(existing.email_marketing) === 1) {
        return c.json({ ok: true, alreadySubscribed: true });
      }
      await c.env.DB.prepare(
        `UPDATE customers SET email_marketing = 1, updated_at = ? WHERE id = ?`,
      ).bind(now, existing.id).run();
      await writeAudit(c.env, {
        userId: null,
        action: 'newsletter.resubscribed',
        targetType: 'customer',
        targetId: existing.id,
        meta: { source: 'newsletter', normalized_email: normalizedEmail, ip_address: ip },
      }).catch(() => {});
      return c.json({ ok: true });
    }

    const id = newCustomerId();
    await c.env.DB.prepare(
      `INSERT INTO customers (
        id, email, email_normalized, name, phone,
        total_bookings, total_attendees, lifetime_value_cents, refund_count,
        first_booking_at, last_booking_at,
        email_transactional, email_marketing, sms_transactional, sms_marketing,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, 0, 0, 0, 0, NULL, NULL, 1, 1, 0, 0, ?, ?)`,
    ).bind(id, emailRaw, normalizedEmail, name || null, now, now).run();

    await writeAudit(c.env, {
      userId: null,
      action: 'newsletter.subscribed',
      targetType: 'customer',
      targetId: id,
      meta: { source: 'newsletter', normalized_email: normalizedEmail, ip_address: ip },
    }).catch(() => {});

    return c.json({ ok: true });
  } catch (err) {
    await writeAudit(c.env, {
      userId: null,
      action: 'newsletter.failed',
      targetType: 'newsletter',
      targetId: null,
      meta: { email: normalizedEmail, error: String(err?.message || err), ip_address: ip },
    }).catch(() => {});
    return c.json({ error: 'Could not sign you up right now. Please try again.' }, 500);
  }
});

export default newsletter;

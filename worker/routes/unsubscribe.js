// Marketing milestone B2b — public one-click unsubscribe.
//
// GET /api/unsubscribe?c=<customerId>&t=<token> — verifies the HMAC token (no
// auth; the token IS the auth), flips customers.email_marketing = 0, and returns
// a small HTML confirmation page. Transactional emails (booking confirmations,
// refunds, etc.) are unaffected — only marketing sends honor email_marketing.
//
// Tests: tests/unit/admin/unsubscribe-route.test.js

import { Hono } from 'hono';
import { verifyUnsubToken } from '../lib/unsubToken.js';
import { writeAudit } from '../lib/auditLog.js';

const unsubscribe = new Hono();

function page(title, message) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">`
        + `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>`
        + `<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#222;text-align:center}`
        + `h1{font-size:20px}p{color:#555;line-height:1.6}</style></head>`
        + `<body><h1>${title}</h1><p>${message}</p></body></html>`;
}

unsubscribe.get('/', async (c) => {
    const cid = c.req.query('c');
    const token = c.req.query('t');
    if (!cid || !token) {
        return c.html(page('Invalid link', 'This unsubscribe link is missing information.'), 400);
    }

    const ok = await verifyUnsubToken(cid, token, c.env.SESSION_SECRET);
    if (!ok) {
        return c.html(page('Invalid link', 'This unsubscribe link is invalid.'), 400);
    }

    try {
        await c.env.DB.prepare('UPDATE customers SET email_marketing = 0 WHERE id = ?').bind(cid).run();
        await writeAudit(c.env, {
            userId: null,
            action: 'customer.unsubscribed',
            targetType: 'customer',
            targetId: cid,
            meta: { via: 'email_link' },
        });
    } catch (err) {
        console.error('unsubscribe update failed', err);
        return c.html(page('Something went wrong', 'We could not process your request. Please email support@airactionsport.com.'), 500);
    }

    return c.html(page(
        'You’re unsubscribed',
        'You will no longer receive marketing emails from Air Action Sports. Booking confirmations and other account emails are unaffected.',
    ));
});

export default unsubscribe;

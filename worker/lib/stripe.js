// Minimal Stripe REST wrapper — uses fetch, no SDK.
// Works on Cloudflare Workers runtime.

const STRIPE_API = 'https://api.stripe.com/v1';

async function stripeFetch(path, { method = 'POST', apiKey, body, idempotencyKey } = {}) {
    const headers = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
    };
    // Idempotency-Key makes Stripe dedupe requests that share the key for 24h.
    // Essential for money-moving operations (refunds) to survive retries/races.
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const res = await fetch(`${STRIPE_API}${path}`, {
        method,
        headers,
        body: body ? encodeForm(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok) {
        const message = json?.error?.message || `Stripe ${res.status}`;
        const err = new Error(message);
        err.stripe = json;
        err.status = res.status;
        throw err;
    }
    return json;
}

/**
 * Create a Checkout Session. Accepts a flat list of line items.
 * @param {object} args
 * @param {string} args.apiKey
 * @param {Array<{name:string, qty:number, unit_price_cents:number}>} args.lineItems
 * @param {string} args.successUrl
 * @param {string} args.cancelUrl
 * @param {string} args.customerEmail
 * @param {Record<string,string>} [args.metadata]
 */
export async function createCheckoutSession({ apiKey, lineItems, successUrl, cancelUrl, customerEmail, metadata = {} }) {
    const body = {
        mode: 'payment',
        'payment_method_types[]': 'card',
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: customerEmail,
    };

    lineItems.forEach((item, i) => {
        body[`line_items[${i}][price_data][currency]`] = 'usd';
        body[`line_items[${i}][price_data][product_data][name]`] = item.name;
        body[`line_items[${i}][price_data][unit_amount]`] = String(item.unit_price_cents);
        body[`line_items[${i}][quantity]`] = String(item.qty);
    });

    for (const [k, v] of Object.entries(metadata)) {
        body[`metadata[${k}]`] = String(v);
    }

    return stripeFetch('/checkout/sessions', { apiKey, body });
}

export async function retrieveSession(sessionId, apiKey) {
    return stripeFetch(`/checkout/sessions/${sessionId}`, { apiKey, method: 'GET' });
}

/**
 * Issue a refund against a payment intent. Amount optional (full refund if omitted).
 * idempotencyKey is strongly recommended by callers — any concurrent or retried
 * call with the same key is deduped by Stripe server-side for 24h.
 * @param {{ apiKey:string, paymentIntent:string, amountCents?:number, reason?:'requested_by_customer'|'duplicate'|'fraudulent', idempotencyKey?:string }} args
 */
export async function issueRefund({ apiKey, paymentIntent, amountCents, reason, idempotencyKey }) {
    const body = { payment_intent: paymentIntent };
    if (amountCents != null) body.amount = String(amountCents);
    if (reason) body.reason = reason;
    return stripeFetch('/refunds', { apiKey, body, idempotencyKey });
}

/**
 * Verify Stripe webhook signature. Replicates stripe.webhooks.constructEvent logic.
 * Stripe-Signature header looks like: "t=1614...,v1=abc123...,v1=def456..."
 * Multiple v1 entries are possible during secret rotation — we accept any match.
 * We compute HMAC-SHA256 of `${timestamp}.${body}` using the webhook secret
 * and compare against each v1 value (constant-time).
 */
export async function verifyWebhookSignature({ body, signatureHeader, secret, tolerance = 300 }) {
    if (!signatureHeader) throw new Error('Missing Stripe-Signature header');

    // Stripe-Signature is comma-separated k=v pairs; v1 may appear more than once.
    // Collect timestamp and ALL v1 values.
    let timestamp = null;
    const v1Values = [];
    for (const part of signatureHeader.split(',')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        const k = part.slice(0, eq).trim();
        const v = part.slice(eq + 1).trim();
        if (k === 't') timestamp = v;
        else if (k === 'v1') v1Values.push(v);
    }
    if (!timestamp || v1Values.length === 0) throw new Error('Malformed Stripe-Signature');

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - Number(timestamp)) > tolerance) {
        throw new Error('Webhook timestamp outside tolerance');
    }

    const payload = `${timestamp}.${body}`;
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const expected = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    // Accept if ANY v1 matches — handles Stripe's dual-sign rotation window.
    let matched = false;
    for (const v1 of v1Values) {
        if (timingSafeEqual(expected, v1)) { matched = true; break; }
    }
    if (!matched) throw new Error('Webhook signature mismatch');
    return JSON.parse(body);
}

function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function encodeForm(obj) {
    return Object.entries(obj)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
}

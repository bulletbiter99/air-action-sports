// Minimal Stripe REST wrapper — uses fetch, no SDK.
// Works on Cloudflare Workers runtime.

const STRIPE_API = 'https://api.stripe.com/v1';

async function stripeFetch(path, { method = 'POST', apiKey, body, idempotencyKey } = {}) {
    const headers = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Pin API version explicitly so response shapes don't drift if the
        // account default is bumped on the Stripe dashboard. Update this
        // string in lockstep with a deliberate dashboard rollover; never
        // omit, never auto-pickup. Account default at audit time: dahlia.
        'Stripe-Version': '2026-04-22.dahlia',
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
 * @param {'off_session'|'on_session'} [args.setupFutureUsage] — M6 B5. When supplied,
 *   sets `payment_intent_data[setup_future_usage]=<value>`. With 'off_session',
 *   Stripe records the payment method against the auto-created Customer
 *   (resolved from customer_email) and authorizes future off-session charges
 *   without re-authentication. This is the substrate B7's damage-charge
 *   Option A depends on. Omit to preserve the pre-M6 Checkout behavior
 *   exactly — the field is purely additive.
 */
export async function createCheckoutSession({ apiKey, lineItems, successUrl, cancelUrl, customerEmail, metadata = {}, setupFutureUsage }) {
    const body = {
        mode: 'payment',
        'payment_method_types[]': 'card',
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: customerEmail,
    };

    if (setupFutureUsage) {
        // Nested under payment_intent_data because mode='payment' creates a
        // PaymentIntent (not a SetupIntent). Form-encoded as a bracketed key.
        body['payment_intent_data[setup_future_usage]'] = setupFutureUsage;
    }

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
 * Retrieve a PaymentIntent — used by M6 B7's off-session damage-charge
 * flow to read the original PI's `customer` + `payment_method` so we
 * can re-charge the saved card without re-prompting the buyer.
 * @param {string} paymentIntentId
 * @param {string} apiKey
 */
export async function retrievePaymentIntent(paymentIntentId, apiKey) {
    return stripeFetch(`/payment_intents/${paymentIntentId}`, { apiKey, method: 'GET' });
}

/**
 * M6 B7 — off-session charge against a saved payment method.
 *
 * Requires that B5's `setup_future_usage: 'off_session'` was on the
 * original Checkout Session (otherwise the PM isn't authorized for
 * off-session re-use). Stripe rejects the charge with
 * `authentication_required` when the bank demands 3DS or with
 * `card_declined` on most other failures.
 *
 * Callers (worker/lib/bookingCharges.js chargeOffSessionForCharge) must
 * pass a stable idempotencyKey (we use `charge_${chargeId}_offsession`)
 * so retries / double-clicks don't double-bill.
 *
 * @param {object} args
 * @param {string} args.apiKey
 * @param {string} args.customer        Stripe Customer ID (cus_...)
 * @param {string} args.paymentMethod   Saved PM ID (pm_...)
 * @param {number} args.amount          Amount in cents
 * @param {string} args.currency        e.g. 'usd' (defaults to 'usd')
 * @param {string} args.idempotencyKey  REQUIRED — prevents double-charge
 * @param {Record<string,string>} [args.metadata]
 * @returns {Promise<{id, status, amount_received?, last_payment_error?}>}
 *   Stripe returns the new PaymentIntent. On success, status='succeeded'
 *   and amount_received equals amount. On failure, status may be
 *   'requires_action' (3DS needed; off-session cannot proceed) or
 *   'requires_payment_method' (card declined). Caller decides how to
 *   handle each non-success outcome — typically: fall back to Option B
 *   (email link) and surface the error to the operator.
 */
export async function chargeOffSession({ apiKey, customer, paymentMethod, amount, currency = 'usd', idempotencyKey, metadata = {} }) {
    if (!customer) throw new Error('chargeOffSession: customer required');
    if (!paymentMethod) throw new Error('chargeOffSession: paymentMethod required');
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error('chargeOffSession: amount must be a positive integer (cents)');
    }
    if (!idempotencyKey) throw new Error('chargeOffSession: idempotencyKey required (prevents double-charge)');

    const body = {
        amount: String(amount),
        currency,
        customer,
        payment_method: paymentMethod,
        off_session: 'true',
        confirm: 'true',
    };
    for (const [k, v] of Object.entries(metadata)) {
        body[`metadata[${k}]`] = String(v);
    }
    return stripeFetch('/payment_intents', { apiKey, body, idempotencyKey });
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

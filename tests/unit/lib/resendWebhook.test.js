// M7 B8 — Svix signature verification for Resend webhooks.
// Mirrors the Group B Stripe signature tests: valid / tampered / stale /
// wrong-secret / malformed-header paths against worker/lib/resendWebhook.js.

import { describe, it, expect } from 'vitest';
import { verifyResendWebhook } from '../../../worker/lib/resendWebhook.js';
import { signSvixWebhook } from '../../helpers/svixSignature.js';

// Valid base64 after the whsec_ prefix (decodes to "svix_test_secret_01").
const SECRET = 'whsec_c3ZpeF90ZXN0X3NlY3JldF8wMQ==';
const OTHER_SECRET = 'whsec_b3RoZXJfc2VjcmV0X2tleV8wMg==';

const PAYLOAD = { type: 'email.bounced', data: { email: 'a@b.com', bounce_type: 'hard' } };

async function verifySigned(signed, { secret = SECRET, tolerance } = {}) {
    return verifyResendWebhook({
        body: signed.body,
        svixId: signed.svixId,
        svixTimestamp: signed.svixTimestamp,
        svixSignature: signed.svixSignature,
        secret,
        ...(tolerance != null ? { tolerance } : {}),
    });
}

describe('verifyResendWebhook — happy path', () => {
    it('returns the parsed body for a valid signature', async () => {
        const signed = await signSvixWebhook({ payload: PAYLOAD, secret: SECRET });
        const event = await verifySigned(signed);
        expect(event.type).toBe('email.bounced');
        expect(event.data.email).toBe('a@b.com');
    });

    it('accepts a secret WITHOUT the whsec_ prefix (raw base64)', async () => {
        const raw = SECRET.slice('whsec_'.length);
        const signed = await signSvixWebhook({ payload: PAYLOAD, secret: raw });
        const event = await verifyResendWebhook({
            body: signed.body, svixId: signed.svixId, svixTimestamp: signed.svixTimestamp,
            svixSignature: signed.svixSignature, secret: raw,
        });
        expect(event.type).toBe('email.bounced');
    });

    it('accepts when a bogus v1 token precedes the correct one (rotation)', async () => {
        const signed = await signSvixWebhook({ payload: PAYLOAD, secret: SECRET, extraV1: ['AAAABBBBCCCCDDDDEEEE'] });
        const event = await verifySigned(signed);
        expect(event.type).toBe('email.bounced');
    });
});

describe('verifyResendWebhook — rejection paths', () => {
    it('throws on a tampered body', async () => {
        const signed = await signSvixWebhook({ payload: PAYLOAD, secret: SECRET, tamperBody: true });
        await expect(verifySigned(signed)).rejects.toThrow(/signature mismatch/i);
    });

    it('throws on a corrupted signature', async () => {
        const signed = await signSvixWebhook({ payload: PAYLOAD, secret: SECRET, badSig: true });
        await expect(verifySigned(signed)).rejects.toThrow(/signature mismatch/i);
    });

    it('throws when verified against a different secret', async () => {
        const signed = await signSvixWebhook({ payload: PAYLOAD, secret: SECRET });
        await expect(verifySigned(signed, { secret: OTHER_SECRET })).rejects.toThrow(/signature mismatch/i);
    });

    it('throws on a stale timestamp (replay guard)', async () => {
        const signed = await signSvixWebhook({ payload: PAYLOAD, secret: SECRET, timestamp: 1 });
        await expect(verifySigned(signed)).rejects.toThrow(/timestamp outside tolerance/i);
    });

    it('throws when the secret is missing', async () => {
        const signed = await signSvixWebhook({ payload: PAYLOAD, secret: SECRET });
        await expect(verifySigned(signed, { secret: '' })).rejects.toThrow(/Missing Resend webhook secret/i);
    });

    it('throws when a svix header is missing', async () => {
        const signed = await signSvixWebhook({ payload: PAYLOAD, secret: SECRET });
        await expect(verifyResendWebhook({
            body: signed.body, svixId: undefined, svixTimestamp: signed.svixTimestamp,
            svixSignature: signed.svixSignature, secret: SECRET,
        })).rejects.toThrow(/Missing svix-id/i);
    });

    it('throws on a non-numeric timestamp', async () => {
        const signed = await signSvixWebhook({ payload: PAYLOAD, secret: SECRET });
        await expect(verifyResendWebhook({
            body: signed.body, svixId: signed.svixId, svixTimestamp: 'not-a-number',
            svixSignature: signed.svixSignature, secret: SECRET,
        })).rejects.toThrow(/Malformed svix-timestamp/i);
    });
});

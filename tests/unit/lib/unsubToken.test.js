// Marketing milestone B2b — unsubscribe HMAC token tests.

import { describe, it, expect } from 'vitest';
import { createUnsubToken, verifyUnsubToken } from '../../../worker/lib/unsubToken.js';

const SECRET = 'test-session-secret-123';

describe('unsubToken', () => {
    it('round-trips a valid token', async () => {
        const t = await createUnsubToken('cus_1', SECRET);
        expect(await verifyUnsubToken('cus_1', t, SECRET)).toBe(true);
    });

    it('is deterministic for the same (customer, secret)', async () => {
        expect(await createUnsubToken('cus_1', SECRET)).toBe(await createUnsubToken('cus_1', SECRET));
    });

    it('rejects a token minted for a different customer', async () => {
        const t = await createUnsubToken('cus_1', SECRET);
        expect(await verifyUnsubToken('cus_2', t, SECRET)).toBe(false);
    });

    it('rejects a tampered token', async () => {
        const t = await createUnsubToken('cus_1', SECRET);
        expect(await verifyUnsubToken('cus_1', `${t}x`, SECRET)).toBe(false);
    });

    it('rejects under a rotated secret', async () => {
        const t = await createUnsubToken('cus_1', SECRET);
        expect(await verifyUnsubToken('cus_1', t, 'rotated-secret')).toBe(false);
    });

    it('rejects missing/empty inputs', async () => {
        const t = await createUnsubToken('cus_1', SECRET);
        expect(await verifyUnsubToken('cus_1', '', SECRET)).toBe(false);
        expect(await verifyUnsubToken('', t, SECRET)).toBe(false);
        expect(await verifyUnsubToken(null, t, SECRET)).toBe(false);
        expect(await verifyUnsubToken('cus_1', null, SECRET)).toBe(false);
    });
});

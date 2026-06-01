// Marketing milestone B2b — public unsubscribe route tests.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../worker/index.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { createUnsubToken } from '../../../worker/lib/unsubToken.js';

let env;

beforeEach(() => {
    env = createMockEnv();
});

function get(path) {
    return worker.fetch(new Request(`https://airactionsport.com${path}`), env, {});
}

describe('GET /api/unsubscribe', () => {
    it('400 when params are missing', async () => {
        const res = await get('/api/unsubscribe');
        expect(res.status).toBe(400);
        expect(await res.text()).toMatch(/Invalid link/);
    });

    it('400 on an invalid token', async () => {
        const res = await get('/api/unsubscribe?c=cus_1&t=garbage');
        expect(res.status).toBe(400);
    });

    it('valid token → sets email_marketing = 0 + audit + 200 confirmation page', async () => {
        env.DB.__on(/UPDATE customers SET email_marketing = 0/, { meta: { changes: 1 } }, 'run');
        const token = await createUnsubToken('cus_1', env.SESSION_SECRET);

        const res = await get(`/api/unsubscribe?c=cus_1&t=${encodeURIComponent(token)}`);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toMatch(/unsubscribed/i);

        const writes = env.DB.__writes();
        const upd = writes.find((w) => /UPDATE customers SET email_marketing = 0/.test(w.sql));
        expect(upd).toBeDefined();
        expect(upd.args).toContain('cus_1');
        const audit = writes.find((w) => /INSERT INTO audit_log/.test(w.sql) && w.args.includes('customer.unsubscribed'));
        expect(audit).toBeDefined();
    });
});

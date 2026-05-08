// M5 R8 — runCertExpirationSweep cron tests.
//
// The sweep scans active certifications expiring at 60d/30d/7d milestones
// and emails each cert holder once per milestone. Idempotency is
// enforced via a NOT EXISTS subquery against audit_log rows with
// action = 'certification.expiration_warning.{60d,30d,7d}'.

import { describe, it, expect, beforeEach } from 'vitest';
import { runCertExpirationSweep } from '../../../worker/lib/certifications.js';
import { createMockEnv } from '../../helpers/mockEnv.js';
import { mockResendFetch } from '../../helpers/mockResend.js';

let env;

beforeEach(() => {
    env = createMockEnv();
    env.RESEND_API_KEY = 'test-resend-key';
    env.RESEND_FROM_EMAIL = 'no-reply@airactionsport.com';
});

describe('runCertExpirationSweep', () => {
    it('returns zero counts when no certs are in any window', async () => {
        // All three bucket queries return empty results.
        env.DB.__on(/FROM certifications c/, { results: [] }, 'all');

        const result = await runCertExpirationSweep(env);
        expect(result.sent60).toBe(0);
        expect(result.sent30).toBe(0);
        expect(result.sent7).toBe(0);
        expect(result.failed).toBe(0);
    });

    it('issues 3 separate SQL queries (one per bucket: 60d, 30d, 7d)', async () => {
        env.DB.__on(/FROM certifications c/, { results: [] }, 'all');

        await runCertExpirationSweep(env);

        const writes = env.DB.__writes();
        const certQueries = writes.filter((w) => /FROM certifications c/.test(w.sql));
        expect(certQueries.length).toBe(3);
    });

    it('binds the audit-action sentinel string into each NOT EXISTS subquery', async () => {
        env.DB.__on(/FROM certifications c/, { results: [] }, 'all');

        await runCertExpirationSweep(env);

        const writes = env.DB.__writes();
        const certQueries = writes.filter((w) => /FROM certifications c/.test(w.sql));
        const sentinelArgs = certQueries.map((q) => q.args.find((a) => typeof a === 'string' && a.startsWith('certification.expiration_warning.')));
        expect(sentinelArgs).toContain('certification.expiration_warning.60d');
        expect(sentinelArgs).toContain('certification.expiration_warning.30d');
        expect(sentinelArgs).toContain('certification.expiration_warning.7d');
    });

    it('sends an email + writes audit row for each candidate; bumps sent7 counter', async () => {
        const sampleCert = {
            id: 'cert_001',
            person_id: 'prs_1',
            person_name: 'Jane Doe',
            person_email: 'jane@example.com',
            kind: 'cpr',
            display_name: 'CPR/AED',
            issuing_authority: 'AHA',
            expires_at: Date.now() + 5 * 86400000,
            status: 'active',
        };
        // 60d empty, 30d empty, 7d returns 1 cert
        let callCount = 0;
        env.DB.__on(/FROM certifications c/, () => {
            callCount++;
            return { results: callCount === 3 ? [sampleCert] : [] };
        }, 'all');
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, {
            slug: 'cert_expiration_7d',
            subject: '{{certName}} expires soon',
            body_html: '<p>Hi {{personName}}, your {{certName}} expires {{expiresOn}}</p>',
            body_text: 'Hi {{personName}}, your {{certName}} expires {{expiresOn}}',
        }, 'first');
        env.DB.__on(/INSERT INTO audit_log/, { meta: { changes: 1 } }, 'run');
        mockResendFetch({ id: 'msg_test_001' });

        const result = await runCertExpirationSweep(env);
        expect(result.sent7).toBe(1);
        expect(result.sent30).toBe(0);
        expect(result.sent60).toBe(0);
        expect(result.failed).toBe(0);

        const writes = env.DB.__writes();
        const auditWrite = writes.find((w) => /INSERT INTO audit_log/.test(w.sql));
        expect(auditWrite).toBeDefined();
        expect(auditWrite.args.some((a) => a === 'certification.expiration_warning.7d')).toBe(true);
        expect(auditWrite.args).toContain('cert_001');
    });

    it('counts a missing email template as failed (not crashes)', async () => {
        const sampleCert = {
            id: 'cert_002',
            person_id: 'prs_2',
            person_name: 'Bob',
            person_email: 'bob@example.com',
            kind: 'first_aid',
            display_name: 'First Aid',
            expires_at: Date.now() + 45 * 86400000,
            status: 'active',
        };
        let callCount = 0;
        env.DB.__on(/FROM certifications c/, () => {
            callCount++;
            return { results: callCount === 1 ? [sampleCert] : [] };
        }, 'all');
        // Template lookup returns null
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, null, 'first');

        const result = await runCertExpirationSweep(env);
        expect(result.sent60).toBe(0);
        expect(result.sent30).toBe(0);
        expect(result.sent7).toBe(0);
        expect(result.failed).toBe(1);
    });

    it('binds correct expires_at window args per bucket (60d: now+30d..now+60d)', async () => {
        env.DB.__on(/FROM certifications c/, { results: [] }, 'all');

        const beforeMs = Date.now();
        await runCertExpirationSweep(env);
        const afterMs = Date.now();

        const writes = env.DB.__writes();
        const certQueries = writes.filter((w) => /FROM certifications c/.test(w.sql));
        // First query is 60d bucket — args[0] = windowStart, args[1] = windowEnd
        const q60 = certQueries[0];
        expect(q60).toBeDefined();
        const start60 = q60.args[0];
        const end60 = q60.args[1];
        // start60 should be in the 30 ± 1d range from now
        expect(start60).toBeGreaterThanOrEqual(beforeMs + 30 * 86400000 - 5000);
        expect(start60).toBeLessThanOrEqual(afterMs + 30 * 86400000 + 5000);
        // end60 should be in the 60 ± 1d range
        expect(end60).toBeGreaterThanOrEqual(beforeMs + 60 * 86400000 - 5000);
        expect(end60).toBeLessThanOrEqual(afterMs + 60 * 86400000 + 5000);
    });

    it('does not crash if RESEND_API_KEY is missing (fails the send, counts in failed)', async () => {
        const sampleCert = {
            id: 'cert_003',
            person_id: 'prs_3',
            person_name: 'Carol',
            person_email: 'carol@example.com',
            kind: 'cpr',
            display_name: 'CPR',
            expires_at: Date.now() + 3 * 86400000,
            status: 'active',
        };
        delete env.RESEND_API_KEY;
        let callCount = 0;
        env.DB.__on(/FROM certifications c/, () => {
            callCount++;
            return { results: callCount === 3 ? [sampleCert] : [] };
        }, 'all');
        env.DB.__on(/SELECT \* FROM email_templates WHERE slug = \?/, {
            slug: 'cert_expiration_7d',
            subject: 'X',
            body_html: '<p>X</p>',
            body_text: 'X',
        }, 'first');
        // No mockResendFetch — sendEmail will throw on missing fetch mock.
        // We expect failure to be caught and counted, not crash.

        const result = await runCertExpirationSweep(env);
        expect(result.failed).toBeGreaterThanOrEqual(1);
        expect(result.sent7).toBe(0);
    });
});

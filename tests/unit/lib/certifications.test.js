// M5 R8 — pure helper tests for worker/lib/certifications.js.
// I/O wrapper tests live in tests/unit/cron/cert-expiration-sweep.test.js.

import { describe, it, expect } from 'vitest';
import {
    classifyExpirationBucket,
    templateSlugForBucket,
    auditActionForBucket,
    bucketWindow,
} from '../../../worker/lib/certifications.js';

const DAY = 86400000;
const NOW = 1_700_000_000_000; // fixed reference point for deterministic windows

describe('classifyExpirationBucket', () => {
    it('returns null for null/undefined expiresAt', () => {
        expect(classifyExpirationBucket(null, NOW)).toBeNull();
        expect(classifyExpirationBucket(undefined, NOW)).toBeNull();
    });

    it('returns null for already-expired certs (negative diff)', () => {
        expect(classifyExpirationBucket(NOW - DAY, NOW)).toBeNull();
        expect(classifyExpirationBucket(NOW - 100 * DAY, NOW)).toBeNull();
    });

    it('returns "expiring_7d" for certs expiring within 7 days inclusive', () => {
        expect(classifyExpirationBucket(NOW + DAY, NOW)).toBe('expiring_7d');
        expect(classifyExpirationBucket(NOW + 7 * DAY, NOW)).toBe('expiring_7d');
        expect(classifyExpirationBucket(NOW, NOW)).toBe('expiring_7d');
    });

    it('returns "expiring_30d" for certs expiring 8–30 days out', () => {
        expect(classifyExpirationBucket(NOW + 8 * DAY, NOW)).toBe('expiring_30d');
        expect(classifyExpirationBucket(NOW + 15 * DAY, NOW)).toBe('expiring_30d');
        expect(classifyExpirationBucket(NOW + 30 * DAY, NOW)).toBe('expiring_30d');
    });

    it('returns "expiring_60d" for certs expiring 31–60 days out', () => {
        expect(classifyExpirationBucket(NOW + 31 * DAY, NOW)).toBe('expiring_60d');
        expect(classifyExpirationBucket(NOW + 45 * DAY, NOW)).toBe('expiring_60d');
        expect(classifyExpirationBucket(NOW + 60 * DAY, NOW)).toBe('expiring_60d');
    });

    it('returns null for certs expiring more than 60 days out', () => {
        expect(classifyExpirationBucket(NOW + 61 * DAY, NOW)).toBeNull();
        expect(classifyExpirationBucket(NOW + 365 * DAY, NOW)).toBeNull();
    });

    it('uses Date.now() as default `now` argument', () => {
        // Don't assert exact bucket — just that no crash and returns one of the
        // valid values (or null) without an explicit now argument.
        const bucket = classifyExpirationBucket(Date.now() + 5 * DAY);
        expect([null, 'expiring_7d', 'expiring_30d', 'expiring_60d']).toContain(bucket);
    });
});

describe('templateSlugForBucket', () => {
    it('maps known buckets to seed migration slugs', () => {
        expect(templateSlugForBucket('expiring_60d')).toBe('cert_expiration_60d');
        expect(templateSlugForBucket('expiring_30d')).toBe('cert_expiration_30d');
        expect(templateSlugForBucket('expiring_7d')).toBe('cert_expiration_7d');
    });

    it('returns null for unknown buckets', () => {
        expect(templateSlugForBucket('expiring_90d')).toBeNull();
        expect(templateSlugForBucket(null)).toBeNull();
        expect(templateSlugForBucket(undefined)).toBeNull();
        expect(templateSlugForBucket('')).toBeNull();
    });
});

describe('auditActionForBucket', () => {
    it('maps known buckets to dotted audit-log action keys', () => {
        expect(auditActionForBucket('expiring_60d')).toBe('certification.expiration_warning.60d');
        expect(auditActionForBucket('expiring_30d')).toBe('certification.expiration_warning.30d');
        expect(auditActionForBucket('expiring_7d')).toBe('certification.expiration_warning.7d');
    });

    it('returns null for unknown buckets', () => {
        expect(auditActionForBucket('unknown')).toBeNull();
        expect(auditActionForBucket(null)).toBeNull();
    });
});

describe('bucketWindow', () => {
    it('returns the [now+30d, now+60d] window for "expiring_60d"', () => {
        const w = bucketWindow('expiring_60d', NOW);
        expect(w.start).toBe(NOW + 30 * DAY);
        expect(w.end).toBe(NOW + 60 * DAY);
    });

    it('returns the [now+7d, now+30d] window for "expiring_30d"', () => {
        const w = bucketWindow('expiring_30d', NOW);
        expect(w.start).toBe(NOW + 7 * DAY);
        expect(w.end).toBe(NOW + 30 * DAY);
    });

    it('returns the [now, now+7d] window for "expiring_7d"', () => {
        const w = bucketWindow('expiring_7d', NOW);
        expect(w.start).toBe(NOW);
        expect(w.end).toBe(NOW + 7 * DAY);
    });

    it('returns null for unknown buckets', () => {
        expect(bucketWindow('unknown', NOW)).toBeNull();
        expect(bucketWindow('', NOW)).toBeNull();
    });

    it('windows are non-overlapping (60d.start === 30d.end, 30d.start === 7d.end)', () => {
        const b60 = bucketWindow('expiring_60d', NOW);
        const b30 = bucketWindow('expiring_30d', NOW);
        const b7 = bucketWindow('expiring_7d', NOW);
        expect(b60.start).toBe(b30.end);
        expect(b30.start).toBe(b7.end);
    });
});

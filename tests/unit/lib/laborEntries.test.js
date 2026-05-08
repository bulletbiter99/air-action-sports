// M5 R10 — pure helper tests for worker/lib/laborEntries.js.
// I/O wrapper tests live in tests/unit/admin/laborEntries/route.test.js
// (route-level coverage exercises the same SQL paths via a Hono request).

import { describe, it, expect } from 'vitest';
import {
    taxYearOf,
    requiresApproval,
    classifyStatus,
    computeTotalsByTaxYear,
    SELF_APPROVAL_CAP_CENTS,
} from '../../../worker/lib/laborEntries.js';

describe('taxYearOf', () => {
    it('returns null for null/undefined', () => {
        expect(taxYearOf(null)).toBeNull();
        expect(taxYearOf(undefined)).toBeNull();
    });

    it('returns the UTC year of an epoch ms timestamp', () => {
        // 2026-05-15 12:00:00 UTC
        const ms = Date.UTC(2026, 4, 15, 12, 0, 0);
        expect(taxYearOf(ms)).toBe(2026);
    });

    it('uses UTC year (not local), so timestamps near year-end work consistently', () => {
        // 2026-12-31 23:59:59 UTC
        expect(taxYearOf(Date.UTC(2026, 11, 31, 23, 59, 59))).toBe(2026);
        // 2027-01-01 00:00:01 UTC
        expect(taxYearOf(Date.UTC(2027, 0, 1, 0, 0, 1))).toBe(2027);
    });
});

describe('SELF_APPROVAL_CAP_CENTS', () => {
    it('is exactly $200 (decision register #54)', () => {
        expect(SELF_APPROVAL_CAP_CENTS).toBe(20000);
    });
});

describe('requiresApproval', () => {
    it('returns false for event_completion source regardless of amount', () => {
        expect(requiresApproval({ source: 'event_completion', amountCents: 50000 })).toBe(false);
        expect(requiresApproval({ source: 'event_completion', amountCents: 200000 })).toBe(false);
    });

    it('returns false for adjustment source regardless of amount', () => {
        expect(requiresApproval({ source: 'adjustment', amountCents: 50000 })).toBe(false);
    });

    it('returns false for manual_entry at or below the $200 cap', () => {
        expect(requiresApproval({ source: 'manual_entry', amountCents: 0 })).toBe(false);
        expect(requiresApproval({ source: 'manual_entry', amountCents: 19999 })).toBe(false);
        expect(requiresApproval({ source: 'manual_entry', amountCents: 20000 })).toBe(false);
    });

    it('returns true for manual_entry above the $200 cap', () => {
        expect(requiresApproval({ source: 'manual_entry', amountCents: 20001 })).toBe(true);
        expect(requiresApproval({ source: 'manual_entry', amountCents: 50000 })).toBe(true);
    });

    it('honors a custom capCents override (per-org configurable)', () => {
        expect(requiresApproval({ source: 'manual_entry', amountCents: 10000, capCents: 5000 })).toBe(true);
        expect(requiresApproval({ source: 'manual_entry', amountCents: 5000, capCents: 5000 })).toBe(false);
    });

    it('returns false when amountCents is null/undefined', () => {
        expect(requiresApproval({ source: 'manual_entry', amountCents: null })).toBe(false);
        expect(requiresApproval({ source: 'manual_entry' })).toBe(false);
    });
});

describe('classifyStatus', () => {
    it('returns "unknown" for null/undefined entry', () => {
        expect(classifyStatus(null)).toBe('unknown');
        expect(classifyStatus(undefined)).toBe('unknown');
    });

    it('returns "rejected" when rejected_at is set', () => {
        expect(classifyStatus({ rejected_at: Date.now() })).toBe('rejected');
    });

    it('returns "disputed" when disputed_at is set and resolved_at is null', () => {
        expect(classifyStatus({ disputed_at: Date.now(), resolved_at: null })).toBe('disputed');
    });

    it('returns "paid" when paid_at is set (no dispute, no rejection)', () => {
        expect(classifyStatus({ paid_at: Date.now() })).toBe('paid');
    });

    it('returns "approved" when approved_at is set (not yet paid)', () => {
        expect(classifyStatus({ approved_at: Date.now() })).toBe('approved');
    });

    it('returns "pending_approval" when approval_required=1 and approved_at null', () => {
        expect(classifyStatus({ approval_required: 1, approved_at: null })).toBe('pending_approval');
    });

    it('returns "recorded" for entries that need no approval and are not paid', () => {
        expect(classifyStatus({ approval_required: 0 })).toBe('recorded');
    });

    it('priority order: rejected > disputed > paid > approved > pending_approval > recorded', () => {
        // rejected wins over everything
        expect(classifyStatus({ rejected_at: 1, disputed_at: 1, paid_at: 1 })).toBe('rejected');
        // disputed wins over paid + approved
        expect(classifyStatus({ disputed_at: 1, paid_at: 1, approved_at: 1 })).toBe('disputed');
        // resolved dispute returns to paid/approved/recorded path
        expect(classifyStatus({ disputed_at: 1, resolved_at: 2, paid_at: 3 })).toBe('paid');
        // paid beats approved
        expect(classifyStatus({ paid_at: 1, approved_at: 1, approval_required: 1 })).toBe('paid');
    });
});

describe('computeTotalsByTaxYear', () => {
    it('returns empty object for non-array input', () => {
        expect(computeTotalsByTaxYear(null)).toEqual({});
        expect(computeTotalsByTaxYear(undefined)).toEqual({});
        expect(computeTotalsByTaxYear({})).toEqual({});
    });

    it('returns empty object for empty array', () => {
        expect(computeTotalsByTaxYear([])).toEqual({});
    });

    it('rolls up paid amount under paidCents', () => {
        const entries = [
            { tax_year: 2026, amount_cents: 10000, paid_at: 1 },
            { tax_year: 2026, amount_cents: 25000, paid_at: 2 },
        ];
        const r = computeTotalsByTaxYear(entries);
        expect(r[2026].paidCents).toBe(35000);
        expect(r[2026].unpaidCents).toBe(0);
        expect(r[2026].totalEntries).toBe(2);
    });

    it('rolls up unpaid (not rejected) amount under unpaidCents', () => {
        const entries = [
            { tax_year: 2026, amount_cents: 10000 }, // unpaid, not rejected
            { tax_year: 2026, amount_cents: 5000, paid_at: 1 }, // paid
        ];
        const r = computeTotalsByTaxYear(entries);
        expect(r[2026].paidCents).toBe(5000);
        expect(r[2026].unpaidCents).toBe(10000);
    });

    it('excludes rejected entries from unpaidCents (they will never pay out)', () => {
        const entries = [
            { tax_year: 2026, amount_cents: 10000, rejected_at: 1 },
        ];
        const r = computeTotalsByTaxYear(entries);
        expect(r[2026].paidCents).toBe(0);
        expect(r[2026].unpaidCents).toBe(0);
        expect(r[2026].totalEntries).toBe(1);
    });

    it('counts pending approvals separately from totals', () => {
        const entries = [
            { tax_year: 2026, amount_cents: 30000, approval_required: 1, approved_at: null },
            { tax_year: 2026, amount_cents: 50000, approval_required: 1, approved_at: 1 },
        ];
        const r = computeTotalsByTaxYear(entries);
        expect(r[2026].pendingApprovalCount).toBe(1);
    });

    it('counts disputed (unresolved) entries separately', () => {
        const entries = [
            { tax_year: 2026, amount_cents: 10000, disputed_at: 1, resolved_at: null },
            { tax_year: 2026, amount_cents: 5000, disputed_at: 1, resolved_at: 2 },
        ];
        const r = computeTotalsByTaxYear(entries);
        expect(r[2026].disputedCount).toBe(1);
    });

    it('separates rollups by tax_year', () => {
        const entries = [
            { tax_year: 2025, amount_cents: 5000, paid_at: 1 },
            { tax_year: 2026, amount_cents: 10000, paid_at: 2 },
        ];
        const r = computeTotalsByTaxYear(entries);
        expect(r[2025].paidCents).toBe(5000);
        expect(r[2026].paidCents).toBe(10000);
        expect(Object.keys(r).length).toBe(2);
    });

    it('falls back to taxYearOf(worked_at) when tax_year column is missing', () => {
        const entries = [
            { worked_at: Date.UTC(2026, 4, 15), amount_cents: 5000, paid_at: 1 },
        ];
        const r = computeTotalsByTaxYear(entries);
        expect(r[2026]).toBeDefined();
        expect(r[2026].paidCents).toBe(5000);
    });

    it('skips entries with no tax_year and unparseable worked_at', () => {
        const entries = [
            { amount_cents: 5000 }, // no year info
        ];
        const r = computeTotalsByTaxYear(entries);
        expect(Object.keys(r).length).toBe(0);
    });
});

// M5.5 Batch 8 — pure-helper tests for the field rentals admin pages.
//
// These helpers are extracted as named exports from the JSX files so the test
// surface stays vitest-only (no React Testing Library required). They cover:
//   - List-page filter parsing + query string serialization
//   - Status / COI badge classification (color + label)
//   - Schedule + money formatters
//   - Requirements progress
//   - Conflict-banner merging
//   - allowedNextStatuses (mirrors server's STATUS_TRANSITIONS)
//   - 3-step wizard validators + pricing preview

import { describe, it, expect } from 'vitest';

import {
    classifyStatus,
    classifyCoiStatus,
    parseListFilters,
    buildListQueryString,
    formatScheduleWindow,
    formatMoney,
    requirementsProgress,
    STATUS_OPTIONS,
    ENGAGEMENT_TYPES,
    COI_STATUSES,
} from '../../../src/admin/AdminFieldRentals.jsx';

import {
    mergeConflictsForBanner,
    computeRequirementsProgress,
    allowedNextStatuses,
} from '../../../src/admin/AdminFieldRentalDetail.jsx';

import {
    validateNewRentalStep1,
    validateNewRentalStep2,
    validateNewRentalStep3,
    previewTotalCents,
} from '../../../src/admin/AdminFieldRentalNew.jsx';

// ────────────────────────────────────────────────────────────────────
// Exported constants
// ────────────────────────────────────────────────────────────────────

describe('exported constants', () => {
    it('STATUS_OPTIONS contains the 8 schema statuses in order', () => {
        expect(STATUS_OPTIONS).toEqual([
            'lead', 'draft', 'sent', 'agreed', 'paid', 'completed', 'cancelled', 'refunded',
        ]);
    });

    it('ENGAGEMENT_TYPES matches migration 0047 enum (7 values)', () => {
        expect(ENGAGEMENT_TYPES).toEqual([
            'private_skirmish', 'paintball', 'tactical_training', 'film_shoot',
            'corporate', 'youth_program', 'other',
        ]);
    });

    it('COI_STATUSES matches migration 0047 enum (4 values)', () => {
        expect(COI_STATUSES).toEqual(['not_required', 'pending', 'received', 'expired']);
    });
});

// ────────────────────────────────────────────────────────────────────
// classifyStatus / classifyCoiStatus
// ────────────────────────────────────────────────────────────────────

describe('classifyStatus', () => {
    it('returns a label + color + bg for each valid status', () => {
        for (const s of STATUS_OPTIONS) {
            const r = classifyStatus(s);
            expect(typeof r.label).toBe('string');
            expect(r.label.length).toBeGreaterThan(0);
            expect(r.color).toMatch(/^#[0-9a-f]{6}$/i);
            expect(r.bg).toMatch(/^#[0-9a-f]{6}$/i);
        }
    });

    it('falls back gracefully for unknown status', () => {
        const r = classifyStatus('made_up_status');
        expect(r.label).toBe('made_up_status');
        expect(r.color).toBeTruthy();
    });

    it('falls back for null/undefined input', () => {
        expect(classifyStatus(null).label).toBe('—');
        expect(classifyStatus(undefined).label).toBe('—');
    });
});

describe('classifyCoiStatus', () => {
    const now = Date.parse('2026-06-01T00:00:00Z');

    it('not_required returns muted label', () => {
        expect(classifyCoiStatus('not_required').label).toBe('Not required');
    });

    it('pending returns amber pending label', () => {
        const r = classifyCoiStatus('pending');
        expect(r.label).toMatch(/pending/i);
    });

    it('expired returns red expired label', () => {
        const r = classifyCoiStatus('expired');
        expect(r.label).toMatch(/expired/i);
        expect(r.bg).toBe('#fee2e2');
    });

    it('received w/ expires >30d: green received label', () => {
        const r = classifyCoiStatus('received', now + 60 * 86400000, now);
        expect(r.label).toMatch(/received/i);
        expect(r.bg).toBe('#d1fae5');
    });

    it('received w/ expires <30d: amber warning', () => {
        const r = classifyCoiStatus('received', now + 14 * 86400000, now);
        expect(r.bg).toBe('#fef3c7');
        expect(r.label).toMatch(/d left/);
    });

    it('received w/ expires <7d: red urgent', () => {
        const r = classifyCoiStatus('received', now + 3 * 86400000, now);
        expect(r.bg).toBe('#fee2e2');
        expect(r.label).toMatch(/d left/);
    });

    it('received w/ expires in past: shows "COI expired"', () => {
        const r = classifyCoiStatus('received', now - 86400000, now);
        expect(r.label).toMatch(/expired/i);
        expect(r.bg).toBe('#fee2e2');
    });

    it('received without expires/now defaults to green received', () => {
        const r = classifyCoiStatus('received');
        expect(r.label).toMatch(/received/i);
    });
});

// ────────────────────────────────────────────────────────────────────
// parseListFilters / buildListQueryString
// ────────────────────────────────────────────────────────────────────

function makeSearchParams(record) {
    return new URLSearchParams(record);
}

describe('parseListFilters', () => {
    it('returns defaults for empty params', () => {
        const r = parseListFilters(makeSearchParams({}));
        expect(r).toEqual({ status: '', site_id: '', engagement_type: '', coi_status: '', archived: '', q: '', limit: 50, offset: 0 });
    });

    it('reads status / site_id / q / etc.', () => {
        const r = parseListFilters(makeSearchParams({ status: 'lead', site_id: 'site_g', q: 'alice', archived: 'true', limit: '25', offset: '50' }));
        expect(r.status).toBe('lead');
        expect(r.site_id).toBe('site_g');
        expect(r.q).toBe('alice');
        expect(r.archived).toBe('true');
        expect(r.limit).toBe(25);
        expect(r.offset).toBe(50);
    });

    it('clamps limit to 200', () => {
        const r = parseListFilters(makeSearchParams({ limit: '999999' }));
        expect(r.limit).toBe(200);
    });

    it('clamps limit to 50 (default) when negative or NaN', () => {
        expect(parseListFilters(makeSearchParams({ limit: '-5' })).limit).toBe(50);
        expect(parseListFilters(makeSearchParams({ limit: 'abc' })).limit).toBe(50);
    });

    it('clamps offset to 0 when negative or NaN', () => {
        expect(parseListFilters(makeSearchParams({ offset: '-5' })).offset).toBe(0);
        expect(parseListFilters(makeSearchParams({ offset: 'abc' })).offset).toBe(0);
    });

    it('returns defaults for null or non-SearchParams input', () => {
        expect(parseListFilters(null).status).toBe('');
        expect(parseListFilters({}).status).toBe('');
    });
});

describe('buildListQueryString', () => {
    it('produces empty string for empty filters', () => {
        expect(buildListQueryString({})).toBe('');
    });

    it('drops empty string values', () => {
        const r = buildListQueryString({ status: '', site_id: 'site_g' });
        expect(r).toBe('site_id=site_g');
    });

    it('drops null/undefined values', () => {
        const r = buildListQueryString({ status: null, site_id: undefined, q: 'alice' });
        expect(r).toBe('q=alice');
    });

    it('emits limit + offset when finite', () => {
        const r = buildListQueryString({ limit: 25, offset: 50 });
        expect(r).toContain('limit=25');
        expect(r).toContain('offset=50');
    });

    it('roundtrip with parseListFilters', () => {
        const original = { status: 'paid', site_id: 'site_g', engagement_type: 'paintball', coi_status: '', archived: '', q: 'alice', limit: 25, offset: 0 };
        const qs = buildListQueryString(original);
        const parsed = parseListFilters(new URLSearchParams(qs));
        expect(parsed.status).toBe(original.status);
        expect(parsed.site_id).toBe(original.site_id);
        expect(parsed.q).toBe(original.q);
        expect(parsed.limit).toBe(original.limit);
    });

    it('handles non-object input defensively', () => {
        expect(buildListQueryString(null)).toBe('');
        expect(buildListQueryString(undefined)).toBe('');
    });
});

// ────────────────────────────────────────────────────────────────────
// Formatters
// ────────────────────────────────────────────────────────────────────

describe('formatScheduleWindow', () => {
    it('returns "—" for non-finite inputs', () => {
        expect(formatScheduleWindow(null, null)).toBe('—');
        expect(formatScheduleWindow('abc', 'def')).toBe('—');
    });

    it('returns a non-empty string for valid inputs', () => {
        const start = Date.parse('2026-06-15T09:00:00Z');
        const end = Date.parse('2026-06-15T17:00:00Z');
        const r = formatScheduleWindow(start, end);
        expect(typeof r).toBe('string');
        expect(r.length).toBeGreaterThan(0);
    });
});

describe('formatMoney', () => {
    it('formats cents → $X.XX', () => {
        expect(formatMoney(0)).toBe('$0.00');
        expect(formatMoney(100)).toBe('$1.00');
        expect(formatMoney(99999)).toMatch(/999\.99/);
    });

    it('returns "—" for non-finite inputs', () => {
        expect(formatMoney(null)).toBe('—');
        expect(formatMoney('abc')).toBe('—');
    });
});

describe('requirementsProgress', () => {
    it('returns "X/5" string', () => {
        expect(requirementsProgress({ requirements: {} })).toBe('0/5');
        expect(requirementsProgress({ requirements: { coiReceived: true } })).toBe('1/5');
        expect(requirementsProgress({ requirements: { coiReceived: true, agreementSigned: true, depositReceived: true, briefingScheduled: true, walkthroughCompleted: true } })).toBe('5/5');
    });

    it('handles missing requirements object', () => {
        expect(requirementsProgress({})).toBe('0/5');
        expect(requirementsProgress(null)).toBe('0/5');
        expect(requirementsProgress(undefined)).toBe('0/5');
    });
});

// ────────────────────────────────────────────────────────────────────
// computeRequirementsProgress (detail-page version with percent)
// ────────────────────────────────────────────────────────────────────

describe('computeRequirementsProgress', () => {
    it('returns { completed, total, percent }', () => {
        const r = computeRequirementsProgress({ requirements: { coiReceived: true, agreementSigned: true } });
        expect(r.completed).toBe(2);
        expect(r.total).toBe(5);
        expect(r.percent).toBe(40);
    });

    it('returns zeros for missing requirements', () => {
        const r = computeRequirementsProgress(null);
        expect(r).toEqual({ completed: 0, total: 5, percent: 0 });
    });

    it('returns 100% when all 5 booleans true', () => {
        const r = computeRequirementsProgress({
            requirements: {
                coiReceived: true, agreementSigned: true, depositReceived: true,
                briefingScheduled: true, walkthroughCompleted: true,
            },
        });
        expect(r.percent).toBe(100);
    });
});

// ────────────────────────────────────────────────────────────────────
// mergeConflictsForBanner
// ────────────────────────────────────────────────────────────────────

describe('mergeConflictsForBanner', () => {
    it('returns empty array for null/undefined', () => {
        expect(mergeConflictsForBanner(null)).toEqual([]);
        expect(mergeConflictsForBanner(undefined)).toEqual([]);
    });

    it('flattens events / blackouts / fieldRentals into a single labeled list', () => {
        const out = mergeConflictsForBanner({
            events: [{ id: 'ev_1', title: 'Op Nightfall', date_iso: '2026-06-15' }],
            blackouts: [{ id: 'blk_1', reason: 'Maintenance', starts_at: 1000, ends_at: 2000 }],
            fieldRentals: [{ id: 'fr_1', starts_at: 3000, ends_at: 4000 }],
        });
        expect(out).toHaveLength(3);
        const kinds = out.map((c) => c.kind);
        expect(kinds).toContain('event');
        expect(kinds).toContain('blackout');
        expect(kinds).toContain('fieldRental');
    });

    it('preserves event dateIso for label rendering', () => {
        const out = mergeConflictsForBanner({ events: [{ id: 'ev_1', title: 'X', date_iso: '2026-06-15' }] });
        expect(out[0].dateIso).toBe('2026-06-15');
    });

    it('skips entries without ids (defensive)', () => {
        const out = mergeConflictsForBanner({
            events: [null, { title: 'no id' }, { id: 'ev_ok', title: 'OK' }],
            blackouts: [],
            fieldRentals: [],
        });
        expect(out).toHaveLength(1);
        expect(out[0].id).toBe('ev_ok');
    });

    it('falls back to ID-as-label when title missing', () => {
        const out = mergeConflictsForBanner({ events: [{ id: 'ev_noname' }] });
        expect(out[0].label).toBe('ev_noname');
    });
});

// ────────────────────────────────────────────────────────────────────
// allowedNextStatuses
// ────────────────────────────────────────────────────────────────────

describe('allowedNextStatuses (mirrors server STATUS_TRANSITIONS)', () => {
    it('lead → draft, cancelled', () => {
        expect(allowedNextStatuses('lead').sort()).toEqual(['cancelled', 'draft']);
    });

    it('agreed → paid, sent, cancelled', () => {
        expect(allowedNextStatuses('agreed').sort()).toEqual(['cancelled', 'paid', 'sent']);
    });

    it('paid → completed, refunded', () => {
        expect(allowedNextStatuses('paid').sort()).toEqual(['completed', 'refunded']);
    });

    it('refunded is terminal', () => {
        expect(allowedNextStatuses('refunded')).toEqual([]);
    });

    it('unknown status returns []', () => {
        expect(allowedNextStatuses('made_up')).toEqual([]);
        expect(allowedNextStatuses(null)).toEqual([]);
    });
});

// ────────────────────────────────────────────────────────────────────
// New-rental step validators
// ────────────────────────────────────────────────────────────────────

describe('validateNewRentalStep1', () => {
    it('requires a customer with .id', () => {
        expect(validateNewRentalStep1({ customer: null }).ok).toBe(false);
        expect(validateNewRentalStep1({ customer: { id: '' } }).ok).toBe(false);
        expect(validateNewRentalStep1({ customer: { id: 'cus_x' } }).ok).toBe(true);
    });

    it('handles undefined state', () => {
        expect(validateNewRentalStep1(undefined).ok).toBe(false);
    });
});

describe('validateNewRentalStep2', () => {
    const validBase = {
        siteId: 'site_g',
        siteFieldIds: ['fld_a'],
        scheduledStartsAt: 1000,
        scheduledEndsAt: 2000,
        engagementType: 'paintball',
    };

    it('happy path returns ok', () => {
        expect(validateNewRentalStep2(validBase).ok).toBe(true);
    });

    it('rejects missing site', () => {
        expect(validateNewRentalStep2({ ...validBase, siteId: '' }).ok).toBe(false);
    });

    it('rejects empty fields array', () => {
        expect(validateNewRentalStep2({ ...validBase, siteFieldIds: [] }).ok).toBe(false);
    });

    it('rejects non-finite schedule', () => {
        expect(validateNewRentalStep2({ ...validBase, scheduledStartsAt: NaN }).ok).toBe(false);
    });

    it('rejects end ≤ start', () => {
        expect(validateNewRentalStep2({ ...validBase, scheduledEndsAt: 1000 }).ok).toBe(false);
        expect(validateNewRentalStep2({ ...validBase, scheduledEndsAt: 500 }).ok).toBe(false);
    });

    it('rejects missing engagement type', () => {
        expect(validateNewRentalStep2({ ...validBase, engagementType: '' }).ok).toBe(false);
    });
});

describe('validateNewRentalStep3', () => {
    it('happy path with valid pricing', () => {
        const r = validateNewRentalStep3({
            siteFeeCents: 50000, discountCents: 0, taxCents: 0,
            addonFees: [{ label: 'Cleanup', cents: 5000 }],
        });
        expect(r.ok).toBe(true);
    });

    it('rejects negative site_fee_cents', () => {
        expect(validateNewRentalStep3({ siteFeeCents: -1, discountCents: 0, taxCents: 0 }).ok).toBe(false);
    });

    it('rejects non-integer pricing inputs', () => {
        expect(validateNewRentalStep3({ siteFeeCents: 99.5, discountCents: 0, taxCents: 0 }).ok).toBe(false);
    });

    it('rejects addon without label', () => {
        expect(validateNewRentalStep3({
            siteFeeCents: 0, discountCents: 0, taxCents: 0,
            addonFees: [{ label: '   ', cents: 100 }],
        }).ok).toBe(false);
    });

    it('rejects addon with negative cents', () => {
        expect(validateNewRentalStep3({
            siteFeeCents: 0, discountCents: 0, taxCents: 0,
            addonFees: [{ label: 'X', cents: -10 }],
        }).ok).toBe(false);
    });
});

describe('previewTotalCents', () => {
    it('site fee only', () => {
        expect(previewTotalCents({ siteFeeCents: 50000 })).toBe(50000);
    });

    it('site + addons + tax - discount', () => {
        expect(previewTotalCents({
            siteFeeCents: 50000,
            addonFees: [{ cents: 5000 }, { cents: 10000 }],
            discountCents: 10000, taxCents: 4400,
        })).toBe(59400);
    });

    it('zero when discount exceeds total (clamped, never negative)', () => {
        expect(previewTotalCents({
            siteFeeCents: 1000, discountCents: 5000, taxCents: 0,
        })).toBe(0);
    });

    it('handles missing addons', () => {
        expect(previewTotalCents({ siteFeeCents: 1000 })).toBe(1000);
    });

    it('handles undefined state', () => {
        expect(previewTotalCents(undefined)).toBe(0);
    });
});

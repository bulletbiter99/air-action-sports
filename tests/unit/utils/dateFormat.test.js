// Tests for the shared date/label helpers (src/utils/dateFormat.js).
//
// Extracted in the post-M7 11c polish from OwnerReports (MONTHS/monthLabel/
// dayLabel) and SiteCoordinatorReports (fmtDate). These lock the exact format
// strings the Reports charts/tables relied on so the extraction is provably
// behavior-preserving.

import { describe, it, expect } from 'vitest';
import { MONTHS, monthLabel, dayLabel, fmtDate } from '../../../src/utils/dateFormat.js';

describe('MONTHS', () => {
    it('is the 12 three-letter month abbreviations', () => {
        expect(MONTHS).toHaveLength(12);
        expect(MONTHS[0]).toBe('Jan');
        expect(MONTHS[4]).toBe('May');
        expect(MONTHS[11]).toBe('Dec');
    });
});

describe('monthLabel (YYYY-MM → "Mon \'YY")', () => {
    it('formats a normal year-month', () => {
        expect(monthLabel('2026-05')).toBe("May '26");
        expect(monthLabel('2026-01')).toBe("Jan '26");
        expect(monthLabel('2026-12')).toBe("Dec '26");
    });

    it('returns empty string for falsy input', () => {
        expect(monthLabel('')).toBe('');
        expect(monthLabel(null)).toBe('');
        expect(monthLabel(undefined)).toBe('');
    });

    it('echoes the input when it has no month part', () => {
        expect(monthLabel('2026')).toBe('2026');
    });

    it('falls back to the raw month number when out of range', () => {
        expect(monthLabel('2026-13')).toBe("13 '26");
    });
});

describe('dayLabel (YYYY-MM-DD → "M/D")', () => {
    it('strips leading zeros from month and day', () => {
        expect(dayLabel('2026-05-31')).toBe('5/31');
        expect(dayLabel('2026-01-09')).toBe('1/9');
        expect(dayLabel('2026-12-25')).toBe('12/25');
    });

    it('returns empty string for falsy input', () => {
        expect(dayLabel('')).toBe('');
        expect(dayLabel(null)).toBe('');
        expect(dayLabel(undefined)).toBe('');
    });

    it('echoes the input when there is no day part', () => {
        expect(dayLabel('2026-05')).toBe('2026-05');
    });
});

describe('fmtDate (epoch ms → ISO date)', () => {
    it('formats a millisecond timestamp as YYYY-MM-DD (UTC)', () => {
        expect(fmtDate(Date.UTC(2026, 4, 31))).toBe('2026-05-31');
        expect(fmtDate(Date.UTC(2026, 0, 1))).toBe('2026-01-01');
    });

    it('treats 0 as a real timestamp (the epoch), not "missing"', () => {
        expect(fmtDate(0)).toBe('1970-01-01');
    });

    it('returns empty string for null/undefined/NaN/garbage', () => {
        expect(fmtDate(null)).toBe('');
        expect(fmtDate(undefined)).toBe('');
        expect(fmtDate(NaN)).toBe('');
        expect(fmtDate('not a number')).toBe('');
    });
});

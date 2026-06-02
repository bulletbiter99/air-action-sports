// M8 Batch C-PR-2 — pure helpers in src/admin/reports/reportData.js.
//
// These are plain functions (query-string building, error-message mapping,
// Content-Disposition parsing) — no DOM, so this runs in the default node env
// (no jsdom pragma). reportData.js imports only React, so it's node-importable;
// we exercise only its pure exports (not the useReportData hook / CSV download).

import { describe, it, expect } from 'vitest';
import {
    buildReportQuery,
    reportErrorMessage,
    filenameFromDisposition,
} from '../../../../src/admin/reports/reportData.js';

describe('buildReportQuery', () => {
    it('returns an empty string for empty / null filters', () => {
        expect(buildReportQuery({})).toBe('');
        expect(buildReportQuery(null)).toBe('');
    });

    it('serializes the period', () => {
        expect(buildReportQuery({ period: 'mtd' })).toBe('?period=mtd');
    });

    it('serializes comparison only when truthy', () => {
        expect(buildReportQuery({ period: 'mtd', comparison: true })).toBe('?period=mtd&comparison=1');
        expect(buildReportQuery({ period: 'mtd', comparison: false })).toBe('?period=mtd');
    });

    it('serializes event_id only when it is not "all"', () => {
        expect(buildReportQuery({ eventId: 'evt_1' })).toBe('?event_id=evt_1');
        expect(buildReportQuery({ eventId: 'all' })).toBe('');
    });

    it('includes custom from/to only for period=custom with both bounds present', () => {
        expect(buildReportQuery({ period: 'custom', from: '2026-01-01', to: '2026-01-31' }))
            .toBe('?period=custom&from=2026-01-01&to=2026-01-31');
        expect(buildReportQuery({ period: 'custom', from: '2026-01-01' })).toBe('?period=custom');
    });

    it('appends format=csv when csv is true', () => {
        expect(buildReportQuery({ period: 'mtd' }, true)).toBe('?period=mtd&format=csv');
    });
});

describe('reportErrorMessage', () => {
    it('maps 401 / 403 to a permission message', () => {
        expect(reportErrorMessage(new Error('HTTP 403'))).toMatch(/permission/i);
        expect(reportErrorMessage(new Error('HTTP 401'))).toMatch(/permission/i);
    });

    it('maps 404 to an unavailable message', () => {
        expect(reportErrorMessage(new Error('HTTP 404'))).toMatch(/unavailable/i);
    });

    it('maps 5xx to a generic retry message', () => {
        expect(reportErrorMessage(new Error('HTTP 500'))).toMatch(/something went wrong/i);
    });

    it('falls back to a connection message when there is no HTTP status', () => {
        expect(reportErrorMessage(new Error('Failed to fetch'))).toMatch(/connection/i);
    });

    it('never surfaces the raw error message', () => {
        expect(reportErrorMessage(new Error('HTTP 500'))).not.toMatch(/HTTP 500/);
    });
});

describe('filenameFromDisposition', () => {
    it('returns an empty string when the header is absent', () => {
        expect(filenameFromDisposition(null)).toBe('');
        expect(filenameFromDisposition('')).toBe('');
    });

    it('parses the RFC 5987 extended form (percent-decoded)', () => {
        expect(filenameFromDisposition("attachment; filename*=UTF-8''revenue%20report.csv"))
            .toBe('revenue report.csv');
    });

    it('parses the plain quoted filename form', () => {
        expect(filenameFromDisposition('attachment; filename="payouts.csv"')).toBe('payouts.csv');
    });
});

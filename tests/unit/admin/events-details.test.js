// M8 item-6a — normalizeEventDetails sanitizer for events.details_json.
//
// The admin event form (6b) will send a `details` object that renders into the
// public event page. This sanitizer coerces each field to its shape, drops
// empties (blank in admin → absent → public hides the section / uses fallback),
// and rejects non-http(s)/relative URLs (no javascript:/data: injection).

import { describe, it, expect } from 'vitest';
import { normalizeEventDetails } from '../../../worker/routes/admin/events.js';

describe('normalizeEventDetails', () => {
    it('returns null for non-objects', () => {
        expect(normalizeEventDetails(null)).toBeNull();
        expect(normalizeEventDetails(undefined)).toBeNull();
        expect(normalizeEventDetails('x')).toBeNull();
        expect(normalizeEventDetails(42)).toBeNull();
        expect(normalizeEventDetails([1, 2])).toBeNull();
    });

    it('returns null when every field is blank/empty (clears details_json)', () => {
        expect(normalizeEventDetails({})).toBeNull();
        expect(normalizeEventDetails({
            missionBriefing: ['', '   '],
            rules: [],
            schedule: [{ time: '', label: '' }],
            documents: [{ label: '' }],
            terrain: '   ',
            fpsLabel: '',
            factionLinks: {},
        })).toBeNull();
    });

    it('keeps non-empty paragraph/line arrays and filters blanks', () => {
        const out = normalizeEventDetails({
            missionBriefing: ['Para one.', '', '  Para two.  '],
            rules: ['No blind fire', ''],
        });
        expect(out.missionBriefing).toEqual(['Para one.', 'Para two.']);
        expect(out.rules).toEqual(['No blind fire']);
    });

    it('keeps schedule rows with a time or label and drops empty rows', () => {
        const out = normalizeEventDetails({
            schedule: [
                { time: '7:00 AM', label: 'Check-in' },
                { time: '', label: '' },
                { time: '8:00 AM', label: '' },
            ],
            scheduleNote: 'Times approximate',
        });
        expect(out.schedule).toEqual([
            { time: '7:00 AM', label: 'Check-in' },
            { time: '8:00 AM', label: '' },
        ]);
        expect(out.scheduleNote).toBe('Times approximate');
    });

    it('preserves a valid day (1..31) on schedule rows; drops invalid/out-of-range day', () => {
        const out = normalizeEventDetails({
            schedule: [
                { day: 1, time: '7:00 AM', label: 'Check-in' },
                { day: 2, time: '6:00 AM', label: 'Dawn push' },
                { day: 0, time: '9:00 AM', label: 'Zero day' },
                { day: 99, time: '9:00 AM', label: 'Too big' },
                { day: 'x', time: '9:00 AM', label: 'NaN day' },
            ],
        });
        expect(out.schedule).toEqual([
            { day: 1, time: '7:00 AM', label: 'Check-in' },
            { day: 2, time: '6:00 AM', label: 'Dawn push' },
            { time: '9:00 AM', label: 'Zero day' },
            { time: '9:00 AM', label: 'Too big' },
            { time: '9:00 AM', label: 'NaN day' },
        ]);
    });

    it('requires a label on documents and sanitizes the url', () => {
        const out = normalizeEventDetails({
            documents: [
                { label: 'Waiver', url: 'https://forms.example/waiver', note: 'sign first' },
                { label: 'Map', url: '/uploads/map.pdf' },
                { label: 'Bad link', url: 'javascript:alert(1)' },
                { label: '', url: 'https://x.example' },
            ],
        });
        expect(out.documents).toEqual([
            { label: 'Waiver', url: 'https://forms.example/waiver', note: 'sign first' },
            { label: 'Map', url: '/uploads/map.pdf' },
            { label: 'Bad link' }, // url dropped (javascript:), label kept
        ]);
    });

    it('sanitizes factionLinks and drops bad/empty entries', () => {
        const out = normalizeEventDetails({
            factionLinks: {
                Kraken: 'https://forms.example/kraken',
                Bolotnik: 'javascript:evil()',
                '': 'https://x.example',
                Empty: '',
            },
        });
        expect(out.factionLinks).toEqual({ Kraken: 'https://forms.example/kraken' });
    });

    it('rejects javascript:/data: URLs on collabBannerUrl, accepts http(s)/relative', () => {
        expect(normalizeEventDetails({ collabBannerUrl: 'javascript:x' })).toBeNull();
        expect(normalizeEventDetails({ collabBannerUrl: 'data:image/png;base64,AAA' })).toBeNull();
        expect(normalizeEventDetails({ collabBannerUrl: 'https://cdn.example/b.png' }).collabBannerUrl)
            .toBe('https://cdn.example/b.png');
        expect(normalizeEventDetails({ collabBannerUrl: '/uploads/banner.png' }).collabBannerUrl)
            .toBe('/uploads/banner.png');
    });

    it('trims scalar string fields', () => {
        const out = normalizeEventDetails({
            terrain: '  Dense jungle  ',
            firstGameLabel: 'Squad TDM',
            fpsLabel: '350 / 450',
        });
        expect(out).toEqual({ terrain: 'Dense jungle', firstGameLabel: 'Squad TDM', fpsLabel: '350 / 450' });
    });

    it('stores per-surface title placement (below/hidden); drops overlay/invalid', () => {
        expect(normalizeEventDetails({ heroTextPlacement: 'below', bannerTextPlacement: 'hidden' }))
            .toEqual({ heroTextPlacement: 'below', bannerTextPlacement: 'hidden' });
        // 'overlay' is the default → not stored
        expect(normalizeEventDetails({ heroTextPlacement: 'overlay', bannerTextPlacement: 'overlay' })).toBeNull();
        // unknown value → not stored
        expect(normalizeEventDetails({ heroTextPlacement: 'sideways' })).toBeNull();
    });

    it('falls back to legacy coverTextBelow → below only when a surface field is omitted', () => {
        // A stale (pre-per-surface) admin tab posts only coverTextBelow → both 'below'.
        expect(normalizeEventDetails({ coverTextBelow: true }))
            .toEqual({ heroTextPlacement: 'below', bannerTextPlacement: 'below' });
        // An explicit per-surface value (even 'overlay') wins over the legacy flag.
        expect(normalizeEventDetails({ heroTextPlacement: 'overlay', coverTextBelow: true }))
            .toEqual({ bannerTextPlacement: 'below' });
        expect(normalizeEventDetails({ coverTextBelow: false })).toBeNull();
    });
});

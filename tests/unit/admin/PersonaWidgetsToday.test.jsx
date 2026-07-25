// @vitest-environment jsdom

// TodayEvents + TodayCheckIns span-aware "today" filtering (2026-07).
//
// Multi-day events (migration 0076, events.end_date_iso) must count as
// "today" on EVERY day of their span — the old filter compared only the
// start date, so an overnight op's second morning showed "No events today".
// The useWidgetData module is mocked (vi.hoisted) so the widgets render
// from fixtures; fixture dates are DERIVED from now (never hardcoded —
// see the 2026-06-11 sales-series calendar-time-bomb lesson) and use
// timed local strings ("T10:00:00") so new Date() parses them in local
// time exactly like production dateIso values.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithRouter, screen } from '../../helpers/renderComponent.jsx';

const mockUseWidgetData = vi.hoisted(() => vi.fn());
const mockUseTodayActive = vi.hoisted(() => vi.fn());
vi.mock('../../../src/hooks/useWidgetData.js', () => ({
    useWidgetData: mockUseWidgetData,
    useTodayActive: mockUseTodayActive,
}));

import { TodayEvents, TodayCheckIns, isEventOnDay } from '../../../src/admin/widgets/PersonaWidgets.jsx';

function ymdLocal(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function daysFromNow(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
}

const TODAY = ymdLocal(daysFromNow(0));
const YESTERDAY = ymdLocal(daysFromNow(-1));
const TOMORROW = ymdLocal(daysFromNow(1));
const NEXT_WEEK = ymdLocal(daysFromNow(7));

const FIXTURE_EVENTS = {
    events: [
        {
            id: 'evt_single_today',
            title: 'Single-Day Op Today',
            dateIso: `${TODAY}T08:30:00`,
            endDateIso: null,
            location: 'Ghost Town',
            timeRange: '8:30 AM – 5:00 PM',
        },
        {
            id: 'evt_overnight_running',
            title: 'Overnight Op Mid-Span',
            dateIso: `${YESTERDAY}T19:45:00`,
            endDateIso: `${TOMORROW}T12:00:00`,
            location: 'Ghost Town',
            timeRange: '7:45 PM – 12:00 PM',
        },
        {
            id: 'evt_next_week',
            title: 'Future Op',
            dateIso: `${NEXT_WEEK}T09:00:00`,
            endDateIso: null,
            location: 'Foxtrot',
            timeRange: '9:00 AM – 4:00 PM',
        },
    ],
};

beforeEach(() => {
    mockUseWidgetData.mockReset();
    mockUseTodayActive.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('isEventOnDay', () => {
    it('matches the start day of a single-day event and nothing else', () => {
        const e = { dateIso: '2026-07-25T08:30:00', endDateIso: null };
        expect(isEventOnDay(e, '2026-07-25')).toBe(true);
        expect(isEventOnDay(e, '2026-07-24')).toBe(false);
        expect(isEventOnDay(e, '2026-07-26')).toBe(false);
    });

    it('matches every day of a multi-day span, inclusive of both ends', () => {
        const e = { dateIso: '2026-07-25T19:45:00', endDateIso: '2026-07-26T12:00:00' };
        expect(isEventOnDay(e, '2026-07-25')).toBe(true);
        expect(isEventOnDay(e, '2026-07-26')).toBe(true);
        expect(isEventOnDay(e, '2026-07-24')).toBe(false);
        expect(isEventOnDay(e, '2026-07-27')).toBe(false);
    });

    it('is false for missing dateIso or today', () => {
        expect(isEventOnDay({ dateIso: null }, '2026-07-25')).toBe(false);
        expect(isEventOnDay(undefined, '2026-07-25')).toBe(false);
        expect(isEventOnDay({ dateIso: '2026-07-25T08:00:00' }, null)).toBe(false);
    });
});

describe('TodayEvents', () => {
    it('shows single-day-today AND mid-span multi-day events, hides future ones', () => {
        mockUseWidgetData.mockReturnValue({ data: FIXTURE_EVENTS, error: null });
        renderWithRouter(<TodayEvents />);
        expect(screen.getByText('Single-Day Op Today')).toBeInTheDocument();
        expect(screen.getByText('Overnight Op Mid-Span')).toBeInTheDocument();
        expect(screen.queryByText('Future Op')).not.toBeInTheDocument();
    });

    it('deep-links Scan (and Roster) to each event', () => {
        mockUseWidgetData.mockReturnValue({ data: FIXTURE_EVENTS, error: null });
        renderWithRouter(<TodayEvents />);
        const scanLinks = screen.getAllByRole('link', { name: 'Scan' });
        expect(scanLinks.map((l) => l.getAttribute('href'))).toEqual([
            '/admin/scan?event=evt_single_today',
            '/admin/scan?event=evt_overnight_running',
        ]);
        const rosterLinks = screen.getAllByRole('link', { name: 'Roster' });
        expect(rosterLinks.map((l) => l.getAttribute('href'))).toEqual([
            '/admin/roster?event=evt_single_today',
            '/admin/roster?event=evt_overnight_running',
        ]);
    });

    it('shows the empty state when no event span contains today', () => {
        mockUseWidgetData.mockReturnValue({
            data: { events: [FIXTURE_EVENTS.events[2]] },
            error: null,
        });
        renderWithRouter(<TodayEvents />);
        expect(screen.getByText('No events today.')).toBeInTheDocument();
    });
});

describe('TodayCheckIns', () => {
    it('lists a mid-span multi-day event on its second day', () => {
        mockUseTodayActive.mockReturnValue({ activeEventToday: true, eventId: null });
        mockUseWidgetData.mockImplementation((url) => {
            if (url.includes('analytics/overview')) {
                return { data: { totals: { checkedIn: 12, attendees: 40 } }, error: null };
            }
            return { data: FIXTURE_EVENTS, error: null };
        });
        renderWithRouter(<TodayCheckIns />);
        expect(screen.getByText('Overnight Op Mid-Span')).toBeInTheDocument();
        expect(screen.getByText('Single-Day Op Today')).toBeInTheDocument();
        expect(screen.queryByText('Future Op')).not.toBeInTheDocument();
        expect(screen.getByText('12 / 40')).toBeInTheDocument();
    });
});

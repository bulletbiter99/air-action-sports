// @vitest-environment jsdom

// CronHealth widget ↔ /api/admin/analytics/cron-status contract (audit A4).
//
// The widget read `lastSweepAgeMs`, `last24hReminders24hCount` and
// `last24hReminders1hCount`; the endpoint returns `lastSweepAt` (an ABSOLUTE
// epoch, not an age) and a nested `reminders24h: { sent24hr, sent1hr }`. Those
// three names appear nowhere else in the repo, so the widget never worked: the
// age was always undefined, which made `stale` unconditionally true, and both
// counters rendered 0. Neither side had a test.
//
// These fixtures are shaped exactly like the endpoint's `c.json({...})` in
// worker/routes/admin/analytics.js — the sibling route test asserts the worker
// really emits that shape, so the two together pin both ends.
//
// Ages are derived from now (never hardcoded — see the 2026-06-11 sales-series
// calendar-time-bomb lesson).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithRouter, screen } from '../../helpers/renderComponent.jsx';

const mockUseWidgetData = vi.hoisted(() => vi.fn());
const mockUseTodayActive = vi.hoisted(() => vi.fn());
vi.mock('../../../src/hooks/useWidgetData.js', () => ({
    useWidgetData: mockUseWidgetData,
    useTodayActive: mockUseTodayActive,
}));

import { CronHealth } from '../../../src/admin/widgets/PersonaWidgets.jsx';

const MINUTE = 60 * 1000;

/** The endpoint's response shape, with the sweep N minutes ago. */
function cronStatus({ minutesAgo, sent24hr = 0, sent1hr = 0 } = {}) {
    return {
        lastSweepAt: minutesAgo == null ? null : Date.now() - minutesAgo * MINUTE,
        lastSweepMeta: null,
        reminders24h: { sent24hr, sent1hr },
    };
}

beforeEach(() => {
    mockUseWidgetData.mockReset();
    mockUseTodayActive.mockReset();
    mockUseTodayActive.mockReturnValue({ data: null });
});

describe('CronHealth', () => {
    it('reports OK for a recent sweep and renders its age', () => {
        mockUseWidgetData.mockReturnValue({ data: cronStatus({ minutesAgo: 12 }), error: null });
        const { container } = renderWithRouter(<CronHealth />);

        expect(screen.getByText('OK')).toBeInTheDocument();
        expect(screen.getByText(/last sweep 12m ago/)).toBeInTheDocument();
        expect(container.querySelector('.admin-persona-widget--cron-fresh')).toBeTruthy();
    });

    it('reports STALE once the sweep is older than an hour', () => {
        mockUseWidgetData.mockReturnValue({ data: cronStatus({ minutesAgo: 90 }), error: null });
        const { container } = renderWithRouter(<CronHealth />);

        expect(screen.getByText('STALE')).toBeInTheDocument();
        expect(container.querySelector('.admin-persona-widget--cron-stale')).toBeTruthy();
    });

    it('renders both reminder counters from the nested reminders24h object', () => {
        mockUseWidgetData.mockReturnValue({
            data: cronStatus({ minutesAgo: 5, sent24hr: 7, sent1hr: 3 }),
            error: null,
        });
        renderWithRouter(<CronHealth />);

        expect(screen.getByText(/24h reminders sent: 7/)).toBeInTheDocument();
        expect(screen.getByText(/1h reminders: 3/)).toBeInTheDocument();
    });

    it('reports STALE with an unknown age when no sweep has ever run', () => {
        // lastSweepAt is null when audit_log has no cron.swept row yet.
        mockUseWidgetData.mockReturnValue({ data: cronStatus({ minutesAgo: null }), error: null });
        renderWithRouter(<CronHealth />);

        expect(screen.getByText('STALE')).toBeInTheDocument();
        expect(screen.getByText(/last sweep unknown ago/)).toBeInTheDocument();
    });

    it('does not depend on the legacy field names that never existed', () => {
        // A payload carrying ONLY the old names must NOT read as healthy —
        // this is the regression that shipped.
        mockUseWidgetData.mockReturnValue({
            data: {
                lastSweepAgeMs: 5 * MINUTE,
                last24hReminders24hCount: 9,
                last24hReminders1hCount: 4,
            },
            error: null,
        });
        renderWithRouter(<CronHealth />);

        expect(screen.getByText('STALE')).toBeInTheDocument();
        expect(screen.queryByText(/24h reminders sent: 9/)).not.toBeInTheDocument();
    });

    it('surfaces a fetch error', () => {
        mockUseWidgetData.mockReturnValue({ data: null, error: 'boom' });
        const { container } = renderWithRouter(<CronHealth />);

        expect(screen.getByText(/Error: boom/)).toBeInTheDocument();
        expect(container.querySelector('.admin-persona-widget--cron-error')).toBeTruthy();
    });
});

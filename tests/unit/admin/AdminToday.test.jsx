// @vitest-environment jsdom

// Render test for AdminToday (the event-day quick-actions page). It's thin glue
// over the useTodayActive() shared subscription with three render states; we
// mock that hook (via vi.hoisted) to drive each state. Design sweep (batch 4a):
// all three states now render the shared AdminPageHeader.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderWithRouter, screen } from '../../helpers/renderComponent.jsx';

const mockUseTodayActive = vi.hoisted(() => vi.fn());
vi.mock('../../../src/hooks/useWidgetData.js', () => ({ useTodayActive: mockUseTodayActive }));

import AdminToday from '../../../src/admin/AdminToday.jsx';

beforeEach(() => mockUseTodayActive.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('AdminToday', () => {
    it('shows a loading state before the subscription resolves', () => {
        mockUseTodayActive.mockReturnValue(undefined);
        renderWithRouter(<AdminToday />);
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('shows the no-event state under the Today header', () => {
        mockUseTodayActive.mockReturnValue({ activeEventToday: false });
        renderWithRouter(<AdminToday />);
        expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'No event today' })).toBeInTheDocument();
    });

    it('shows the active-event state with deep-linked action tiles', () => {
        mockUseTodayActive.mockReturnValue({
            activeEventToday: true,
            eventId: 'evt_1',
            events: [{ id: 'evt_1', title: 'Operation Last Light' }],
        });
        renderWithRouter(<AdminToday />);
        expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Roster/ })).toHaveAttribute('href', '/admin/roster?event=evt_1');
        expect(screen.getByRole('link', { name: /Check in/ })).toHaveAttribute('href', '/admin/scan?event=evt_1');
        expect(screen.getByRole('link', { name: /New Booking/ })).toHaveAttribute('href', '/admin/new-booking?event=evt_1');
        // Single event → title in the header description, no per-group heading.
        expect(screen.getByText(/Operation Last Light/)).toBeInTheDocument();
    });

    it('renders one tile group per event on a two-event day, each deep-linked to its own event', () => {
        mockUseTodayActive.mockReturnValue({
            activeEventToday: true,
            eventId: null,
            events: [
                { id: 'evt_ll', title: 'Operation Last Light' },
                { id: 'evt_fs', title: 'Operation Fire Storm' },
            ],
        });
        renderWithRouter(<AdminToday />);
        expect(screen.getByRole('heading', { name: 'Operation Last Light' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Operation Fire Storm' })).toBeInTheDocument();
        const rosterLinks = screen.getAllByRole('link', { name: /Roster/ });
        expect(rosterLinks.map((l) => l.getAttribute('href'))).toEqual([
            '/admin/roster?event=evt_ll',
            '/admin/roster?event=evt_fs',
        ]);
        const scanLinks = screen.getAllByRole('link', { name: /Check in/ });
        expect(scanLinks.map((l) => l.getAttribute('href'))).toEqual([
            '/admin/scan?event=evt_ll',
            '/admin/scan?event=evt_fs',
        ]);
        const bookingLinks = screen.getAllByRole('link', { name: /New Booking/ });
        expect(bookingLinks.map((l) => l.getAttribute('href'))).toEqual([
            '/admin/new-booking?event=evt_ll',
            '/admin/new-booking?event=evt_fs',
        ]);
    });

    it('still deep-links from an eventId-only payload (stale pre-events cache shape)', () => {
        mockUseTodayActive.mockReturnValue({ activeEventToday: true, eventId: 'evt_1' });
        renderWithRouter(<AdminToday />);
        expect(screen.getByRole('link', { name: /Check in/ })).toHaveAttribute('href', '/admin/scan?event=evt_1');
    });

    it('falls back to the pick-an-event card when active but no event info at all', () => {
        mockUseTodayActive.mockReturnValue({ activeEventToday: true, eventId: null });
        renderWithRouter(<AdminToday />);
        expect(screen.getByRole('heading', { name: 'Multiple events scheduled today' })).toBeInTheDocument();
    });
});

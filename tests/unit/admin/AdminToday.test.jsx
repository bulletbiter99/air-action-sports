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
        mockUseTodayActive.mockReturnValue({ activeEventToday: true, eventId: 'evt_1' });
        renderWithRouter(<AdminToday />);
        expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Roster/ })).toHaveAttribute('href', '/admin/roster?event=evt_1');
        expect(screen.getByRole('link', { name: /Check in/ })).toHaveAttribute('href', '/admin/scan?event=evt_1');
    });
});

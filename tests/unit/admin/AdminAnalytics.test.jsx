// @vitest-environment jsdom

// Render test for AdminAnalytics. Consumes useAdmin() + useNavigate and fetches
// overview / sales-series / per-event on mount, so it renders via renderWithAdmin.
// Design sweep (batch 4a): the bespoke header was swapped for AdminPageHeader,
// with the event + date-range filters moved into its secondaryActions slot.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithAdmin, screen } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminAnalytics from '../../../src/admin/AdminAnalytics.jsx';

function mockAnalytics() {
    return installClientFetch([
        { match: '/api/admin/analytics/overview', body: { totals: { grossCents: 0, bookings: 0 } } },
        { match: '/api/admin/analytics/sales-series', body: { series: [] } },
        { match: '/api/admin/analytics/per-event', body: { events: [] } },
    ]);
}

afterEach(() => vi.restoreAllMocks());

describe('AdminAnalytics', () => {
    it('renders the Analytics header + the filter controls (in secondaryActions)', () => {
        mockAnalytics();
        renderWithAdmin(<AdminAnalytics />);
        expect(screen.getByRole('heading', { name: 'Analytics' })).toBeInTheDocument();
        expect(screen.getByLabelText('Event')).toBeInTheDocument();
        expect(screen.getByLabelText('Date range')).toBeInTheDocument();
    });
});

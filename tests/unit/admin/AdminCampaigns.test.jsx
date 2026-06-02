// @vitest-environment jsdom

// M8 Batch C — RTL component tests for AdminCampaigns (native Marketing B3 list
// page). First use of the page-test pattern: a bare render() + a mocked client
// fetch (installClientFetch). AdminCampaigns imports only React hooks — no
// router, no context, no child components — so it needs no providers.
//
// Dates are deliberately NOT asserted: the page renders formatRelative(), whose
// >30-day branch is locale-dependent (toLocaleDateString). We assert the rows +
// key fields instead.

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminCampaigns from '../../../src/admin/AdminCampaigns.jsx';

const CAMPAIGNS = [
    { id: 'c1', name: 'Spring re-engage', subject: 'Come back', status: 'sent', recipientCount: 2400, sentCount: 2398, failedCount: 2, updatedAt: 1_767_225_600_000 },
    { id: 'c2', name: 'Summer launch', subject: 'Season opens', status: 'scheduled', recipientCount: 1200, sentCount: 0, failedCount: 0, updatedAt: 1_767_225_600_000 },
];

describe('AdminCampaigns', () => {
    it('shows a loading state while the request is in flight', () => {
        // A never-resolving fetch keeps loading=true deterministically (no act-timing race).
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        render(<AdminCampaigns />);
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('renders the campaigns table with statuses + send metrics', async () => {
        installClientFetch([{ match: '/api/admin/campaigns', body: { campaigns: CAMPAIGNS } }]);
        render(<AdminCampaigns />);
        await waitFor(() => expect(screen.getByText('Spring re-engage')).toBeInTheDocument());
        expect(screen.getByText('Summer launch')).toBeInTheDocument();
        // StatusBadge renders the raw status (lowercase) — distinct from the
        // capitalized "Sent"/"Scheduled" filter chips.
        expect(screen.getByText('sent')).toBeInTheDocument();
        expect(screen.getByText('scheduled')).toBeInTheDocument();
        // failedCount suffix on the Sent cell
        expect(screen.getByText(/2 failed/)).toBeInTheDocument();
    });

    it('renders the empty state when there are no campaigns', async () => {
        installClientFetch([{ match: '/api/admin/campaigns', body: { campaigns: [] } }]);
        render(<AdminCampaigns />);
        await waitFor(() => expect(screen.getByText(/No campaigns.*yet\./)).toBeInTheDocument());
    });

    it('surfaces a fetch error', async () => {
        installClientFetch([{ match: '/api/admin/campaigns', status: 500, body: { error: 'boom' } }]);
        render(<AdminCampaigns />);
        await waitFor(() => expect(screen.getByText(/^Error:/)).toBeInTheDocument());
    });

    it('re-fetches with a status filter when a chip is clicked', async () => {
        const fetchMock = installClientFetch([{ match: '/api/admin/campaigns', body: { campaigns: CAMPAIGNS } }]);
        const user = userEvent.setup();
        render(<AdminCampaigns />);
        await waitFor(() => expect(screen.getByText('Spring re-engage')).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Draft' }));
        await waitFor(() => {
            const urls = fetchMock.mock.calls.map((args) => String(args[0]));
            expect(urls.some((u) => u.includes('status=draft'))).toBe(true);
        });
    });
});

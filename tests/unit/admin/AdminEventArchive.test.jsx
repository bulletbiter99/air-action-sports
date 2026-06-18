// @vitest-environment jsdom

// Render test for AdminEventArchive. Consumes useAdmin() and fetches
// /api/admin/event-archive on mount, so it renders via renderWithAdmin.
//
// Design-consistency sweep (batch 3): the bespoke <h1>/<p> header was swapped
// for the shared AdminPageHeader; the description keeps an inline link to the
// public /games page (passed to AdminPageHeader as a JSX node).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithAdmin, screen, waitFor } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminEventArchive from '../../../src/admin/AdminEventArchive.jsx';

afterEach(() => vi.restoreAllMocks());

describe('AdminEventArchive', () => {
    it('shows the Event Archive header + a loading state while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderWithAdmin(<AdminEventArchive />);
        expect(screen.getByRole('heading', { name: 'Event Archive' })).toBeInTheDocument();
        // the header description links to the public /games page
        expect(screen.getByRole('link', { name: '/games' })).toHaveAttribute('href', '/games');
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('renders the empty state when there are no archived events', async () => {
        installClientFetch([{ match: '/api/admin/event-archive', body: { events: [] } }]);
        renderWithAdmin(<AdminEventArchive />);
        expect(screen.getByRole('heading', { name: 'Event Archive' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText(/No past events yet/)).toBeInTheDocument());
    });
});

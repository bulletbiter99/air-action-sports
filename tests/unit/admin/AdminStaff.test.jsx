// @vitest-environment jsdom

// M8 item-1 backfill (batch A5) — RTL tests for AdminStaff (the directory list).
// Consumes useAdmin() (manager-gated + Add Staff) + FilterBar (fires
// /api/admin/saved-views), so it renders via renderWithAdmin. On mount it loads
// /api/admin/staff -> { persons, total, viewerCanSeePii }. PII columns render a
// "(masked)" hint when viewerCanSeePii is false. Dates aren't asserted.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithAdmin, screen, waitFor, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminStaff from '../../../src/admin/AdminStaff.jsx';

const SAVED_VIEWS = { match: '/api/admin/saved-views', body: { views: [] } };

const PERSONS = [
    { id: 'per_1', fullName: 'Paul Keddington', preferredName: 'Paul', email: 'paul@example.com', phone: '555-1000', status: 'active', archivedAt: null, createdAt: 1_767_225_600_000 },
    { id: 'per_2', fullName: 'Rebecca Stone', preferredName: 'Becca', email: 'becca@example.com', phone: '555-2000', status: 'onboarding', archivedAt: null, createdAt: 1_767_225_600_000 },
];

function mockStaff({ persons = PERSONS, total = 2, viewerCanSeePii = true } = {}) {
    return installClientFetch([
        SAVED_VIEWS,
        { match: '/api/admin/staff', body: { persons, total, viewerCanSeePii } },
    ]);
}

afterEach(() => vi.restoreAllMocks());

describe('AdminStaff', () => {
    it('shows a loading row while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderWithAdmin(<AdminStaff />);
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('renders the staff table with the manager CTA', async () => {
        mockStaff();
        renderWithAdmin(<AdminStaff />);
        expect(screen.getByRole('heading', { name: 'Staff' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '+ Add Staff' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('Paul Keddington')).toBeInTheDocument());
        expect(screen.getByText('becca@example.com')).toBeInTheDocument();
        // name links to the detail route
        expect(screen.getAllByRole('link', { name: 'View' })[0]).toHaveAttribute('href', '/admin/staff/per_1');
    });

    it('shows the (masked) hint when PII is gated', async () => {
        mockStaff({ viewerCanSeePii: false });
        renderWithAdmin(<AdminStaff />);
        await waitFor(() => expect(screen.getByText('Paul Keddington')).toBeInTheDocument());
        expect(screen.getAllByText('(masked)').length).toBeGreaterThan(0);
    });

    it('renders the empty state when no staff match', async () => {
        mockStaff({ persons: [], total: 0 });
        renderWithAdmin(<AdminStaff />);
        await waitFor(() => expect(screen.getByText('No staff match the current filter.')).toBeInTheDocument());
    });

    it('hides + Add Staff for non-managers', async () => {
        mockStaff();
        renderWithAdmin(<AdminStaff />, { admin: { hasRole: () => false } });
        await waitFor(() => expect(screen.getByText('Paul Keddington')).toBeInTheDocument());
        expect(screen.queryByRole('link', { name: '+ Add Staff' })).not.toBeInTheDocument();
    });

    it('paginates and re-fetches with the next offset', async () => {
        const fetchMock = mockStaff({ total: 120 });
        const user = userEvent.setup();
        renderWithAdmin(<AdminStaff />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Next →' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Next →' }));
        await waitFor(() => {
            const hit = fetchMock.mock.calls.some((args) => String(args[0]).includes('offset=50'));
            expect(hit).toBe(true);
        });
    });
});

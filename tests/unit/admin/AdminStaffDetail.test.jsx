// @vitest-environment jsdom

// M8 item-1 backfill (batch A5) — RTL tests for AdminStaffDetail (8-tab page).
// Consumes useParams + useAdmin(), so it renders through a <Routes>/<Route> via
// renderWithAdmin. load() fetches /api/admin/staff/:id (404 -> navigate). The
// Profile/Roles/Notes tabs render from the loaded payload; Documents/Access/
// Issues/Certifications/Schedule lazily fetch their endpoint on tab switch — so
// the tab-switch test clicks a tab and asserts its fetch fired. Mock order lists
// the tab's /incidents endpoint before the /:id detail match (first-hit-wins).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { renderWithAdmin, screen, waitFor, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminStaffDetail from '../../../src/admin/AdminStaffDetail.jsx';

const DATA = {
    person: {
        id: 'per_1', fullName: 'Paul Keddington', preferredName: 'Paul', pronouns: 'he/him',
        email: 'paul@example.com', phone: '555-1000', status: 'active', archivedAt: null,
        viewerCanSeePii: true, createdAt: 1_767_225_600_000,
    },
    roles: [{ id: 'role_1', name: 'Event Director', tier: 1, isPrimary: true }],
};

function mockDetail({ data = DATA, extra = [] } = {}) {
    return installClientFetch([
        ...extra,
        { match: '/api/admin/staff/per_1', body: data },
    ]);
}

function renderDetail(opts = {}) {
    return renderWithAdmin(
        <Routes>
            <Route path="/admin/staff/:id" element={<AdminStaffDetail />} />
        </Routes>,
        { route: '/admin/staff/per_1', ...opts },
    );
}

afterEach(() => vi.restoreAllMocks());

describe('AdminStaffDetail', () => {
    it('shows a loading state while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderDetail();
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('renders the profile tab + the 8-tab nav after load', async () => {
        mockDetail();
        renderDetail();
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Paul Keddington' })).toBeInTheDocument());
        expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
        expect(screen.getByText('Full name')).toBeInTheDocument();
        // all 8 tab buttons render
        for (const label of ['Profile', 'Roles', 'Documents', 'Notes', 'Access', 'Issues', 'Certifications', 'Schedule']) {
            expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
        }
    });

    it('lazily fetches a tab endpoint when its tab is opened', async () => {
        const fetchMock = mockDetail({ extra: [{ match: '/incidents', body: { incidents: [] } }] });
        const user = userEvent.setup();
        renderDetail();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Issues' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Issues' }));
        await waitFor(() => {
            const hit = fetchMock.mock.calls.some((args) => String(args[0]).includes('/incidents'));
            expect(hit).toBe(true);
        });
    });

    it('shows Edit profile to managers but not below', async () => {
        mockDetail();
        const { unmount } = renderDetail({ admin: { hasRole: () => false } });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Edit profile' })).not.toBeInTheDocument();
        unmount();

        mockDetail();
        renderDetail();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Edit profile' })).toBeInTheDocument());
    });

    it('shows (masked) hints on profile PII when gated', async () => {
        mockDetail({ data: { ...DATA, person: { ...DATA.person, viewerCanSeePii: false } } });
        renderDetail();
        await waitFor(() => expect(screen.getByText('Full name')).toBeInTheDocument());
        expect(screen.getAllByText('(masked)').length).toBeGreaterThan(0);
    });
});

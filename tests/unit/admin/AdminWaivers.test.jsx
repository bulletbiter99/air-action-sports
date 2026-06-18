// @vitest-environment jsdom

// M8 item-1 backfill — RTL component tests for AdminWaivers (the versioned
// waiver-document manager). Consumes useAdmin() (owner-gated writes) + router
// <Link>s, so it renders via renderWithAdmin (which provides AdminContext and
// avoids the /me fetch). The list fetch runs on mount, so row assertions
// waitFor it; window.confirm guards Retire (stubbed). Dates are intentionally
// not asserted (locale-dependent toLocaleString).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithAdmin, screen, waitFor, userEvent, fireEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminWaivers from '../../../src/admin/AdminWaivers.jsx';

const LIVE = {
    id: 'wd_v2', version: 2, retiredAt: null,
    effectiveFrom: 1_767_225_600_000,
    bodySha256: 'abc123def456abc123def456abc123def456abc123def456abc123def4560000',
    bodyHtml: '<p>I agree to the latest terms.</p>',
};
const RETIRED = {
    id: 'wd_v1', version: 1, retiredAt: 1_767_225_600_000,
    effectiveFrom: 1_760_000_000_000,
    bodySha256: '111122223333111122223333111122223333111122223333111122223333aaaa',
    bodyHtml: '<p>The original terms.</p>',
};

function mockDocs(waivers) {
    return installClientFetch([
        { match: '/api/admin/waiver-documents', body: { waivers } },
    ]);
}

afterEach(() => vi.restoreAllMocks());

describe('AdminWaivers', () => {
    it('shows a loading state while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderWithAdmin(<AdminWaivers />);
        expect(screen.getByText('Loading waiver versions…')).toBeInTheDocument();
    });

    it('renders the version table + LIVE banner, with owner write actions', async () => {
        mockDocs([LIVE, RETIRED]);
        renderWithAdmin(<AdminWaivers />);
        expect(screen.getByRole('heading', { name: 'Waiver Document' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('v2')).toBeInTheDocument());
        expect(screen.getByText('v1')).toBeInTheDocument();
        // LIVE banner names the live version, retired row carries the retired pill
        expect(screen.getByText(/LIVE:/)).toBeInTheDocument();
        expect(screen.getByText('retired')).toBeInTheDocument();
        // owner (default) sees the write affordances
        expect(screen.getByRole('button', { name: '+ New version' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retire' })).toBeInTheDocument();
    });

    it('hides the write actions for non-owners but keeps View', async () => {
        mockDocs([LIVE]);
        renderWithAdmin(<AdminWaivers />, { admin: { hasRole: () => false } });
        await waitFor(() => expect(screen.getByText('v2')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: '+ New version' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Retire' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    });

    it('renders the empty state when there are no waiver documents', async () => {
        mockDocs([]);
        renderWithAdmin(<AdminWaivers />);
        await waitFor(() => expect(screen.getByText('No waiver documents yet')).toBeInTheDocument());
    });

    it('opens the View modal with the full SHA-256 and rendered body', async () => {
        // fireEvent (not userEvent) — the row button opens a fixed-overlay modal
        // that userEvent's pointer sequence dismisses; fireEvent.click is the
        // lower-level path the public Waiver suite uses for the same reason.
        mockDocs([LIVE]);
        renderWithAdmin(<AdminWaivers />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'View' }));
        // modal body (rendered HTML) is unique to the open modal
        expect(await screen.findByText('I agree to the latest terms.')).toBeInTheDocument();
        // the modal shows the FULL sha — the table only shows a 12-char prefix +
        // a "SHA-256" column header, so the full hash matches only the modal
        expect(screen.getByText(new RegExp(LIVE.bodySha256))).toBeInTheDocument();
    });

    it('opens the New Waiver Version modal from + New version', async () => {
        mockDocs([LIVE]);
        const user = userEvent.setup();
        renderWithAdmin(<AdminWaivers />);
        await waitFor(() => expect(screen.getByRole('button', { name: '+ New version' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: '+ New version' }));
        expect(await screen.findByRole('heading', { name: 'New Waiver Version' })).toBeInTheDocument();
    });

    it('posts a retire request after confirmation (owner)', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const fetchMock = mockDocs([LIVE]);
        const user = userEvent.setup();
        renderWithAdmin(<AdminWaivers />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Retire' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Retire' }));
        await waitFor(() => {
            const retired = fetchMock.mock.calls.some(
                (args) => String(args[0]).includes('/wd_v2/retire') && args[1]?.method === 'POST',
            );
            expect(retired).toBe(true);
        });
    });
});

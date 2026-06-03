// @vitest-environment jsdom

// M8 item-1 backfill — RTL component tests for AdminSegments (Marketing B1
// list + create/edit modal). AdminSegments imports only React hooks — no
// router, no context — so a bare render() suffices.
//
// Dates are deliberately NOT asserted: the page renders formatRelative(), whose
// >30-day branch is locale-dependent (toLocaleDateString). We assert rows +
// key fields + modal wiring instead.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminSegments from '../../../src/admin/AdminSegments.jsx';

const SEGMENTS = [
    {
        id: 'seg_1', name: 'VIP locals', querySummary: 'tags any: vip', lastPreviewCount: 42,
        shared: true, updatedAt: 1_767_225_600_000,
        query: { v: 1, tags: { any: ['vip'], all: [], none: [] }, ltvCents: { min: 50000 }, totalBookings: {} },
    },
    {
        id: 'seg_2', name: 'Lapsed', querySummary: 'tags any: lapsed', lastPreviewCount: null,
        shared: false, updatedAt: 1_767_225_600_000,
        query: { v: 1, tags: { any: ['lapsed'], all: [], none: [] }, ltvCents: {}, totalBookings: {} },
    },
];

afterEach(() => {
    vi.restoreAllMocks();
});

describe('AdminSegments', () => {
    it('shows a loading state while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        render(<AdminSegments />);
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('renders the segments table with criteria + counts', async () => {
        installClientFetch([{ match: '/api/admin/segments', body: { segments: SEGMENTS } }]);
        render(<AdminSegments />);
        await waitFor(() => expect(screen.getByText('VIP locals')).toBeInTheDocument());
        expect(screen.getByText('Lapsed')).toBeInTheDocument();
        expect(screen.getByText('tags any: vip')).toBeInTheDocument();
        expect(screen.getByText('42')).toBeInTheDocument();
        // shared column renders a check for the shared segment
        expect(screen.getByText('✓')).toBeInTheDocument();
    });

    it('renders the empty state when there are no segments', async () => {
        installClientFetch([{ match: '/api/admin/segments', body: { segments: [] } }]);
        render(<AdminSegments />);
        await waitFor(() => expect(screen.getByText(/No segments yet\./)).toBeInTheDocument());
    });

    it('surfaces a fetch error', async () => {
        installClientFetch([{ match: '/api/admin/segments', status: 500, body: { error: 'boom' } }]);
        render(<AdminSegments />);
        await waitFor(() => expect(screen.getByText(/^Error: HTTP 500/)).toBeInTheDocument());
    });

    it('opens the new-segment modal and runs a live preview', async () => {
        const fetchMock = installClientFetch([
            { match: '/api/admin/segments/preview', body: { count: 5 } },
            { match: '/api/admin/segments', body: { segments: [] } },
        ]);
        const user = userEvent.setup();
        render(<AdminSegments />);
        await waitFor(() => expect(screen.getByText(/No segments yet\./)).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: '+ New segment' }));
        expect(screen.getByRole('heading', { name: 'New segment' })).toBeInTheDocument();
        // The modal debounces a POST preview on open — prove it wires up.
        await waitFor(() => {
            const hitPreview = fetchMock.mock.calls.some((args) => String(args[0]).includes('/api/admin/segments/preview'));
            expect(hitPreview).toBe(true);
        });
    });

    it('opens the edit modal when a segment name is clicked', async () => {
        installClientFetch([
            { match: '/api/admin/segments/preview', body: { count: 42 } },
            { match: '/api/admin/segments', body: { segments: SEGMENTS } },
        ]);
        const user = userEvent.setup();
        render(<AdminSegments />);
        await waitFor(() => expect(screen.getByText('VIP locals')).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'VIP locals' }));
        expect(screen.getByRole('heading', { name: 'Edit: VIP locals' })).toBeInTheDocument();
    });

    it('deletes a segment after confirmation', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const fetchMock = installClientFetch([{ match: '/api/admin/segments', body: { segments: SEGMENTS } }]);
        const user = userEvent.setup();
        render(<AdminSegments />);
        await waitFor(() => expect(screen.getByText('VIP locals')).toBeInTheDocument());
        await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
        await waitFor(() => {
            const deleted = fetchMock.mock.calls.some(
                (args) => (args[1]?.method === 'DELETE') && String(args[0]).includes('/api/admin/segments/seg_1'),
            );
            expect(deleted).toBe(true);
        });
    });
});

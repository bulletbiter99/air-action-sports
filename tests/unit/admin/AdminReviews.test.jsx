// @vitest-environment jsdom

// Batch 5b — RTL tests for AdminReviews (review moderation page). Uses useAdmin
// + FilterBar (fires /api/admin/saved-views) + router, so it renders via
// renderWithAdmin. Row "View" opens a fixed-overlay modal → fireEvent.click
// (userEvent's pointer sequence would dismiss it).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithAdmin, screen, waitFor } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminReviews from '../../../src/admin/AdminReviews.jsx';

const SAVED_VIEWS = { match: '/api/admin/saved-views', body: { views: [] } };

const REVIEWS = [
    { id: 'rv_1', event: { id: 'ev_1', title: 'Operation Last Light', slug: 'op' }, rating: 5, title: 'Epic', comment: 'Best op ever', authorName: 'Jane D.', email: 'jane@x.com', verified: true, status: 'published', editCount: 0, createdAt: 1767225600000, bookingFlag: null },
    { id: 'rv_2', event: { id: 'ev_1', title: 'Operation Last Light', slug: 'op' }, rating: 2, title: null, comment: 'meh', authorName: 'Bob S.', email: 'bob@x.com', verified: true, status: 'hidden', hiddenReason: 'spam', editCount: 0, createdAt: 1767225600000, bookingFlag: 'refunded' },
];
const SUMMARY = { published: 3, hidden: 1, total: 4, average: 4.2 };

afterEach(() => vi.restoreAllMocks());

describe('AdminReviews', () => {
    it('shows a loading state while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        renderWithAdmin(<AdminReviews />);
        expect(screen.getByText('Loading reviews…')).toBeInTheDocument();
    });

    it('renders the review rows + the summary stats', async () => {
        installClientFetch([
            SAVED_VIEWS,
            { match: '/api/admin/reviews', body: { items: REVIEWS, summary: SUMMARY } },
        ]);
        renderWithAdmin(<AdminReviews />);
        await waitFor(() => expect(screen.getByText('Jane D.')).toBeInTheDocument());
        expect(screen.getByText('Bob S.')).toBeInTheDocument();
        expect(screen.getByText('Epic')).toBeInTheDocument();   // rv_1 row shows title (title || comment)
        expect(screen.getByText('meh')).toBeInTheDocument();    // rv_2 has no title → shows comment
        expect(screen.getAllByText('Operation Last Light').length).toBeGreaterThanOrEqual(2);
        // Avg rating stat card.
        expect(screen.getByText('4.2 ★')).toBeInTheDocument();
        // The refunded booking is flagged on its row.
        expect(screen.getByText('refunded')).toBeInTheDocument();
    });

    it('shows the empty state when there are no reviews', async () => {
        installClientFetch([
            SAVED_VIEWS,
            { match: '/api/admin/reviews', body: { items: [], summary: { published: 0, hidden: 0, total: 0, average: null } } },
        ]);
        renderWithAdmin(<AdminReviews />);
        await waitFor(() => expect(screen.getByText('No reviews yet')).toBeInTheDocument());
    });

    it('opens the detail modal with the moderation controls', async () => {
        installClientFetch([
            SAVED_VIEWS,
            { match: '/api/admin/reviews', body: { items: REVIEWS, summary: SUMMARY } },
        ]);
        renderWithAdmin(<AdminReviews />);
        await waitFor(() => expect(screen.getByText('Jane D.')).toBeInTheDocument());

        fireEvent.click(screen.getAllByText('View')[0]);   // rv_1 (published)
        expect(screen.getByText('Review detail')).toBeInTheDocument();
        // A published review shows the Hide control + the warning.
        expect(screen.getByRole('button', { name: 'Hide review' })).toBeInTheDocument();
        expect(screen.getByText(/removes this review from the public site/i)).toBeInTheDocument();
    });

    it('fires a PUT hide when the operator hides a review', async () => {
        const fetchMock = installClientFetch([
            { match: /\/api\/admin\/reviews\/rv_/, body: { item: { ...REVIEWS[0], status: 'hidden', hiddenReason: 'off-topic' } } },
            { match: '/api/admin/reviews', body: { items: REVIEWS, summary: SUMMARY } },
            SAVED_VIEWS,
        ]);
        renderWithAdmin(<AdminReviews />);
        await waitFor(() => expect(screen.getByText('Jane D.')).toBeInTheDocument());

        fireEvent.click(screen.getAllByText('View')[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Hide review' }));

        await waitFor(() => {
            const put = fetchMock.mock.calls.find(([u, o]) => /\/api\/admin\/reviews\/rv_1/.test(u) && o?.method === 'PUT');
            expect(put).toBeTruthy();
        });
    });
});

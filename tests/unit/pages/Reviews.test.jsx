// @vitest-environment jsdom

// Tests for the public /reviews page (src/pages/Reviews.jsx, Batch 6). Locks:
// the friendly empty state when no reviews exist yet (the dormant launch
// state), and the summary band + verified review cards once reviews accrue.

import { describe, it, expect } from 'vitest';
import { renderWithRouter, screen, waitFor } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import Reviews from '../../../src/pages/Reviews.jsx';

describe('Reviews page', () => {
    it('shows a friendly empty state when there are no reviews', async () => {
        installClientFetch([
            { match: '/api/reviews/all', body: { total: 0, average: null, reviews: [] } },
        ]);
        renderWithRouter(<Reviews />, { route: '/reviews' });
        await waitFor(() => expect(screen.getByText(/No player reviews yet/i)).toBeInTheDocument());
        expect(screen.queryByText(/verified review/i)).not.toBeInTheDocument();
    });

    it('renders the summary band + review cards when reviews exist', async () => {
        installClientFetch([
            {
                match: '/api/reviews/all',
                body: {
                    total: 2,
                    average: 4.5,
                    reviews: [
                        { id: 'rv_1', rating: 5, title: 'Unreal', comment: 'Best site around', authorName: 'Jane D.', event: { slug: 'operation-last-light', title: 'Operation Last Light' } },
                        { id: 'rv_2', rating: 4, title: null, comment: 'Solid day out', authorName: 'Sam R.', event: { slug: 'operation-last-light', title: 'Operation Last Light' } },
                    ],
                },
            },
        ]);
        renderWithRouter(<Reviews />, { route: '/reviews' });

        await waitFor(() => expect(screen.getByText('4.5')).toBeInTheDocument());
        expect(screen.getByText('2 verified reviews')).toBeInTheDocument();
        expect(screen.getByText('Unreal')).toBeInTheDocument();
        expect(screen.getByText('Best site around')).toBeInTheDocument();
        expect(screen.getAllByText('Operation Last Light').length).toBeGreaterThan(0);
    });
});

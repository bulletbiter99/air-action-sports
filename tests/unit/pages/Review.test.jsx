// @vitest-environment jsdom

// Tests for the public review-submission page (src/pages/Review.jsx, Batch 6).
// Reached from a per-booking email link (/review?token=…). Locks: the eligible
// form renders from /context; submitting with no star shows an inline error +
// scrolls to the picker (no POST); a rated submit POSTs the chosen rating and
// shows the thank-you; ineligible + already-reviewed contexts render their own
// states with no form.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithRouter, screen, waitFor, fireEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import Review from '../../../src/pages/Review.jsx';

const TOKEN = 'a'.repeat(40);
const EVENT = { slug: 'operation-last-light', title: 'Operation Last Light', displayDate: '25 July 2026' };

const ELIGIBLE = {
    eligible: true,
    reason: null,
    alreadyReviewed: false,
    editable: false,
    event: EVENT,
    suggestedAuthorName: 'Jane D.',
    existingReview: null,
};

beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    window.scrollTo = vi.fn();
});

// Order matters: /context is more specific than the /api/reviews POST target.
function mockRoutes(context, { postStatus = 201, postBody = { ok: true, id: 'rv_1', status: 'published', edited: false } } = {}) {
    return installClientFetch([
        { match: '/api/reviews/context', body: context },
        { match: '/api/reviews', status: postStatus, body: postBody },
    ]);
}

async function renderForm(context = ELIGIBLE) {
    const fetchMock = mockRoutes(context);
    renderWithRouter(<Review />, { route: `/review?token=${TOKEN}` });
    await waitFor(() => expect(screen.getByRole('button', { name: /Submit review/i })).toBeInTheDocument());
    return fetchMock;
}

describe('Review page', () => {
    it('renders the eligible form with the event name + suggested author', async () => {
        await renderForm();
        expect(screen.getByText('Operation Last Light')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Jane D.')).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: '5 stars' })).toBeInTheDocument();
    });

    it('submitting with no rating shows an inline error, scrolls to the picker, and does not POST', async () => {
        const fetchMock = await renderForm();
        fireEvent.click(screen.getByRole('button', { name: /Submit review/i }));

        expect(await screen.findByText(/pick a star rating/i)).toBeInTheDocument();
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
        const posted = fetchMock.mock.calls.some((c) => c[1]?.method === 'POST');
        expect(posted).toBe(false);
    });

    it('a rated submit POSTs the chosen rating and shows the thank-you screen', async () => {
        const fetchMock = await renderForm();
        fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
        fireEvent.change(screen.getByLabelText(/Headline/i), { target: { value: 'Great day' } });
        fireEvent.click(screen.getByRole('button', { name: /Submit review/i }));

        await waitFor(() => expect(screen.getByText('Thanks!')).toBeInTheDocument());
        const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
        expect(post).toBeTruthy();
        const sent = JSON.parse(post[1].body);
        expect(sent.rating).toBe(4);
        expect(sent.title).toBe('Great day');
        expect(sent.token).toBe(TOKEN);
    });

    it('an ineligible booking shows the reason and no form', async () => {
        mockRoutes({ eligible: false, reason: 'This booking was refunded.', alreadyReviewed: false, event: EVENT, suggestedAuthorName: '', existingReview: null });
        renderWithRouter(<Review />, { route: `/review?token=${TOKEN}` });
        expect(await screen.findByText('This booking was refunded.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Submit review/i })).not.toBeInTheDocument();
    });

    it('an already-reviewed, non-editable booking shows the existing review read-only', async () => {
        mockRoutes({
            eligible: true, alreadyReviewed: true, editable: false, reason: null, event: EVENT, suggestedAuthorName: 'Sam R.',
            existingReview: { rating: 5, title: 'Epic', comment: 'Loved every minute', authorName: 'Sam R.' },
        });
        renderWithRouter(<Review />, { route: `/review?token=${TOKEN}` });
        expect(await screen.findByText('Already Reviewed')).toBeInTheDocument();
        expect(screen.getByText('Loved every minute')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Submit review/i })).not.toBeInTheDocument();
    });

    it('a missing token shows the link error without calling the API', async () => {
        const fetchMock = installClientFetch([{ match: '/api/reviews/context', body: ELIGIBLE }]);
        renderWithRouter(<Review />, { route: '/review' });
        expect(await screen.findByText(/missing its token/i)).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

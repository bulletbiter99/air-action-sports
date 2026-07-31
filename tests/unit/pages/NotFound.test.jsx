// @vitest-environment jsdom
//
// The 404 page used to count down from 10 and then navigate('/').
//
// That mattered more than a normal UX nit because every unmatched path in this
// app returns HTTP 200 with the SPA shell — a dead link is invisible to any
// status check, monitor or crawler, so this page was the ONLY place a broken
// URL was ever visible, and it erased it after ten seconds.
//
// Both directions are pinned. A test that only asserted "the path is shown"
// would still pass with the redirect restored, because the path IS shown for
// the first ten seconds.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, act } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithRouter } from '../../helpers/renderComponent.jsx';
import NotFound from '../../../src/pages/NotFound.jsx';

const DEAD = '/portal/auth/consume-typo?token=abc123';

// renderWithRouter uses MemoryRouter, so window.location NEVER reflects router
// state — asserting on it proves nothing. Mount a real route tree with a
// distinguishable home page instead, so an actual navigate('/') swaps the
// rendered content and the test can see it.
const HOME_MARKER = 'HOME-PAGE-RENDERED';

function renderAt(route) {
    return renderWithRouter(
        <Routes>
            <Route path="/" element={<div>{HOME_MARKER}</div>} />
            <Route path="*" element={<NotFound />} />
        </Routes>,
        { route },
    );
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe('NotFound', () => {
    it('shows the URL that failed, so it can be read and reported', () => {
        renderAt(DEAD);
        expect(screen.getByText(DEAD)).toBeInTheDocument();
    });

    it('does NOT redirect away — the URL survives well past the old 10s timer', async () => {
        renderAt(DEAD);

        await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

        // Under the old behaviour the router navigated to '/' at t=10s, which
        // would unmount NotFound and render the home marker instead.
        expect(screen.queryByText(HOME_MARKER)).not.toBeInTheDocument();
        expect(screen.getByText(DEAD)).toBeInTheDocument();
        expect(screen.getByText('404')).toBeInTheDocument();
    });

    it('no longer promises a redirect it will not perform', async () => {
        renderAt(DEAD);
        await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
        expect(screen.queryByText(/redirecting to home/i)).not.toBeInTheDocument();
    });

    it('offers a way out and a way to report it', () => {
        renderAt(DEAD);
        expect(screen.getByRole('link', { name: /back to base/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /let us know/i })).toBeInTheDocument();
    });

    it('renders a query string verbatim rather than dropping it', () => {
        // The query string is often the whole diagnosis — a truncated or
        // missing token is exactly the kind of bug this page has to expose.
        renderAt('/x?token=trunc8ed');
        expect(screen.getByText('/x?token=trunc8ed')).toBeInTheDocument();
    });
});

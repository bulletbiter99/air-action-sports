// @vitest-environment jsdom
//
// /portal/auth/signed-out used to render PortalConsume, the magic-link handler.
// PortalConsume reads ?token= on mount and, finding none, sets status='invalid'
// — so a staff member who signed out SUCCESSFULLY was shown, in danger red,
// "Invalid link. Please use the URL from your invitation email." The header's
// "Sign in" link points at the same route, so arriving signed-out looked broken
// too.
//
// The negative assertions are the real ones here: a page that merely says
// something friendly would still be wrong if it also said the link was invalid.

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../helpers/renderComponent.jsx';
import PortalSignedOut from '../../../src/portal/PortalSignedOut.jsx';

describe('PortalSignedOut', () => {
    it('confirms the sign-out succeeded', () => {
        renderWithRouter(<PortalSignedOut />, { route: '/portal/auth/signed-out' });
        expect(screen.getByText(/you.{0,3}re signed out/i)).toBeInTheDocument();
    });

    it('does NOT report an error for a successful sign-out', () => {
        renderWithRouter(<PortalSignedOut />, { route: '/portal/auth/signed-out' });
        expect(screen.queryByText(/invalid link/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/already been used/i)).not.toBeInTheDocument();
    });

    it('explains how to get back in, since the portal is magic-link only', () => {
        // There is no password form to point at, so "how do I sign in again"
        // has to be answered in prose or the page is a dead end.
        renderWithRouter(<PortalSignedOut />, { route: '/portal/auth/signed-out' });
        expect(screen.getByText(/invitation link/i)).toBeInTheDocument();
        expect(screen.getByText(/ask them to send a new link/i)).toBeInTheDocument();
    });

    it('offers a route off the page', () => {
        renderWithRouter(<PortalSignedOut />, { route: '/portal/auth/signed-out' });
        expect(screen.getByRole('link', { name: /airactionsport\.com/i })).toBeInTheDocument();
    });
});

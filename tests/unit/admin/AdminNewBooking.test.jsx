// @vitest-environment jsdom

// Render test for AdminNewBooking (the admin manual-booking form). Consumes
// useAdmin() + useNavigate and fetches /api/admin/events on mount, so it renders
// via renderWithAdmin. Design sweep (batch 4b): the form-mode <h1>/<p> header was
// swapped for the shared AdminPageHeader (the success-screen status headline, a
// separate result view, keeps its own h1).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithAdmin, screen } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminNewBooking from '../../../src/admin/AdminNewBooking.jsx';

afterEach(() => vi.restoreAllMocks());

describe('AdminNewBooking', () => {
    it('renders the New Booking header + description via AdminPageHeader', () => {
        installClientFetch([{ match: '/api/admin/events', body: { events: [] } }]);
        renderWithAdmin(<AdminNewBooking />);
        expect(screen.getByRole('heading', { name: 'New Booking' })).toBeInTheDocument();
        expect(screen.getByText(/Create a booking directly in the system/)).toBeInTheDocument();
    });
});

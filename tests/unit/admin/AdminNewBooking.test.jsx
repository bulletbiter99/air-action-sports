// @vitest-environment jsdom

// Render test for AdminNewBooking (the admin manual-booking form). Consumes
// useAdmin() + useNavigate and fetches /api/admin/events on mount, so it renders
// via renderWithAdmin. Design sweep (batch 4b): the form-mode <h1>/<p> header was
// swapped for the shared AdminPageHeader (the success-screen status headline, a
// separate result view, keeps its own h1).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithAdmin, screen, waitFor } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminNewBooking from '../../../src/admin/AdminNewBooking.jsx';

afterEach(() => vi.restoreAllMocks());

const TWO_EVENTS = {
    events: [
        { id: 'evt_last_light', title: 'Operation Last Light', ticketTypes: [], addons: [] },
        { id: 'evt_fire_storm', title: 'Operation Fire Storm', ticketTypes: [], addons: [] },
    ],
};

describe('AdminNewBooking', () => {
    it('renders the New Booking header + description via AdminPageHeader', () => {
        installClientFetch([{ match: '/api/admin/events', body: { events: [] } }]);
        renderWithAdmin(<AdminNewBooking />);
        expect(screen.getByRole('heading', { name: 'New Booking' })).toBeInTheDocument();
        expect(screen.getByText(/Create a booking directly in the system/)).toBeInTheDocument();
    });

    it('preselects the event from the ?event= deep-link (Today page walk-in tile)', async () => {
        installClientFetch([{ match: '/api/admin/events', body: TWO_EVENTS }]);
        renderWithAdmin(<AdminNewBooking />, { route: '/admin/new-booking?event=evt_fire_storm' });
        await waitFor(() => {
            expect(screen.getByDisplayValue(/Operation Fire Storm/)).toBeInTheDocument();
        });
    });

    it('falls back to the first event when the ?event= id is unknown', async () => {
        installClientFetch([{ match: '/api/admin/events', body: TWO_EVENTS }]);
        renderWithAdmin(<AdminNewBooking />, { route: '/admin/new-booking?event=evt_nope' });
        await waitFor(() => {
            expect(screen.getByDisplayValue(/Operation Last Light/)).toBeInTheDocument();
        });
    });
});

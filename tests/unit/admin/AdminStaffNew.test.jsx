// @vitest-environment jsdom

// Render test for AdminStaffNew (the staff create form). Consumes useAdmin()
// (manager-gated) + useNavigate, so it renders via renderWithAdmin. On mount it
// fetches /api/admin/staff/roles-catalog to populate the primary-role select.
//
// The page title was unified to "Add Staff" in the design-consistency sweep
// (batch 2a) — matching the browser tab title and the list "+ Add Staff" CTA —
// via the shared AdminPageHeader; the form branch previously read "New Person".

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithAdmin, screen, waitFor } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminStaffNew from '../../../src/admin/AdminStaffNew.jsx';

const ROLES = {
    match: '/api/admin/staff/roles-catalog',
    body: { roles: [{ id: 'role_1', name: 'Event Director', tier: 1 }] },
};

afterEach(() => vi.restoreAllMocks());

describe('AdminStaffNew', () => {
    it('renders the Add Staff header + create form for managers', async () => {
        installClientFetch([ROLES]);
        renderWithAdmin(<AdminStaffNew />);
        expect(screen.getByRole('heading', { name: 'Add Staff' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Create person' })).toBeInTheDocument();
        // roles-catalog populates the primary-role select after the mount fetch
        await waitFor(() =>
            expect(screen.getByRole('option', { name: 'Event Director (Tier 1)' })).toBeInTheDocument()
        );
    });

    it('shows the permission notice under the Add Staff header for non-managers', () => {
        installClientFetch([ROLES]);
        renderWithAdmin(<AdminStaffNew />, { admin: { hasRole: () => false } });
        expect(screen.getByRole('heading', { name: 'Add Staff' })).toBeInTheDocument();
        expect(screen.getByText(/don.t have permission to create staff/i)).toBeInTheDocument();
        // the create form is not rendered for non-managers
        expect(screen.queryByRole('button', { name: 'Create person' })).not.toBeInTheDocument();
    });
});

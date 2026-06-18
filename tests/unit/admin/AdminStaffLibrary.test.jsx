// @vitest-environment jsdom

// Render test for AdminStaffLibrary (the versioned JD/SOP/checklist library).
// Consumes useAdmin() (manager-gated CTA) + fetches /api/admin/staff-documents,
// so it renders via renderWithAdmin. Design sweep (batch 4a): the bespoke
// <header>/<h1> was swapped for the shared AdminPageHeader.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithAdmin, screen, waitFor } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminStaffLibrary from '../../../src/admin/AdminStaffLibrary.jsx';

const DOCS = {
    match: '/api/admin/staff-documents',
    body: { documents: [{ id: 'doc_1', kind: 'sop', title: 'Range Safety SOP', version: 3, slug: 'range-safety', retiredAt: null }] },
};

afterEach(() => vi.restoreAllMocks());

describe('AdminStaffLibrary', () => {
    it('renders the header, a document row, and the manager CTA', async () => {
        installClientFetch([DOCS]);
        renderWithAdmin(<AdminStaffLibrary />);
        expect(screen.getByRole('heading', { name: 'Staff Document Library' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '+ New Document' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('Range Safety SOP')).toBeInTheDocument());
    });

    it('hides + New Document for non-managers', async () => {
        installClientFetch([DOCS]);
        renderWithAdmin(<AdminStaffLibrary />, { admin: { hasRole: () => false } });
        await waitFor(() => expect(screen.getByText('Range Safety SOP')).toBeInTheDocument());
        expect(screen.queryByRole('link', { name: '+ New Document' })).not.toBeInTheDocument();
    });
});

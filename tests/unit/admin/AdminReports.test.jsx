// @vitest-environment jsdom

// M8 Batch C-PR-2, rewritten for the open-reads model (2026-07): every admin
// sees all four persona tabs regardless of reports.read.* capabilities —
// report reads opened server-side; only CSV export stays capability-gated
// (covered by reportShells.test.jsx + the server suite). The default tab
// still follows user.persona. We render via renderWithAdmin (wraps the raw
// AdminContext.Provider — no /me fetch) and assert the tab strip, which
// renders synchronously. A visible tab lazy-loads a persona shell that
// fetches its report endpoints (and ReportFilters fetches /events); we mock
// those (reports → 500 so every shell falls into its safe error state with
// no data-shape assumptions; events → empty) so the shell renders without an
// unmocked-fetch throw. findByRole flushes the lazy/Suspense work within act.

import { describe, it, expect } from 'vitest';
import { renderWithAdmin, screen } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminReports from '../../../src/admin/AdminReports.jsx';

function mockReportData() {
    return installClientFetch([
        { match: '/api/admin/events', body: { events: [] } },
        { match: '/api/admin/reports', status: 500, body: { error: 'stub' } },
    ]);
}

describe('AdminReports — open-reads tab strip', () => {
    it('shows all four persona tabs to a viewer with NO reports capabilities (open-reads model)', async () => {
        mockReportData();
        renderWithAdmin(<AdminReports />, { admin: { capabilities: [] } });
        expect(await screen.findByRole('tab', { name: 'Owner' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Bookkeeper' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Marketing' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Site Coordinator' })).toBeInTheDocument();
        expect(screen.queryByText('No reports available for your role')).toBeNull();
    });

    it('shows all four tabs regardless of which capability subset is held', async () => {
        mockReportData();
        renderWithAdmin(<AdminReports />, { admin: { capabilities: ['reports.read.owner'] } });
        expect(await screen.findByRole('tab', { name: 'Owner' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Bookkeeper' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Marketing' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Site Coordinator' })).toBeInTheDocument();
    });

    it('defaults the active tab to the viewer persona', async () => {
        mockReportData();
        renderWithAdmin(<AdminReports />, {
            admin: {
                user: { role: 'owner', persona: 'bookkeeper' },
                capabilities: ['reports.read.owner', 'reports.read.bookkeeper'],
            },
        });
        const bookkeeperTab = await screen.findByRole('tab', { name: 'Bookkeeper' });
        expect(bookkeeperTab).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Owner' })).toHaveAttribute('aria-selected', 'false');
    });

    it('falls back to the first tab when the persona matches no tab', async () => {
        mockReportData();
        renderWithAdmin(<AdminReports />, {
            admin: { user: { role: 'owner', persona: 'generic_manager' }, capabilities: [] },
        });
        const ownerTab = await screen.findByRole('tab', { name: 'Owner' });
        expect(ownerTab).toHaveAttribute('aria-selected', 'true');
    });
});

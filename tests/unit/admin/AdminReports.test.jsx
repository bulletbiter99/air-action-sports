// @vitest-environment jsdom

// M8 Batch C-PR-2 — AdminReports capability-gated tab strip.
//
// The high-value logic here is tab gating: each persona tab shows only when the
// viewer holds its reports.read.<persona> capability (from /me), and the default
// tab follows user.persona. We render via renderWithAdmin (wraps the raw
// AdminContext.Provider — no /me fetch) and assert the tab strip, which renders
// synchronously. A visible tab lazy-loads a persona shell that fetches its report
// endpoints (and ReportFilters fetches /events); we mock those (reports → 500 so
// every shell falls into its safe error state with no data-shape assumptions;
// events → empty) so the shell renders without an unmocked-fetch throw.
// findByRole flushes the lazy/Suspense work within act.

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

describe('AdminReports — capability-gated tabs', () => {
    it('renders a no-access empty state when the viewer has no reports capabilities', () => {
        renderWithAdmin(<AdminReports />, { admin: { capabilities: [] } });
        expect(screen.getByText('No reports available for your role')).toBeInTheDocument();
        expect(screen.queryAllByRole('tab')).toHaveLength(0);
    });

    it('shows only the single tab the viewer is entitled to', async () => {
        mockReportData();
        renderWithAdmin(<AdminReports />, { admin: { capabilities: ['reports.read.owner'] } });
        expect(await screen.findByRole('tab', { name: 'Owner' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'Bookkeeper' })).toBeNull();
        expect(screen.queryByRole('tab', { name: 'Marketing' })).toBeNull();
        expect(screen.queryByRole('tab', { name: 'Site Coordinator' })).toBeNull();
    });

    it('shows multiple tabs when entitled to several personas', async () => {
        mockReportData();
        renderWithAdmin(<AdminReports />, {
            admin: { capabilities: ['reports.read.owner', 'reports.read.bookkeeper'] },
        });
        expect(await screen.findByRole('tab', { name: 'Owner' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Bookkeeper' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'Marketing' })).toBeNull();
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
});

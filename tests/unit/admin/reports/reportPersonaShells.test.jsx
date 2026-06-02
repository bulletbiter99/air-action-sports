// @vitest-environment jsdom

// M8 Batch C-PR-3 — the 4 Reports persona shells.
//
// Each shell renders a ReportFilters bar + several report cards (useReportData
// per card). The shells don't call useAdmin() directly, but they render
// ReportLayout (which does), and Bookkeeper/SiteCoordinator use <Link> — so all
// render via renderWithAdmin (AdminContext + router). ReportLayout renders each
// card's title in its header regardless of data state, so the titles are stable
// assertion anchors: an empty {} body → each card's empty state + its title; a
// 500 → ReportLayout's "Error loading report:" degraded state.

import { describe, it, expect } from 'vitest';
import { renderWithAdmin, screen, waitFor } from '../../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../../helpers/mockClientFetch.js';
import OwnerReports from '../../../../src/admin/reports/OwnerReports.jsx';
import BookkeeperReports from '../../../../src/admin/reports/BookkeeperReports.jsx';
import MarketingReports from '../../../../src/admin/reports/MarketingReports.jsx';
import SiteCoordinatorReports from '../../../../src/admin/reports/SiteCoordinatorReports.jsx';

// An empty-but-complete shape: each card's empty-state guard checks one of these
// fields (series/items/rows/total/charged/created/hasData/…), so every card
// renders its title + empty state and never its rich-data branch (which assumes
// a populated shape — a bare {} would crash cards that read data.<nested>.x).
const EMPTY_REPORT = {
    series: [], items: [], rows: [], events: [], promos: [], cohorts: [],
    metrics: [], channels: [], buckets: [],
    total: 0, charged: 0, created: 0, count: 0, hasData: false,
};
function mockEmpty(personaBase) {
    installClientFetch([
        { match: '/api/admin/events', body: { events: [] } },
        { match: personaBase, body: EMPTY_REPORT },
    ]);
}
// 500 → useReportData error → ReportLayout shows "Error loading report:".
function mockError(personaBase) {
    installClientFetch([
        { match: '/api/admin/events', body: { events: [] } },
        { match: personaBase, status: 500, body: {} },
    ]);
}

async function expectTitles(titles) {
    for (const title of titles) {
        expect(await screen.findByText(title)).toBeInTheDocument();
    }
}

describe('OwnerReports', () => {
    it('renders all five report cards', async () => {
        mockEmpty('/api/admin/reports/owner');
        renderWithAdmin(<OwnerReports />);
        await expectTitles(['Revenue trends', 'Refund rate', 'Average order value', 'Retention by event series', 'Repeat customers']);
    });

    it('shows the error state when a report fails to load', async () => {
        mockError('/api/admin/reports/owner');
        renderWithAdmin(<OwnerReports />);
        await waitFor(() => expect(screen.getAllByText(/Error loading report/).length).toBeGreaterThan(0));
    });
});

describe('BookkeeperReports', () => {
    it('renders its cards + the 1099 Thresholds deep link', async () => {
        mockEmpty('/api/admin/reports/bookkeeper');
        renderWithAdmin(<BookkeeperReports />);
        await expectTitles(['Payouts summary', 'Tax & fee summary', 'Period comparison', '1099 Thresholds']);
        const link = screen.getByRole('link', { name: /Open 1099 Thresholds/ });
        expect(link).toHaveAttribute('href', '/admin/staff/1099-thresholds');
    });

    it('shows the error state when a report fails to load', async () => {
        mockError('/api/admin/reports/bookkeeper');
        renderWithAdmin(<BookkeeperReports />);
        await waitFor(() => expect(screen.getAllByText(/Error loading report/).length).toBeGreaterThan(0));
    });
});

describe('MarketingReports', () => {
    it('renders all four report cards', async () => {
        mockEmpty('/api/admin/reports/marketing');
        renderWithAdmin(<MarketingReports />);
        await expectTitles(['Conversion funnel by event', 'Promo code performance', 'Customer cohorts', 'Channel attribution']);
    });

    it('shows the error state when a report fails to load', async () => {
        mockError('/api/admin/reports/marketing');
        renderWithAdmin(<MarketingReports />);
        await waitFor(() => expect(screen.getAllByText(/Error loading report/).length).toBeGreaterThan(0));
    });
});

describe('SiteCoordinatorReports', () => {
    it('renders all four report cards', async () => {
        mockEmpty('/api/admin/reports/site-coordinator');
        renderWithAdmin(<SiteCoordinatorReports />);
        await expectTitles(['Field rental revenue by site', 'COI compliance status', 'Lead-to-booking conversion', 'Recurrence retention']);
    });

    it('shows the error state when a report fails to load', async () => {
        mockError('/api/admin/reports/site-coordinator');
        renderWithAdmin(<SiteCoordinatorReports />);
        await waitFor(() => expect(screen.getAllByText(/Error loading report/).length).toBeGreaterThan(0));
    });
});

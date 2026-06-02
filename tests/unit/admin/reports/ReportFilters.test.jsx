// @vitest-environment jsdom

// M8 Batch C-PR-3 — ReportFilters control bar.
//
// Bare render (it doesn't use useAdmin or Link). It fetches /api/admin/events on
// mount for the event-scope select, so that's mocked. Each control is wrapped in
// its own <label>, so controls are queried by label text.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, userEvent } from '../../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../../helpers/mockClientFetch.js';
import ReportFilters from '../../../../src/admin/reports/ReportFilters.jsx';

const VALUE = { period: 'mtd', comparison: false, eventId: 'all' };

describe('ReportFilters', () => {
    it('renders period options, the comparison toggle, and the event-scope select', async () => {
        installClientFetch([
            { match: '/api/admin/events', body: { events: [{ id: 'e1', title: 'Op Mock', dateIso: '2026-06-10' }] } },
        ]);
        render(<ReportFilters value={VALUE} onChange={() => {}} />);
        expect(screen.getByText('Month to date')).toBeInTheDocument();
        expect(screen.getByText('Custom range…')).toBeInTheDocument();
        expect(screen.getByText('Compare to prior period')).toBeInTheDocument();
        expect(screen.getByText('All events')).toBeInTheDocument();
        // The event scope select populates once the /events fetch resolves.
        await waitFor(() => expect(screen.getByText(/Op Mock/)).toBeInTheDocument());
    });

    it('shows the custom from/to inputs when the period is "custom"', () => {
        installClientFetch([{ match: '/api/admin/events', body: { events: [] } }]);
        render(<ReportFilters value={{ ...VALUE, period: 'custom' }} onChange={() => {}} />);
        expect(screen.getByLabelText('From')).toBeInTheDocument();
        expect(screen.getByLabelText('To')).toBeInTheDocument();
    });

    it('fires onChange with the new period when the Period select changes', async () => {
        installClientFetch([{ match: '/api/admin/events', body: { events: [] } }]);
        const onChange = vi.fn();
        const user = userEvent.setup();
        render(<ReportFilters value={VALUE} onChange={onChange} />);
        await user.selectOptions(screen.getByLabelText('Period'), 'ytd');
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ period: 'ytd' }));
    });

    it('hides the event-scope + comparison controls when disabled', () => {
        installClientFetch([{ match: '/api/admin/events', body: { events: [] } }]);
        render(<ReportFilters value={VALUE} onChange={() => {}} showEventScope={false} showComparison={false} />);
        expect(screen.queryByText('Event scope')).toBeNull();
        expect(screen.queryByText('Compare to prior period')).toBeNull();
    });
});

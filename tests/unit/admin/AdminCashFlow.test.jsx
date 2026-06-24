// @vitest-environment jsdom

// RTL component tests for AdminCashFlow (the 13-week forecast page).

import { describe, it, expect } from 'vitest';
import { renderWithAdmin, screen, waitFor } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminCashFlow from '../../../src/admin/AdminCashFlow.jsx';

const FORECAST = {
    rows: [
        { label: '2026-06-24', startMs: 1, openingCents: 500000, receiptsCents: 10000, disbursementsCents: 0, netCents: 10000, closingCents: 510000 },
        { label: '2026-07-01', startMs: 2, openingCents: 510000, receiptsCents: 10000, disbursementsCents: 0, netCents: 10000, closingCents: 520000 },
    ],
    openingCents: 500000,
    endingCents: 520000,
    totalReceiptsCents: 20000,
    totalDisbursementsCents: 0,
    netCents: 20000,
    minClosingCents: 510000,
    minClosingWeekLabel: '2026-06-24',
    horizonWeeks: 13,
    assumptions: { openingCents: 500000, weeklyRevenueCents: 10000, revenueDerived: true },
};

describe('AdminCashFlow', () => {
    it('renders the summary cards + weekly table from the forecast payload', async () => {
        installClientFetch([{ match: '/api/admin/cash-flow', body: FORECAST }]);
        renderWithAdmin(<AdminCashFlow />, { admin: { capabilities: ['finances.read'] } });
        await waitFor(() => expect(screen.getByText('Cash Flow Forecast')).toBeInTheDocument());
        // $5200.00 = ending-balance card + wk2 closing; $5100.00 = wk1 closing + lowest point.
        await waitFor(() => expect(screen.getAllByText('$5200.00').length).toBeGreaterThan(0));
        expect(screen.getAllByText('$5100.00').length).toBeGreaterThan(0);
        expect(screen.getByText('Projected closing cash')).toBeInTheDocument();
    });

    it('flags a negative trough with a warning', async () => {
        installClientFetch([{
            match: '/api/admin/cash-flow',
            body: { ...FORECAST, minClosingCents: -25000, minClosingWeekLabel: '2026-07-15' },
        }]);
        renderWithAdmin(<AdminCashFlow />, { admin: { capabilities: ['finances.read'] } });
        await waitFor(() => expect(screen.getByText(/dips below zero/)).toBeInTheDocument());
    });
});

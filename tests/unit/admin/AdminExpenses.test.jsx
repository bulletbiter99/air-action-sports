// @vitest-environment jsdom

// RTL component tests for AdminExpenses (the operating-expense list page).
// Uses renderWithAdmin (page consumes useAdmin + useNavigate) + a mocked
// client fetch for /api/admin/expenses and /api/admin/events.

import { describe, it, expect } from 'vitest';
import { renderWithAdmin, screen, waitFor } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminExpenses from '../../../src/admin/AdminExpenses.jsx';

const EXPENSES = [
    { id: 'exp_1', category: 'field_rent', description: 'July field lease', amountCents: 120000, incurredAt: Date.UTC(2026, 6, 1), vendor: 'Ghost Town', eventId: null },
    { id: 'exp_2', category: 'consumables', description: 'BBs + green gas', amountCents: 5000, incurredAt: Date.UTC(2026, 6, 2), vendor: null, eventId: null },
];

describe('AdminExpenses', () => {
    it('renders the expense rows with category labels + the total', async () => {
        installClientFetch([
            { match: '/api/admin/expenses', body: { expenses: EXPENSES, totalCents: 125000 } },
            { match: '/api/admin/events', body: { events: [] } },
        ]);
        renderWithAdmin(<AdminExpenses />, { admin: { capabilities: ['finances.read', 'finances.write'] } });
        await waitFor(() => expect(screen.getByText('July field lease')).toBeInTheDocument());
        expect(screen.getByText('BBs + green gas')).toBeInTheDocument();
        // "Field / Rent" appears in both the filter dropdown and the row.
        expect(screen.getAllByText('Field / Rent').length).toBeGreaterThan(0);
        expect(screen.getByText('$1250.00')).toBeInTheDocument(); // total shown (formatMoney = no thousands sep)
        expect(screen.getByText('+ New Expense')).toBeInTheDocument();
    });

    it('shows the empty state when there are no expenses', async () => {
        installClientFetch([
            { match: '/api/admin/expenses', body: { expenses: [], totalCents: 0 } },
            { match: '/api/admin/events', body: { events: [] } },
        ]);
        renderWithAdmin(<AdminExpenses />, { admin: { capabilities: ['finances.read', 'finances.write'] } });
        await waitFor(() => expect(screen.getByText(/No expenses this month/)).toBeInTheDocument());
    });

    it('hides the New Expense action for a read-only (finances.read only) viewer', async () => {
        installClientFetch([
            { match: '/api/admin/expenses', body: { expenses: [], totalCents: 0 } },
            { match: '/api/admin/events', body: { events: [] } },
        ]);
        renderWithAdmin(<AdminExpenses />, { admin: { capabilities: ['finances.read'] } });
        await waitFor(() => expect(screen.getByText(/No expenses this month/)).toBeInTheDocument());
        expect(screen.queryByText('+ New Expense')).toBeNull();
    });
});

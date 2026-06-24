// @vitest-environment jsdom

// RTL component tests for AdminBudgets (the monthly per-category budget grid).

import { describe, it, expect } from 'vitest';
import { renderWithAdmin, screen, waitFor } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminBudgets from '../../../src/admin/AdminBudgets.jsx';

describe('AdminBudgets', () => {
    it('renders a row per category and sums saved budgets into the total', async () => {
        installClientFetch([
            { match: '/api/admin/budgets', body: { budgets: [
                { id: 'bud_1', period: '2026-07', category: 'payroll', budgetedCents: 300000 },
                { id: 'bud_2', period: '2026-07', category: 'field_rent', budgetedCents: 120000 },
            ] } },
        ]);
        renderWithAdmin(<AdminBudgets />, { admin: { capabilities: ['finances.read', 'finances.write'] } });
        // The category labels are static; wait for the loaded total to appear.
        // formatMoney has no thousands separator → "$4200.00".
        await waitFor(() => expect(screen.getByText('$4200.00')).toBeInTheDocument());
        expect(screen.getByText('Payroll')).toBeInTheDocument();
        expect(screen.getByText('Field / Rent')).toBeInTheDocument();
    });

    it('marks the page read-only for a finances.read-only viewer', async () => {
        installClientFetch([{ match: '/api/admin/budgets', body: { budgets: [] } }]);
        renderWithAdmin(<AdminBudgets />, { admin: { capabilities: ['finances.read'] } });
        await waitFor(() => expect(screen.getByText(/read-only access to budgets/)).toBeInTheDocument());
    });
});

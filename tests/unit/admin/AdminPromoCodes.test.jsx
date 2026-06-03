// @vitest-environment jsdom

// M8 item-1 backfill — RTL component tests for AdminPromoCodes (list + create/
// edit form + batch-create modal). Consumes useAdmin() + useNavigate; loads
// /api/admin/events + /api/admin/promo-codes (+ /api/admin/saved-views via
// FilterBar). Rows render through VirtualizedList, which yields no rows in jsdom
// unless a sized ResizeObserver + getBoundingClientRect are stubbed (M8 lesson
// #4) — so the row-content assertions live in their own stubbed describe block.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithAdmin, screen, waitFor, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminPromoCodes from '../../../src/admin/AdminPromoCodes.jsx';

const EVENTS = [{ id: 'ev_1', title: 'Operation Nightfall' }];
const PROMOS = [
    { id: 'pc_1', code: 'EARLYBIRD', discountType: 'percent', discountValue: 10, eventId: null, usesCount: 3, maxUses: 100, minOrderCents: null, startsAt: null, expiresAt: null, active: true },
    { id: 'pc_2', code: 'VIP25', discountType: 'fixed', discountValue: 2500, eventId: 'ev_1', usesCount: 0, maxUses: null, minOrderCents: null, startsAt: null, expiresAt: null, active: false },
];

function mockRoutes(promos = PROMOS) {
    return installClientFetch([
        { match: '/api/admin/events', body: { events: EVENTS } },
        { match: '/api/admin/saved-views', body: { views: [] } },
        { match: '/api/admin/promo-codes', body: { promoCodes: promos } },
    ]);
}

describe('AdminPromoCodes — shell (no virtualization needed)', () => {
    it('renders the page header + primary actions for a manager', async () => {
        // Non-empty list: once data loads, the empty-state (which carries its own
        // duplicate "+ New Code" action) is gone, leaving only the header actions.
        mockRoutes();
        renderWithAdmin(<AdminPromoCodes />);
        await waitFor(() => expect(screen.queryByText(/No promo codes yet/)).not.toBeInTheDocument());
        expect(screen.getByRole('heading', { name: 'Promo Codes' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '+ New Code' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '+ Batch Create' })).toBeInTheDocument();
    });

    it('renders the empty state when there are no codes', async () => {
        mockRoutes([]);
        renderWithAdmin(<AdminPromoCodes />);
        await waitFor(() => expect(screen.getByText(/No promo codes yet/)).toBeInTheDocument());
    });

    it('hides create actions from a non-manager', async () => {
        mockRoutes([]);
        renderWithAdmin(<AdminPromoCodes />, { admin: { hasRole: () => false } });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Promo Codes' })).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: '+ New Code' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '+ Batch Create' })).not.toBeInTheDocument();
    });

    it('opens the new-code form modal', async () => {
        mockRoutes();
        const user = userEvent.setup();
        renderWithAdmin(<AdminPromoCodes />);
        await waitFor(() => expect(screen.queryByText(/No promo codes yet/)).not.toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: '+ New Code' }));
        expect(screen.getByRole('heading', { name: 'New promo code' })).toBeInTheDocument();
    });

    it('opens the batch-create modal', async () => {
        mockRoutes([]);
        const user = userEvent.setup();
        renderWithAdmin(<AdminPromoCodes />);
        await waitFor(() => expect(screen.getByRole('button', { name: '+ Batch Create' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: '+ Batch Create' }));
        expect(screen.getByRole('heading', { name: 'Batch create promo codes' })).toBeInTheDocument();
    });
});

describe('AdminPromoCodes — virtualized rows (element dimensions stubbed)', () => {
    let rectSpy;
    let prevResizeObserver;
    beforeEach(() => {
        rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
            width: 600, height: 600, top: 0, left: 0, right: 600, bottom: 600, x: 0, y: 0, toJSON() {},
        }));
        prevResizeObserver = globalThis.ResizeObserver;
        globalThis.ResizeObserver = class {
            constructor(cb) { this._cb = cb; }
            observe(el) {
                this._cb([{
                    target: el,
                    contentRect: { width: 600, height: 600, top: 0, left: 0, right: 600, bottom: 600, x: 0, y: 0 },
                    borderBoxSize: [{ inlineSize: 600, blockSize: 600 }],
                    contentBoxSize: [{ inlineSize: 600, blockSize: 600 }],
                }], this);
            }
            unobserve() {}
            disconnect() {}
        };
    });
    afterEach(() => {
        rectSpy.mockRestore();
        globalThis.ResizeObserver = prevResizeObserver;
    });

    it('renders promo rows with code, discount + status', async () => {
        mockRoutes();
        renderWithAdmin(<AdminPromoCodes />);
        await waitFor(() => expect(screen.getByText('EARLYBIRD')).toBeInTheDocument());
        expect(screen.getByText('VIP25')).toBeInTheDocument();
        expect(screen.getByText('10% off')).toBeInTheDocument();
        // percent vs fixed discount rendering
        expect(screen.getByText('$25.00 off')).toBeInTheDocument();
        // active vs inactive status cells
        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.getByText('Inactive')).toBeInTheDocument();
    });
});

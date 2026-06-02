// @vitest-environment jsdom

// M8 Batch A/B — RTL + jsdom proof + a11y characterization for VirtualizedList.
//
// Batch A stood up the jsdom component-test lane and locked #241's region a11y.
// Batch B upgrades the primitive to a full ARIA *table* (role="table" + row /
// columnheader / cell + aria-rowcount/colcount/rowindex/colindex) so windowing
// still conveys each row's and cell's TRUE position. These tests cover both:
//   * table-level semantics — header + container always render, no virtualizer
//     measurement needed;
//   * the windowed cell roles — element dimensions are stubbed so the virtualizer
//     actually yields rows in jsdom (it otherwise measures a zero-size box and
//     renders none — the Batch A handoff).
//
// role="table" (not "grid") is deliberate — see VirtualizedList.jsx: these are
// scrollable data tables, not an arrow-key cell-navigation widget.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '../../helpers/renderComponent.jsx';
import VirtualizedList from '../../../src/admin/VirtualizedList.jsx';

const ROWS = [
    { id: 'a', name: 'Alpha', email: 'a@example.io', status: 'Active' },
    { id: 'b', name: 'Bravo', email: 'b@example.io', status: 'Active' },
    { id: 'c', name: 'Charlie', email: 'c@example.io', status: 'Inactive' },
];

const GRID = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' };

// A consumer tagged exactly like the real admin pages (AdminEvents etc.): the
// header grid div is role="row" (rowindex 1) with columnheader cells, and each
// data row is role="row" (rowindex index+2) with cell children carrying
// aria-colindex. The component flattens its own layout wrappers to presentation.
function renderTable(props = {}) {
    return render(
        <VirtualizedList
            items={ROWS}
            getKey={(r) => r.id}
            ariaLabel="People table"
            colCount={3}
            header={(
                <div role="row" aria-rowindex={1} style={GRID}>
                    <div role="columnheader" aria-colindex={1}>Name</div>
                    <div role="columnheader" aria-colindex={2}>Email</div>
                    <div role="columnheader" aria-colindex={3}>Status</div>
                </div>
            )}
            renderRow={(r, i) => (
                <div role="row" aria-rowindex={i + 2} style={GRID}>
                    <div role="cell" aria-colindex={1}>{r.name}</div>
                    <div role="cell" aria-colindex={2}>{r.email}</div>
                    <div role="cell" aria-colindex={3}>{r.status}</div>
                </div>
            )}
            {...props}
        />
    );
}

describe('VirtualizedList — table semantics', () => {
    it('exposes role="table" named by ariaLabel and stays keyboard-focusable (#241)', () => {
        renderTable();
        const table = screen.getByRole('table', { name: 'People table' });
        expect(table).toBeInTheDocument();
        expect(table).toHaveAttribute('tabindex', '0');
    });

    it('counts the header row in aria-rowcount and reflects aria-colcount', () => {
        renderTable();
        const table = screen.getByRole('table', { name: 'People table' });
        // 3 data rows + 1 header row
        expect(table).toHaveAttribute('aria-rowcount', '4');
        expect(table).toHaveAttribute('aria-colcount', '3');
    });

    it('falls back to a default accessible name when ariaLabel is omitted', () => {
        renderTable({ ariaLabel: undefined });
        expect(screen.getByRole('table', { name: 'Scrollable list' })).toBeInTheDocument();
    });

    it('omits aria-colcount when colCount is not provided', () => {
        renderTable({ colCount: undefined });
        const table = screen.getByRole('table', { name: 'People table' });
        expect(table).not.toHaveAttribute('aria-colcount');
    });

    it('renders the header as row 1 with column headers (no virtualization needed)', () => {
        renderTable();
        const headers = screen.getAllByRole('columnheader');
        expect(headers).toHaveLength(3);
        expect(headers.map((h) => h.getAttribute('aria-colindex'))).toEqual(['1', '2', '3']);
        expect(headers.map((h) => h.textContent)).toEqual(['Name', 'Email', 'Status']);
    });
});

describe('VirtualizedList — windowed rows (element dimensions stubbed)', () => {
    // jsdom reports every element as a zero-size box AND never fires a real
    // ResizeObserver, so TanStack Virtual measures a 0-height viewport and renders
    // no rows. Two stubs give it a real size: getBoundingClientRect (used to
    // measure each rendered row) and a ResizeObserver whose observe() immediately
    // reports a 600px box (v3 reads the viewport from the observer, not an initial
    // rect read). Both are restored after each test so they never leak.
    let rectSpy;
    let prevResizeObserver;
    beforeEach(() => {
        rectSpy = vi
            .spyOn(Element.prototype, 'getBoundingClientRect')
            .mockImplementation(() => ({
                width: 600, height: 600, top: 0, left: 0, right: 600, bottom: 600, x: 0, y: 0,
                toJSON() {},
            }));
        prevResizeObserver = globalThis.ResizeObserver;
        globalThis.ResizeObserver = class {
            constructor(cb) { this._cb = cb; }
            observe(el) {
                this._cb(
                    [{
                        target: el,
                        contentRect: { width: 600, height: 600, top: 0, left: 0, right: 600, bottom: 600, x: 0, y: 0 },
                        borderBoxSize: [{ inlineSize: 600, blockSize: 600 }],
                        contentBoxSize: [{ inlineSize: 600, blockSize: 600 }],
                    }],
                    this,
                );
            }
            unobserve() {}
            disconnect() {}
        };
    });
    afterEach(() => {
        rectSpy.mockRestore();
        globalThis.ResizeObserver = prevResizeObserver;
    });

    it('renders data rows with role="row" and ascending aria-rowindex >= 2', async () => {
        renderTable();
        // 1 header row + 3 data rows once the virtualizer measures a viewport.
        await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4));
        const dataRowIndexes = screen
            .getAllByRole('row')
            .map((r) => Number(r.getAttribute('aria-rowindex')))
            .filter((n) => n >= 2)
            .sort((m, n) => m - n);
        expect(dataRowIndexes).toEqual([2, 3, 4]);
    });

    it('tags each data cell with role="cell" and an aria-colindex in 1..colCount', async () => {
        renderTable();
        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
        const firstCell = screen.getByText('Alpha');
        expect(firstCell).toHaveAttribute('role', 'cell');
        expect(firstCell).toHaveAttribute('aria-colindex', '1');

        const cells = screen.getAllByRole('cell');
        expect(cells).toHaveLength(ROWS.length * 3);
        for (const cell of cells) {
            const ci = Number(cell.getAttribute('aria-colindex'));
            expect(ci).toBeGreaterThanOrEqual(1);
            expect(ci).toBeLessThanOrEqual(3);
        }
    });

    it('resolves rows under the table in the a11y tree (wrappers flattened)', async () => {
        renderTable();
        const table = screen.getByRole('table', { name: 'People table' });
        // The component's sticky/spacer/transform wrappers are role="presentation",
        // so the header + data rows resolve as the table's rows.
        await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(4));
    });
});

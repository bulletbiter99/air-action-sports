// @vitest-environment jsdom

// M8 Batch A — proof test for the RTL + jsdom infrastructure, and a
// characterization lock on VirtualizedList's region-level a11y (shipped in
// #241: a focusable, labeled scroll region exposing a live row count).
//
// This is the first React component test in the repo. It proves the new lane
// works end-to-end — esbuild's automatic JSX transform + the jsdom env + the
// tests/helpers/renderComponent.jsx wiring (jest-dom matchers, afterEach
// cleanup, and the ResizeObserver stub that lets @tanstack/react-virtual
// initialize) — while pinning the accessibility contract Batch B builds on
// (the windowed-grid roles layer on top of this region).
//
// Scope note: these assert the region wrapper + sticky header, which render
// regardless of layout. Row-level assertions are deferred to Batch B — jsdom
// gives the scroll viewport a zero-size box, so TanStack Virtual computes an
// empty visible range and renders no row elements; Batch B stubs element
// dimensions so the windowed rows materialize for the gridcell-role tests.

import { describe, it, expect } from 'vitest';
import { render, screen } from '../../helpers/renderComponent.jsx';
import VirtualizedList from '../../../src/admin/VirtualizedList.jsx';

const ITEMS = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Bravo' },
    { id: 'c', name: 'Charlie' },
];

function renderList(props = {}) {
    return render(
        <VirtualizedList
            items={ITEMS}
            getKey={(it) => it.id}
            ariaLabel="Test list"
            header={<div>Column header</div>}
            renderRow={(it) => <div>{it.name}</div>}
            {...props}
        />
    );
}

describe('VirtualizedList — region a11y (#241)', () => {
    it('renders a scroll region named by ariaLabel', () => {
        renderList();
        expect(screen.getByRole('region', { name: 'Test list' })).toBeInTheDocument();
    });

    it('exposes the full item count via aria-rowcount and is keyboard-focusable', () => {
        renderList();
        const region = screen.getByRole('region', { name: 'Test list' });
        expect(region).toHaveAttribute('aria-rowcount', String(ITEMS.length));
        expect(region).toHaveAttribute('tabindex', '0');
    });

    it('renders the sticky header node', () => {
        renderList();
        expect(screen.getByText('Column header')).toBeInTheDocument();
    });

    it('falls back to a default accessible name when ariaLabel is omitted', () => {
        renderList({ ariaLabel: undefined });
        expect(screen.getByRole('region', { name: 'Scrollable list' })).toBeInTheDocument();
    });
});

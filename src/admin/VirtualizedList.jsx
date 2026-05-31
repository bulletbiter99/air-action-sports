// M7 Batch 7 — row virtualization primitive (TanStack Virtual).
//
// Renders only the on-screen rows of a (potentially large) list inside a
// bounded-height scroll viewport, so admin lists that render every row stay
// smooth as data grows. Generic render-prop: the caller controls each row's
// markup (and, for table-derived lists, renders a matching header row ABOVE
// this component so the header stays put while the body scrolls).
//
// Always-virtualizes: for a small list the virtualizer simply yields all rows,
// so the markup is identical at every size (no threshold seam). measureElement
// lets row heights self-measure (variable-height rows are fine).
//
// Optional `header` (M7 Batch 11b): a column-header node rendered as a
// position:sticky element INSIDE the scroll viewport. Because the header now
// shares the rows' scroll context, the columns stay aligned even when the
// vertical scrollbar narrows the content area, and the header stays pinned to
// the top while the list scrolls. Callers pass the same grid template for the
// header and each row so the columns line up. `scrollbar-gutter: stable` keeps
// the content width constant so there's no horizontal jump when the scrollbar
// appears/disappears.
//
// Used by the M7 Batch 7 admin lists (Roster / Events / PromoCodes /
// RentalAssignments). JSX-only (no RTL in this project) — build + browser
// verified.

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export default function VirtualizedList({
    items,
    renderRow,
    getKey,
    header,
    estimateRowHeight = 44,
    overscan = 8,
    maxHeight = '60vh',
    style,
}) {
    const parentRef = useRef(null);
    const rowVirtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => estimateRowHeight,
        overscan,
    });

    return (
        <div ref={parentRef} style={{ maxHeight, overflowY: 'auto', scrollbarGutter: 'stable', ...style }}>
            {header && (
                <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--color-bg-page)' }}>
                    {header}
                </div>
            )}
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                {rowVirtualizer.getVirtualItems().map((vi) => {
                    const item = items[vi.index];
                    return (
                        <div
                            key={getKey ? getKey(item, vi.index) : vi.key}
                            data-index={vi.index}
                            ref={rowVirtualizer.measureElement}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${vi.start}px)`,
                            }}
                        >
                            {renderRow(item, vi.index)}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

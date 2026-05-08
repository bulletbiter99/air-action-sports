// EmptyState — shared admin empty-state primitive.
//
// Replaces the bespoke "no results" / "no items yet" markup that the 16
// admin pages each rolled. M5 Batch 0 standardized empty-state treatment.
//
// Pure helper `inferEmptyStateVariant` is exported for testability — the
// component layer is presentational JSX.
//
// Usage:
//   <EmptyState
//     title="No entries match"
//     description="Try clearing the action filter or expanding the date range."
//     isFiltered
//   />
//
//   <EmptyState
//     variant="error"
//     title="Couldn't load assignments"
//     description={errorMessage}
//     action={<button onClick={retry}>Retry</button>}
//   />

import './EmptyState.css';

const VARIANT_GLYPH = {
    'no-data': '◇',
    search: '⌕',
    error: '!',
    loading: '…',
};

// Pure helper — choose a variant key based on the props the caller
// passed. Explicit `variant` always wins. Otherwise: error > search >
// no-data. Returns one of: 'no-data' | 'search' | 'error' | 'loading'
// or whatever string the caller passed as `variant`.
export function inferEmptyStateVariant({ variant, isError, isFiltered } = {}) {
    if (variant) return variant;
    if (isError) return 'error';
    if (isFiltered) return 'search';
    return 'no-data';
}

export default function EmptyState({
    variant,
    isError,
    isFiltered,
    title,
    description,
    action,
    icon,
    compact,
}) {
    const v = inferEmptyStateVariant({ variant, isError, isFiltered });
    const glyph = icon ?? VARIANT_GLYPH[v] ?? VARIANT_GLYPH['no-data'];
    const className = ['aas-empty-state', `aas-empty-state--${v}`, compact && 'aas-empty-state--compact']
        .filter(Boolean)
        .join(' ');
    return (
        <div className={className} role="status">
            <div className="aas-empty-state__glyph" aria-hidden="true">
                {glyph}
            </div>
            {title && <p className="aas-empty-state__title">{title}</p>}
            {description && <p className="aas-empty-state__description">{description}</p>}
            {action && <div className="aas-empty-state__action">{action}</div>}
        </div>
    );
}

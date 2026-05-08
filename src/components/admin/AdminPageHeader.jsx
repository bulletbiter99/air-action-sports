// AdminPageHeader — shared admin page header primitive.
//
// Surfaces the "title + breadcrumb + primary action right" pattern that
// M5 Batch 0 standardized across the 16 admin pages. Replaces the
// per-page bespoke header markup that grew during M1-M4.
//
// Pure helper `buildBreadcrumbItems` is exported for testability — the
// component layer is presentational JSX.
//
// Usage:
//   <AdminPageHeader
//     title="Audit Log"
//     description="Every admin action that mutates state is recorded here."
//     breadcrumb={[{ label: 'Settings', to: '/admin/settings' }, { label: 'Audit Log' }]}
//     primaryAction={<button onClick={...}>+ New</button>}
//     secondaryActions={<Link to="/admin/rentals">← Inventory</Link>}
//   />

import { Link } from 'react-router-dom';
import './AdminPageHeader.css';

// Pure helper — defensively normalize breadcrumb items.
//
// Accepts:
//   - null / undefined / non-array → []
//   - array of { label, to? } objects → passthrough (with label trimmed)
//   - array of strings → coerced to [{ label }]
//   - array entries that are null / undefined / lacking label → filtered out
//
// Returns array of { label: string, to?: string }. Always safe to .map().
export function buildBreadcrumbItems(items) {
    if (!Array.isArray(items)) return [];
    return items
        .map((item) => {
            if (item == null) return null;
            if (typeof item === 'string') {
                const label = item.trim();
                return label ? { label } : null;
            }
            if (typeof item !== 'object') return null;
            const label = String(item.label ?? '').trim();
            if (!label) return null;
            return item.to ? { label, to: String(item.to) } : { label };
        })
        .filter(Boolean);
}

export default function AdminPageHeader({
    title,
    description,
    breadcrumb,
    primaryAction,
    secondaryActions,
}) {
    const trail = buildBreadcrumbItems(breadcrumb);
    const hasActions = Boolean(primaryAction || secondaryActions);
    return (
        <header className="aas-admin-page-header">
            {trail.length > 0 && (
                <nav className="aas-admin-page-header__breadcrumb" aria-label="Breadcrumb">
                    {trail.map((item, idx) => (
                        <span key={`${item.label}-${idx}`} className="aas-admin-page-header__breadcrumb-item">
                            {item.to ? <Link to={item.to}>{item.label}</Link> : <span>{item.label}</span>}
                            {idx < trail.length - 1 && (
                                <span aria-hidden="true" className="aas-admin-page-header__breadcrumb-sep">/</span>
                            )}
                        </span>
                    ))}
                </nav>
            )}
            <div className="aas-admin-page-header__row">
                <div className="aas-admin-page-header__title-block">
                    <h1 className="aas-admin-page-header__title">{title}</h1>
                    {description && (
                        <p className="aas-admin-page-header__description">{description}</p>
                    )}
                </div>
                {hasActions && (
                    <div className="aas-admin-page-header__actions">
                        {secondaryActions}
                        {primaryAction}
                    </div>
                )}
            </div>
        </header>
    );
}

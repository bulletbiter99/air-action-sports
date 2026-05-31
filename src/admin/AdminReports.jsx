// M7 Batch 1b — Reports page shell.
//
// Persona-aware tab strip backed by /api/admin/auth/me capabilities. Each
// tab maps to a `reports.read.<persona>` capability seeded by migration 0062.
// Tab visibility honors the viewer's actual cap array (DB-backed via /me),
// not the legacy role hierarchy.
//
// Default active tab: first visible per viewer's persona (M4 B4a column).
// Falls back to first visible tab generally if persona doesn't match a tab.
//
// Each tab's content is empty until Batches 2-5 populate. Until then the
// page renders a "Coming in Batch N" placeholder per persona.

import { useState, useMemo, lazy, Suspense } from 'react';
import { useAdmin } from './AdminContext';
import ReportEmptyState from './reports/ReportEmptyState.jsx';

// Owner tab content (Batch 2). Lazy-loaded so the report bundle + chart
// primitives don't weigh down the shell for personas that never open it.
const OwnerReports = lazy(() => import('./reports/OwnerReports.jsx'));
// Bookkeeper tab content (Batch 3).
const BookkeeperReports = lazy(() => import('./reports/BookkeeperReports.jsx'));

const TABS = [
    { key: 'owner',            label: 'Owner',             capability: 'reports.read.owner',            batch: 'Batch 2' },
    { key: 'bookkeeper',       label: 'Bookkeeper',        capability: 'reports.read.bookkeeper',       batch: 'Batch 3' },
    { key: 'marketing',        label: 'Marketing',         capability: 'reports.read.marketing',        batch: 'Batch 4' },
    { key: 'site_coordinator', label: 'Site Coordinator',  capability: 'reports.read.site_coordinator', batch: 'Batch 5' },
];

// Map user.persona → preferred default tab. If persona doesn't match a tab
// or capability isn't held, falls back to first visible tab.
const PERSONA_TO_TAB = {
    owner: 'owner',
    bookkeeper: 'bookkeeper',
    marketing: 'marketing',
    site_coordinator: 'site_coordinator',
};

export default function AdminReports() {
    const { user, hasCapability, loading: authLoading } = useAdmin();

    const visibleTabs = useMemo(
        () => TABS.filter((t) => typeof hasCapability === 'function' && hasCapability(t.capability)),
        [hasCapability],
    );

    const defaultTab = useMemo(() => {
        if (visibleTabs.length === 0) return null;
        const preferred = PERSONA_TO_TAB[user?.persona];
        if (preferred && visibleTabs.some((t) => t.key === preferred)) return preferred;
        return visibleTabs[0].key;
    }, [user?.persona, visibleTabs]);

    const [activeTab, setActiveTab] = useState(defaultTab);

    if (authLoading) {
        return <div style={pageWrap}><p style={muted}>Loading…</p></div>;
    }

    // Capability-less viewer: no tabs at all (M5 capability system gates).
    // The sidebar stub may have shown the nav entry but the page renders an
    // empty-state explanation here.
    if (visibleTabs.length === 0) {
        return (
            <div style={pageWrap}>
                <header style={pageHeader}>
                    <h1 style={pageTitle}>Reports</h1>
                </header>
                <ReportEmptyState
                    kind="not-implemented"
                    title="No reports available for your role"
                    description="The Reports section is gated per persona capability. Contact admin if you need access."
                    hint="Personas: Owner, Bookkeeper, Marketing, Site Coordinator"
                />
            </div>
        );
    }

    // If `defaultTab` set after first render (auth-loaded), useState's initial
    // value is null — sync once.
    const currentTab = activeTab || defaultTab;
    const tabConfig = TABS.find((t) => t.key === currentTab);

    return (
        <div style={pageWrap}>
            <header style={pageHeader}>
                <div>
                    <h1 style={pageTitle}>Reports</h1>
                    <p style={pageSub}>
                        Per-persona drilldowns into bookings, revenue, customers, and field
                        rentals. Filters apply to all reports in the active tab.
                    </p>
                </div>
            </header>

            <nav style={tabStrip} role="tablist">
                {visibleTabs.map((tab) => (
                    <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        aria-selected={currentTab === tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        style={currentTab === tab.key ? activeTabStyle : tabStyle}
                    >
                        {tab.label}
                    </button>
                ))}
            </nav>

            <div style={tabContent}>
                {currentTab === 'owner' ? (
                    <Suspense fallback={<p style={muted}>Loading reports…</p>}>
                        <OwnerReports />
                    </Suspense>
                ) : currentTab === 'bookkeeper' ? (
                    <Suspense fallback={<p style={muted}>Loading reports…</p>}>
                        <BookkeeperReports />
                    </Suspense>
                ) : tabConfig ? (
                    <ReportEmptyState
                        kind="not-implemented"
                        title={`${tabConfig.label} reports`}
                        description={`This tab populates in M7 ${tabConfig.batch} — backend stubs from Batch 1a return 501 until then.`}
                        hint={`Capability gate: ${tabConfig.capability}`}
                    />
                ) : (
                    <ReportEmptyState
                        kind="not-implemented"
                        title="Select a tab"
                        description="Pick a persona above to view its reports."
                    />
                )}
            </div>
        </div>
    );
}

const pageWrap = { maxWidth: 1200, margin: '0 auto', padding: '2rem' };
const pageHeader = { marginBottom: '1.5rem' };
const pageTitle = { color: 'var(--color-text)', margin: 0 };
const pageSub = { color: 'var(--color-text-muted)', marginTop: '0.25rem', maxWidth: 760 };
const muted = { color: 'var(--color-text-muted)' };

const tabStrip = {
    display: 'flex',
    gap: '0.25rem',
    borderBottom: '1px solid var(--color-border-strong)',
    marginBottom: '1.5rem',
    flexWrap: 'wrap',
};

const tabStyle = {
    background: 'transparent',
    border: 'none',
    borderBottom: '3px solid transparent',
    padding: '0.75rem 1.25rem',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 600,
    marginBottom: '-1px',
};

const activeTabStyle = {
    ...tabStyle,
    color: 'var(--color-accent)',
    borderBottomColor: 'var(--color-accent)',
};

const tabContent = {
    minHeight: 400,
};

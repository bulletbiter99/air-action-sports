// M7 Batch 1b — Shared layout for an individual report.
//
// Wraps the report's title + description + filter bar + data area + optional
// CSV export button. Used by all 17 reports across Batches 2-5 so the UX is
// consistent and we can fix layout issues in one place.

import { useState } from 'react';
import { useAdmin } from '../AdminContext';

export default function ReportLayout({
    title,
    description,
    filters,
    children,
    onExportCsv,
    loading,
    error,
}) {
    const { hasCapability } = useAdmin();
    const canExport = typeof hasCapability === 'function' ? hasCapability('reports.export') : false;
    const [exporting, setExporting] = useState(false);
    const [exportErr, setExportErr] = useState(null);

    // onExportCsv triggers an async CSV download (reportData.downloadReportCsv).
    // Await it so the button can show progress and a server error surfaces here
    // instead of the browser navigating away to a raw error response.
    async function handleExport() {
        if (exporting) return;
        setExporting(true);
        setExportErr(null);
        try {
            await onExportCsv();
        } catch {
            setExportErr('Export failed. Please try again.');
        } finally {
            setExporting(false);
        }
    }

    return (
        <section style={wrap}>
            <header style={header}>
                <div>
                    <h2 style={titleStyle}>{title}</h2>
                    {description && <p style={descStyle}>{description}</p>}
                </div>
                {canExport && onExportCsv && (
                    <div style={exportWrap}>
                        <button
                            type="button"
                            onClick={handleExport}
                            disabled={loading || exporting}
                            style={exportBtn}
                            title="Download report as CSV"
                            aria-busy={exporting}
                        >
                            {exporting ? 'Exporting…' : '▼ Export CSV'}
                        </button>
                        {exportErr && <span style={exportErrStyle}>{exportErr}</span>}
                    </div>
                )}
            </header>

            {filters && <div style={filtersWrap}>{filters}</div>}

            <div style={dataArea}>
                {loading && <p style={loadingMsg}>Loading report…</p>}
                {error && <p style={errStyle}>Error loading report: {error}</p>}
                {!loading && !error && children}
            </div>
        </section>
    );
}

const wrap = {
    background: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    padding: '1.5rem',
    marginBottom: '1.5rem',
};

const header = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    marginBottom: '1rem',
};

const titleStyle = {
    color: 'var(--color-text)',
    margin: 0,
    fontSize: '1.25rem',
};

const descStyle = {
    color: 'var(--color-text-muted)',
    margin: '0.25rem 0 0',
    fontSize: '0.9rem',
};

const exportBtn = {
    background: 'var(--color-bg-sunken)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border-strong)',
    padding: '0.4rem 0.8rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 700,
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
};

const filtersWrap = {
    marginBottom: '1rem',
};

const dataArea = {
    minHeight: 200,
};

const loadingMsg = {
    color: 'var(--color-text-muted)',
    fontStyle: 'italic',
};

const errStyle = {
    color: 'var(--color-danger)',
};

const exportWrap = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '0.35rem',
};

const exportErrStyle = {
    color: 'var(--color-danger)',
    fontSize: '0.75rem',
    maxWidth: 180,
    textAlign: 'right',
};

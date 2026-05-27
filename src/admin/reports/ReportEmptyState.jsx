// M7 Batch 1b — Consistent empty state for individual reports.
//
// Used when:
//   - A report has not been implemented yet (Batches 2-5 placeholders)
//   - A report has no data for the current period/filters
//   - A report errored out (degraded mode)

export default function ReportEmptyState({ kind = 'no-data', title, description, hint }) {
    const defaults = {
        'no-data': {
            title: 'No data for this period',
            description: 'Try adjusting the period or filters.',
        },
        'not-implemented': {
            title: 'Coming soon',
            description: 'This report is part of the M7 Reports rollout and will populate in a subsequent batch.',
        },
        error: {
            title: 'Could not load report',
            description: 'Please try again. If the problem persists, contact admin.',
        },
    };
    const d = defaults[kind] || defaults['no-data'];

    return (
        <div style={wrap}>
            <div style={iconBox}>
                {kind === 'no-data' && '📊'}
                {kind === 'not-implemented' && '🚧'}
                {kind === 'error' && '⚠'}
            </div>
            <h3 style={titleStyle}>{title || d.title}</h3>
            <p style={descStyle}>{description || d.description}</p>
            {hint && <p style={hintStyle}>{hint}</p>}
        </div>
    );
}

const wrap = {
    padding: '3rem 1rem',
    textAlign: 'center',
    background: 'var(--color-bg-elevated)',
    border: '1px dashed var(--color-border-strong)',
    borderRadius: 6,
};

const iconBox = {
    fontSize: '2.5rem',
    marginBottom: '0.5rem',
};

const titleStyle = {
    color: 'var(--color-text)',
    margin: '0.5rem 0',
};

const descStyle = {
    color: 'var(--color-text-muted)',
    margin: '0.25rem 0',
    maxWidth: 500,
    marginLeft: 'auto',
    marginRight: 'auto',
};

const hintStyle = {
    color: 'var(--color-text-subtle)',
    fontSize: '0.85rem',
    marginTop: '1rem',
    fontStyle: 'italic',
};

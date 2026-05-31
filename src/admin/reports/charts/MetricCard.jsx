// M7 Batch 2 — stat tile with an optional delta indicator.
//
// Renders a headline metric (value + label) and, when a delta is supplied,
// a ▲/▼ change vs the prior period. `deltaPct === null` (prior period was 0)
// renders a neutral "—" rather than a fake ∞%.
//
// `deltaInverse` flips the color semantics for metrics where DOWN is good
// (e.g. refund rate): a decrease shows green, an increase shows red.

export default function MetricCard({
    label,
    value,
    sublabel,
    delta = null,
    deltaInverse = false,
    hint,
}) {
    let deltaEl = null;
    if (delta && delta.deltaPct != null) {
        const pct = delta.deltaPct;
        const flat = pct === 0;
        const up = pct > 0;
        const good = deltaInverse ? !up : up;
        const color = flat
            ? 'var(--color-text-muted)'
            : good ? 'var(--color-success)' : 'var(--color-danger)';
        const arrow = flat ? '→' : up ? '▲' : '▼';
        deltaEl = (
            <span style={{ ...deltaStyle, color }} title="Change vs prior period">
                {arrow} {Math.abs(pct * 100).toFixed(1)}%
            </span>
        );
    } else if (delta) {
        deltaEl = (
            <span style={{ ...deltaStyle, color: 'var(--color-text-subtle)' }} title="No prior-period baseline">
                —
            </span>
        );
    }

    return (
        <div style={card}>
            <div style={labelStyle}>{label}</div>
            <div style={valueRow}>
                <span style={valueStyle}>{value}</span>
                {deltaEl}
            </div>
            {sublabel && <div style={subStyle}>{sublabel}</div>}
            {hint && <div style={hintStyle}>{hint}</div>}
        </div>
    );
}

const card = {
    background: 'var(--color-bg-sunken)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    padding: '1rem 1.25rem',
    minWidth: 180,
};

const labelStyle = {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: 'var(--letter-spacing-wide)',
};

const valueRow = {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.5rem',
    marginTop: '0.35rem',
};

const valueStyle = {
    fontSize: '1.75rem',
    fontWeight: 800,
    color: 'var(--color-text)',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
};

const deltaStyle = {
    fontSize: '0.85rem',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
};

const subStyle = {
    fontSize: '0.8rem',
    color: 'var(--color-text-muted)',
    marginTop: '0.35rem',
};

const hintStyle = {
    fontSize: '0.75rem',
    color: 'var(--color-text-subtle)',
    marginTop: '0.25rem',
    fontStyle: 'italic',
};

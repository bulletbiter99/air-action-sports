// M7 Batch 2 — dependency-free SVG line chart for reports.
//
// Matches the reports shell's --color-* token palette. Same no-deps approach
// as src/admin/charts.jsx (BarChart), but renders a line + soft area fill for
// trend reports (revenue, refund rate, AOV). The polyline uses
// vector-effect="non-scaling-stroke" so the stroke stays crisp under the
// preserveAspectRatio="none" horizontal scaling.

export default function LineChart({
    data = [],
    height = 200,
    color = 'var(--color-accent)',
    valueKey = 'value',
    labelKey = 'label',
    formatValue = (v) => v,
    formatLabel = (l) => l,
    ariaLabel,
}) {
    if (!data.length) {
        return <div style={empty}>No data for this period</div>;
    }

    const values = data.map((d) => Number(d[valueKey]) || 0);
    const maxRaw = Math.max(0, ...values);
    const max = maxRaw === 0 ? 1 : maxRaw * 1.1; // 10% headroom; never divide by 0
    const W = 600;
    const H = 200;
    const padTop = 10;
    const padBottom = 8;
    const chartH = H - padTop - padBottom;
    const n = data.length;

    const xAt = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
    const yAt = (v) => padTop + chartH * (1 - v / max);

    // For a single data point, draw a flat horizontal line so something shows.
    const pts = n === 1
        ? [{ px: 0, py: yAt(values[0]) }, { px: W, py: yAt(values[0]) }]
        : data.map((d, i) => ({ px: xAt(i), py: yAt(Number(d[valueKey]) || 0) }));
    const linePts = pts.map((p) => `${p.px},${p.py}`).join(' ');
    const areaPts = `0,${padTop + chartH} ${linePts} ${W},${padTop + chartH}`;

    const yTicks = [0, 0.5, 1];

    return (
        <div style={{ width: '100%' }} role="img" aria-label={ariaLabel || 'Trend line chart'}>
            <div style={{ display: 'flex' }}>
                <div style={{ ...yAxisCol, height }}>
                    {yTicks.map((f) => (
                        <div key={f} style={{ ...yTickStyle, top: `${(1 - f) * 100}%` }}>
                            {formatValue(Math.round(max * f))}
                        </div>
                    ))}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <svg
                        viewBox={`0 0 ${W} ${H}`}
                        preserveAspectRatio="none"
                        style={{ width: '100%', height, display: 'block' }}
                    >
                        {yTicks.map((f) => (
                            <line
                                key={f}
                                x1="0"
                                x2={W}
                                y1={padTop + chartH * (1 - f)}
                                y2={padTop + chartH * (1 - f)}
                                stroke="var(--color-border)"
                                strokeWidth="1"
                                vectorEffect="non-scaling-stroke"
                            />
                        ))}
                        <polygon points={areaPts} fill={color} opacity="0.1" />
                        <polyline
                            points={linePts}
                            fill="none"
                            stroke={color}
                            strokeWidth="2"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                        />
                    </svg>
                    <div style={xLabelRow}>
                        <span>{formatLabel(data[0][labelKey])}</span>
                        {n > 1 && <span>{formatLabel(data[n - 1][labelKey])}</span>}
                    </div>
                </div>
            </div>
        </div>
    );
}

const empty = {
    padding: '2rem',
    color: 'var(--color-text-subtle)',
    textAlign: 'center',
    fontSize: '0.85rem',
    border: '1px dashed var(--color-border)',
    borderRadius: 6,
};

const yAxisCol = {
    width: 56,
    flexShrink: 0,
    position: 'relative',
};

const yTickStyle = {
    position: 'absolute',
    right: 6,
    transform: 'translateY(-50%)',
    fontSize: 10,
    color: 'var(--color-text-subtle)',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
};

const xLabelRow = {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: 4,
    fontSize: 11,
    color: 'var(--color-text-muted)',
    fontVariantNumeric: 'tabular-nums',
};

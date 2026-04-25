// Lightweight SVG chart primitives — no external deps.
// Designed for admin dashboards: bar + line over a small series (≤ 365 points).

export function BarChart({
  data,          // [{ label, value }]
  valueKey = 'value',
  labelKey = 'label',
  height = 160,
  barColor = 'var(--orange)',
  labelEvery,    // show x-axis label every N bars; defaults to auto-stride
  formatValue = (v) => v,
  formatLabel = (l) => l,
  yAxisWidth = 40,
}) {
  if (!data?.length) {
    return <div style={emptyState}>No data</div>;
  }
  const values = data.map((d) => d[valueKey] || 0);
  const max = Math.max(1, ...values);
  const padTop = 8;
  const padBottom = 22;
  const padRight = 16; // reserve room for the last x-axis label so it isn't clipped
  const chartH = height - padTop - padBottom;
  const stride = labelEvery || Math.max(1, Math.ceil(data.length / 6));
  const chartW = data.length * 10;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div style={{ display: 'flex' }}>
        <YAxis max={max} height={chartH} padTop={padTop} formatValue={formatValue} width={yAxisWidth} />
        <svg
          viewBox={`0 0 ${Math.max(chartW + padRight, 300)} ${height}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height, display: 'block' }}
        >
          {/* Faint gridlines */}
          {[0.25, 0.5, 0.75].map((frac) => (
            <line
              key={frac}
              x1={0}
              x2={chartW}
              y1={padTop + chartH * (1 - frac)}
              y2={padTop + chartH * (1 - frac)}
              stroke="rgba(200,184,154,0.08)"
              strokeWidth="0.5"
            />
          ))}
          {/* Bars */}
          {data.map((d, i) => {
            const v = d[valueKey] || 0;
            const h = (v / max) * chartH;
            const x = i * 10 + 1;
            return (
              <g key={i}>
                <rect
                  x={x}
                  y={padTop + chartH - h}
                  width={8}
                  height={h}
                  fill={barColor}
                  opacity={v === 0 ? 0.2 : 0.9}
                >
                  <title>{`${formatLabel(d[labelKey])}: ${formatValue(v)}`}</title>
                </rect>
              </g>
            );
          })}
          {/* X-axis labels — sparse, anchored via text. Last label uses end-anchor so it can't clip past viewBox. */}
          {data.map((d, i) => {
            if (i % stride !== 0 && i !== data.length - 1) return null;
            const isLast = i === data.length - 1;
            return (
              <text
                key={`lbl-${i}`}
                x={isLast ? chartW + padRight : i * 10 + 5}
                y={height - 6}
                textAnchor={isLast ? 'end' : 'middle'}
                fill="var(--olive-light)"
                fontSize="7"
              >
                {formatLabel(d[labelKey])}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function YAxis({ max, height, padTop, formatValue, width }) {
  const ticks = [0, 0.5, 1];
  return (
    <div style={{ width, flexShrink: 0, position: 'relative', height: height + padTop + 22 }}>
      {ticks.map((frac) => {
        const v = max * frac;
        return (
          <div
            key={frac}
            style={{
              position: 'absolute',
              right: 6,
              top: padTop + height * (1 - frac) - 6,
              fontSize: 9,
              color: 'var(--olive-light)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatValue(Math.round(v))}
          </div>
        );
      })}
    </div>
  );
}

export function ProgressBar({ value, max, height = 6, color = 'var(--orange)' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height, background: 'rgba(200,184,154,0.08)', borderRadius: height / 2, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
    </div>
  );
}

const emptyState = {
  padding: '2rem',
  color: 'var(--olive-light)',
  textAlign: 'center',
  fontSize: 12,
  border: '1px dashed rgba(200,184,154,0.15)',
};

// Owner weekly scorecard grid — metric rows × 13 week columns with a per-cell
// status tint (on / watch / off / neutral). Purely presentational: every cell
// was already classified server-side by computeScorecard (worker/lib/reports.js);
// this just formats the value, colors the cell, and adds a sticky metric label
// column + a right-hand Avg column + an On/Watch/Off summary pill row.
//
// ReportTable is deliberately NOT reused: it is row-first (a row = one data
// object, columns = its fields) with no conditional cell tint, whereas the
// scorecard is metrics-rows × weeks-columns with per-cell coloring. Matches the
// same inline-style + --color-* token conventions as ReportTable otherwise.

import { formatMoney } from '../../utils/money.js';
import { dayLabel } from '../../utils/dateFormat.js';

const STATUS_BG = {
    on: 'var(--color-success-soft)',
    watch: 'var(--color-warning-soft)',
    off: 'var(--color-danger-soft)',
    neutral: 'transparent',
};
const STATUS_FG = {
    on: 'var(--color-success)',
    watch: 'var(--color-warning)',
    off: 'var(--color-danger)',
    neutral: 'var(--color-text-muted)',
};

function formatValue(unit, v) {
    if (v == null) return '—';
    if (unit === 'money') return formatMoney(v);
    if (unit === 'percent') return `${(v * 100).toFixed(1)}%`;
    return String(v);
}

function statusWord(s) {
    return s === 'on' ? 'On track' : s === 'watch' ? 'Watch' : s === 'off' ? 'Off track' : 'No judgment';
}

function cellTitle(metric, cell, week) {
    const v = formatValue(metric.unit, cell.value);
    if (cell.status === 'neutral') {
        return `Week of ${week.startIso}: ${v}${week.isCurrent ? ' (in progress)' : ''}`;
    }
    return `Week of ${week.startIso}: ${v} · ${statusWord(cell.status)} vs target ${formatValue(metric.unit, metric.target)}`;
}

function Pill({ label, count, color }) {
    return (
        <span style={{ ...pill, borderColor: color, color }}>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{count}</strong> {label}
        </span>
    );
}

export default function ScorecardGrid({ weeks = [], metrics = [], summary = null }) {
    return (
        <div>
            {summary && (
                <div style={pillRow}>
                    <Pill label="On track" count={summary.on} color="var(--color-success)" />
                    <Pill label="Watch" count={summary.watch} color="var(--color-warning)" />
                    <Pill label="Off track" count={summary.off} color="var(--color-danger)" />
                </div>
            )}
            <div style={scroll}>
                <table style={table}>
                    <thead>
                        <tr>
                            <th style={{ ...th, ...stickyLabel }}>Metric</th>
                            {weeks.map((w) => (
                                <th key={w.index} style={{ ...th, textAlign: 'right' }}>
                                    {w.isCurrent
                                        ? <span style={thisWeek}>This wk</span>
                                        : dayLabel(w.startIso)}
                                </th>
                            ))}
                            <th style={{ ...th, textAlign: 'right', borderLeft: '2px solid var(--color-border-strong)' }}>Avg</th>
                        </tr>
                    </thead>
                    <tbody>
                        {metrics.map((m) => (
                            <tr key={m.key}>
                                <th scope="row" style={{ ...td, ...stickyLabel, fontWeight: 700 }}>
                                    {m.label}{' '}
                                    <span
                                        style={arrow}
                                        title={m.direction === 'higher-better' ? 'Higher is better' : 'Lower is better'}
                                    >
                                        {m.direction === 'higher-better' ? '↑' : '↓'}
                                    </span>
                                </th>
                                {m.cells.map((cell) => (
                                    <td
                                        key={cell.index}
                                        style={{
                                            ...td,
                                            textAlign: 'right',
                                            background: STATUS_BG[cell.status] || 'transparent',
                                            color: STATUS_FG[cell.status] || 'var(--color-text)',
                                            fontWeight: cell.status === 'on' || cell.status === 'off' ? 700 : 400,
                                        }}
                                        title={cellTitle(m, cell, weeks[cell.index] || {})}
                                        aria-label={`${m.label}, week of ${(weeks[cell.index] || {}).startIso}: ${formatValue(m.unit, cell.value)}, ${statusWord(cell.status)}`}
                                    >
                                        {formatValue(m.unit, cell.value)}
                                    </td>
                                ))}
                                <td style={{ ...td, textAlign: 'right', fontWeight: 700, borderLeft: '2px solid var(--color-border-strong)' }}>
                                    {formatValue(m.unit, m.avg)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p style={basis}>
                Targets auto-derived from the 12-week trailing median (current week excluded). No goals to configure.
                Quiet weeks (no sales) are shown gray, not judged.
            </p>
        </div>
    );
}

// ── styles (mirror ReportTable's scroll/th/td conventions) ───────────
const scroll = { width: '100%', overflowX: 'auto' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' };
const th = {
    padding: '0.4rem 0.6rem',
    background: 'var(--color-bg-sunken)',
    color: 'var(--color-text-muted)',
    fontSize: '0.7rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 'var(--letter-spacing-wide)',
    borderBottom: '1px solid var(--color-border-strong)',
    whiteSpace: 'nowrap',
};
const td = {
    padding: '0.4rem 0.6rem',
    color: 'var(--color-text)',
    borderBottom: '1px solid var(--color-border)',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
};
const stickyLabel = {
    position: 'sticky',
    left: 0,
    background: 'var(--color-bg-sunken)',
    textAlign: 'left',
    minWidth: 140,
    zIndex: 1,
};
const arrow = { color: 'var(--color-text-subtle)', fontWeight: 400 };
const thisWeek = {
    fontSize: '0.65rem',
    fontWeight: 800,
    color: 'var(--color-accent)',
    textTransform: 'uppercase',
    letterSpacing: 'var(--letter-spacing-wide)',
};
const pillRow = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' };
const pill = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    padding: '0.2rem 0.6rem',
    border: '1px solid',
    borderRadius: 999,
    fontSize: '0.8rem',
    fontWeight: 600,
};
const basis = { color: 'var(--color-text-subtle)', fontSize: '0.78rem', fontStyle: 'italic', marginTop: '0.6rem' };

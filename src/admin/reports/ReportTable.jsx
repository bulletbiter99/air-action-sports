// M7 Batch 3 — generic report table primitive.
//
// Used by the table-heavy Bookkeeper reports (and reused by Batch 5's Site
// Coordinator tables). Matches the reports shell's --color-* token palette.
//
//   columns: [{ key, label, align?, render?(value, row) }]
//   rows:    [ row objects keyed by column.key ]
//   footer:  optional row object rendered as a bold totals row

export default function ReportTable({ columns = [], rows = [], footer = null, emptyText = 'No data' }) {
    if (!rows.length && !footer) {
        return <div style={empty}>{emptyText}</div>;
    }

    const cell = (col, row) => (col.render ? col.render(row[col.key], row) : row[col.key]);

    return (
        <div style={scroll}>
            <table style={table}>
                <thead>
                    <tr>
                        {columns.map((c) => (
                            <th key={c.key} style={{ ...th, textAlign: c.align || 'left' }}>{c.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={row.key ?? row.month ?? i}>
                            {columns.map((c) => (
                                <td key={c.key} style={{ ...td, textAlign: c.align || 'left' }}>{cell(c, row)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
                {footer && (
                    <tfoot>
                        <tr>
                            {columns.map((c) => (
                                <td key={c.key} style={{ ...td, ...footerCell, textAlign: c.align || 'left' }}>
                                    {cell(c, footer)}
                                </td>
                            ))}
                        </tr>
                    </tfoot>
                )}
            </table>
        </div>
    );
}

const scroll = { width: '100%', overflowX: 'auto' };

const table = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.9rem',
};

const th = {
    padding: '0.5rem 0.75rem',
    background: 'var(--color-bg-sunken)',
    color: 'var(--color-text-muted)',
    fontSize: '0.75rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 'var(--letter-spacing-wide)',
    borderBottom: '1px solid var(--color-border-strong)',
    whiteSpace: 'nowrap',
};

const td = {
    padding: '0.5rem 0.75rem',
    color: 'var(--color-text)',
    borderBottom: '1px solid var(--color-border)',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
};

const footerCell = {
    fontWeight: 800,
    borderTop: '2px solid var(--color-border-strong)',
    borderBottom: 'none',
    background: 'var(--color-bg-sunken)',
};

const empty = {
    padding: '2rem',
    color: 'var(--color-text-subtle)',
    textAlign: 'center',
    fontSize: '0.85rem',
    border: '1px dashed var(--color-border)',
    borderRadius: 6,
};

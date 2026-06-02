// @vitest-environment jsdom

// M8 Batch C-PR-2 — shared Reports shell + chart primitives.
//
// The pure presentational pieces (ReportEmptyState / ReportTable / MetricCard /
// LineChart) render with a bare render(). ReportLayout consumes useAdmin() to
// gate its CSV-export button on the reports.export capability, so it uses
// renderWithAdmin — which also exercises the Batch C-PR-2 helper.

import { describe, it, expect } from 'vitest';
import { render, renderWithAdmin, screen } from '../../../helpers/renderComponent.jsx';
import ReportEmptyState from '../../../../src/admin/reports/ReportEmptyState.jsx';
import ReportTable from '../../../../src/admin/reports/ReportTable.jsx';
import ReportLayout from '../../../../src/admin/reports/ReportLayout.jsx';
import MetricCard from '../../../../src/admin/reports/charts/MetricCard.jsx';
import LineChart from '../../../../src/admin/reports/charts/LineChart.jsx';

describe('ReportEmptyState', () => {
    it('renders the no-data default copy', () => {
        render(<ReportEmptyState kind="no-data" />);
        expect(screen.getByText('No data for this period')).toBeInTheDocument();
    });

    it('renders the error-kind default copy', () => {
        render(<ReportEmptyState kind="error" />);
        expect(screen.getByText('Could not load report')).toBeInTheDocument();
    });

    it('honors title / description / hint overrides', () => {
        render(<ReportEmptyState kind="not-implemented" title="Custom title" description="Custom desc" hint="Custom hint" />);
        expect(screen.getByText('Custom title')).toBeInTheDocument();
        expect(screen.getByText('Custom desc')).toBeInTheDocument();
        expect(screen.getByText('Custom hint')).toBeInTheDocument();
    });
});

describe('ReportTable', () => {
    const columns = [{ key: 'month', label: 'Month' }, { key: 'gross', label: 'Gross' }];

    it('renders column headers + row cells', () => {
        render(<ReportTable columns={columns} rows={[{ month: 'Jan', gross: '$1,000' }]} />);
        expect(screen.getByText('Month')).toBeInTheDocument();
        expect(screen.getByText('Gross')).toBeInTheDocument();
        expect(screen.getByText('Jan')).toBeInTheDocument();
        expect(screen.getByText('$1,000')).toBeInTheDocument();
    });

    it('renders a footer totals row', () => {
        const { container } = render(
            <ReportTable columns={columns} rows={[{ month: 'Jan', gross: '$1,000' }]} footer={{ month: 'Total', gross: '$1,000' }} />,
        );
        expect(container.querySelector('tfoot')).toBeTruthy();
        expect(screen.getByText('Total')).toBeInTheDocument();
    });

    it('renders the empty text when there are no rows', () => {
        render(<ReportTable columns={columns} rows={[]} emptyText="Nothing here" />);
        expect(screen.getByText('Nothing here')).toBeInTheDocument();
    });
});

describe('MetricCard', () => {
    it('renders label + value', () => {
        render(<MetricCard label="Revenue" value="$50,000" />);
        expect(screen.getByText('Revenue')).toBeInTheDocument();
        expect(screen.getByText('$50,000')).toBeInTheDocument();
    });

    it('renders an upward delta as a percentage', () => {
        render(<MetricCard label="AOV" value="$120" delta={{ deltaPct: 0.15 }} />);
        expect(screen.getByText(/15\.0%/)).toBeInTheDocument();
    });

    it('renders a neutral dash when there is no prior-period baseline', () => {
        render(<MetricCard label="AOV" value="$120" delta={{ deltaPct: null }} />);
        expect(screen.getByText('—')).toBeInTheDocument();
    });
});

describe('LineChart', () => {
    it('renders a labeled SVG chart for data', () => {
        render(<LineChart data={[{ value: 10, label: 'Jan' }, { value: 20, label: 'Feb' }]} ariaLabel="Revenue trend" />);
        expect(screen.getByRole('img', { name: 'Revenue trend' })).toBeInTheDocument();
    });

    it('renders an empty state for no data', () => {
        render(<LineChart data={[]} />);
        expect(screen.getByText('No data for this period')).toBeInTheDocument();
    });
});

describe('ReportLayout — CSV export gate', () => {
    it('shows the export button when the viewer has reports.export', () => {
        renderWithAdmin(
            <ReportLayout title="Revenue" onExportCsv={() => {}}>body</ReportLayout>,
            { admin: { capabilities: ['reports.export'] } },
        );
        expect(screen.getByRole('button', { name: /Export CSV/ })).toBeInTheDocument();
    });

    it('hides the export button without the capability', () => {
        renderWithAdmin(
            <ReportLayout title="Revenue" onExportCsv={() => {}}>body</ReportLayout>,
            { admin: { capabilities: [] } },
        );
        expect(screen.queryByRole('button', { name: /Export CSV/ })).toBeNull();
    });

    it('renders children when not loading or errored', () => {
        renderWithAdmin(<ReportLayout title="Revenue">the body content</ReportLayout>, { admin: { capabilities: [] } });
        expect(screen.getByText('the body content')).toBeInTheDocument();
    });

    it('renders the loading state', () => {
        renderWithAdmin(<ReportLayout title="Revenue" loading>the body content</ReportLayout>, { admin: { capabilities: [] } });
        expect(screen.getByText('Loading report…')).toBeInTheDocument();
        expect(screen.queryByText('the body content')).toBeNull();
    });
});

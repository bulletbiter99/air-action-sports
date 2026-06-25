// @vitest-environment jsdom

// Component-render coverage for the Owner weekly scorecard grid. The pure
// computeScorecard math is covered in tests/unit/lib/reports.test.js and the
// route in reports-stub.test.js; the visual-admin baseline only captures the
// EMPTY state (the harness mocks return no data). This exercises the POPULATED
// render path — cells, value formatting, status pills, current-week badge, and
// the null → "—" case — by feeding the grid the real computeScorecard output.

import { describe, it, expect } from 'vitest';
import { render, screen } from '../../../helpers/renderComponent.jsx';
import ScorecardGrid from '../../../../src/admin/reports/ScorecardGrid.jsx';
import { computeScorecard } from '../../../../worker/lib/reports.js';

const WEEK = 604800000;
const START = Date.UTC(2026, 0, 5); // a Monday
const mkWeeks = () => Array.from({ length: 13 }, (_, i) => ({
    index: i, startMs: START + i * WEEK, endMs: START + (i + 1) * WEEK,
    startIso: new Date(START + i * WEEK).toISOString().slice(0, 10),
    isCurrent: i === 12, isPartial: i === 12,
}));

describe('ScorecardGrid', () => {
    it('renders metric rows, formatted cells, status pills, and the current-week badge', () => {
        // Cash In: completed weeks mostly $1000 (median target 1000) with an
        // on/watch/off trio ($950 / $800 / $600), current week $500. Refund Rate:
        // flat 10% so a percent cell renders.
        const cashValues = [95000, 80000, 60000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 50000];
        const out = computeScorecard({
            weeks: mkWeeks(),
            metricInputs: [
                { key: 'cash_in', label: 'Cash In', unit: 'money', direction: 'higher-better', weekValues: cashValues, volumeByWeek: Array(13).fill(3) },
                { key: 'refund_rate', label: 'Refund Rate', unit: 'percent', direction: 'lower-better', weekValues: Array(13).fill(0.1), volumeByWeek: Array(13).fill(10) },
            ],
        });
        render(<ScorecardGrid weeks={out.weeks} metrics={out.metrics} summary={out.summary} />);

        // Metric labels.
        expect(screen.getByText('Cash In')).toBeInTheDocument();
        expect(screen.getByText('Refund Rate')).toBeInTheDocument();
        // Money formatted with NO thousands separator (house formatMoney).
        expect(screen.getAllByText('$1000.00').length).toBeGreaterThan(0);
        expect(screen.getAllByText('$500.00').length).toBeGreaterThan(0);
        // Percent formatted to 1 dp.
        expect(screen.getAllByText('10.0%').length).toBeGreaterThan(0);
        // Status-count pills (text split by a <strong> count → regex match).
        expect(screen.getByText(/On track/)).toBeInTheDocument();
        expect(screen.getByText(/Watch/)).toBeInTheDocument();
        expect(screen.getByText(/Off track/)).toBeInTheDocument();
        // The in-progress week is badged.
        expect(screen.getAllByText('This wk').length).toBeGreaterThan(0);
    });

    it('renders a dash for null cells (a zero-volume rate week)', () => {
        // Week 0 has no charged bookings → refund rate is null → renders "—".
        const out = computeScorecard({
            weeks: mkWeeks(),
            metricInputs: [{
                key: 'refund_rate', label: 'Refund Rate', unit: 'percent', direction: 'lower-better',
                weekValues: [null, ...Array(12).fill(0.1)],
                volumeByWeek: [0, ...Array(12).fill(10)],
            }],
        });
        render(<ScorecardGrid weeks={out.weeks} metrics={out.metrics} summary={out.summary} />);
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });
});

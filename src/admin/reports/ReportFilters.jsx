// M7 Batch 1b — Shared report filter controls.
//
// Period selector (MTD/QTD/YTD/Custom), comparison toggle (vs prior period),
// event scope filter (all/specific). Emits onChange with the full filter
// state on every change. Custom period not yet wired (Batch 11 polish).

import { useState, useEffect, useCallback } from 'react';

export const PERIOD_OPTIONS = [
    { value: 'mtd', label: 'Month to date' },
    { value: 'qtd', label: 'Quarter to date' },
    { value: 'ytd', label: 'Year to date' },
    { value: 'last_30d', label: 'Last 30 days' },
    { value: 'last_90d', label: 'Last 90 days' },
    { value: 'custom', label: 'Custom range…' },
];

export default function ReportFilters({
    value,
    onChange,
    showEventScope = true,
    showComparison = true,
}) {
    // Sensible defaults — MTD + comparison off + all events.
    const [period, setPeriod] = useState(value?.period || 'mtd');
    const [comparison, setComparison] = useState(value?.comparison || false);
    const [eventId, setEventId] = useState(value?.eventId || 'all');
    const [events, setEvents] = useState([]);
    const [eventsLoading, setEventsLoading] = useState(false);

    // Fetch event list once when showEventScope is on.
    useEffect(() => {
        if (!showEventScope) return;
        let cancelled = false;
        setEventsLoading(true);
        (async () => {
            try {
                const res = await fetch('/api/admin/events', {
                    credentials: 'include',
                    cache: 'no-store',
                });
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (!cancelled) setEvents(data.events || []);
            } catch { /* swallow — filter degrades to "all" only */ }
            finally { if (!cancelled) setEventsLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [showEventScope]);

    // Notify parent on any change.
    const notify = useCallback((next) => {
        const merged = { period, comparison, eventId, ...next };
        onChange?.(merged);
    }, [period, comparison, eventId, onChange]);

    return (
        <div style={wrap}>
            <label style={field}>
                <span style={label}>Period</span>
                <select
                    value={period}
                    onChange={(e) => { setPeriod(e.target.value); notify({ period: e.target.value }); }}
                    style={select}
                >
                    {PERIOD_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </label>

            {showComparison && (
                <label style={{ ...field, ...checkboxField }}>
                    <input
                        type="checkbox"
                        checked={comparison}
                        onChange={(e) => { setComparison(e.target.checked); notify({ comparison: e.target.checked }); }}
                    />
                    <span style={label}>Compare to prior period</span>
                </label>
            )}

            {showEventScope && (
                <label style={field}>
                    <span style={label}>Event scope</span>
                    <select
                        value={eventId}
                        onChange={(e) => { setEventId(e.target.value); notify({ eventId: e.target.value }); }}
                        style={select}
                        disabled={eventsLoading}
                    >
                        <option value="all">All events</option>
                        {events.map((e) => (
                            <option key={e.id} value={e.id}>
                                {e.title} — {e.displayDate || e.dateIso}
                            </option>
                        ))}
                    </select>
                </label>
            )}

            {period === 'custom' && (
                <div style={customNote}>
                    Custom date range coming in Batch 11 polish — for now this falls back to
                    last 30 days.
                </div>
            )}
        </div>
    );
}

const wrap = {
    display: 'flex',
    gap: '1rem',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    padding: '1rem',
    background: 'var(--color-bg-sunken)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
};

const field = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
};

const checkboxField = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '0.5rem',
};

const label = {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: 'var(--letter-spacing-wide)',
};

const select = {
    padding: '0.4rem 0.6rem',
    background: 'var(--color-bg-page)',
    border: '1px solid var(--color-border-strong)',
    color: 'var(--color-text)',
    minWidth: 200,
};

const customNote = {
    flex: '1 1 100%',
    padding: '0.5rem',
    color: 'var(--color-text-muted)',
    fontSize: '0.85rem',
    fontStyle: 'italic',
};

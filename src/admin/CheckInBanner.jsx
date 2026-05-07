// M4 B6 — CheckInBanner: top-level admin shell banner shown when
// /api/admin/today/active reports activeEventToday=true. One-click
// deep-link to /admin/scan?event=<eventId> so BC staff can switch
// from any admin page into the scan tool when an event is in
// progress. Reuses the useTodayActive() shared subscription from
// B4b — no extra polling, just a subscriber to the cached state.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTodayActive } from '../hooks/useWidgetData.js';

export default function CheckInBanner() {
    const today = useTodayActive();
    const [dismissedThisSession, setDismissedThisSession] = useState(false);

    if (!today?.activeEventToday) return null;
    if (dismissedThisSession) return null;

    const eventId = today.eventId;
    const scanHref = eventId
        ? `/admin/scan?event=${encodeURIComponent(eventId)}`
        : '/admin/scan';

    return (
        <div
            className="admin-checkin-banner"
            role="status"
            aria-live="polite"
        >
            <span className="admin-checkin-banner__pulse" aria-hidden="true" />
            <span className="admin-checkin-banner__copy">
                <strong>Event in progress</strong>
                {today.checkInOpen && (
                    <span className="admin-checkin-banner__sub"> · check-in window open</span>
                )}
            </span>
            <Link to={scanHref} className="admin-checkin-banner__cta">
                Open scan →
            </Link>
            <button
                type="button"
                className="admin-checkin-banner__dismiss"
                aria-label="Dismiss banner"
                onClick={() => setDismissedThisSession(true)}
            >
                ×
            </button>
        </div>
    );
}

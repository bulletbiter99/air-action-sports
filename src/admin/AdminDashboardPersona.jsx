// M3 Batch 9 — persona-tailored AdminDashboard shell.
//
// Rendered in place of the legacy AdminDashboard when the
// new_admin_dashboard feature flag is enabled (off by default — see
// migration 0025 / docs/decisions.md). The legacy code path lives in
// AdminDashboard.jsx and remains the fallback so flipping the flag
// back to off is an instant rollback with no redeploy.
//
// This shell:
//   1. Reads the calling user from useAdmin()
//   2. Resolves a widget layout for the user's role via personaLayouts.js
//   3. Renders the listed widgets in order
//
// The "+ New Booking" CTA from the legacy header is preserved so manager+
// users still have one-click manual booking access from the dashboard.

import { Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import { resolveLayout, personaLabel } from './personaLayouts.js';
import { WIDGETS } from './widgets/PersonaWidgets.jsx';
import './widgets/PersonaWidgets.css';

export default function AdminDashboardPersona() {
    const { user, hasRole } = useAdmin();
    const layout = resolveLayout(user);
    // M4 B4b: prefer persona for the label; fall back to role until a
    // persona-selection UI ships (B4d+) and every user has persona set.
    const personaKey = user?.persona ?? user?.role;

    return (
        <div className="admin-persona-dashboard">
            <header className="admin-persona-dashboard__header">
                <div>
                    <h1>Dashboard</h1>
                    <p className="admin-persona-dashboard__subtitle">
                        {user?.displayName || user?.email || 'Admin'}{' '}
                        <span className="admin-persona-dashboard__persona-tag">
                            {personaLabel(personaKey)}
                        </span>
                    </p>
                </div>
                {hasRole?.('owner', 'manager') && (
                    <Link to="/admin/new-booking" className="admin-persona-dashboard__cta">
                        + New Booking
                    </Link>
                )}
            </header>

            <div className="admin-persona-dashboard__grid">
                {layout.map((widgetKey) => {
                    const Component = WIDGETS[widgetKey];
                    if (!Component) {
                        // Defensive: layout config references an unimplemented widget.
                        // Render a placeholder rather than crashing the dashboard so
                        // the rest of the page stays usable.
                        return (
                            <section
                                key={widgetKey}
                                className="admin-persona-widget admin-persona-widget--placeholder"
                            >
                                <h2>{widgetKey}</h2>
                                <p>Widget not implemented.</p>
                            </section>
                        );
                    }
                    return <Component key={widgetKey} />;
                })}
            </div>
        </div>
    );
}

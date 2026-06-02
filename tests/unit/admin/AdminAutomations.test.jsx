// @vitest-environment jsdom

// M8 Batch C — RTL component tests for AdminAutomations (native Marketing B5b
// list page). Same page-test pattern as AdminCampaigns: bare render() + mocked
// client fetch. The page imports only React hooks (no router/context). It makes
// two mount fetches — /api/admin/automations (the list) + /api/admin/segments
// (the modal's audience picker) — so both are mocked.

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminAutomations from '../../../src/admin/AdminAutomations.jsx';

const AUTOMATIONS = [
    { id: 'a1', name: 'Welcome new', status: 'active', triggerType: 'tag_added', triggerConfig: { tag: 'new' }, sentCount: 847, lastRunAt: 1_767_225_600_000 },
    { id: 'a2', name: 'Loyalty recurring', status: 'paused', triggerType: 'recurring', triggerConfig: { intervalDays: 14 }, sentCount: 0, lastRunAt: null },
];

function mockOk(automations = AUTOMATIONS) {
    return installClientFetch([
        { match: '/api/admin/automations', body: { automations } },
        { match: '/api/admin/segments', body: { segments: [] } },
    ]);
}

describe('AdminAutomations', () => {
    it('shows a loading state while the request is in flight', () => {
        globalThis.fetch.mockImplementation(() => new Promise(() => {}));
        render(<AdminAutomations />);
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('renders the table with trigger descriptions, last-run, and status toggles', async () => {
        mockOk();
        render(<AdminAutomations />);
        await waitFor(() => expect(screen.getByText('Welcome new')).toBeInTheDocument());
        expect(screen.getByText('Loyalty recurring')).toBeInTheDocument();
        // describeTrigger() output for each trigger type
        expect(screen.getByText('Tag added: new')).toBeInTheDocument();
        expect(screen.getByText('Every 14 days')).toBeInTheDocument();
        // a2 has a null lastRunAt → renders an em dash
        expect(screen.getByText('—')).toBeInTheDocument();
        // toggle label reflects status: active → Pause, paused → Activate
        expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
    });

    it('renders the empty state when there are no automations', async () => {
        mockOk([]);
        render(<AdminAutomations />);
        await waitFor(() => expect(screen.getByText('No automations yet.')).toBeInTheDocument());
    });

    it('surfaces a fetch error', async () => {
        installClientFetch([
            { match: '/api/admin/automations', status: 500, body: { error: 'boom' } },
            { match: '/api/admin/segments', body: { segments: [] } },
        ]);
        render(<AdminAutomations />);
        await waitFor(() => expect(screen.getByText(/^Error:/)).toBeInTheDocument());
    });
});

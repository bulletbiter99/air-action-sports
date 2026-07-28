// @vitest-environment jsdom

// B7 (2026-07-27) — the staff write endpoints that shipped with no UI caller.
//
// Each of these has been live and tested server-side since M5 while being
// unreachable from the interface: archive, certification revoke, and
// certification edit/renew (AdminStaffCertEditor already supported both modes,
// but only 'add' was ever passed).

import { describe, it, expect, vi } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { renderWithAdmin, screen, waitFor, userEvent, fireEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminStaffDetail from '../../../src/admin/AdminStaffDetail.jsx';

const PERSON = {
    id: 'per_1', fullName: 'Rebecca Vance', preferredName: null, status: 'active',
    archivedAt: null, archivedReason: null, email: 'rebecca@example.com', phone: null,
    pronouns: null, hiredAt: null, separatedAt: null,
};

const DETAIL = { person: PERSON, roles: [] };

const CERT = {
    id: 'cert_1', displayName: 'First Aid / CPR', kind: 'medical', status: 'active',
    issuingAuthority: 'Red Cross', expiresAt: Date.now() + 200 * 86400000, certificateNumber: 'FA-99',
};

function renderDetail({ admin, person = PERSON, certs = [CERT] } = {}) {
    installClientFetch([
        { match: /\/api\/admin\/certifications\?person_id=/, body: { certifications: certs } },
        { match: /\/api\/admin\/staff\/per_1$/, body: { ...DETAIL, person } },
    ]);
    return renderWithAdmin(
        <Routes>
            <Route path="/admin/staff/:id" element={<AdminStaffDetail />} />
        </Routes>,
        { route: '/admin/staff/per_1', admin },
    );
}

// Intercept only mutations; the GETs stay with installClientFetch.
//
// MUST be called AFTER render: installClientFetch mutates globalThis.fetch, so
// wrapping before renderDetail() gets silently discarded.
function interceptMutations(handler) {
    const original = globalThis.fetch;
    globalThis.fetch = (url, init) => {
        if (init?.method && init.method !== 'GET') {
            const r = handler(String(url), init);
            if (r) return Promise.resolve(r);
        }
        return original(url, init);
    };
    return () => { globalThis.fetch = original; };
}

describe('AdminStaffDetail — archive / restore', () => {
    it('offers Archive for an active person holding staff.archive', async () => {
        renderDetail({ admin: { capabilities: ['staff.archive'] } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument());
    });

    it('hides the control without the capability', async () => {
        renderDetail({ admin: { capabilities: [] } });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Rebecca Vance' })).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    });

    it('flips to "Restore to active" for an archived person', async () => {
        renderDetail({
            admin: { capabilities: ['staff.archive'] },
            person: { ...PERSON, archivedAt: 1_767_225_600_000, archivedReason: 'manual', status: 'inactive' },
        });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Restore to active' })).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    });

    it('confirms before archiving, and POSTs to /archive', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const user = userEvent.setup();
        renderDetail({ admin: { capabilities: ['staff.archive'] } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument());

        const calls = [];
        const restore = interceptMutations((url, init) => {
            calls.push({ url, method: init.method });
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        });
        await user.click(screen.getByRole('button', { name: 'Archive' }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].url).toMatch(/\/staff\/per_1\/archive$/);
        expect(window.confirm).toHaveBeenCalled();
        restore();
        window.confirm.mockRestore();
    });

    it('does nothing when the confirm is declined', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        const user = userEvent.setup();
        renderDetail({ admin: { capabilities: ['staff.archive'] } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument());

        const calls = [];
        const restore = interceptMutations((url) => { calls.push(url); return new Response('{}', { status: 200 }); });
        await user.click(screen.getByRole('button', { name: 'Archive' }));

        expect(calls).toHaveLength(0);
        restore();
        window.confirm.mockRestore();
    });

    it('restoring needs no confirm and POSTs to /unarchive', async () => {
        const user = userEvent.setup();
        renderDetail({
            admin: { capabilities: ['staff.archive'] },
            person: { ...PERSON, archivedAt: 1_767_225_600_000, status: 'inactive' },
        });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Restore to active' })).toBeInTheDocument());

        const calls = [];
        const restore = interceptMutations((url) => {
            calls.push(url);
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        });
        await user.click(screen.getByRole('button', { name: 'Restore to active' }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0]).toMatch(/\/staff\/per_1\/unarchive$/);
        restore();
    });
});

describe('AdminStaffDetail — certification actions', () => {
    async function openCertsTab(admin = { capabilities: [], hasRole: () => true }) {
        const user = userEvent.setup();
        renderDetail({ admin });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Rebecca Vance' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: /Certifications/i }));
        await waitFor(() => expect(screen.getByText('First Aid / CPR')).toBeInTheDocument());
        return user;
    }

    it('offers Edit, Renew and Revoke on an existing certification', async () => {
        await openCertsTab();
        expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Renew' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    });

    it('offers nothing on an already-revoked certification', async () => {
        const user = userEvent.setup();
        renderDetail({ admin: { hasRole: () => true }, certs: [{ ...CERT, status: 'revoked' }] });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Rebecca Vance' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: /Certifications/i }));
        await waitFor(() => expect(screen.getByText('First Aid / CPR')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    });

    it('hides the actions for a viewer who cannot edit', async () => {
        const user = userEvent.setup();
        renderDetail({ admin: { hasRole: () => false } });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Rebecca Vance' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: /Certifications/i }));
        await waitFor(() => expect(screen.getByText('First Aid / CPR')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    });

    it('confirms, then POSTs to /revoke', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const user = await openCertsTab();

        const calls = [];
        const restore = interceptMutations((url, init) => {
            calls.push({ url, method: init.method });
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        });
        fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].url).toMatch(/\/certifications\/cert_1\/revoke$/);
        expect(calls[0].method).toBe('POST');
        restore();
        window.confirm.mockRestore();
        expect(user).toBeTruthy();
    });

    it('surfaces a revoke failure instead of failing silently', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        await openCertsTab();

        const restore = interceptMutations(() => new Response(
            JSON.stringify({ error: 'Not found or already revoked' }), { status: 404 },
        ));
        fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

        expect(await screen.findByText(/Not found or already revoked/)).toBeInTheDocument();
        restore();
        window.confirm.mockRestore();
    });
});

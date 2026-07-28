// @vitest-environment jsdom

// C3 (2026-07-27) — RTL coverage for the customer-detail EDIT surface:
// contact/notes/comm-preference modals and the manual-tag composer.
// The read-only rendering of this page is covered by AdminCustomerDetail.test.jsx.
//
// canWrite = hasCapability('customers.write') && !archived, so the default
// renderWithAdmin owner (capabilities: []) sees no edit affordances at all —
// every test here opts in explicitly.

import { describe, it, expect } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { renderWithAdmin, screen, waitFor, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import AdminCustomerDetail from '../../../src/admin/AdminCustomerDetail.jsx';

const BASE_CUSTOMER = {
    id: 'cus_1', name: 'Sarah Chen', email: 'sarah@example.com', emailNormalized: 'sarah@example.com',
    phone: '555-0100', clientType: 'individual', archivedAt: null, archivedReason: null, mergedInto: null,
    totalBookings: 8, totalAttendees: 14, lifetimeValueCents: 124000, refundCount: 0,
    firstBookingAt: 1_700_000_000_000, lastBookingAt: 1_767_225_600_000,
    emailTransactional: true, emailMarketing: false, smsTransactional: false, smsMarketing: false,
    notes: 'Prefers email contact',
    viewerCanSeeBusinessFields: true, viewerCanWriteBusinessFields: true,
    hasEncryptedTaxId: false, hasEncryptedBillingAddress: false,
};

const DETAIL = {
    customer: BASE_CUSTOMER,
    bookings: [],
    tags: [{ tagType: 'system', tag: 'vip' }],
    fieldRentals: [],
};

const WRITER = { capabilities: ['customers.write'] };

function renderDetail({ admin } = {}) {
    return renderWithAdmin(
        <Routes>
            <Route path="/admin/customers/:id" element={<AdminCustomerDetail />} />
        </Routes>,
        { route: '/admin/customers/cus_1', admin },
    );
}

function withDetail(body) {
    installClientFetch([{ match: /\/api\/admin\/customers\/cus_1$/, body }]);
}

// Intercept only the mutating call, leaving the detail GET to installClientFetch.
function interceptMutations(handler) {
    const original = globalThis.fetch;
    globalThis.fetch = (url, init) => {
        if (init?.method && init.method !== 'GET') {
            const result = handler(String(url), init);
            if (result) return Promise.resolve(result);
        }
        return original(url, init);
    };
    return () => { globalThis.fetch = original; };
}

describe('AdminCustomerDetail — edit affordance gating', () => {
    it('hides every edit affordance without customers.write', async () => {
        withDetail(DETAIL);
        renderDetail();
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Sarah Chen' })).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: '+ Add tag' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit contact' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit comm preferences' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit notes' })).not.toBeInTheDocument();
    });

    it('hides edit affordances on an ARCHIVED customer even with the capability', async () => {
        // The server 409s an archived edit; the UI must not offer it either.
        withDetail({ ...DETAIL, customer: { ...BASE_CUSTOMER, archivedAt: 1_767_225_600_000 } });
        renderDetail({ admin: WRITER });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Sarah Chen' })).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: '+ Add tag' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit contact' })).not.toBeInTheDocument();
    });

    it('gives each Edit button a distinct accessible name', async () => {
        // Three buttons all labelled "Edit" is ambiguous to a screen reader.
        withDetail(DETAIL);
        renderDetail({ admin: WRITER });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Edit contact' })).toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Edit comm preferences' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Edit notes' })).toBeInTheDocument();
    });

    // These two sections used to render only when non-empty, which would have
    // put their own add buttons out of reach for exactly the customers that
    // have neither — the most likely bug in this work item.
    it('renders Notes and Tags with their add buttons when BOTH are empty', async () => {
        withDetail({ ...DETAIL, customer: { ...BASE_CUSTOMER, notes: null }, tags: [] });
        renderDetail({ admin: WRITER });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument());
        expect(screen.getByText('No notes yet.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add notes' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Tags' })).toBeInTheDocument();
        expect(screen.getByText('No tags yet.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '+ Add tag' })).toBeInTheDocument();
    });
});

describe('AdminCustomerDetail — contact + notes modals', () => {
    it('saves name and phone through PUT /:id', async () => {
        withDetail(DETAIL);
        const calls = [];
        const restore = interceptMutations((url, init) => {
            calls.push({ url, body: JSON.parse(init.body) });
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        });

        const user = userEvent.setup();
        renderDetail({ admin: WRITER });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Sarah Chen' })).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: 'Edit contact' }));
        expect(screen.getByRole('heading', { name: 'Edit contact' })).toBeInTheDocument();

        const nameInput = screen.getByRole('textbox', { name: /Name/i });
        await user.clear(nameInput);
        await user.type(nameInput, 'Sarah C');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].url).toMatch(/\/api\/admin\/customers\/cus_1$/);
        expect(calls[0].body.name).toBe('Sarah C');
        expect(calls[0].body.phone).toBe('555-0100');
        restore();
    });

    it('surfaces a server error verbatim instead of closing', async () => {
        withDetail(DETAIL);
        const restore = interceptMutations(() => new Response(
            JSON.stringify({ error: 'Cannot edit archived customer' }), { status: 409 },
        ));

        const user = userEvent.setup();
        renderDetail({ admin: WRITER });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Sarah Chen' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Edit contact' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/Cannot edit archived customer/)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Edit contact' })).toBeInTheDocument();
        restore();
    });

    it('clears notes to null rather than an empty string', async () => {
        withDetail(DETAIL);
        const calls = [];
        const restore = interceptMutations((url, init) => {
            calls.push(JSON.parse(init.body));
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        });

        const user = userEvent.setup();
        renderDetail({ admin: WRITER });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Edit notes' }));

        const box = screen.getByRole('textbox', { name: /Notes/i });
        await user.clear(box);
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].notes).toBe(null);
        restore();
    });
});

describe('AdminCustomerDetail — consent ceremony', () => {
    async function openPrefs(customerOverrides) {
        withDetail({ ...DETAIL, customer: { ...BASE_CUSTOMER, ...customerOverrides } });
        const user = userEvent.setup();
        renderDetail({ admin: WRITER });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Comm preferences' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Edit comm preferences' }));
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit comm preferences' })).toBeInTheDocument());
        return user;
    }

    it('opting OUT asks for nothing extra', async () => {
        const user = await openPrefs({ emailMarketing: true });
        await user.click(screen.getByRole('checkbox', { name: /Email marketing/ }));
        expect(screen.queryByRole('textbox', { name: /Why are they being re-subscribed/ })).not.toBeInTheDocument();
        expect(screen.getByText(/records the opt-out immediately/i)).toBeInTheDocument();
    });

    it('opting IN reveals the reason field and blocks an empty submit client-side', async () => {
        const user = await openPrefs({ emailMarketing: false });
        const restore = interceptMutations(() => new Response(JSON.stringify({ success: true }), { status: 200 }));

        await user.click(screen.getByRole('checkbox', { name: /Email marketing/ }));
        expect(screen.getByRole('textbox', { name: /Why are they being re-subscribed/ })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText(/A reason is required to re-subscribe/)).toBeInTheDocument();
        restore();
    });

    it('sends marketingOptInReason only on the opt-IN direction', async () => {
        const user = await openPrefs({ emailMarketing: false });
        const calls = [];
        const restore = interceptMutations((url, init) => {
            calls.push(JSON.parse(init.body));
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        });

        await user.click(screen.getByRole('checkbox', { name: /Email marketing/ }));
        await user.type(screen.getByRole('textbox', { name: /Why are they being re-subscribed/ }), 'Called 7/27');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].emailMarketing).toBe(true);
        expect(calls[0].marketingOptInReason).toBe('Called 7/27');
        restore();
    });

    it('omits marketingOptInReason when consent is unchanged', async () => {
        const user = await openPrefs({ emailMarketing: true });
        const calls = [];
        const restore = interceptMutations((url, init) => {
            calls.push(JSON.parse(init.body));
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        });

        await user.click(screen.getByRole('checkbox', { name: /SMS marketing/ }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].marketingOptInReason).toBeUndefined();
        expect(calls[0].emailMarketing).toBe(true);
        restore();
    });

    it('surfaces the suppression 409 from the server', async () => {
        const user = await openPrefs({ emailMarketing: false });
        const restore = interceptMutations(() => new Response(JSON.stringify({
            error: 'This address previously hard-bounced or filed a spam complaint, so it is suppressed for marketing.',
        }), { status: 409 }));

        await user.click(screen.getByRole('checkbox', { name: /Email marketing/ }));
        await user.type(screen.getByRole('textbox', { name: /Why are they being re-subscribed/ }), 'they called');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/spam complaint/)).toBeInTheDocument();
        restore();
    });
});

describe('AdminCustomerDetail — manual tags', () => {
    it('offers remove on manual tags only, never on system tags', async () => {
        withDetail({
            ...DETAIL,
            tags: [{ tagType: 'system', tag: 'vip' }, { tagType: 'manual', tag: 'reunion-2027' }],
        });
        renderDetail({ admin: WRITER });
        await waitFor(() => expect(screen.getByText('reunion-2027')).toBeInTheDocument());
        // A system tag is recomputed nightly, so removing it by hand is
        // meaningless — the affordance must not exist.
        expect(screen.getByRole('button', { name: 'Remove tag reunion-2027' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove tag vip' })).not.toBeInTheDocument();
    });

    it('posts a new tag and reloads on success', async () => {
        withDetail(DETAIL);
        const calls = [];
        const restore = interceptMutations((url, init) => {
            calls.push({ url, method: init.method, body: JSON.parse(init.body) });
            return new Response(JSON.stringify({ success: true }), { status: 201 });
        });

        const user = userEvent.setup();
        renderDetail({ admin: WRITER });
        await waitFor(() => expect(screen.getByRole('button', { name: '+ Add tag' })).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: '+ Add tag' }));
        await user.type(screen.getByRole('textbox', { name: 'New tag' }), 'reunion-2027');
        await user.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toMatch(/\/customers\/cus_1\/tags$/);
        expect(calls[0].body.tag).toBe('reunion-2027');
        restore();
    });

    it('surfaces the reserved-name rejection verbatim and keeps the input open', async () => {
        withDetail(DETAIL);
        const restore = interceptMutations(() => new Response(JSON.stringify({
            error: '"vip" is a system tag, applied automatically from booking history.',
        }), { status: 400 }));

        const user = userEvent.setup();
        renderDetail({ admin: WRITER });
        await waitFor(() => expect(screen.getByRole('button', { name: '+ Add tag' })).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: '+ Add tag' }));
        await user.type(screen.getByRole('textbox', { name: 'New tag' }), 'vip');
        await user.click(screen.getByRole('button', { name: 'Add' }));

        expect(await screen.findByText(/is a system tag/)).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'New tag' })).toBeInTheDocument();
        restore();
    });

    it('DELETEs a manual tag through the tag-scoped route', async () => {
        withDetail({ ...DETAIL, tags: [{ tagType: 'manual', tag: 'reunion-2027' }] });
        const calls = [];
        const restore = interceptMutations((url, init) => {
            calls.push({ url, method: init.method });
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        });

        const user = userEvent.setup();
        renderDetail({ admin: WRITER });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Remove tag reunion-2027' })).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Remove tag reunion-2027' }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].method).toBe('DELETE');
        expect(calls[0].url).toMatch(/\/customers\/cus_1\/tags\/reunion-2027$/);
        restore();
    });
});

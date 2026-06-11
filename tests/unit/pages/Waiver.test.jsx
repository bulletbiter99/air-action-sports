// @vitest-environment jsdom

// Validation-UX tests for the public waiver form (src/pages/Waiver.jsx).
// Locks the failed-submit behavior shipped after a customer reported the form
// "kept taking me to the top of the page" with no visible explanation:
//   * a failed submit scrolls to + focuses the FIRST invalid field (visual
//     order) instead of blindly scrolling to the top,
//   * a role="alert" summary appears above the submit button with a live count,
//   * editing a flagged field clears its highlight + updates the count,
//   * a valid submission still POSTs and shows the confirmation screen.
// First RTL suite under tests/unit/pages/ — public pages render via
// renderWithRouter (no AdminContext).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithRouter, screen, waitFor, fireEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';
import Waiver from '../../../src/pages/Waiver.jsx';

const LOAD = {
    attendee: { firstName: 'Max', lastName: 'Prudden', email: 'max@example.com', phone: '555-0100', alreadySigned: false },
    event: { title: 'FOXTROT: Jungle Warfare', displayDate: '20 June 2026', location: 'Kaysville, UT' },
    waiverDocument: { bodyHtml: '<p>Risk terms.</p>', version: 4 },
};

let scrollIntoViewSpy;
let scrollToSpy;

beforeEach(() => {
    // jsdom implements neither; the component calls both (scrollIntoView on a
    // failed submit, window.scrollTo on success / as a not-found fallback).
    scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;
    scrollToSpy = vi.fn();
    window.scrollTo = scrollToSpy;
});

async function renderForm(load = LOAD) {
    const fetchMock = installClientFetch([{ match: '/api/waivers/', body: load }]);
    renderWithRouter(<Waiver />, { route: '/waiver?token=tok_test' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Submit Waiver/ })).toBeInTheDocument());
    return fetchMock;
}

function fillAdultForm() {
    fireEvent.change(screen.getByLabelText('Date of Birth *'), { target: { value: '1990-01-01' } });
    fireEvent.change(screen.getByLabelText('Emergency Contact Name *'), { target: { value: 'Jane Prudden' } });
    fireEvent.change(screen.getByLabelText('Emergency Contact Phone *'), { target: { value: '555-0101' } });
    fireEvent.click(screen.getByLabelText(/I have read, understood, and agree/));
    fireEvent.click(screen.getByLabelText(/I consent to sign and receive this waiver electronically/));
    fireEvent.change(screen.getByPlaceholderText('Max Prudden'), { target: { value: 'Max Prudden' } });
    fireEvent.change(screen.getByLabelText('Jury Trial Waiver Initials *'), { target: { value: 'MP' } });
}

describe('Waiver validation UX', () => {
    it('failed submit focuses the first invalid field and shows an alert summary (no scroll-to-top)', async () => {
        await renderForm();

        // name/email/phone are prefilled from the attendee, so the first
        // invalid field in visual order is the date of birth.
        fireEvent.click(screen.getByRole('button', { name: /Submit Waiver/ }));

        expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText('Date of Birth *')).toHaveFocus();
        expect(scrollToSpy).not.toHaveBeenCalled();

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('7 highlighted fields');

        // Editing the focused field clears its highlight and drops the count.
        fireEvent.change(screen.getByLabelText('Date of Birth *'), { target: { value: '1990-01-01' } });
        expect(screen.getByRole('alert')).toHaveTextContent('6 highlighted fields');
        expect(screen.getByLabelText('Date of Birth *').closest('.form-group')).not.toHaveClass('error');
    });

    it('signature mismatch lands on the signature field with the mismatch message (singular copy)', async () => {
        await renderForm();
        fillAdultForm();
        fireEvent.change(screen.getByPlaceholderText('Max Prudden'), { target: { value: 'Wrong Name' } });

        fireEvent.click(screen.getByRole('button', { name: /Submit Waiver/ }));

        expect(screen.getByPlaceholderText('Max Prudden')).toHaveFocus();
        expect(screen.getByRole('alert')).toHaveTextContent('Please fix the highlighted field above');
        expect(screen.getAllByText(/Signature must match the name on your ticket/).length).toBeGreaterThan(0);
    });

    it('valid submission POSTs the waiver and shows the confirmation screen', async () => {
        const fetchMock = await renderForm();
        fillAdultForm();

        fireEvent.click(screen.getByRole('button', { name: /Submit Waiver/ }));

        await waitFor(() => expect(screen.getByText(/Waiver Submitted!/)).toBeInTheDocument());
        const post = fetchMock.mock.calls.find(([, opts]) => opts && opts.method === 'POST');
        expect(post).toBeTruthy();
        expect(post[0]).toContain('/api/waivers/tok_test');
        expect(JSON.parse(post[1].body).signature).toBe('Max Prudden');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
    });

    it('already-signed attendee sees the On File state, not the form', async () => {
        installClientFetch([{
            match: '/api/waivers/',
            body: { ...LOAD, attendee: { ...LOAD.attendee, alreadySigned: true, signedAt: 1781204721538 } },
        }]);
        renderWithRouter(<Waiver />, { route: '/waiver?token=tok_test' });
        await waitFor(() => expect(screen.getByText('Waiver On File.')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: /Submit Waiver/ })).not.toBeInTheDocument();
    });
});

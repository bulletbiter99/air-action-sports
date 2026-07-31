// @vitest-environment jsdom
//
// The printed ticket told the customer to visit
//   airactionsport.com/waiver?token=<first 8 chars>…
// which cannot resolve. This is a PRINTED page — typing is the only way to use
// the link, and the QR beside it encodes the bare token for staff check-in
// scanners, not a waiver URL. So a truncated token left the customer with no
// working route to their waiver at all.
//
// The assertion is on the FULL token being present, not merely on the URL
// looking right: an assertion like /waiver\?token=/ passes happily against the
// truncated version.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') },
}));

const Ticket = (await import('../../../src/pages/Ticket.jsx')).default;

// Real shape: qrToken is a long opaque id, which is the entire point.
const QR_TOKEN = 'qr_9fK2mZq7XbT4vLn1RcJ8dW';

function mountTicket() {
    installClientFetch([
        {
            match: '/api/waivers/',
            body: {
                attendee: { qrToken: QR_TOKEN, fullName: 'Jane Doe' },
                event: { title: 'Operation Last Light', displayDate: '25 July 2026', location: 'Ghost Town' },
            },
        },
    ]);
    // Ticket auto-calls window.print(); jsdom has no implementation.
    window.print = vi.fn();
    return renderWithRouter(<Ticket />, { route: `/booking/ticket?token=${QR_TOKEN}&auto=0` });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('Ticket — printed waiver URL', () => {
    it('prints the FULL token, not a truncated one', async () => {
        const { container } = mountTicket();
        await waitFor(() => expect(screen.getByText(/Operation Last Light/i)).toBeInTheDocument());

        const text = container.textContent;
        expect(text).toContain(`airactionsport.com/waiver?token=${QR_TOKEN}`);

        // The specific old bug: 8 chars followed by an ellipsis. Pinning the
        // absence of that pattern next to a URL is what stops a well-meaning
        // "tidy up the long token" change from silently breaking it again.
        expect(text).not.toMatch(/waiver\?token=[A-Za-z0-9_]{1,12}…/);
    });

    it('keeps the short token in the FOOTER, which is an identifier not a link', async () => {
        // Truncation is correct there — it is a support reference, not
        // something anyone types into a browser.
        const { container } = mountTicket();
        await waitFor(() => expect(screen.getByText(/Operation Last Light/i)).toBeInTheDocument());
        expect(container.textContent).toMatch(/Ticket token\s+qr_9fK2m…/);
    });

    it('omits the waiver line entirely when there is no token, rather than printing a broken URL', async () => {
        installClientFetch([
            {
                match: '/api/waivers/',
                body: {
                    attendee: { qrToken: null, fullName: 'Jane Doe' },
                    event: { title: 'Operation Last Light', displayDate: '25 July 2026', location: 'Ghost Town' },
                },
            },
        ]);
        window.print = vi.fn();
        const { container } = renderWithRouter(<Ticket />, { route: '/booking/ticket?token=x&auto=0' });
        await waitFor(() => expect(screen.getByText(/Operation Last Light/i)).toBeInTheDocument());
        expect(container.textContent).not.toContain('waiver?token=');
    });
});

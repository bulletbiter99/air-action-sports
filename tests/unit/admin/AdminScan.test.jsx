// @vitest-environment jsdom

// M8 item-1 backfill (batch A6, final) — RTL tests for AdminScan. The page
// imports @zxing/browser and calls listVideoInputDevices() on mount +
// decodeFromConstraints() on Start, neither of which jsdom can provide — so the
// module is mocked via vi.hoisted, letting each test drive the camera. The full
// camera path isn't unit-testable, but capturing the decode callback lets us
// simulate a scanned QR and exercise handleScan -> the attendee check-in card.
// Consumes useAdmin() + useSearchParams (?event= deep-link), so renderWithAdmin.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithAdmin, screen, waitFor, act, userEvent } from '../../helpers/renderComponent.jsx';
import { installClientFetch } from '../../helpers/mockClientFetch.js';

const { decodeFromConstraints, listVideoInputDevices } = vi.hoisted(() => ({
    decodeFromConstraints: vi.fn(),
    listVideoInputDevices: vi.fn(),
}));

vi.mock('@zxing/browser', () => ({
    BrowserMultiFormatReader: class {
        decodeFromConstraints(...args) { return decodeFromConstraints(...args); }
    },
    BrowserCodeReader: { listVideoInputDevices: (...args) => listVideoInputDevices(...args) },
}));

// Imported after the mock is registered (vi.mock is hoisted above imports).
import AdminScan from '../../../src/admin/AdminScan.jsx';

beforeEach(() => {
    listVideoInputDevices.mockReset().mockResolvedValue([]);
    decodeFromConstraints.mockReset().mockResolvedValue({ stop() {} });
});

describe('AdminScan', () => {
    it('renders the scanner header with the default description', () => {
        renderWithAdmin(<AdminScan />);
        expect(screen.getByRole('heading', { name: 'QR Scanner' })).toBeInTheDocument();
        expect(screen.getByText(/Scan player QR codes/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Start Camera' })).toBeInTheDocument();
    });

    it('shows "Scanning for: <event>" from the ?event= deep-link (via GET /:id/detail)', async () => {
        const fetchMock = installClientFetch([
            { match: '/api/admin/events', body: { event: { id: 'evt_1', title: 'Operation Nightfall', displayDate: 'Jun 20' } } },
        ]);
        renderWithAdmin(<AdminScan />, { route: '/admin/scan?event=evt_1' });
        await waitFor(() => expect(screen.getByText(/Scanning for: Operation Nightfall/)).toBeInTheDocument());
        // Regression guard: the old bare GET /api/admin/events/:id doesn't exist
        // on the admin router (silent 404 — the header never resolved).
        const eventUrls = fetchMock.mock.calls
            .map((c) => (typeof c[0] === 'string' ? c[0] : c[0]?.url))
            .filter((u) => u && u.includes('/api/admin/events/'));
        expect(eventUrls).toEqual(['/api/admin/events/evt_1/detail']);
    });

    it('surfaces a camera error when starting the scanner fails', async () => {
        decodeFromConstraints.mockRejectedValue(new Error('Permission denied'));
        const user = userEvent.setup();
        renderWithAdmin(<AdminScan />);
        await user.click(screen.getByRole('button', { name: 'Start Camera' }));
        expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    });

    it('handles a scanned attendee QR and shows the check-in card', async () => {
        let capturedCb = null;
        decodeFromConstraints.mockImplementation((_constraints, _video, cb) => {
            capturedCb = cb;
            return Promise.resolve({ stop() {} });
        });
        installClientFetch([
            { match: '/api/admin/rentals/lookup/', body: { type: 'attendee', qrToken: 'qr_abc' } },
            { match: '/api/admin/attendees/by-qr/', body: { attendee: { id: 'at_1', firstName: 'Sarah', lastName: 'Chen', waiverSigned: true, checkedInAt: null, qrToken: 'qr_abc' }, event: { title: 'Operation Nightfall', displayDate: 'Jun 20' }, rentalAssignments: [] } },
        ]);
        const user = userEvent.setup();
        renderWithAdmin(<AdminScan />);
        await user.click(screen.getByRole('button', { name: 'Start Camera' }));
        await waitFor(() => expect(capturedCb).toBeTruthy());
        // simulate the camera decoding a QR code
        act(() => { capturedCb({ getText: () => 'qr_token_123' }); });
        expect(await screen.findByText('Sarah Chen')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Check In' })).toBeInTheDocument();
    });

    it('shows a persistent Payment-due banner when the booking is not paid/comp', async () => {
        let capturedCb = null;
        decodeFromConstraints.mockImplementation((_constraints, _video, cb) => {
            capturedCb = cb;
            return Promise.resolve({ stop() {} });
        });
        installClientFetch([
            { match: '/api/admin/rentals/lookup/', body: { type: 'attendee', qrToken: 'qr_due' } },
            { match: '/api/admin/attendees/by-qr/', body: {
                attendee: { id: 'at_2', firstName: 'Kayden', lastName: 'Case', waiverSigned: true, checkedInAt: null, qrToken: 'qr_due' },
                booking: { id: 'bk_2', status: 'unpaid', buyerName: 'Kayden Case' },
                event: { id: 'evt_1', title: 'Operation Last Light', displayDate: 'Jul 25' },
                rentalAssignments: [],
            } },
        ]);
        const user = userEvent.setup();
        renderWithAdmin(<AdminScan />);
        await user.click(screen.getByRole('button', { name: 'Start Camera' }));
        await waitFor(() => expect(capturedCb).toBeTruthy());
        act(() => { capturedCb({ getText: () => 'qr_due' }); });
        expect(await screen.findByText(/Payment due — booking is unpaid\. Collect payment before admitting\./)).toBeInTheDocument();
    });

    it('shows no payment banner for a paid booking', async () => {
        let capturedCb = null;
        decodeFromConstraints.mockImplementation((_constraints, _video, cb) => {
            capturedCb = cb;
            return Promise.resolve({ stop() {} });
        });
        installClientFetch([
            { match: '/api/admin/rentals/lookup/', body: { type: 'attendee', qrToken: 'qr_ok' } },
            { match: '/api/admin/attendees/by-qr/', body: {
                attendee: { id: 'at_3', firstName: 'Sarah', lastName: 'Chen', waiverSigned: true, checkedInAt: null, qrToken: 'qr_ok' },
                booking: { id: 'bk_3', status: 'paid', buyerName: 'Sarah Chen' },
                event: { id: 'evt_1', title: 'Operation Last Light', displayDate: 'Jul 25' },
                rentalAssignments: [],
            } },
        ]);
        const user = userEvent.setup();
        renderWithAdmin(<AdminScan />);
        await user.click(screen.getByRole('button', { name: 'Start Camera' }));
        await waitFor(() => expect(capturedCb).toBeTruthy());
        act(() => { capturedCb({ getText: () => 'qr_ok' }); });
        expect(await screen.findByText('Sarah Chen')).toBeInTheDocument();
        expect(screen.queryByText(/Payment due/)).not.toBeInTheDocument();
    });

    it('shows a Different-event banner and confirm-gates check-in on a wrong-event scan', async () => {
        let capturedCb = null;
        decodeFromConstraints.mockImplementation((_constraints, _video, cb) => {
            capturedCb = cb;
            return Promise.resolve({ stop() {} });
        });
        const fetchMock = installClientFetch([
            { match: '/api/admin/events/', body: { event: { id: 'evt_expected', title: 'Operation Last Light' } } },
            { match: '/api/admin/rentals/lookup/', body: { type: 'attendee', qrToken: 'qr_w' } },
            { match: '/api/admin/attendees/by-qr/', body: {
                attendee: { id: 'at_4', firstName: 'Jordan', lastName: 'Reyes', waiverSigned: true, checkedInAt: null, qrToken: 'qr_w' },
                booking: { id: 'bk_4', status: 'paid', buyerName: 'Jordan Reyes' },
                event: { id: 'evt_other', title: 'Operation Fire Storm', displayDate: 'Jul 25' },
                rentalAssignments: [],
            } },
        ]);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const user = userEvent.setup();
        renderWithAdmin(<AdminScan />, { route: '/admin/scan?event=evt_expected' });
        await user.click(screen.getByRole('button', { name: 'Start Camera' }));
        await waitFor(() => expect(capturedCb).toBeTruthy());
        act(() => { capturedCb({ getText: () => 'qr_w' }); });
        expect(await screen.findByText(/this ticket is for Operation Fire Storm/)).toBeInTheDocument();

        // Declined confirm → the check-in POST must never fire.
        await user.click(screen.getByRole('button', { name: 'Check In' }));
        expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/different event \(Operation Fire Storm\)/));
        const checkInCalls = fetchMock.mock.calls
            .map((c) => (typeof c[0] === 'string' ? c[0] : c[0]?.url))
            .filter((u) => u && u.includes('/check-in'));
        expect(checkInCalls).toEqual([]);
        confirmSpy.mockRestore();
    });

    it('proceeds with a wrong-event check-in when the operator confirms', async () => {
        let capturedCb = null;
        decodeFromConstraints.mockImplementation((_constraints, _video, cb) => {
            capturedCb = cb;
            return Promise.resolve({ stop() {} });
        });
        const fetchMock = installClientFetch([
            { match: '/api/admin/events/', body: { event: { id: 'evt_expected', title: 'Operation Last Light' } } },
            { match: '/api/admin/rentals/lookup/', body: { type: 'attendee', qrToken: 'qr_y' } },
            { match: '/check-in', body: { attendee: { id: 'at_5', checkedInAt: 1234567890 } } },
            { match: '/api/admin/attendees/by-qr/', body: {
                attendee: { id: 'at_5', firstName: 'Riley', lastName: 'Ito', waiverSigned: true, checkedInAt: null, qrToken: 'qr_y' },
                booking: { id: 'bk_5', status: 'paid', buyerName: 'Riley Ito' },
                event: { id: 'evt_other', title: 'Operation Fire Storm', displayDate: 'Jul 25' },
                rentalAssignments: [],
            } },
        ]);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const user = userEvent.setup();
        renderWithAdmin(<AdminScan />, { route: '/admin/scan?event=evt_expected' });
        await user.click(screen.getByRole('button', { name: 'Start Camera' }));
        await waitFor(() => expect(capturedCb).toBeTruthy());
        act(() => { capturedCb({ getText: () => 'qr_y' }); });
        expect(await screen.findByText('Riley Ito')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Check In' }));
        await waitFor(() => {
            const checkInCalls = fetchMock.mock.calls
                .map((c) => (typeof c[0] === 'string' ? c[0] : c[0]?.url))
                .filter((u) => u && u.includes('/check-in'));
            expect(checkInCalls).toEqual(['/api/admin/attendees/at_5/check-in']);
        });
        confirmSpy.mockRestore();
    });

    it('shows an unrecognized-QR flash when the lookup 404s', async () => {
        let capturedCb = null;
        decodeFromConstraints.mockImplementation((_constraints, _video, cb) => {
            capturedCb = cb;
            return Promise.resolve({ stop() {} });
        });
        installClientFetch([
            { match: '/api/admin/rentals/lookup/', status: 404, body: {} },
        ]);
        const user = userEvent.setup();
        renderWithAdmin(<AdminScan />);
        await user.click(screen.getByRole('button', { name: 'Start Camera' }));
        await waitFor(() => expect(capturedCb).toBeTruthy());
        act(() => { capturedCb({ getText: () => 'bad_token' }); });
        expect(await screen.findByText('QR not recognized')).toBeInTheDocument();
    });
});

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

    it('shows "Scanning for: <event>" from the ?event= deep-link', async () => {
        installClientFetch([
            { match: '/api/admin/events', body: { event: { id: 'evt_1', title: 'Operation Nightfall', displayDate: 'Jun 20' } } },
        ]);
        renderWithAdmin(<AdminScan />, { route: '/admin/scan?event=evt_1' });
        await waitFor(() => expect(screen.getByText(/Scanning for: Operation Nightfall/)).toBeInTheDocument());
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

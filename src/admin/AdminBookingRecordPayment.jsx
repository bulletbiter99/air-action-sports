// C7 (2026-07-27) — record an out-of-band payment RECEIVED.
//
// The inverse of AdminBookingExternalRefund, which existed while its
// counterpart did not: there was no way to record that money for an unpaid
// booking had arrived. That is exactly what the Stripe live-cutover invoices
// needed in June, and it was done by hand with SQL.
//
// Unlike the refund modal this sends NO email. The customer already holds
// their booking and QR ticket from the original flow; "Resend confirmation"
// becomes available once the status flips and is the existing, tested path if
// a receipt is wanted.

import { useState } from 'react';
import { formatMoney } from '../utils/money.js';

const METHOD_OPTIONS = [
    { value: 'invoice', label: 'Invoice paid (Stripe invoice, bank transfer)' },
    { value: 'cash',    label: 'Cash' },
    { value: 'venmo',   label: 'Venmo' },
    { value: 'paypal',  label: 'PayPal' },
    { value: 'check',   label: 'Check' },
    { value: 'other',   label: 'Other' },
];

export default function AdminBookingRecordPayment({ booking, onClose, onSuccess }) {
    const [method, setMethod] = useState('invoice');
    const [reference, setReference] = useState('');
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const submit = async () => {
        setSubmitting(true);
        setError(null);
        try {
            const body = { method };
            if (reference.trim()) body.reference = reference.trim();
            if (note.trim()) body.note = note.trim();

            const res = await fetch(
                `/api/admin/bookings/${encodeURIComponent(booking.id)}/record-payment`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                },
            );
            const d = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(d.error || `HTTP ${res.status}`);
                return;
            }
            onSuccess?.(method);
        } catch (e) {
            setError(e?.message || 'Network error');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="abd-modal-backdrop" onClick={onClose}>
            <div className="abd-modal" onClick={(e) => e.stopPropagation()}>
                <header className="abd-modal-header">
                    <div className="abd-modal-eyebrow">Record payment received</div>
                    <h2>Mark {formatMoney(booking.totalCents)} as paid?</h2>
                    <button type="button" onClick={onClose} className="abd-modal-close" aria-label="Close">×</button>
                </header>

                <div className="abd-modal-body">
                    <p>
                        This records money received outside the normal checkout — an invoice that
                        cleared, cash at the gate, a transfer. It does <strong>not</strong> charge
                        anything through Stripe.
                    </p>
                    <ul className="abd-modal-bullets">
                        <li>Booking moves from <strong>{booking.status}</strong> to <strong>paid</strong></li>
                        <li>Payment date is set to <strong>now</strong>, so it lands in this period&apos;s revenue</li>
                        <li>Tickets are <strong>not</strong> re-counted — this booking already holds its seats</li>
                        <li>No email is sent; use <strong>Resend confirmation</strong> afterwards if the customer wants a receipt</li>
                    </ul>

                    <label className="abd-field">
                        <span className="abd-field-label">Method <span className="abd-required">*</span></span>
                        <select value={method} onChange={(e) => setMethod(e.target.value)} disabled={submitting}>
                            {METHOD_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    </label>

                    <label className="abd-field">
                        <span className="abd-field-label">Reference <span className="abd-field-optional">(optional)</span></span>
                        <input
                            type="text"
                            value={reference}
                            onChange={(e) => setReference(e.target.value)}
                            placeholder="Invoice #, Venmo txn id, check #"
                            disabled={submitting}
                            maxLength={120}
                        />
                    </label>

                    <label className="abd-field">
                        <span className="abd-field-label">Note <span className="abd-field-optional">(optional)</span></span>
                        <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Anything worth keeping in the audit trail"
                            rows={3}
                            disabled={submitting}
                            maxLength={500}
                        />
                        <span className="abd-field-counter">{note.length} / 500</span>
                    </label>

                    {error && <div className="abd-modal-error">{error}</div>}
                </div>

                <footer className="abd-modal-footer">
                    <button type="button" onClick={onClose} disabled={submitting} className="abd-btn-cancel">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={submitting}
                        className="abd-btn-confirm"
                    >
                        {submitting ? 'Recording…' : '▶ Record payment'}
                    </button>
                </footer>
            </div>
        </div>
    );
}

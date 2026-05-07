// M4 Batch 3b — out-of-band refund modal (cash / venmo / paypal / comp /
// waived). POSTs to /api/admin/bookings/:id/refund-external (B3a).
//
// D06: customer is always notified via the refund_recorded_external email
// template. There is no opt-out checkbox — the persistent banner makes
// this explicit so the operator isn't surprised.

import { useState } from 'react';
import { formatMoney } from '../utils/money.js';

const METHOD_OPTIONS = [
    { value: 'cash',   label: 'Cash' },
    { value: 'venmo',  label: 'Venmo' },
    { value: 'paypal', label: 'PayPal' },
    { value: 'comp',   label: 'Comped (no charge)' },
    { value: 'waived', label: 'Fee waived' },
];

export default function AdminBookingExternalRefund({ booking, onClose, onSuccess }) {
    const [method, setMethod] = useState('cash');
    const [reference, setReference] = useState('');
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const submitDisabled = submitting || !reason.trim() || !METHOD_OPTIONS.find((o) => o.value === method);

    const submit = async () => {
        setSubmitting(true);
        setError(null);
        try {
            const body = { method, reason: reason.trim() };
            if (reference.trim()) body.reference = reference.trim();

            const res = await fetch(`/api/admin/bookings/${encodeURIComponent(booking.id)}/refund-external`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
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
                    <div className="abd-modal-eyebrow">⚠ Record out-of-band refund</div>
                    <h2>Record {formatMoney(booking.totalCents)} refund?</h2>
                    <button type="button" onClick={onClose} className="abd-modal-close" aria-label="Close">×</button>
                </header>

                <div className="abd-modal-body">
                    <div className="abd-modal-banner">
                        Customer will be emailed automatically (<code>refund_recorded_external</code>).
                        There is no opt-out — the email confirms the refund channel + reference for the customer's records.
                    </div>

                    <p>This records a refund processed outside Stripe (cash handed over, Venmo sent, comp issued, fee waived). It does NOT issue a Stripe refund.</p>
                    <ul className="abd-modal-bullets">
                        <li>Booking will be marked <strong>refunded</strong></li>
                        <li>{booking.playerCount} ticket{booking.playerCount > 1 ? 's' : ''} will be released back to inventory</li>
                        <li>Customer aggregates (LTV, refund count) will be recomputed</li>
                        <li><strong>This action cannot be undone</strong></li>
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
                            placeholder='Venmo txn id, check #, "comp from owner", etc.'
                            disabled={submitting}
                            maxLength={120}
                        />
                    </label>

                    <label className="abd-field">
                        <span className="abd-field-label">Reason <span className="abd-required">*</span></span>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Required for the audit trail"
                            rows={3}
                            disabled={submitting}
                            maxLength={500}
                        />
                        <span className="abd-field-counter">{reason.length} / 500</span>
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
                        disabled={submitDisabled}
                        className="abd-btn-confirm abd-btn-confirm--danger"
                    >
                        {submitting ? 'Recording…' : '▶ Record refund'}
                    </button>
                </footer>
            </div>
        </div>
    );
}

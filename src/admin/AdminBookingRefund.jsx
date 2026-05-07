// M4 Batch 3b — Stripe refund modal.
//
// Used by AdminBookingsDetail.jsx for the card-paid refund path. POSTs to
// the existing /api/admin/bookings/:id/refund endpoint (B3a left this
// endpoint untouched — Group E gated). Required reason field is
// frontend-enforced; the API still accepts the reason via body and audits it.

import { useState } from 'react';
import { formatMoney } from '../utils/money.js';

const REASON_PRESETS = [
    'requested_by_customer',
    'event_cancelled',
    'duplicate_charge',
    'event_rescheduled_no_attendance',
    'other',
];

export default function AdminBookingRefund({ booking, onClose, onSuccess }) {
    const [reason, setReason] = useState('requested_by_customer');
    const [otherDetail, setOtherDetail] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const finalReason = reason === 'other' ? otherDetail.trim() : reason;
    const submitDisabled = submitting || !finalReason;

    const submit = async () => {
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(`/api/admin/bookings/${encodeURIComponent(booking.id)}/refund`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: finalReason }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(d.error || `HTTP ${res.status}`);
                return;
            }
            onSuccess?.();
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
                    <div className="abd-modal-eyebrow">⚠ Issue Stripe refund</div>
                    <h2>Refund {formatMoney(booking.totalCents)}?</h2>
                    <button type="button" onClick={onClose} className="abd-modal-close" aria-label="Close">×</button>
                </header>

                <div className="abd-modal-body">
                    <p>This will issue a Stripe refund of <strong>{formatMoney(booking.totalCents)}</strong> back to the customer's card.</p>
                    <ul className="abd-modal-bullets">
                        <li>Booking will be marked <strong>refunded</strong></li>
                        <li>{booking.playerCount} ticket{booking.playerCount > 1 ? 's' : ''} will be released back to inventory</li>
                        <li>Customer will receive the standard Stripe refund email automatically</li>
                        <li><strong>This action cannot be undone</strong></li>
                    </ul>

                    <label className="abd-field">
                        <span className="abd-field-label">Reason <span className="abd-required">*</span></span>
                        <select value={reason} onChange={(e) => setReason(e.target.value)} disabled={submitting}>
                            {REASON_PRESETS.map((r) => (
                                <option key={r} value={r}>{r.replaceAll('_', ' ')}</option>
                            ))}
                        </select>
                    </label>

                    {reason === 'other' && (
                        <label className="abd-field">
                            <span className="abd-field-label">Specify reason <span className="abd-required">*</span></span>
                            <textarea
                                value={otherDetail}
                                onChange={(e) => setOtherDetail(e.target.value)}
                                placeholder="Required when reason = other"
                                rows={3}
                                disabled={submitting}
                                maxLength={500}
                            />
                            <span className="abd-field-counter">{otherDetail.length} / 500</span>
                        </label>
                    )}

                    <div className="abd-modal-meta">
                        Idempotency key: <code>refund_{booking.id}</code> — Stripe holds this for 24h; repeated submissions return the same refund.
                    </div>

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
                        {submitting ? 'Refunding…' : '▶ Issue Stripe refund'}
                    </button>
                </footer>
            </div>
        </div>
    );
}

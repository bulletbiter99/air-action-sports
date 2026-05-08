// M5 R13 — Walk-up booking page (Surface 5).
//
// Streamlined fast-path for at-event bookings. Single-screen form with
// three sections (buyer / attendees / payment). Backed by R13's
// /api/event-day/walkup endpoint.
//
// Routed at /event/walkup. Card payment is intentionally absent — the
// M5 prompt's "Option B fallback" for card pays through the admin
// desktop, not the kiosk.

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEventDay } from './EventDayLayout.jsx';
import { enqueue } from './offlineQueue.js';

const PAYMENT_METHODS = [
    { value: 'cash', label: 'Cash' },
    { value: 'venmo', label: 'Venmo' },
    { value: 'paypal', label: 'PayPal' },
    { value: 'comp', label: 'Comp ($0)' },
];

function emptyAttendee() {
    return { firstName: '', lastName: '', ticketTypeId: '' };
}

function formatUsd(cents) {
    return `$${(cents / 100).toFixed(2)}`;
}

export default function WalkUpBooking() {
    const { activeEvent, online } = useEventDay();
    const navigate = useNavigate();

    const [ticketTypes, setTicketTypes] = useState([]);
    const [loadingTypes, setLoadingTypes] = useState(true);
    const [ticketTypesErr, setTicketTypesErr] = useState('');

    const [buyer, setBuyer] = useState({ fullName: '', email: '', phone: '' });
    const [attendees, setAttendees] = useState([emptyAttendee()]);
    const [paymentMethod, setPaymentMethod] = useState('cash');

    const [submitting, setSubmitting] = useState(false);
    const [errorText, setErrorText] = useState('');

    const loadTicketTypes = useCallback(async () => {
        if (!activeEvent?.id) return;
        setLoadingTypes(true);
        setTicketTypesErr('');
        try {
            const res = await fetch(`/api/admin/events/${encodeURIComponent(activeEvent.id)}/ticket-types`, {
                credentials: 'include', cache: 'no-store',
            });
            if (!res.ok) {
                setTicketTypesErr(`Could not load ticket types (${res.status})`);
                return;
            }
            const data = await res.json();
            const list = Array.isArray(data.ticketTypes) ? data.ticketTypes : Array.isArray(data) ? data : [];
            setTicketTypes(list.filter((t) => t.active !== 0 && t.active !== false));
        } catch (err) {
            setTicketTypesErr(err?.message || 'Network error');
        } finally {
            setLoadingTypes(false);
        }
    }, [activeEvent?.id]);

    useEffect(() => { loadTicketTypes(); }, [loadTicketTypes]);

    function updateBuyer(field, value) {
        setBuyer((b) => ({ ...b, [field]: value }));
    }

    function updateAttendee(idx, field, value) {
        setAttendees((arr) => arr.map((a, i) => (i === idx ? { ...a, [field]: value } : a)));
    }

    function addAttendeeRow() {
        setAttendees((arr) => [...arr, emptyAttendee()]);
    }

    function removeAttendeeRow(idx) {
        setAttendees((arr) => (arr.length === 1 ? arr : arr.filter((_, i) => i !== idx)));
    }

    function previewTotal() {
        if (paymentMethod === 'comp') return 0;
        const byId = new Map(ticketTypes.map((t) => [t.id, t]));
        return attendees.reduce((sum, a) => {
            const tt = byId.get(a.ticketTypeId);
            return sum + (tt?.price_cents || 0);
        }, 0);
    }

    async function submit() {
        if (!activeEvent?.id) return;
        setErrorText('');

        if (!buyer.fullName.trim() || !buyer.email.trim()) {
            setErrorText('Buyer name and email required.');
            return;
        }
        for (const [idx, a] of attendees.entries()) {
            if (!a.firstName.trim() || !a.ticketTypeId) {
                setErrorText(`Attendee #${idx + 1} needs a first name and ticket type.`);
                return;
            }
        }

        const payload = {
            buyer: {
                fullName: buyer.fullName.trim(),
                email: buyer.email.trim(),
                phone: buyer.phone.trim() || undefined,
            },
            attendees: attendees.map((a) => ({
                firstName: a.firstName.trim(),
                lastName: a.lastName?.trim() || undefined,
                ticketTypeId: a.ticketTypeId,
            })),
            paymentMethod,
        };

        setSubmitting(true);

        // Offline queue: persist payload locally; surface "queued" state.
        if (!online) {
            try {
                enqueue(localStorage, { kind: 'walkup', payload: { body: payload } });
                navigate('/event/check-in', { replace: true });
            } finally {
                setSubmitting(false);
            }
            return;
        }

        try {
            const res = await fetch('/api/event-day/walkup', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 409 && data.error === 'capacity_exceeded') {
                setErrorText(`Not enough capacity for ${data.ticketTypeName}: ${data.remaining} left, ${data.requested} requested.`);
                return;
            }
            if (!res.ok) {
                setErrorText(data.message || data.error || `Booking failed (${res.status})`);
                return;
            }
            // Navigate to the new attendee's detail page so the operator
            // can immediately check them in.
            if (data.firstQrToken) {
                navigate(`/event/attendee/${encodeURIComponent(data.firstQrToken)}`);
                return;
            }
            navigate('/event/check-in');
        } catch (err) {
            setErrorText(err?.message || 'Network error');
        } finally {
            setSubmitting(false);
        }
    }

    if (!activeEvent) {
        return (
            <div>
                <Link to="/event" className="aas-event-day__back-link">← Back</Link>
                <h1 className="aas-event-day__h1">No active event</h1>
                <p className="aas-event-day__copy">Walk-up bookings only available during an active event window.</p>
            </div>
        );
    }

    return (
        <div>
            <Link to="/event" className="aas-event-day__back-link">← Back</Link>
            <h1 className="aas-event-day__h1">Walk-up booking</h1>
            {!online && (
                <div className="aas-event-day__banner aas-event-day__banner--warn">
                    You are offline — submission will queue until network returns.
                </div>
            )}

            <section className="aas-event-day__card">
                <h2 className="aas-event-day__h2">Buyer</h2>
                <label className="aas-event-day__field">
                    <span>Full name</span>
                    <input
                        type="text"
                        value={buyer.fullName}
                        onChange={(e) => updateBuyer('fullName', e.target.value)}
                        autoFocus
                        className="aas-event-day__input"
                    />
                </label>
                <label className="aas-event-day__field">
                    <span>Email</span>
                    <input
                        type="email"
                        value={buyer.email}
                        onChange={(e) => updateBuyer('email', e.target.value)}
                        className="aas-event-day__input"
                    />
                </label>
                <label className="aas-event-day__field">
                    <span>Phone (optional)</span>
                    <input
                        type="tel"
                        value={buyer.phone}
                        onChange={(e) => updateBuyer('phone', e.target.value)}
                        className="aas-event-day__input"
                    />
                </label>
            </section>

            <section className="aas-event-day__card">
                <h2 className="aas-event-day__h2">Attendees</h2>
                {loadingTypes && <p className="aas-event-day__copy">Loading ticket types…</p>}
                {ticketTypesErr && <p className="aas-event-day__copy aas-event-day__copy--error">{ticketTypesErr}</p>}

                {!loadingTypes && !ticketTypesErr && attendees.map((a, idx) => (
                    <div key={idx} className="aas-event-day__attendee-row">
                        <label className="aas-event-day__field">
                            <span>First name</span>
                            <input
                                type="text"
                                value={a.firstName}
                                onChange={(e) => updateAttendee(idx, 'firstName', e.target.value)}
                                className="aas-event-day__input"
                            />
                        </label>
                        <label className="aas-event-day__field">
                            <span>Last name (optional)</span>
                            <input
                                type="text"
                                value={a.lastName}
                                onChange={(e) => updateAttendee(idx, 'lastName', e.target.value)}
                                className="aas-event-day__input"
                            />
                        </label>
                        <label className="aas-event-day__field">
                            <span>Ticket type</span>
                            <select
                                value={a.ticketTypeId}
                                onChange={(e) => updateAttendee(idx, 'ticketTypeId', e.target.value)}
                                className="aas-event-day__input"
                            >
                                <option value="">— Select —</option>
                                {ticketTypes.map((tt) => (
                                    <option key={tt.id} value={tt.id}>
                                        {tt.name} — {formatUsd(tt.price_cents)}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {attendees.length > 1 && (
                            <button
                                type="button"
                                onClick={() => removeAttendeeRow(idx)}
                                className="aas-event-day__inline-btn aas-event-day__inline-btn--danger"
                            >
                                Remove
                            </button>
                        )}
                    </div>
                ))}

                <button
                    type="button"
                    onClick={addAttendeeRow}
                    className="aas-event-day__action-btn"
                    disabled={loadingTypes || !!ticketTypesErr}
                >
                    + Add another attendee
                </button>
            </section>

            <section className="aas-event-day__card">
                <h2 className="aas-event-day__h2">Payment</h2>
                <div className="aas-event-day__radio-group">
                    {PAYMENT_METHODS.map((m) => (
                        <label key={m.value} className="aas-event-day__radio">
                            <input
                                type="radio"
                                name="paymentMethod"
                                value={m.value}
                                checked={paymentMethod === m.value}
                                onChange={() => setPaymentMethod(m.value)}
                            />
                            <span>{m.label}</span>
                        </label>
                    ))}
                </div>
                <div className="aas-event-day__total-preview">
                    Estimated total (pre-tax): <strong>{formatUsd(previewTotal())}</strong>
                </div>
            </section>

            {errorText && (
                <p className="aas-event-day__copy aas-event-day__copy--error">{errorText}</p>
            )}

            <div className="aas-event-day__actions-row">
                <button
                    type="button"
                    onClick={submit}
                    disabled={submitting || loadingTypes}
                    className="aas-event-day__action-btn aas-event-day__action-btn--primary"
                >
                    {submitting ? 'Submitting…' : 'Create booking'}
                </button>
            </div>
        </div>
    );
}

// M4 Batch 3b — /admin/bookings/:id detail workspace.
//
// Backed by GET /api/admin/bookings/:id (B3a). Two-column layout per
// Surface 2: left = booking summary + customer card + line items;
// right = attendees panel (with inline edit) + actions panel; bottom
// = activity log full-width.
//
// PII masking is server-side (B3a). When viewerCanSeePII === false,
// the page renders the masked values returned by the API and shows a
// "(masked)" badge so the user knows why values look obscured. No
// client-side reveal interaction (D05 interpreted as server-gated only).
//
// Refund flows are owned by two sibling modals:
//   - AdminBookingRefund.jsx          — Stripe path (paid + non-cash intent)
//   - AdminBookingExternalRefund.jsx  — out-of-band path (paid OR comp)
//
// The legacy AdminDashboard's BookingDetailModal still exists and is
// untouched in B3b. M4 B10/B12 will retire it once the new dashboard
// reaches `state='on'`.

import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import { formatMoney } from '../utils/money.js';
import AdminBookingRefund from './AdminBookingRefund.jsx';
import AdminBookingExternalRefund from './AdminBookingExternalRefund.jsx';
import './AdminBookingsDetail.css';

function dateFmt(ms) {
    return ms ? new Date(ms).toLocaleString() : '—';
}

function StatusBadge({ status }) {
    return <span className={`abd-status abd-status--${status || 'unknown'}`}>{status || '—'}</span>;
}

function MethodBadge({ method }) {
    if (!method) return <span className="abd-method-empty">—</span>;
    return <span className={`abd-method abd-method--${method}`}>{method}</span>;
}

export default function AdminBookingsDetail() {
    const { id } = useParams();
    const { isAuthenticated, hasRole } = useAdmin();

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [actionMsg, setActionMsg] = useState(null);
    const [refundOpen, setRefundOpen] = useState(false);
    const [externalRefundOpen, setExternalRefundOpen] = useState(false);
    const [resending, setResending] = useState(false);
    // M6 B9 — detach-saved-PM confirm + busy state
    const [detachPmOpen, setDetachPmOpen] = useState(false);
    const [detaching, setDetaching] = useState(false);
    // Move-to-another-event modal
    const [rescheduleOpen, setRescheduleOpen] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/admin/bookings/${encodeURIComponent(id)}`, {
                credentials: 'include', cache: 'no-store',
            });
            if (res.status === 404) {
                setError('Booking not found');
                setData(null);
                return;
            }
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                setError(j.error || `HTTP ${res.status}`);
                return;
            }
            setData(await res.json());
        } catch (e) {
            setError(e?.message || 'Network error');
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { if (isAuthenticated && id) load(); }, [isAuthenticated, id, load]);

    const flashMsg = (kind, text, ms = 4000) => {
        setActionMsg({ kind, text });
        setTimeout(() => setActionMsg(null), ms);
    };

    const resendConfirmation = async () => {
        setResending(true);
        try {
            const res = await fetch(`/api/admin/bookings/${encodeURIComponent(id)}/resend-confirmation`, {
                method: 'POST', credentials: 'include',
            });
            const j = await res.json().catch(() => ({}));
            if (res.ok) flashMsg('ok', `Confirmation re-sent to ${j.sentTo || data?.booking?.email || 'customer'}`);
            else flashMsg('err', j.error || 'Resend failed');
        } catch (e) {
            flashMsg('err', e?.message || 'Network error');
        } finally {
            setResending(false);
        }
    };

    // M6 B9 — detach the customer's saved PM (irreversible from this UI).
    const submitDetachPm = async () => {
        setDetaching(true);
        try {
            const res = await fetch(`/api/admin/bookings/${encodeURIComponent(id)}/detach-saved-pm`, {
                method: 'POST', credentials: 'include',
            });
            const j = await res.json().catch(() => ({}));
            if (res.ok && j.ok) {
                setDetachPmOpen(false);
                flashMsg(
                    'ok',
                    j.noop
                        ? 'Saved payment method was already detached — no action needed.'
                        : `Detached saved payment method ${j.detachedPaymentMethodId} from this customer. Off-session damage charges against this card are no longer possible.`,
                    6000,
                );
                await load();
            } else if (res.status === 422) {
                flashMsg('err', `No saved payment method on this booking (${j.detail || 'detail unknown'}).`);
            } else if (res.status === 502) {
                flashMsg('err', `Stripe error: ${j.message || 'request failed'}. Try again in a moment.`);
            } else if (res.status === 403) {
                flashMsg('err', 'Only owners can detach saved payment methods.');
            } else {
                flashMsg('err', j.error || `Detach failed (${res.status})`);
            }
        } catch (e) {
            flashMsg('err', e?.message || 'Network error');
        } finally {
            setDetaching(false);
        }
    };

    if (!isAuthenticated) return null;

    if (loading) {
        return (
            <div className="abd">
                <Link to="/admin/bookings" className="abd-back">← Back to bookings</Link>
                <div className="abd-loading">Loading booking…</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="abd">
                <Link to="/admin/bookings" className="abd-back">← Back to bookings</Link>
                <div className="abd-error">
                    <h2>Couldn't load booking</h2>
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    if (!data) return null;

    const { booking, event, attendees, customer, activityLog, viewerCanSeePII } = data;
    const canManagerActions = hasRole?.('manager');
    const canOwnerActions = hasRole?.('owner');
    // Stripe-refund eligibility mirrors the legacy modal's gate:
    //   paid + non-synthetic stripe_payment_intent (i.e. not cash_/venmo_/etc.)
    const stripeIntent = booking.stripePaymentIntent || '';
    const isExternalIntent = ['cash_', 'venmo_', 'paypal_', 'comp_'].some((p) => stripeIntent.startsWith(p));
    const canRefundStripe = booking.status === 'paid' && stripeIntent && !isExternalIntent;
    // External refund: paid or comp, not already refunded.
    const canRefundExternal = ['paid', 'comp'].includes(booking.status) && !booking.refundedAt;
    const canResend = ['paid', 'comp'].includes(booking.status);
    // M6 B9 — detach saved PM: owner-only, requires non-synthetic Stripe PI
    // (synthetic prefixes are cash_/venmo_/etc., no real Stripe PM behind them).
    const canDetachPM = canOwnerActions && stripeIntent && !isExternalIntent;
    // Reschedule: a paid/comp booking that hasn't been refunded can move events.
    const canReschedule = ['paid', 'comp'].includes(booking.status) && !booking.refundedAt;

    return (
        <div className="abd">
            <header className="abd-header">
                <Link to="/admin/bookings" className="abd-back">← Back to bookings</Link>
                <div className="abd-header-row">
                    <div>
                        <h1>Booking <code>{booking.id}</code></h1>
                        <p className="abd-subtitle">
                            {event?.title || 'Event missing'}
                            {event?.displayDate ? ` · ${event.displayDate}` : ''}
                        </p>
                    </div>
                    <StatusBadge status={booking.status} />
                </div>
                {!viewerCanSeePII && (
                    <div className="abd-pii-banner">
                        Customer email + phone are masked for your role. Owner / Manager roles see full PII (with audit-log capture per view).
                    </div>
                )}
            </header>

            {actionMsg && (
                <div className={`abd-msg abd-msg--${actionMsg.kind}`}>{actionMsg.text}</div>
            )}

            <div className="abd-cols">
                {/* ────────────── Left column ────────────── */}
                <div className="abd-col">
                    <section className="abd-card">
                        <h2>Booking details</h2>
                        <Row label="Total" value={<strong>{formatMoney(booking.totalCents)}</strong>} />
                        <Row label="Subtotal" value={formatMoney(booking.subtotalCents)} />
                        {booking.taxCents > 0 && <Row label="Tax" value={formatMoney(booking.taxCents)} />}
                        {booking.feeCents > 0 && <Row label="Fee" value={formatMoney(booking.feeCents)} />}
                        <Row label="Payment" value={<MethodBadge method={booking.paymentMethod} />} />
                        <Row label="Buyer" value={
                            <>
                                <strong>{booking.fullName}</strong>
                                <div className="abd-pii-line">
                                    {booking.email}{!viewerCanSeePII && <span className="abd-pii-tag">masked</span>}
                                </div>
                                {booking.phone && (
                                    <div className="abd-pii-line">
                                        {booking.phone}{!viewerCanSeePII && <span className="abd-pii-tag">masked</span>}
                                    </div>
                                )}
                            </>
                        } />
                        <Row label="Created" value={dateFmt(booking.createdAt)} />
                        {booking.paidAt && <Row label="Paid at" value={dateFmt(booking.paidAt)} />}
                        {booking.refundedAt && (
                            <Row label="Refunded at" value={
                                <>
                                    {dateFmt(booking.refundedAt)}
                                    {booking.refundExternal && booking.refundExternalMethod && (
                                        <span className="abd-refund-tag"> · external ({booking.refundExternalMethod})</span>
                                    )}
                                </>
                            } />
                        )}
                        {booking.notes && <Row label="Notes" value={booking.notes} />}
                    </section>

                    {customer && (
                        <section className="abd-card">
                            <h2>Customer</h2>
                            <Row label="Name" value={<strong>{customer.name}</strong>} />
                            <Row label="Email" value={
                                <>
                                    {customer.email}
                                    {!viewerCanSeePII && <span className="abd-pii-tag">masked</span>}
                                </>
                            } />
                            {customer.phone && (
                                <Row label="Phone" value={
                                    <>
                                        {customer.phone}
                                        {!viewerCanSeePII && <span className="abd-pii-tag">masked</span>}
                                    </>
                                } />
                            )}
                            <Row label="Lifetime value" value={<strong>{formatMoney(customer.lifetimeValueCents)}</strong>} />
                            <Row label="Total bookings" value={customer.totalBookings} />
                            <Row label="Prior bookings" value={`${customer.priorBookingCount} (excl. this one)`} />
                            {customer.refundCount > 0 && (
                                <Row label="Refunds" value={customer.refundCount} />
                            )}
                            <Link to={`/admin/customers/${customer.id}`} className="abd-customer-link">
                                View customer →
                            </Link>
                        </section>
                    )}

                    <section className="abd-card">
                        <h2>Line items</h2>
                        <table className="abd-table">
                            <thead><tr><th>Item</th><th>Qty</th><th className="abd-num">Total</th></tr></thead>
                            <tbody>
                                {(booking.lineItems || []).filter((li) => li.type === 'ticket' || li.type === 'addon').map((li, i) => (
                                    <tr key={i}>
                                        <td>{li.name}{li.addon_type === 'rental' ? ' (rental)' : ''}</td>
                                        <td>{li.qty}</td>
                                        <td className="abd-num">{formatMoney(li.line_total_cents)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                </div>

                {/* ────────────── Right column ────────────── */}
                <div className="abd-col">
                    <section className="abd-card">
                        <h2>Attendees ({attendees?.length || 0})</h2>
                        {(attendees || []).length === 0 && (
                            <p className="abd-empty">No attendees on this booking.</p>
                        )}
                        {(attendees || []).length > 0 && (
                            <table className="abd-table abd-attendees-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Email</th>
                                        <th>Phone</th>
                                        <th>Waiver</th>
                                        <th>Check-in</th>
                                        {canManagerActions && <th></th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {attendees.map((a) => (
                                        <AttendeeRow
                                            key={a.id}
                                            attendee={a}
                                            canEdit={canManagerActions}
                                            viewerCanSeePII={viewerCanSeePII}
                                            onChanged={load}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </section>

                    {canManagerActions && (
                        <section className="abd-card abd-actions-card">
                            <h2>Actions</h2>
                            <div className="abd-actions">
                                {canResend && (
                                    <button
                                        type="button"
                                        onClick={resendConfirmation}
                                        disabled={resending}
                                        className="abd-action-btn"
                                    >
                                        {resending ? 'Sending…' : '✉ Resend confirmation'}
                                    </button>
                                )}
                                {canRefundStripe && (
                                    <button
                                        type="button"
                                        onClick={() => setRefundOpen(true)}
                                        className="abd-action-btn abd-action-btn--danger"
                                    >
                                        Issue Stripe refund
                                    </button>
                                )}
                                {canRefundExternal && (
                                    <button
                                        type="button"
                                        onClick={() => setExternalRefundOpen(true)}
                                        className="abd-action-btn abd-action-btn--danger"
                                    >
                                        Record out-of-band refund
                                    </button>
                                )}
                                {canReschedule && (
                                    <button
                                        type="button"
                                        onClick={() => setRescheduleOpen(true)}
                                        className="abd-action-btn"
                                    >
                                        ↪ Move to another event
                                    </button>
                                )}
                                {!canRefundStripe && !canRefundExternal && !canResend && !canDetachPM && !canReschedule && (
                                    <p className="abd-empty">No actions available for this booking's status.</p>
                                )}
                            </div>
                            {canDetachPM && (
                                <div className="abd-privacy-section">
                                    <h3 className="abd-privacy-title">Privacy controls</h3>
                                    <p className="abd-privacy-copy">
                                        Detach the customer&apos;s saved payment method from their Stripe Customer.
                                        Once detached, off-session damage charges (B7+) against this card are
                                        no longer possible. Use this when a customer requests their card be
                                        removed from your records. <strong>Irreversible from this UI.</strong>
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => setDetachPmOpen(true)}
                                        disabled={detaching}
                                        className="abd-action-btn abd-action-btn--danger"
                                    >
                                        Remove saved card
                                    </button>
                                </div>
                            )}
                        </section>
                    )}
                </div>
            </div>

            {/* ────────────── Activity log full-width ────────────── */}
            <section className="abd-card abd-activity">
                <h2>Activity log</h2>
                {(!activityLog || activityLog.length === 0) && (
                    <p className="abd-empty">No activity yet for this booking.</p>
                )}
                {activityLog && activityLog.length > 0 && (
                    <table className="abd-table">
                        <thead><tr><th>When</th><th>Action</th><th>By</th><th>Details</th></tr></thead>
                        <tbody>
                            {activityLog.map((row) => (
                                <tr key={row.id}>
                                    <td>{dateFmt(row.createdAt)}</td>
                                    <td><code>{row.action}</code></td>
                                    <td>{row.userId || <em>system</em>}</td>
                                    <td>
                                        {row.meta && (
                                            <code className="abd-meta">{JSON.stringify(row.meta)}</code>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>

            {refundOpen && (
                <AdminBookingRefund
                    booking={booking}
                    onClose={() => setRefundOpen(false)}
                    onSuccess={() => { setRefundOpen(false); load(); flashMsg('ok', 'Stripe refund issued'); }}
                />
            )}

            {externalRefundOpen && (
                <AdminBookingExternalRefund
                    booking={booking}
                    onClose={() => setExternalRefundOpen(false)}
                    onSuccess={(method) => {
                        setExternalRefundOpen(false);
                        load();
                        flashMsg('ok', `Out-of-band refund recorded (${method}); customer notified`);
                    }}
                />
            )}

            {/* M6 B9 — Remove-saved-card confirm modal */}
            {rescheduleOpen && (
                <RescheduleModal
                    booking={booking}
                    currentEventId={event?.id || booking.eventId}
                    onClose={() => setRescheduleOpen(false)}
                    onSuccess={(j) => {
                        setRescheduleOpen(false);
                        load();
                        const diff = j.priceDifferenceCents;
                        const diffNote = booking.status === 'paid' && diff ? ` Price difference ${formatMoney(diff)} — settle separately.` : '';
                        const mailNote = j.emailResult && !j.emailResult.error ? ' Confirmation re-sent.' : '';
                        flashMsg('ok', `Moved to ${j.toEventTitle}.${mailNote}${diffNote}`, 7000);
                    }}
                />
            )}

            {detachPmOpen && (
                <div className="abd-modal-backdrop" onClick={() => !detaching && setDetachPmOpen(false)}>
                    <div className="abd-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Remove saved payment method?</h2>
                        <p>
                            This will detach the customer&apos;s saved card from their Stripe Customer.
                            Once detached, <strong>off-session damage charges against this card are no longer possible</strong>{' '}
                            — you can still issue Stripe refunds against the original charge.
                        </p>
                        <p className="abd-modal-footnote">
                            This is irreversible from this UI. If the customer wants their card saved again,
                            they will need to make a new booking. No customer email is sent.
                        </p>
                        <div className="abd-modal-actions">
                            <button
                                type="button"
                                onClick={() => setDetachPmOpen(false)}
                                disabled={detaching}
                                className="abd-action-btn"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={submitDetachPm}
                                disabled={detaching}
                                className="abd-action-btn abd-action-btn--danger"
                            >
                                {detaching ? 'Detaching…' : 'Remove saved card'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Move-to-another-event modal. Loads events (+ their active ticket types) from
// GET /api/admin/events, lets the operator pick a target event + ticket type,
// optionally re-send the confirmation, then POSTs /reschedule.
function RescheduleModal({ booking, currentEventId, onClose, onSuccess }) {
    const [events, setEvents] = useState(null);
    const [loadErr, setLoadErr] = useState(null);
    const [targetEventId, setTargetEventId] = useState('');
    const [targetTicketTypeId, setTargetTicketTypeId] = useState('');
    const [resend, setResend] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);

    useEffect(() => {
        let alive = true;
        fetch('/api/admin/events', { credentials: 'include', cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((j) => { if (alive) setEvents((j.events || []).filter((e) => e.id !== currentEventId)); })
            .catch((e) => { if (alive) setLoadErr(e?.message || 'Failed to load events'); });
        return () => { alive = false; };
    }, [currentEventId]);

    const targetEvent = (events || []).find((e) => e.id === targetEventId);
    const ticketTypes = targetEvent?.ticketTypes || [];
    const targetTicket = ticketTypes.find((t) => t.id === targetTicketTypeId);

    const lineItems = Array.isArray(booking.lineItems) ? booking.lineItems : [];
    const ticketQty = lineItems.filter((i) => i.type === 'ticket').reduce((s, i) => s + (i.qty || 0), 0) || booking.playerCount || 1;
    const paidTicketCents = lineItems.filter((i) => i.type === 'ticket').reduce((s, i) => s + (i.unitPriceCents || 0) * (i.qty || 0), 0);
    const priceDiff = targetTicket ? (targetTicket.priceCents || 0) * ticketQty - paidTicketCents : 0;

    const submit = async () => {
        setErr(null); setBusy(true);
        try {
            const res = await fetch(`/api/admin/bookings/${encodeURIComponent(booking.id)}/reschedule`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetEventId, targetTicketTypeId, resendConfirmation: resend }),
            });
            const j = await res.json().catch(() => ({}));
            if (res.ok && j.ok) onSuccess(j);
            else setErr(j.error || `Failed (${res.status})`);
        } catch (e) {
            setErr(e?.message || 'Network error');
        } finally {
            setBusy(false);
        }
    };

    const labelStyle = { display: 'block', fontSize: '13px', marginBottom: '0.25rem', marginTop: '0.85rem' };

    return (
        <div className="abd-modal-backdrop" onClick={() => !busy && onClose()}>
            <div className="abd-modal" onClick={(e) => e.stopPropagation()}>
                <h2>Move to another event</h2>
                <p>
                    Moves this booking and its {ticketQty} attendee{ticketQty === 1 ? '' : 's'} to a different event.
                    The same booking ID and QR ticket{ticketQty === 1 ? '' : 's'} stay valid.
                </p>
                {loadErr && <p className="abd-msg abd-msg--err">{loadErr}</p>}
                {!events && !loadErr && <p className="abd-empty">Loading events…</p>}
                {events && (
                    <>
                        <label style={labelStyle}>Target event</label>
                        <select
                            style={{ width: '100%' }}
                            value={targetEventId}
                            onChange={(e) => { setTargetEventId(e.target.value); setTargetTicketTypeId(''); }}
                        >
                            <option value="">Select an event…</option>
                            {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                        </select>

                        {targetEvent && (
                            <>
                                <label style={labelStyle}>Ticket type</label>
                                <select
                                    style={{ width: '100%' }}
                                    value={targetTicketTypeId}
                                    onChange={(e) => setTargetTicketTypeId(e.target.value)}
                                >
                                    <option value="">Select a ticket type…</option>
                                    {ticketTypes.map((t) => (
                                        <option key={t.id} value={t.id}>
                                            {t.name}{t.priceCents != null ? ` — ${formatMoney(t.priceCents)}` : ''}
                                        </option>
                                    ))}
                                </select>
                                {ticketTypes.length === 0 && (
                                    <p className="abd-modal-footnote">This event has no active ticket types.</p>
                                )}
                            </>
                        )}

                        {targetTicket && booking.status === 'paid' && priceDiff !== 0 && (
                            <p className="abd-modal-footnote">
                                They paid {formatMoney(paidTicketCents)} for tickets; {targetTicket.name} is{' '}
                                {formatMoney((targetTicket.priceCents || 0) * ticketQty)} ({priceDiff > 0 ? '+' : ''}{formatMoney(priceDiff)}).{' '}
                                <strong>Moving won&apos;t change what they paid</strong> — settle any difference separately via refund.
                            </p>
                        )}

                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                            <input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} />
                            <span>Email the customer an updated confirmation for the new event</span>
                        </label>
                    </>
                )}
                {err && <p className="abd-msg abd-msg--err" style={{ marginTop: '0.75rem' }}>{err}</p>}
                <div className="abd-modal-actions">
                    <button type="button" onClick={onClose} disabled={busy} className="abd-action-btn">Cancel</button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={busy || !targetEventId || !targetTicketTypeId}
                        className="abd-action-btn"
                    >
                        {busy ? 'Moving…' : 'Move booking'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Row({ label, value }) {
    return (
        <div className="abd-row">
            <div className="abd-row-label">{label}</div>
            <div className="abd-row-value">{value || '—'}</div>
        </div>
    );
}

function AttendeeRow({ attendee: a, canEdit, viewerCanSeePII, onChanged }) {
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState({
        firstName: a.firstName || '', lastName: a.lastName || '',
        email: a.email || '', phone: a.phone || '',
    });
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState(null);
    const [waiverSending, setWaiverSending] = useState(false);

    const save = async () => {
        setSaving(true); setErr(null);
        try {
            const res = await fetch(`/api/admin/attendees/${encodeURIComponent(a.id)}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            if (res.ok) {
                setEditing(false);
                onChanged?.();
            } else {
                const d = await res.json().catch(() => ({}));
                setErr(d.error || 'Save failed');
            }
        } catch (e) {
            setErr(e?.message || 'Network error');
        } finally {
            setSaving(false);
        }
    };

    const resendWaiver = async () => {
        setWaiverSending(true);
        try {
            const res = await fetch(`/api/admin/attendees/${encodeURIComponent(a.id)}/send-waiver`, {
                method: 'POST', credentials: 'include',
            });
            if (res.ok) {
                onChanged?.();
            }
        } finally {
            setWaiverSending(false);
        }
    };

    if (editing) {
        return (
            <tr>
                <td colSpan={canEdit ? 6 : 5}>
                    <div className="abd-edit-grid">
                        <input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                        <input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                        <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                        <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                        <button type="button" onClick={save} disabled={saving} className="abd-edit-save">
                            {saving ? '…' : 'Save'}
                        </button>
                        <button type="button" onClick={() => { setEditing(false); setErr(null); }} className="abd-edit-cancel">×</button>
                    </div>
                    {a.waiverSigned && (
                        <div className="abd-edit-warn">
                            ⚠ Waiver already signed — stored signature won't be altered
                        </div>
                    )}
                    {err && <div className="abd-edit-err">{err}</div>}
                </td>
            </tr>
        );
    }

    return (
        <tr>
            <td><strong>{a.firstName} {a.lastName}</strong></td>
            <td>
                {a.email || '—'}
                {a.email && !viewerCanSeePII && <span className="abd-pii-tag">masked</span>}
            </td>
            <td>
                {a.phone || '—'}
                {a.phone && !viewerCanSeePII && <span className="abd-pii-tag">masked</span>}
            </td>
            <td>{a.waiverSigned ? <span className="abd-yes">✓ Signed</span> : <span className="abd-pending">Pending</span>}</td>
            <td>{a.checkedIn ? <span className="abd-yes">✓</span> : '—'}</td>
            {canEdit && (
                <td className="abd-attendee-actions">
                    <button type="button" onClick={() => setEditing(true)} className="abd-edit-btn">Edit</button>
                    {!a.waiverSigned && (
                        <button type="button" onClick={resendWaiver} disabled={waiverSending} className="abd-edit-btn">
                            {waiverSending ? '…' : '✉ Waiver'}
                        </button>
                    )}
                </td>
            )}
        </tr>
    );
}

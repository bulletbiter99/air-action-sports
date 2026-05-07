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
    // Stripe-refund eligibility mirrors the legacy modal's gate:
    //   paid + non-synthetic stripe_payment_intent (i.e. not cash_/venmo_/etc.)
    const stripeIntent = booking.stripePaymentIntent || '';
    const isExternalIntent = ['cash_', 'venmo_', 'paypal_', 'comp_'].some((p) => stripeIntent.startsWith(p));
    const canRefundStripe = booking.status === 'paid' && stripeIntent && !isExternalIntent;
    // External refund: paid or comp, not already refunded.
    const canRefundExternal = ['paid', 'comp'].includes(booking.status) && !booking.refundedAt;
    const canResend = ['paid', 'comp'].includes(booking.status);

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
                                {!canRefundStripe && !canRefundExternal && !canResend && (
                                    <p className="abd-empty">No actions available for this booking's status.</p>
                                )}
                            </div>
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

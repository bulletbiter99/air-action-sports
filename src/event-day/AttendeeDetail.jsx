// M5 R13 — Attendee detail page for event-day check-in (Surface 5).
//
// Renders post-scan or post-search context for a single attendee, plus
// the Lead-Marshal waiver-block override UI. Backed by R13's
// /api/event-day/checkin/by-qr + /api/event-day/checkin/:id endpoints.
//
// Routed at /event/attendee/:qrToken. Use cases:
//   1. Operator scans a QR -> AdminScan-style flow navigates here
//      with the token in the URL.
//   2. Operator pastes a token in CheckIn.jsx -> navigates here.
//   3. Operator finishes a walk-up (WalkUpBooking) -> navigates here
//      with the new attendee's qrToken to immediately check them in.

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useEventDay } from './EventDayLayout.jsx';
import { enqueue } from './offlineQueue.js';

function formatStatus(attendee) {
    if (attendee.checkedInAt) return { label: '✓ Checked in', cls: 'aas-event-day__status--ok' };
    if (!attendee.waiverId) return { label: '⚠ Waiver missing', cls: 'aas-event-day__status--warn' };
    return { label: 'Ready to check in', cls: 'aas-event-day__status--info' };
}

export default function AttendeeDetail() {
    const { qrToken } = useParams();
    const { online } = useEventDay();
    const navigate = useNavigate();

    const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'wrong_event' | 'not_found' | 'error' | 'success'
    const [attendee, setAttendee] = useState(null);
    const [booking, setBooking] = useState(null);
    const [canBypass, setCanBypass] = useState(false);
    const [errorText, setErrorText] = useState('');

    const [bypassOpen, setBypassOpen] = useState(false);
    const [bypassReason, setBypassReason] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const lookup = useCallback(async () => {
        if (!qrToken) return;
        setPhase('loading');
        setErrorText('');
        try {
            const res = await fetch('/api/event-day/checkin/by-qr', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ qrToken }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 404 && data.error === 'wrong_event') {
                setPhase('wrong_event');
                setErrorText(`Ticket is for a different event.`);
                return;
            }
            if (res.status === 404) {
                setPhase('not_found');
                return;
            }
            if (!res.ok) {
                setPhase('error');
                setErrorText(data.error || `Lookup failed (${res.status})`);
                return;
            }
            setAttendee(data.attendee);
            setBooking(data.booking);
            setCanBypass(Boolean(data.canBypass));
            setPhase('ready');
        } catch (err) {
            setPhase('error');
            setErrorText(err?.message || 'Network error');
        }
    }, [qrToken]);

    useEffect(() => { lookup(); }, [lookup]);

    async function performCheckIn(opts = {}) {
        if (!attendee) return;
        const { bypassWaiver, bypassReason: reason } = opts;
        setSubmitting(true);
        try {
            const body = {};
            if (bypassWaiver) {
                body.bypassWaiver = true;
                body.bypassReason = reason || '';
            }

            // Offline queue: when offline, persist the action locally and
            // surface a "queued for replay" state. The shell's online
            // listener triggers replayQueue.
            if (!online) {
                enqueue(localStorage, {
                    kind: 'checkin',
                    payload: { attendeeId: attendee.id, body },
                });
                setPhase('success');
                setAttendee((a) => ({ ...a, checkedInAt: Date.now(), _queued: true }));
                return;
            }

            const res = await fetch(`/api/event-day/checkin/${encodeURIComponent(attendee.id)}`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 409 && data.error === 'waiver_required') {
                setCanBypass(Boolean(data.canBypass));
                setBypassOpen(true);
                return;
            }
            if (!res.ok) {
                setErrorText(data.error || `Check-in failed (${res.status})`);
                return;
            }
            setAttendee((a) => ({ ...a, checkedInAt: data.attendee?.checkedInAt || Date.now() }));
            setPhase('success');
            setBypassOpen(false);
            setBypassReason('');
        } catch (err) {
            setErrorText(err?.message || 'Network error');
        } finally {
            setSubmitting(false);
        }
    }

    if (phase === 'loading') {
        return (
            <div>
                <Link to="/event/check-in" className="aas-event-day__back-link">← Back</Link>
                <p className="aas-event-day__loading">Looking up ticket…</p>
            </div>
        );
    }

    if (phase === 'not_found') {
        return (
            <div>
                <Link to="/event/check-in" className="aas-event-day__back-link">← Back</Link>
                <h1 className="aas-event-day__h1">QR not recognized</h1>
                <p className="aas-event-day__copy">
                    No ticket found for this code. Confirm the customer&apos;s booking
                    confirmation email or ask them to re-display the QR.
                </p>
                <button type="button" onClick={lookup} className="aas-event-day__action-btn">Try again</button>
            </div>
        );
    }

    if (phase === 'wrong_event') {
        return (
            <div>
                <Link to="/event/check-in" className="aas-event-day__back-link">← Back</Link>
                <h1 className="aas-event-day__h1">Ticket is for a different event</h1>
                <p className="aas-event-day__copy">
                    This ticket belongs to another event. Direct the customer to the
                    correct check-in station, or call the Lead Marshal for help.
                </p>
            </div>
        );
    }

    if (phase === 'error') {
        return (
            <div>
                <Link to="/event/check-in" className="aas-event-day__back-link">← Back</Link>
                <h1 className="aas-event-day__h1">Lookup failed</h1>
                <p className="aas-event-day__copy aas-event-day__copy--error">{errorText}</p>
                <button type="button" onClick={lookup} className="aas-event-day__action-btn">Try again</button>
            </div>
        );
    }

    const status = formatStatus(attendee);

    return (
        <div>
            <Link to="/event/check-in" className="aas-event-day__back-link">← Back</Link>
            <h1 className="aas-event-day__h1">{attendee.fullName || attendee.firstName || '—'}</h1>

            <section className="aas-event-day__card">
                <div className={`aas-event-day__status ${status.cls}`}>{status.label}</div>
                <dl className="aas-event-day__defs">
                    <dt>Ticket</dt><dd>{attendee.ticketTypeName || attendee.ticketTypeId || '—'}</dd>
                    <dt>Event</dt><dd>{booking?.eventId || '—'}</dd>
                    <dt>Buyer</dt><dd>{booking?.buyerName || '—'}{booking?.buyerEmail ? ` · ${booking.buyerEmail}` : ''}</dd>
                    <dt>Waiver</dt><dd>{attendee.waiverSignedAt ? `Signed ${new Date(attendee.waiverSignedAt).toLocaleDateString()}` : 'Not on file'}{attendee.waiverIsMinor ? ' (minor)' : ''}</dd>
                </dl>
            </section>

            {phase === 'success' && (
                <div className="aas-event-day__banner aas-event-day__banner--ok">
                    {attendee._queued
                        ? 'Queued for replay when network returns.'
                        : 'Checked in.'}
                    {' '}
                    <button
                        type="button"
                        onClick={() => navigate('/event/check-in')}
                        className="aas-event-day__inline-btn"
                    >
                        Check in another →
                    </button>
                </div>
            )}

            {phase !== 'success' && (
                <div className="aas-event-day__actions-row">
                    {!attendee.waiverId && !bypassOpen ? (
                        <button
                            type="button"
                            onClick={() => performCheckIn()}
                            disabled={submitting}
                            className="aas-event-day__action-btn aas-event-day__action-btn--primary"
                        >
                            {submitting ? 'Working…' : 'Check in'}
                        </button>
                    ) : null}

                    {attendee.waiverId && (
                        <button
                            type="button"
                            onClick={() => performCheckIn()}
                            disabled={submitting || Boolean(attendee.checkedInAt)}
                            className="aas-event-day__action-btn aas-event-day__action-btn--primary"
                        >
                            {submitting ? 'Working…' : (attendee.checkedInAt ? 'Already checked in' : 'Check in')}
                        </button>
                    )}
                </div>
            )}

            {bypassOpen && (
                <section className="aas-event-day__card aas-event-day__card--warn">
                    <h2 className="aas-event-day__h2">Override missing waiver</h2>
                    {!canBypass ? (
                        <p className="aas-event-day__copy aas-event-day__copy--error">
                            You don&apos;t have authority to override missing waivers. Find
                            the Lead Marshal or Event Director.
                        </p>
                    ) : (
                        <>
                            <p className="aas-event-day__copy">
                                Lead Marshal override. Why are you allowing this attendee to
                                play without a signed waiver?
                            </p>
                            <textarea
                                value={bypassReason}
                                onChange={(e) => setBypassReason(e.target.value)}
                                rows={3}
                                placeholder="e.g. Player has waiver in their email but cannot pull it up; I verified ID."
                                className="aas-event-day__textarea"
                            />
                            <div className="aas-event-day__actions-row">
                                <button
                                    type="button"
                                    onClick={() => { setBypassOpen(false); setBypassReason(''); }}
                                    className="aas-event-day__action-btn"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => performCheckIn({ bypassWaiver: true, bypassReason })}
                                    disabled={submitting || !bypassReason.trim()}
                                    className="aas-event-day__action-btn aas-event-day__action-btn--primary"
                                >
                                    {submitting ? 'Working…' : 'Override and check in'}
                                </button>
                            </div>
                        </>
                    )}
                </section>
            )}

            {errorText && phase === 'ready' && (
                <p className="aas-event-day__copy aas-event-day__copy--error">{errorText}</p>
            )}
        </div>
    );
}

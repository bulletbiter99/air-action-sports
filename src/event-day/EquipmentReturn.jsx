// M5 Batch 14 — Equipment return scaffolding.
// R14: switched from the admin rentals routes (silent 401 under the
// portal cookie used in event-day mode) to the new
// /api/event-day/equipment-return endpoints, which are gated by
// requireEventDayAuth and locked to the active event server-side.
// R16: extended with the damage-charge fast-path. After a damaged/lost
// return is recorded, an inline form posts to /api/event-day/damage-charge
// to create the booking_charges row (Option B email-link payment per
// the M5 prompt). Within-cap charges email immediately; above-cap
// charges enter the admin /admin/booking-charges queue for review.

import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function EquipmentReturn() {
    const [token, setToken] = useState('');
    const [item, setItem] = useState(null);
    const [condition, setCondition] = useState('good');
    const [notes, setNotes] = useState('');
    const [status, setStatus] = useState(null);

    // R16 damage-charge form state — only surfaces after a damaged/lost
    // return is recorded. The completed assignment id is captured so
    // the charge POST has the link target.
    const [chargePending, setChargePending] = useState(null); // { assignmentId, condition }
    const [chargeAmount, setChargeAmount] = useState('');
    const [chargeReasonKind, setChargeReasonKind] = useState('damage');
    const [chargeDescription, setChargeDescription] = useState('');
    const [chargeSubmitting, setChargeSubmitting] = useState(false);

    async function lookup() {
        setStatus(null);
        const res = await fetch('/api/event-day/equipment-return/lookup', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrToken: token }),
        });
        if (res.ok) setItem(await res.json());
        else {
            const data = await res.json().catch(() => ({}));
            setStatus({ kind: 'err', text: data.error === 'wrong_event' ? 'Wrong event' : 'Not found' });
        }
    }

    async function complete() {
        if (!item?.assignment?.id) return;
        const assignmentId = item.assignment.id;
        const res = await fetch(
            `/api/event-day/equipment-return/${encodeURIComponent(assignmentId)}/complete`,
            {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ condition, notes }),
            },
        );
        if (res.ok) {
            setStatus({ kind: 'ok', text: 'Equipment returned' });
            // R16: surface the damage-charge form when condition is
            // chargeable (R14's endpoint also returns requiresChargeReview
            // = true for damaged/lost; we use the local condition since
            // it's authoritative at submit time). Otherwise reset cleanly.
            if (condition === 'damaged' || condition === 'lost') {
                setChargePending({ assignmentId, condition });
                setChargeReasonKind(condition === 'lost' ? 'lost' : 'damage');
            } else {
                setItem(null); setToken(''); setNotes(''); setCondition('good');
            }
        } else {
            const data = await res.json().catch(() => ({}));
            setStatus({ kind: 'err', text: data.error === 'already_returned' ? 'Already returned' : 'Return failed' });
        }
    }

    async function submitDamageCharge() {
        if (!chargePending?.assignmentId) return;
        const cents = Math.round(Number(chargeAmount) * 100);
        if (!Number.isInteger(cents) || cents <= 0) {
            setStatus({ kind: 'err', text: 'Amount must be greater than $0.00' });
            return;
        }
        setChargeSubmitting(true);
        try {
            const res = await fetch('/api/event-day/damage-charge', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    assignmentId: chargePending.assignmentId,
                    reasonKind: chargeReasonKind,
                    amountCents: cents,
                    description: chargeDescription.trim() || undefined,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setStatus({ kind: 'err', text: data.error || `Charge failed (${res.status})` });
                return;
            }
            // Distinct success copy depending on routing.
            const successText = data.approvalRequired
                ? `Charge $${(cents / 100).toFixed(2)} queued for Lead Marshal review (above your role's cap).`
                : `Charge $${(cents / 100).toFixed(2)} sent — customer will receive email link.`;
            setStatus({ kind: 'ok', text: successText });
            // Reset for next item.
            setChargePending(null);
            setChargeAmount('');
            setChargeReasonKind('damage');
            setChargeDescription('');
            setItem(null); setToken(''); setNotes(''); setCondition('good');
        } finally {
            setChargeSubmitting(false);
        }
    }

    function skipCharge() {
        // Operator chose not to charge — just reset and continue.
        setChargePending(null);
        setChargeAmount('');
        setChargeDescription('');
        setItem(null); setToken(''); setNotes(''); setCondition('good');
    }

    return (
        <div>
            <Link to="/event" style={back}>← Back</Link>
            <h1 style={h1}>Equipment Return</h1>

            <div style={card}>
                <label style={lbl}>Item QR/serial
                    <input type="text" value={token} onChange={(e) => setToken(e.target.value)} style={input} placeholder="rt_..." autoFocus />
                </label>
                <button type="button" onClick={lookup} style={primaryBtn} disabled={!token}>Look up</button>
            </div>

            {status && <div style={status.kind === 'ok' ? okBox : errBox}>{status.text}</div>}

            {item?.assignment && (
                <div style={card}>
                    <h2 style={h2}>{item.item?.name || 'Item'}</h2>
                    <p style={{ color: '#bbb' }}>Assigned to: {item.attendee?.fullName || '—'}</p>

                    <label style={lbl}>Condition on return
                        <select value={condition} onChange={(e) => setCondition(e.target.value)} style={input}>
                            <option value="good">Good</option>
                            <option value="fair">Fair</option>
                            <option value="damaged">Damaged</option>
                            <option value="lost">Lost</option>
                        </select>
                    </label>

                    {(condition === 'damaged' || condition === 'lost') && (
                        <label style={lbl}>Damage notes
                            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={input} />
                        </label>
                    )}

                    <button type="button" onClick={complete} style={primaryBtn}>Complete Return</button>
                </div>
            )}

            {chargePending && (
                <div style={card}>
                    <h2 style={h2}>Create damage charge</h2>
                    <p style={{ color: '#ffaa44', marginTop: 0, fontSize: 13 }}>
                        Equipment was returned <strong>{chargePending.condition}</strong>. Enter
                        the replacement / repair amount; the customer will receive an email
                        link to pay (above your cap → Lead Marshal review).
                    </p>

                    <label style={lbl}>Reason
                        <select
                            value={chargeReasonKind}
                            onChange={(e) => setChargeReasonKind(e.target.value)}
                            style={input}
                        >
                            <option value="damage">Damage</option>
                            <option value="lost">Lost</option>
                            <option value="late_return">Late return</option>
                            <option value="cleaning">Cleaning</option>
                            <option value="other">Other</option>
                        </select>
                    </label>

                    <label style={lbl}>Amount (USD)
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={chargeAmount}
                            onChange={(e) => setChargeAmount(e.target.value)}
                            style={input}
                            placeholder="25.00"
                            autoFocus
                        />
                    </label>

                    <label style={lbl}>Description (optional)
                        <textarea
                            value={chargeDescription}
                            onChange={(e) => setChargeDescription(e.target.value)}
                            rows={3}
                            style={input}
                            placeholder="e.g. Hopper crack near feed-tube; visible on inspection."
                        />
                    </label>

                    <button
                        type="button"
                        onClick={submitDamageCharge}
                        disabled={chargeSubmitting || !chargeAmount}
                        style={primaryBtn}
                    >
                        {chargeSubmitting ? 'Submitting…' : 'Create charge'}
                    </button>
                    <button
                        type="button"
                        onClick={skipCharge}
                        disabled={chargeSubmitting}
                        style={{
                            ...primaryBtn,
                            background: 'transparent',
                            color: '#fff',
                            border: '1px solid #555',
                            marginTop: 8,
                        }}
                    >
                        Skip charge — done with this item
                    </button>
                </div>
            )}
        </div>
    );
}

const back = { color: '#ff8800', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'none' };
const h1 = { fontSize: 28, fontWeight: 900, margin: '12px 0 24px' };
const h2 = { fontSize: 20, fontWeight: 800, margin: '0 0 8px' };
const card = { background: '#1a1a1a', border: '1px solid #333', padding: 16, marginBottom: 16, borderRadius: 4 };
const lbl = { display: 'block', fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 };
const input = { width: '100%', padding: 14, background: '#000', border: '1px solid #555', color: '#fff', fontSize: 16, marginTop: 6, boxSizing: 'border-box', fontFamily: 'inherit' };
const primaryBtn = { padding: '14px 32px', background: '#ff8800', color: '#000', border: 0, fontSize: 16, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', minHeight: 56, width: '100%' };
const okBox = { background: '#003300', border: '1px solid #5fba5f', color: '#5fba5f', padding: 12, marginBottom: 16, borderRadius: 4 };
const errBox = { background: '#330000', border: '1px solid #ff5050', color: '#ff5050', padding: 12, marginBottom: 16, borderRadius: 4 };

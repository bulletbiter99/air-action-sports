// M5.5 Batch 8 — Field Rental detail page. 2-column layout per Surface 7 §6.
//
// Left column: status / schedule / customer / activity log
// Right column: requirements / documents (with upload modals) / payments
//               (with record/refund modals) / quick actions
//
// Mutations:
//   PUT  /api/admin/field-rentals/:id           — basic edits
//   POST /api/admin/field-rentals/:id/status    — non-cancel transitions
//   POST /api/admin/field-rentals/:id/cancel    — cancel + reason + deposit-retained
//   POST /api/admin/field-rentals/:id/archive   — terminal-status-only archive
//   POST /api/admin/field-rentals/:id/reschedule — re-runs conflict check
//   POST /api/admin/field-rental-documents      — multipart upload
//   POST /api/admin/field-rental-documents/:id/retire
//   POST /api/admin/field-rental-payments       — record payment (kind-gated cap)
//   PUT  /api/admin/field-rental-payments/:id   — pending → received
//   POST /api/admin/field-rental-payments/:id/refund — refund (gated by field_rentals.refund)
//
// Capability awareness: /api/admin/auth/me returns capabilities[]; we hide
// buttons the viewer can't action. Server still enforces.

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { classifyStatus, classifyCoiStatus } from './AdminFieldRentals.jsx';

// ────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ────────────────────────────────────────────────────────────────────

/**
 * Flattens a conflict-detection response into a banner-friendly list with
 * category labels. Defensive against missing fields.
 *
 * @returns {Array<{ kind: string, id: string, label: string, startsAt?: number, endsAt?: number }>}
 */
export function mergeConflictsForBanner(conflictsResponse) {
    if (!conflictsResponse || typeof conflictsResponse !== 'object') return [];
    const out = [];
    for (const ev of conflictsResponse.events || []) {
        if (!ev?.id) continue;
        out.push({ kind: 'event', id: ev.id, label: ev.title || ev.id, dateIso: ev.date_iso || null });
    }
    for (const blk of conflictsResponse.blackouts || []) {
        if (!blk?.id) continue;
        out.push({
            kind: 'blackout', id: blk.id,
            label: blk.reason || '(no reason)',
            startsAt: blk.starts_at, endsAt: blk.ends_at,
        });
    }
    for (const fr of conflictsResponse.fieldRentals || []) {
        if (!fr?.id) continue;
        out.push({
            kind: 'fieldRental', id: fr.id,
            label: `Rental ${fr.id}`,
            startsAt: fr.starts_at, endsAt: fr.ends_at,
        });
    }
    return out;
}

/**
 * { completed, total, percent } for the 5-requirement checklist on a rental.
 */
export function computeRequirementsProgress(rental) {
    const r = rental?.requirements || {};
    const flags = [
        ['coiReceived', r.coiReceived],
        ['agreementSigned', r.agreementSigned],
        ['depositReceived', r.depositReceived],
        ['briefingScheduled', r.briefingScheduled],
        ['walkthroughCompleted', r.walkthroughCompleted],
    ];
    const completed = flags.filter(([, v]) => Boolean(v)).length;
    return { completed, total: 5, percent: Math.round((completed / 5) * 100) };
}

/**
 * Returns the array of valid `to` statuses for a given `from`, mirroring the
 * server's worker/lib/fieldRentals.js STATUS_TRANSITIONS table. Kept inline
 * (rather than imported from worker/) because the worker bundle isn't part of
 * the SPA — Vite would refuse the cross-bundle import.
 */
export function allowedNextStatuses(from) {
    const TRANSITIONS = {
        lead:      ['draft', 'cancelled'],
        draft:     ['sent', 'cancelled'],
        sent:      ['agreed', 'draft', 'cancelled'],
        agreed:    ['paid', 'sent', 'cancelled'],
        paid:      ['completed', 'refunded'],
        completed: ['refunded'],
        cancelled: ['refunded'],
        refunded:  [],
    };
    return TRANSITIONS[from] || [];
}

// ────────────────────────────────────────────────────────────────────
// Inline styles
// ────────────────────────────────────────────────────────────────────

const containerStyle = { padding: 'var(--space-24)' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-16)' };
const backLinkStyle = { color: 'var(--text-secondary, #666)', textDecoration: 'none', fontSize: 13 };
const titleStyle = { fontSize: 24, fontWeight: 700, margin: '4px 0 0' };
const gridStyle = { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-16)' };
const cardStyle = {
    background: 'var(--surface-card, white)', border: '1px solid var(--border-soft, #e0e0e0)',
    borderRadius: 4, padding: 'var(--space-16)', marginBottom: 'var(--space-16)',
};
const sectionTitleStyle = { fontSize: 13, textTransform: 'uppercase', color: 'var(--text-secondary, #666)', margin: '0 0 var(--space-8)', fontWeight: 600 };
const dlStyle = { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 13, margin: 0 };
const dtStyle = { color: 'var(--text-secondary, #666)' };
const ddStyle = { margin: 0 };
const badgeStyle = (cls) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 12,
    background: cls.bg, color: cls.color, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
});
const errorStyle = { background: '#fef0f0', border: '1px solid #d4541a', padding: 'var(--space-12)', borderRadius: 4, marginBottom: 'var(--space-12)' };
const primaryBtn = {
    background: 'var(--orange-strong, #d4541a)', color: 'white', border: 'none',
    padding: '8px 16px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: 13,
};
const ghostBtn = {
    background: 'white', color: 'var(--text-primary, #333)', border: '1px solid var(--border-soft, #d0d0d0)',
    padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 13,
};
const dangerBtn = {
    background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca',
    padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 13,
};
const modalBg = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '5vh', zIndex: 1000 };
const modalBox = { background: 'var(--surface-card, white)', padding: 'var(--space-24)', borderRadius: 4, minWidth: 480, maxWidth: 640, maxHeight: '85vh', overflowY: 'auto' };
const fieldRow = { marginBottom: 'var(--space-12)' };
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary, #666)' };
const inputStyle = { width: '100%', padding: '8px 12px', border: '1px solid var(--border-soft, #d0d0d0)', borderRadius: 4, fontSize: 14 };

function moneyFmt(c) { return Number.isFinite(Number(c)) ? `$${(Number(c) / 100).toFixed(2)}` : '—'; }
function dateFmt(ms) { return Number.isFinite(Number(ms)) ? new Date(Number(ms)).toLocaleString() : '—'; }

// ────────────────────────────────────────────────────────────────────
// Modal: change status
// ────────────────────────────────────────────────────────────────────

function StatusModal({ rental, onClose, onSubmit }) {
    const allowed = allowedNextStatuses(rental.status);
    const [to, setTo] = useState(allowed[0] || '');
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!to) return;
        setSubmitting(true); setErr('');
        try {
            await onSubmit({ to, reason: reason || null });
            onClose();
        } catch (e2) { setErr(e2.message); }
        finally { setSubmitting(false); }
    };

    return (
        <div style={modalBg} onClick={onClose}>
            <form style={modalBox} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
                <h3 style={{ marginTop: 0 }}>Change status</h3>
                {err && <div style={errorStyle}>{err}</div>}
                <div style={fieldRow}>
                    <label style={labelStyle}>From</label>
                    <span style={badgeStyle(classifyStatus(rental.status))}>{classifyStatus(rental.status).label}</span>
                </div>
                <div style={fieldRow}>
                    <label style={labelStyle} htmlFor="status-to">To</label>
                    <select id="status-to" style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} required>
                        {allowed.map((s) => <option key={s} value={s}>{classifyStatus(s).label}</option>)}
                    </select>
                </div>
                <div style={fieldRow}>
                    <label style={labelStyle} htmlFor="status-reason">Reason (optional)</label>
                    <input id="status-reason" style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" style={ghostBtn} onClick={onClose}>Cancel</button>
                    <button type="submit" style={primaryBtn} disabled={submitting || !to}>{submitting ? 'Saving…' : 'Change'}</button>
                </div>
            </form>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────
// Modal: cancel rental
// ────────────────────────────────────────────────────────────────────

function CancelModal({ onClose, onSubmit }) {
    const [reason, setReason] = useState('');
    const [depositRetained, setDepositRetained] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState('');

    return (
        <div style={modalBg} onClick={onClose}>
            <form
                style={modalBox}
                onClick={(e) => e.stopPropagation()}
                onSubmit={async (e) => {
                    e.preventDefault();
                    setSubmitting(true); setErr('');
                    try {
                        await onSubmit({ reason: reason || null, deposit_retained: depositRetained });
                        onClose();
                    } catch (e2) { setErr(e2.message); }
                    finally { setSubmitting(false); }
                }}
            >
                <h3 style={{ marginTop: 0 }}>Cancel rental</h3>
                {err && <div style={errorStyle}>{err}</div>}
                <div style={fieldRow}>
                    <label style={labelStyle}>Reason</label>
                    <textarea
                        style={{ ...inputStyle, minHeight: 80 }}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Optional — captured in the audit log"
                    />
                </div>
                <div style={fieldRow}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <input type="checkbox" checked={depositRetained} onChange={(e) => setDepositRetained(e.target.checked)} />
                        Deposit retained (deposit will NOT be refunded as part of this cancellation)
                    </label>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" style={ghostBtn} onClick={onClose}>Back</button>
                    <button type="submit" style={{ ...dangerBtn, fontWeight: 600 }} disabled={submitting}>{submitting ? 'Cancelling…' : 'Cancel rental'}</button>
                </div>
            </form>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────
// Modal: upload document
// ────────────────────────────────────────────────────────────────────

function UploadModal({ rentalId, kind, onClose, onUploaded }) {
    const [file, setFile] = useState(null);
    const [coi, setCoi] = useState({ carrier: '', policy: '', amountCents: '', effective: '', expires: '' });
    const [sua, setSua] = useState({ typedName: '', signedAt: new Date().toISOString().slice(0, 16) });
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!file) { setErr('Pick a file'); return; }
        setSubmitting(true); setErr('');
        try {
            const form = new FormData();
            form.append('rental_id', rentalId);
            form.append('kind', kind);
            form.append('file', file);
            if (kind === 'coi') {
                form.append('coi_carrier_name', coi.carrier);
                form.append('coi_policy_number', coi.policy);
                form.append('coi_amount_cents', String(Number(coi.amountCents) || 0));
                form.append('coi_effective_at', String(new Date(coi.effective).getTime()));
                form.append('coi_expires_at', String(new Date(coi.expires).getTime()));
            } else if (kind === 'agreement') {
                form.append('sua_signer_typed_name', sua.typedName);
                form.append('sua_signer_ip', 'admin-recorded');
                form.append('sua_signer_ua', navigator.userAgent || 'unknown');
                form.append('sua_signed_at', String(new Date(sua.signedAt).getTime()));
            }
            const res = await fetch('/api/admin/field-rental-documents', {
                method: 'POST', credentials: 'include', body: form,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            onUploaded(data.document);
            onClose();
        } catch (e2) { setErr(e2.message); }
        finally { setSubmitting(false); }
    };

    const KIND_TITLES = { coi: 'Upload COI', agreement: 'Upload Signed Agreement', addendum: 'Upload Addendum', correspondence: 'Upload Correspondence', other: 'Upload Document' };

    return (
        <div style={modalBg} onClick={onClose}>
            <form style={modalBox} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
                <h3 style={{ marginTop: 0 }}>{KIND_TITLES[kind] || 'Upload'}</h3>
                {err && <div style={errorStyle}>{err}</div>}

                <div style={fieldRow}>
                    <label style={labelStyle} htmlFor="file">File (PDF or image, up to 10MB)</label>
                    <input id="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} required />
                </div>

                {kind === 'coi' && (
                    <>
                        <div style={fieldRow}>
                            <label style={labelStyle}>Carrier name</label>
                            <input style={inputStyle} value={coi.carrier} onChange={(e) => setCoi({ ...coi, carrier: e.target.value })} required />
                        </div>
                        <div style={fieldRow}>
                            <label style={labelStyle}>Policy number</label>
                            <input style={inputStyle} value={coi.policy} onChange={(e) => setCoi({ ...coi, policy: e.target.value })} required />
                        </div>
                        <div style={fieldRow}>
                            <label style={labelStyle}>Coverage amount (cents)</label>
                            <input type="number" min="1" style={inputStyle} value={coi.amountCents} onChange={(e) => setCoi({ ...coi, amountCents: e.target.value })} required />
                            <small style={{ color: 'var(--text-secondary, #666)' }}>e.g. 100000000 = $1,000,000</small>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div style={fieldRow}>
                                <label style={labelStyle}>Effective</label>
                                <input type="date" style={inputStyle} value={coi.effective} onChange={(e) => setCoi({ ...coi, effective: e.target.value })} required />
                            </div>
                            <div style={fieldRow}>
                                <label style={labelStyle}>Expires</label>
                                <input type="date" style={inputStyle} value={coi.expires} onChange={(e) => setCoi({ ...coi, expires: e.target.value })} required />
                            </div>
                        </div>
                    </>
                )}

                {kind === 'agreement' && (
                    <>
                        <div style={fieldRow}>
                            <label style={labelStyle}>Signer typed name</label>
                            <input style={inputStyle} value={sua.typedName} onChange={(e) => setSua({ ...sua, typedName: e.target.value })} required />
                        </div>
                        <div style={fieldRow}>
                            <label style={labelStyle}>Signed at</label>
                            <input type="datetime-local" style={inputStyle} value={sua.signedAt} onChange={(e) => setSua({ ...sua, signedAt: e.target.value })} required />
                        </div>
                    </>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" style={ghostBtn} onClick={onClose}>Cancel</button>
                    <button type="submit" style={primaryBtn} disabled={submitting}>{submitting ? 'Uploading…' : 'Upload'}</button>
                </div>
            </form>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────
// Modal: record payment
// ────────────────────────────────────────────────────────────────────

function PaymentModal({ rentalId, defaultKind, onClose, onRecorded }) {
    const [kind, setKind] = useState(defaultKind || 'deposit');
    const [method, setMethod] = useState('venmo');
    const [amountCents, setAmountCents] = useState('');
    const [reference, setReference] = useState('');
    const [receivedNow, setReceivedNow] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState('');

    return (
        <div style={modalBg} onClick={onClose}>
            <form
                style={modalBox}
                onClick={(e) => e.stopPropagation()}
                onSubmit={async (e) => {
                    e.preventDefault();
                    setSubmitting(true); setErr('');
                    try {
                        const body = {
                            rental_id: rentalId,
                            payment_kind: kind,
                            payment_method: method,
                            amount_cents: Number(amountCents) || 0,
                            reference: reference || null,
                        };
                        if (receivedNow) body.received_at = Date.now();
                        const res = await fetch('/api/admin/field-rental-payments', {
                            method: 'POST', credentials: 'include',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify(body),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
                        onRecorded(data.payment);
                        onClose();
                    } catch (e2) { setErr(e2.message); }
                    finally { setSubmitting(false); }
                }}
            >
                <h3 style={{ marginTop: 0 }}>Record payment</h3>
                {err && <div style={errorStyle}>{err}</div>}

                <div style={fieldRow}>
                    <label style={labelStyle}>Kind</label>
                    <select style={inputStyle} value={kind} onChange={(e) => setKind(e.target.value)}>
                        <option value="deposit">Deposit</option>
                        <option value="balance">Balance</option>
                        <option value="full">Full (deposit + balance combined)</option>
                        <option value="damage">Damage charge</option>
                        <option value="other">Other</option>
                    </select>
                </div>
                <div style={fieldRow}>
                    <label style={labelStyle}>Method</label>
                    <select style={inputStyle} value={method} onChange={(e) => setMethod(e.target.value)}>
                        <option value="cash">Cash</option>
                        <option value="check">Check</option>
                        <option value="venmo">Venmo</option>
                        <option value="ach">ACH</option>
                        <option value="card_offplatform">Card (off-platform)</option>
                        <option value="stripe_invoice">Stripe invoice</option>
                    </select>
                </div>
                <div style={fieldRow}>
                    <label style={labelStyle}>Amount (cents)</label>
                    <input type="number" min="1" style={inputStyle} value={amountCents} onChange={(e) => setAmountCents(e.target.value)} required />
                </div>
                <div style={fieldRow}>
                    <label style={labelStyle}>Reference (check # / handle, optional)</label>
                    <input style={inputStyle} value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
                <div style={fieldRow}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                        <input type="checkbox" checked={receivedNow} onChange={(e) => setReceivedNow(e.target.checked)} />
                        Mark as received now (vs leave pending)
                    </label>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" style={ghostBtn} onClick={onClose}>Cancel</button>
                    <button type="submit" style={primaryBtn} disabled={submitting}>{submitting ? 'Recording…' : 'Record'}</button>
                </div>
            </form>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────
// Modal: refund payment
// ────────────────────────────────────────────────────────────────────

function RefundModal({ payment, onClose, onRefunded }) {
    const [refundAmount, setRefundAmount] = useState(String(payment.amountCents || ''));
    const [refundMethod, setRefundMethod] = useState(payment.paymentMethod || 'venmo');
    const [refundReason, setRefundReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState('');

    return (
        <div style={modalBg} onClick={onClose}>
            <form
                style={modalBox}
                onClick={(e) => e.stopPropagation()}
                onSubmit={async (e) => {
                    e.preventDefault();
                    setSubmitting(true); setErr('');
                    try {
                        const res = await fetch(`/api/admin/field-rental-payments/${payment.id}/refund`, {
                            method: 'POST', credentials: 'include',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                                refund_amount_cents: Number(refundAmount),
                                refund_method: refundMethod,
                                refund_reason: refundReason || null,
                            }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
                        onRefunded(data.payment);
                        onClose();
                    } catch (e2) { setErr(e2.message); }
                    finally { setSubmitting(false); }
                }}
            >
                <h3 style={{ marginTop: 0 }}>Refund payment</h3>
                {err && <div style={errorStyle}>{err}</div>}
                <p style={{ fontSize: 13, color: 'var(--text-secondary, #666)' }}>
                    Original payment: {moneyFmt(payment.amountCents)} via {payment.paymentMethod} on {dateFmt(payment.receivedAt)}.
                </p>
                <div style={fieldRow}>
                    <label style={labelStyle}>Refund amount (cents, max {payment.amountCents})</label>
                    <input type="number" min="1" max={payment.amountCents} style={inputStyle} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} required />
                </div>
                <div style={fieldRow}>
                    <label style={labelStyle}>Method</label>
                    <select style={inputStyle} value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
                        <option value="cash">Cash</option>
                        <option value="check">Check</option>
                        <option value="venmo">Venmo</option>
                        <option value="ach">ACH</option>
                        <option value="card_offplatform">Card (off-platform)</option>
                        <option value="stripe_invoice">Stripe</option>
                    </select>
                </div>
                <div style={fieldRow}>
                    <label style={labelStyle}>Reason</label>
                    <textarea style={{ ...inputStyle, minHeight: 60 }} value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" style={ghostBtn} onClick={onClose}>Cancel</button>
                    <button type="submit" style={{ ...dangerBtn, fontWeight: 600 }} disabled={submitting}>{submitting ? 'Refunding…' : 'Issue refund'}</button>
                </div>
            </form>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────

export default function AdminFieldRentalDetail() {
    const { id } = useParams();
    const [detail, setDetail] = useState(null);
    const [documents, setDocuments] = useState([]);
    const [payments, setPayments] = useState([]);
    const [caps, setCaps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [modal, setModal] = useState(null); // { kind: 'status' | 'cancel' | 'upload-coi' | ... }
    const [refundFor, setRefundFor] = useState(null);

    const nowMs = Date.now();
    const hasCap = (key) => caps.includes(key);

    const loadAll = async () => {
        setLoading(true); setErr('');
        try {
            const [detailRes, docsRes, payRes, meRes] = await Promise.all([
                fetch(`/api/admin/field-rentals/${id}`, { credentials: 'include', cache: 'no-store' }),
                fetch(`/api/admin/field-rental-documents?rental_id=${id}`, { credentials: 'include', cache: 'no-store' }),
                fetch(`/api/admin/field-rental-payments?rental_id=${id}`, { credentials: 'include', cache: 'no-store' }),
                fetch('/api/admin/auth/me', { credentials: 'include' }),
            ]);
            if (!detailRes.ok) {
                const d = await detailRes.json().catch(() => ({}));
                throw new Error(d.error || `HTTP ${detailRes.status}`);
            }
            const detailJson = await detailRes.json();
            setDetail(detailJson);

            if (docsRes.ok) {
                const j = await docsRes.json();
                setDocuments(j.documents || []);
            } else { setDocuments([]); }
            if (payRes.ok) {
                const j = await payRes.json();
                setPayments(j.payments || []);
            } else { setPayments([]); }
            if (meRes.ok) {
                const j = await meRes.json();
                setCaps(j.capabilities || []);
            }
        } catch (e) {
            setErr(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

    const action = async (path, body) => {
        const res = await fetch(path, {
            method: 'POST', credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body || {}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        await loadAll();
        return data;
    };

    const retireDoc = async (docId) => {
        if (!confirm('Retire this document?')) return;
        try {
            const res = await fetch(`/api/admin/field-rental-documents/${docId}/retire`, { method: 'POST', credentials: 'include' });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || `HTTP ${res.status}`);
            }
            await loadAll();
        } catch (e) { setErr(e.message); }
    };

    const markPaymentReceived = async (paymentId) => {
        try {
            const res = await fetch(`/api/admin/field-rental-payments/${paymentId}`, {
                method: 'PUT', credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ received_at: Date.now() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            await loadAll();
        } catch (e) { setErr(e.message); }
    };

    if (loading) return <div style={containerStyle}>Loading…</div>;
    if (err && !detail) return <div style={containerStyle}><div style={errorStyle}>{err}</div></div>;
    if (!detail) return <div style={containerStyle}>Not found.</div>;

    const { rental, contacts, site, customer } = detail;
    const status = classifyStatus(rental.status);
    const coi = classifyCoiStatus(rental.coiStatus, rental.coiExpiresAt, nowMs);
    const reqProgress = computeRequirementsProgress(rental);
    const isTerminal = ['completed', 'cancelled', 'refunded'].includes(rental.status);
    const isArchived = !!rental.archivedAt;

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <div>
                    <Link to="/admin/field-rentals" style={backLinkStyle}>← All field rentals</Link>
                    <h1 style={titleStyle}>Rental <code style={{ fontSize: 18 }}>{rental.id}</code></h1>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <span style={badgeStyle(status)}>{status.label}</span>
                    <span style={badgeStyle(coi)}>{coi.label}</span>
                    {isArchived && <span style={badgeStyle({ label: 'Archived', color: '#475569', bg: '#e5e7eb' })}>Archived</span>}
                </div>
            </div>

            {err && <div style={errorStyle}>{err}</div>}

            <div style={gridStyle}>
                {/* LEFT COLUMN */}
                <div>
                    <div style={cardStyle}>
                        <h2 style={sectionTitleStyle}>Status & lifecycle</h2>
                        <dl style={dlStyle}>
                            <dt style={dtStyle}>Status</dt>
                            <dd style={ddStyle}>{status.label} (since {dateFmt(rental.statusChangedAt)})</dd>
                            <dt style={dtStyle}>Created</dt>
                            <dd style={ddStyle}>{dateFmt(rental.createdAt)}</dd>
                            {rental.cancelledAt && (
                                <>
                                    <dt style={dtStyle}>Cancelled</dt>
                                    <dd style={ddStyle}>{dateFmt(rental.cancelledAt)} — {rental.cancellationReason || '(no reason)'}</dd>
                                </>
                            )}
                        </dl>
                        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                            {hasCap('field_rentals.write') && !isTerminal && !isArchived && allowedNextStatuses(rental.status).length > 0 && (
                                <button style={ghostBtn} onClick={() => setModal({ kind: 'status' })}>Change status</button>
                            )}
                            {hasCap('field_rentals.cancel') && !isTerminal && !isArchived && (
                                <button style={dangerBtn} onClick={() => setModal({ kind: 'cancel' })}>Cancel rental</button>
                            )}
                            {hasCap('field_rentals.archive') && isTerminal && !isArchived && (
                                <button style={ghostBtn} onClick={async () => {
                                    if (confirm('Archive this rental?')) {
                                        try { await action(`/api/admin/field-rentals/${id}/archive`); }
                                        catch (e) { setErr(e.message); }
                                    }
                                }}>Archive</button>
                            )}
                        </div>
                    </div>

                    <div style={cardStyle}>
                        <h2 style={sectionTitleStyle}>Schedule</h2>
                        <dl style={dlStyle}>
                            <dt style={dtStyle}>Starts</dt>
                            <dd style={ddStyle}>{dateFmt(rental.scheduledStartsAt)}</dd>
                            <dt style={dtStyle}>Ends</dt>
                            <dd style={ddStyle}>{dateFmt(rental.scheduledEndsAt)}</dd>
                            <dt style={dtStyle}>Site</dt>
                            <dd style={ddStyle}>{site ? <Link to={`/admin/sites/${site.id}`}>{site.name}</Link> : '—'}</dd>
                            <dt style={dtStyle}>Fields</dt>
                            <dd style={ddStyle}>{(rental.siteFieldIds || []).join(', ') || '—'}</dd>
                            <dt style={dtStyle}>Engagement</dt>
                            <dd style={ddStyle}>{(rental.engagementType || '').replace(/_/g, ' ')}</dd>
                        </dl>
                    </div>

                    <div style={cardStyle}>
                        <h2 style={sectionTitleStyle}>Customer</h2>
                        {customer ? (
                            <dl style={dlStyle}>
                                <dt style={dtStyle}>Name</dt>
                                <dd style={ddStyle}><Link to={`/admin/customers/${customer.id}`}>{customer.name || '—'}</Link></dd>
                                <dt style={dtStyle}>Email</dt>
                                <dd style={ddStyle}>{customer.email || <em style={{ color: 'var(--text-secondary, #666)' }}>(masked — need read.pii)</em>}</dd>
                                <dt style={dtStyle}>Type</dt>
                                <dd style={ddStyle}>{customer.clientType || 'individual'}</dd>
                            </dl>
                        ) : <p style={{ margin: 0, color: 'var(--text-secondary, #666)' }}>No customer linked</p>}
                    </div>

                    <div style={cardStyle}>
                        <h2 style={sectionTitleStyle}>Contacts ({contacts?.length || 0})</h2>
                        {contacts && contacts.length > 0 ? (
                            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                                {contacts.map((c) => (
                                    <li key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-soft, #f0f0f0)', fontSize: 13 }}>
                                        <strong>{c.fullName}</strong> — {c.role}{c.isPrimary ? ' (primary)' : ''}
                                        {' · '}{c.email || '—'}{' · '}{c.phone || '—'}
                                    </li>
                                ))}
                            </ul>
                        ) : <p style={{ margin: 0, color: 'var(--text-secondary, #666)' }}>No contacts on file</p>}
                    </div>
                </div>

                {/* RIGHT COLUMN */}
                <div>
                    <div style={cardStyle}>
                        <h2 style={sectionTitleStyle}>Requirements ({reqProgress.completed}/{reqProgress.total})</h2>
                        <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 13 }}>
                            {[
                                ['coiReceived', 'COI received'],
                                ['agreementSigned', 'Agreement signed'],
                                ['depositReceived', 'Deposit received'],
                                ['briefingScheduled', 'Briefing scheduled'],
                                ['walkthroughCompleted', 'Walkthrough completed'],
                            ].map(([key, label]) => (
                                <li key={key} style={{ padding: '4px 0' }}>
                                    {rental.requirements?.[key] ? '✓' : '☐'} {label}
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div style={cardStyle}>
                        <h2 style={sectionTitleStyle}>Pricing</h2>
                        <dl style={dlStyle}>
                            <dt style={dtStyle}>Site fee</dt>
                            <dd style={ddStyle}>{moneyFmt(rental.siteFeeCents)}</dd>
                            <dt style={dtStyle}>Addons</dt>
                            <dd style={ddStyle}>{(rental.addonFees || []).length} item(s)</dd>
                            <dt style={dtStyle}>Discount</dt>
                            <dd style={ddStyle}>-{moneyFmt(rental.discountCents)}</dd>
                            <dt style={dtStyle}>Tax</dt>
                            <dd style={ddStyle}>{moneyFmt(rental.taxCents)}</dd>
                            <dt style={dtStyle}>Total</dt>
                            <dd style={{ ...ddStyle, fontWeight: 700 }}>{moneyFmt(rental.totalCents)}</dd>
                        </dl>
                    </div>

                    <div style={cardStyle}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Documents</h2>
                            {hasCap('field_rentals.documents.upload') && !isArchived && (
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button style={ghostBtn} onClick={() => setModal({ kind: 'upload', docKind: 'coi' })}>+ COI</button>
                                    <button style={ghostBtn} onClick={() => setModal({ kind: 'upload', docKind: 'agreement' })}>+ Agreement</button>
                                    <button style={ghostBtn} onClick={() => setModal({ kind: 'upload', docKind: 'other' })}>+ Other</button>
                                </div>
                            )}
                        </div>
                        {documents.length === 0 ? (
                            <p style={{ margin: 0, color: 'var(--text-secondary, #666)', fontSize: 13 }}>No documents yet</p>
                        ) : (
                            <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 13 }}>
                                {documents.map((d) => (
                                    <li key={d.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-soft, #f0f0f0)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                            <div>
                                                <strong>{d.fileName}</strong>{' '}
                                                <span style={{ color: 'var(--text-secondary, #666)' }}>· {d.kind}{d.retiredAt ? ' (retired)' : ''}</span>
                                            </div>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                {hasCap('field_rentals.documents.read') && (
                                                    <a href={`/api/admin/field-rental-documents/${d.id}/download`} style={{ ...ghostBtn, textDecoration: 'none' }}>Download</a>
                                                )}
                                                {hasCap('field_rentals.documents.upload') && !d.retiredAt && (
                                                    <button style={ghostBtn} onClick={() => retireDoc(d.id)}>Retire</button>
                                                )}
                                            </div>
                                        </div>
                                        {d.kind === 'coi' && (
                                            <div style={{ fontSize: 12, color: 'var(--text-secondary, #666)' }}>
                                                Expires: {dateFmt(d.coiExpiresAt)} · Carrier: {d.coiCarrierName || '—'}
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div style={cardStyle}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Payments</h2>
                            {!isArchived && !isTerminal && (hasCap('field_rentals.deposit_record') || hasCap('field_rentals.balance_record') || hasCap('field_rentals.write')) && (
                                <button style={ghostBtn} onClick={() => setModal({ kind: 'payment', paymentKind: 'deposit' })}>+ Record</button>
                            )}
                        </div>
                        {payments.length === 0 ? (
                            <p style={{ margin: 0, color: 'var(--text-secondary, #666)', fontSize: 13 }}>No payments yet</p>
                        ) : (
                            <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 13 }}>
                                {payments.map((p) => (
                                    <li key={p.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-soft, #f0f0f0)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                            <div>
                                                <strong>{moneyFmt(p.amountCents)}</strong>{' '}
                                                <span style={{ color: 'var(--text-secondary, #666)' }}>
                                                    · {p.paymentKind} · {p.paymentMethod} · {p.status}
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                {p.status === 'pending' && (
                                                    <button style={ghostBtn} onClick={() => markPaymentReceived(p.id)}>Mark received</button>
                                                )}
                                                {p.status === 'received' && hasCap('field_rentals.refund') && (
                                                    <button style={dangerBtn} onClick={() => setRefundFor(p)}>Refund</button>
                                                )}
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 12, color: 'var(--text-secondary, #666)' }}>
                                            {p.receivedAt ? `Received ${dateFmt(p.receivedAt)}` : (p.dueAt ? `Due ${dateFmt(p.dueAt)}` : 'No due date')}
                                            {p.reference ? ` · ref: ${p.reference}` : ''}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </div>

            {modal?.kind === 'status' && (
                <StatusModal
                    rental={rental}
                    onClose={() => setModal(null)}
                    onSubmit={(body) => action(`/api/admin/field-rentals/${id}/status`, body)}
                />
            )}
            {modal?.kind === 'cancel' && (
                <CancelModal
                    onClose={() => setModal(null)}
                    onSubmit={(body) => action(`/api/admin/field-rentals/${id}/cancel`, body)}
                />
            )}
            {modal?.kind === 'upload' && (
                <UploadModal
                    rentalId={id}
                    kind={modal.docKind}
                    onClose={() => setModal(null)}
                    onUploaded={() => loadAll()}
                />
            )}
            {modal?.kind === 'payment' && (
                <PaymentModal
                    rentalId={id}
                    defaultKind={modal.paymentKind}
                    onClose={() => setModal(null)}
                    onRecorded={() => loadAll()}
                />
            )}
            {refundFor && (
                <RefundModal
                    payment={refundFor}
                    onClose={() => setRefundFor(null)}
                    onRefunded={() => { setRefundFor(null); loadAll(); }}
                />
            )}
        </div>
    );
}

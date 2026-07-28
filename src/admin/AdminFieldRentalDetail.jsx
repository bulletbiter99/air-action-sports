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
import { toDateTimeLocal } from './AdminFieldRentalNew.jsx';

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

// What the STATUS ROUTE will actually accept, which is narrower than the map
// above. `POST /:id/status` special-cases `to === 'refunded'` and 400s BEFORE
// consulting STATUS_TRANSITIONS: a rental becomes refunded as a CONSEQUENCE of
// refunding its payments, otherwise the rental would read refunded while its
// payment rows still said received.
//
// allowedNextStatuses stays a faithful mirror of the server's data map (its
// test pins exactly that). This is the separate question of what the operator
// should be OFFERED — putting `refunded` in the dropdown only ever produced an
// error they could do nothing with.
export function selectableNextStatuses(from) {
    return allowedNextStatuses(from).filter((s) => s !== 'refunded');
}

// Mirrors FIELD_RENTAL_ENGAGEMENT_TYPES in worker/lib/fieldRentals.js, which is
// the CHECK-constrained set the server accepts. Same cross-bundle constraint as
// allowedNextStatuses — the worker bundle is not part of the SPA.
export const ENGAGEMENT_TYPES = [
    { value: 'private_skirmish',  label: 'Private skirmish' },
    { value: 'paintball',         label: 'Paintball' },
    { value: 'tactical_training', label: 'Tactical training' },
    { value: 'film_shoot',        label: 'Film shoot' },
    { value: 'corporate',         label: 'Corporate' },
    { value: 'youth_program',     label: 'Youth program' },
    { value: 'other',             label: 'Other' },
];

// ────────────────────────────────────────────────────────────────────
// Inline styles
// ────────────────────────────────────────────────────────────────────

const containerStyle = { padding: 'var(--space-24)' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 'var(--space-24)' };
const backLinkStyle = { display: 'inline-block', marginBottom: '1rem', color: 'var(--tan-light)', textDecoration: 'none', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' };
const titleStyle = { fontSize: 24, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.5px', color: 'var(--cream)', margin: '0 0 4px' };
const titleCodeStyle = { fontFamily: "'SF Mono', 'Courier New', monospace", background: 'rgba(200, 184, 154, 0.08)', padding: '2px 8px', fontSize: 18, color: 'var(--tan)' };
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
const errorStyle = { background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger)', color: 'var(--color-text)', padding: 'var(--space-12)', borderRadius: 4, marginBottom: 'var(--space-12)' };
const primaryBtn = {
    background: 'var(--orange-strong, #d4541a)', color: 'white', border: 'none',
    padding: '8px 16px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: 13,
};
const ghostBtn = {
    background: 'transparent', color: 'var(--text-primary, #333)', border: '1px solid var(--border-soft, #d0d0d0)',
    padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 13,
};
const dangerBtn = {
    background: 'var(--color-danger)', color: '#fff', border: 'none',
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

// C2 (2026-07-27) — triage a rental into a scheduled booking.
//
// Both endpoints below already existed and were fully tested; the detail page
// simply never called them. A lead arriving from the public /contact inquiry
// form has site_id NULL and an epoch-0 schedule (which renders as
// "Dec 31, 1969"), and until now the only ways forward were raw SQL or
// recreating it through the wizard and cancelling the original.

function EditDetailsModal({ rental, onClose, onSaved }) {
    const [sites, setSites] = useState([]);
    const [siteId, setSiteId] = useState(rental.siteId || '');
    const [siteFieldIds, setSiteFieldIds] = useState(rental.siteFieldIds || []);
    const [engagementType, setEngagementType] = useState(rental.engagementType || ENGAGEMENT_TYPES[0].value);
    const [headcount, setHeadcount] = useState(rental.headcountEstimate ?? '');
    const [notes, setNotes] = useState(rental.notes || '');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState('');

    useEffect(() => {
        let cancelled = false;
        fetch('/api/admin/sites', { credentials: 'include', cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : { sites: [] }))
            .then((d) => { if (!cancelled) setSites(d.sites || []); })
            .catch(() => { if (!cancelled) setSites([]); });
        return () => { cancelled = true; };
    }, []);

    const selectedSite = sites.find((s) => s.id === siteId);
    const fields = selectedSite?.fields || [];

    const toggleField = (fid) => setSiteFieldIds((prev) => (
        prev.includes(fid) ? prev.filter((x) => x !== fid) : [...prev, fid]
    ));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true); setErr('');
        try {
            const body = {
                site_id: siteId || null,
                site_field_ids: siteFieldIds,
                engagement_type: engagementType,
                headcount_estimate: headcount === '' ? null : Number(headcount),
                notes: notes.trim() || null,
            };
            const res = await fetch(`/api/admin/field-rentals/${encodeURIComponent(rental.id)}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) { setErr(d.error || `HTTP ${res.status}`); return; }
            await onSaved?.();
        } catch (e2) {
            setErr(e2.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={modalBg} onClick={onClose}>
            <form style={modalBox} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
                <h3 style={{ marginTop: 0 }}>Edit details</h3>
                {err && <div style={errorStyle}>{err}</div>}

                <div style={fieldRow}>
                    <label style={labelStyle} htmlFor="fr-site">Venue</label>
                    <select
                        id="fr-site"
                        style={inputStyle}
                        value={siteId}
                        onChange={(e) => { setSiteId(e.target.value); setSiteFieldIds([]); }}
                    >
                        <option value="">— none selected —</option>
                        {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </div>

                {fields.length > 0 && (
                    <div style={fieldRow}>
                        <label style={labelStyle}>Fields</label>
                        <div>
                            {fields.map((f) => (
                                <label key={f.id} style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
                                    <input
                                        type="checkbox"
                                        checked={siteFieldIds.includes(f.id)}
                                        onChange={() => toggleField(f.id)}
                                        style={{ marginRight: 6 }}
                                    />
                                    {f.name}
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                <div style={fieldRow}>
                    <label style={labelStyle} htmlFor="fr-engagement">Engagement type</label>
                    <select id="fr-engagement" style={inputStyle} value={engagementType} onChange={(e) => setEngagementType(e.target.value)}>
                        {ENGAGEMENT_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                    </select>
                </div>

                <div style={fieldRow}>
                    <label style={labelStyle} htmlFor="fr-headcount">Expected headcount</label>
                    <input
                        id="fr-headcount" type="number" min="0" style={inputStyle}
                        value={headcount} onChange={(e) => setHeadcount(e.target.value)}
                    />
                </div>

                <div style={fieldRow}>
                    <label style={labelStyle} htmlFor="fr-notes">Notes</label>
                    <textarea id="fr-notes" rows={4} style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" style={ghostBtn} onClick={onClose}>Cancel</button>
                    <button type="submit" style={primaryBtn} disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</button>
                </div>
            </form>
        </div>
    );
}

function RescheduleModal({ rental, onClose, onSubmit, onDone }) {
    // A lead from the inquiry form has no schedule at all, so epoch 0 would
    // prefill "1969". Start from a sensible near-future window instead.
    const hasSchedule = !!rental.scheduledStartsAt;
    const defaultStart = hasSchedule ? rental.scheduledStartsAt : Date.now() + 7 * 86400000;
    const defaultEnd = rental.scheduledEndsAt && hasSchedule
        ? rental.scheduledEndsAt
        : defaultStart + 4 * 3600000;

    const [startsAt, setStartsAt] = useState(toDateTimeLocal(defaultStart));
    const [endsAt, setEndsAt] = useState(toDateTimeLocal(defaultEnd));
    const [acknowledge, setAcknowledge] = useState(false);
    const [conflicts, setConflicts] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true); setErr('');
        try {
            await onSubmit({
                scheduled_starts_at: new Date(startsAt).getTime(),
                scheduled_ends_at: new Date(endsAt).getTime(),
                ...(acknowledge ? { acknowledgeConflicts: true } : {}),
            });
            onDone?.();
        } catch (e2) {
            // The conflict engine returns 409 with the colliding rows; surface
            // them and let the operator acknowledge rather than dead-ending.
            setErr(e2.message);
            setConflicts(true);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={modalBg} onClick={onClose}>
            <form style={modalBox} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
                <h3 style={{ marginTop: 0 }}>{hasSchedule ? 'Reschedule' : 'Set schedule'}</h3>
                {err && <div style={errorStyle}>{err}</div>}

                <div style={fieldRow}>
                    <label style={labelStyle} htmlFor="fr-starts">Starts</label>
                    <input
                        id="fr-starts" type="datetime-local" style={inputStyle}
                        value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required
                    />
                </div>
                <div style={fieldRow}>
                    <label style={labelStyle} htmlFor="fr-ends">Ends</label>
                    <input
                        id="fr-ends" type="datetime-local" style={inputStyle}
                        value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required
                    />
                </div>

                {conflicts && (
                    <div style={fieldRow}>
                        <label style={{ fontSize: 13 }}>
                            <input
                                type="checkbox"
                                checked={acknowledge}
                                onChange={(e) => setAcknowledge(e.target.checked)}
                                style={{ marginRight: 6 }}
                            />
                            Book anyway, despite the conflict above
                        </label>
                    </div>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" style={ghostBtn} onClick={onClose}>Cancel</button>
                    <button type="submit" style={primaryBtn} disabled={submitting}>{submitting ? 'Saving…' : 'Save schedule'}</button>
                </div>
            </form>
        </div>
    );
}

function StatusModal({ rental, onClose, onSubmit }) {
    const allowed = selectableNextStatuses(rental.status);
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

// Sprint 4 B4 — recurrence series management on the rental detail page.
// The nightly cron has generated instances from field_rental_recurrences
// since M5.5, but no UI could create/pause/end a series (SQL-only). A rental
// that BELONGS to a series shows its series controls; a standalone rental
// offers "Make recurring", using itself as the template.
function RecurrenceCard({ rental, hasCap, isArchived, isTerminal, onChanged, onError }) {
    const [series, setSeries] = useState(null);
    const [showCreate, setShowCreate] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let alive = true;
        if (!rental.recurrenceId) { setSeries(null); return undefined; }
        fetch(`/api/admin/field-rental-recurrences/${encodeURIComponent(rental.recurrenceId)}`, {
            credentials: 'include', cache: 'no-store',
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => { if (alive) setSeries(j); })
            .catch(() => { if (alive) setSeries(null); });
        return () => { alive = false; };
    }, [rental.recurrenceId]);

    const seriesAction = async (verb, body) => {
        setBusy(true);
        try {
            const res = await fetch(`/api/admin/field-rental-recurrences/${encodeURIComponent(rental.recurrenceId)}/${verb}`, {
                method: 'POST', credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body || {}),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
            await onChanged();
        } catch (e) {
            onError(e.message);
        } finally {
            setBusy(false);
        }
    };

    // Not part of a series: offer creation (only for a live, non-generated rental).
    if (!rental.recurrenceId) {
        if (!hasCap('field_rentals.recurrence_create') || isArchived || isTerminal) return null;
        return (
            <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Recurring series</h2>
                    <button style={ghostBtn} onClick={() => setShowCreate(true)}>↻ Make recurring</button>
                </div>
                <p style={{ margin: '8px 0 0', color: 'var(--text-secondary, #666)', fontSize: 12 }}>
                    Turn this rental into the template for a repeating series — the nightly sweep
                    generates future instances out to a 90-day horizon.
                </p>
                {showCreate && (
                    <CreateRecurrenceModal
                        rental={rental}
                        onClose={() => setShowCreate(false)}
                        onCreated={() => { setShowCreate(false); onChanged(); }}
                    />
                )}
            </div>
        );
    }

    const rec = series?.recurrence;
    const canModify = hasCap('field_rentals.recurrence_modify');
    const canEnd = hasCap('field_rentals.recurrence_end');
    return (
        <div style={cardStyle}>
            <h2 style={sectionTitleStyle}>Recurring series</h2>
            {!rec && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #666)' }}>Instance {rental.recurrenceInstanceIndex ?? '—'} of series {rental.recurrenceId}</p>}
            {rec && (
                <>
                    <dl style={dlStyle}>
                        <dt style={dtStyle}>Status</dt>
                        <dd style={ddStyle}>{rec.active ? 'Active — generating nightly' : 'Paused / ended'}</dd>
                        <dt style={dtStyle}>Frequency</dt>
                        <dd style={ddStyle}>{rec.frequency}{rec.frequency === 'weekly' && rec.weekdayMask ? ` (mask ${rec.weekdayMask})` : ''}</dd>
                        <dt style={dtStyle}>Window</dt>
                        <dd style={ddStyle}>{rec.startsOn} → {rec.endsOn || 'open-ended'}{rec.maxOccurrences ? ` (max ${rec.maxOccurrences})` : ''}</dd>
                        <dt style={dtStyle}>This instance</dt>
                        <dd style={ddStyle}>#{rental.recurrenceInstanceIndex ?? '—'} of {series.instances?.length ?? '—'} generated</dd>
                        <dt style={dtStyle}>Generated through</dt>
                        <dd style={ddStyle}>{rec.generatedThrough || 'nothing yet'}</dd>
                    </dl>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        {canModify && rec.active && (
                            <button style={ghostBtn} disabled={busy} onClick={() => seriesAction('pause')}>⏸ Pause series</button>
                        )}
                        {canModify && !rec.active && (
                            <button style={ghostBtn} disabled={busy} onClick={() => seriesAction('resume')}>▶ Resume series</button>
                        )}
                        {canEnd && (
                            <button
                                style={{ ...ghostBtn, borderColor: 'var(--color-danger, #b33)', color: 'var(--color-danger, #b33)' }}
                                disabled={busy}
                                onClick={() => {
                                    // End is permanent and cancels future un-paid instances —
                                    // spell that out before acting.
                                    if (window.confirm(
                                        'End this series permanently? Future instances that are not yet '
                                        + 'paid will be CANCELLED. Paid/completed instances are untouched.',
                                    )) seriesAction('end', { reason: 'Series ended from rental detail' });
                                }}
                            >
                                ✕ End series
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

// Weekday bitmask per migration 0047: 1=Sun, 2=Mon, 4=Tue, 8=Wed, 16=Thu, 32=Fri, 64=Sat.
const WEEKDAYS = [
    ['Sun', 1], ['Mon', 2], ['Tue', 4], ['Wed', 8], ['Thu', 16], ['Fri', 32], ['Sat', 64],
];

function CreateRecurrenceModal({ rental, onClose, onCreated }) {
    // Template times derive from THIS rental's schedule, formatted in the
    // browser's local zone. The cron interprets template HH:MM as
    // America/Denver wall clock — for the Mountain-based operator these
    // agree; the times are shown for confirmation either way.
    const hhmm = (ms) => {
        const d = new Date(ms);
        const pad = (n) => String(n).padStart(2, '0');
        return Number.isFinite(d.getTime()) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
    };
    const startDate = (() => {
        const d = new Date(rental.scheduledStartsAt);
        if (!Number.isFinite(d.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    })();

    const [frequency, setFrequency] = useState('weekly');
    const [mask, setMask] = useState(() => {
        const d = new Date(rental.scheduledStartsAt);
        return Number.isFinite(d.getTime()) ? (1 << d.getDay()) : 2;
    });
    const [startsOn, setStartsOn] = useState(startDate);
    const [endsOn, setEndsOn] = useState('');
    const [maxOccurrences, setMaxOccurrences] = useState('');
    const [startsLocal, setStartsLocal] = useState(hhmm(rental.scheduledStartsAt));
    const [endsLocal, setEndsLocal] = useState(hhmm(rental.scheduledEndsAt));
    const [monthlyDay, setMonthlyDay] = useState('1');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    const submit = async () => {
        setBusy(true); setErr('');
        try {
            const body = {
                customerId: rental.customerId,
                siteId: rental.siteId,
                frequency,
                startsOn,
                endsOn: endsOn || null,
                maxOccurrences: maxOccurrences || null,
                template: {
                    engagementType: rental.engagementType,
                    siteFieldIds: (rental.siteFieldIds || []).join(','),
                    startsLocal,
                    endsLocal,
                    siteFeeCents: rental.siteFeeCents ?? 0,
                },
            };
            if (frequency === 'weekly') body.weekdayMask = mask;
            if (frequency === 'monthly') body.monthlyPattern = { kind: 'day_of_month', day: Number(monthlyDay) };
            const res = await fetch('/api/admin/field-rental-recurrences', {
                method: 'POST', credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
            window.alert(j.note || 'Series created — instances generate on the nightly sweep.');
            onCreated();
        } catch (e) {
            setErr(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={modalBg} onClick={() => !busy && onClose()}>
            <div style={modalBox} onClick={(e) => e.stopPropagation()}>
                <h2 style={sectionTitleStyle}>Make this rental recurring</h2>
                <p style={{ fontSize: 12, color: 'var(--text-secondary, #666)', marginTop: 0 }}>
                    Uses this rental as the template (site, fields, times, fee). The nightly 03:00 UTC
                    sweep generates instances out to a 90-day horizon — nothing appears immediately.
                </p>
                <label style={labelStyle}>Frequency
                    <select value={frequency} onChange={(e) => setFrequency(e.target.value)} style={inputStyle}>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly (day of month)</option>
                    </select>
                </label>
                {frequency === 'weekly' && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
                        {WEEKDAYS.map(([label, bit]) => (
                            <label key={bit} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input
                                    type="checkbox"
                                    checked={(mask & bit) !== 0}
                                    onChange={(e) => setMask((m) => (e.target.checked ? m | bit : m & ~bit))}
                                />
                                {label}
                            </label>
                        ))}
                    </div>
                )}
                {frequency === 'monthly' && (
                    <label style={labelStyle}>Day of month (1–31)
                        <input type="number" min="1" max="31" value={monthlyDay} onChange={(e) => setMonthlyDay(e.target.value)} style={inputStyle} />
                    </label>
                )}
                <label style={labelStyle}>First occurrence on
                    <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} style={inputStyle} />
                </label>
                <label style={labelStyle}>Ends on (optional)
                    <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} style={inputStyle} />
                </label>
                <label style={labelStyle}>Max occurrences (optional)
                    <input type="number" min="1" value={maxOccurrences} onChange={(e) => setMaxOccurrences(e.target.value)} style={inputStyle} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label style={labelStyle}>Start time
                        <input type="time" value={startsLocal} onChange={(e) => setStartsLocal(e.target.value)} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>End time
                        <input type="time" value={endsLocal} onChange={(e) => setEndsLocal(e.target.value)} style={inputStyle} />
                    </label>
                </div>
                {err && <div style={errorStyle}>{err}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                    <button style={ghostBtn} disabled={busy} onClick={onClose}>Cancel</button>
                    <button style={primaryBtn} disabled={busy || !startsOn || !startsLocal || !endsLocal} onClick={submit}>
                        {busy ? 'Creating…' : 'Create series'}
                    </button>
                </div>
            </div>
        </div>
    );
}

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
    // "Dead" is narrower than terminal: a COMPLETED rental may still legitimately
    // have money outstanding, but a cancelled or refunded one must not be
    // collected against. Mirrors the server-side A/R aging filter (#330).
    const rentalIsDead = ['cancelled', 'refunded'].includes(rental.status);
    // Triage affordances: a lead arriving from the public inquiry form has no
    // site and an epoch-0 schedule, and until now had no UI path to either.
    const canEdit = hasCap('field_rentals.write') && !isArchived && !isTerminal;
    const canReschedule = hasCap('field_rentals.reschedule') && !isArchived && !rentalIsDead;

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <div>
                    <Link to="/admin/field-rentals" style={backLinkStyle}>← All field rentals</Link>
                    <h1 style={titleStyle}>Rental <code style={titleCodeStyle}>{rental.id}</code></h1>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <span style={badgeStyle(status)}>{status.label}</span>
                    <span style={badgeStyle(coi)}>{coi.label}</span>
                    {isArchived && <span style={badgeStyle({ label: 'Archived', color: 'var(--color-text-muted)', bg: 'var(--color-bg-sunken)' })}>Archived</span>}
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
                            {canEdit && (
                                <button style={ghostBtn} onClick={() => setModal({ kind: 'edit' })}>Edit details</button>
                            )}
                            {canReschedule && (
                                <button style={ghostBtn} onClick={() => setModal({ kind: 'reschedule' })}>
                                    {rental.scheduledStartsAt ? 'Reschedule' : 'Set schedule'}
                                </button>
                            )}
                            {hasCap('field_rentals.write') && !isTerminal && !isArchived && selectableNextStatuses(rental.status).length > 0 && (
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

                    <RecurrenceCard
                        rental={rental}
                        hasCap={hasCap}
                        isArchived={isArchived}
                        isTerminal={isTerminal}
                        onChanged={loadAll}
                        onError={setErr}
                    />

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
                                                {/* Open-reads model (2026-07): document reads are open to any admin. */}
                                                <a href={`/api/admin/field-rental-documents/${d.id}/download`} style={{ ...ghostBtn, textDecoration: 'none' }}>Download</a>
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
                                                {/* Gated on the RENTAL's status, not just the payment's.
                                                    A cancelled or refunded rental keeps its pending payment
                                                    rows, and this button stayed live on them — collecting
                                                    against a dead deal. Same leak the A/R aging report was
                                                    fixed for server-side in #330. */}
                                                {p.status === 'pending' && !rentalIsDead && (
                                                    <button style={ghostBtn} onClick={() => markPaymentReceived(p.id)}>Mark received</button>
                                                )}
                                                {p.status === 'pending' && rentalIsDead && (
                                                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                                        rental {rental.status} — not collectable
                                                    </span>
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
            {modal?.kind === 'edit' && (
                <EditDetailsModal
                    rental={rental}
                    onClose={() => setModal(null)}
                    onSaved={async () => { setModal(null); await loadAll(); }}
                />
            )}
            {modal?.kind === 'reschedule' && (
                <RescheduleModal
                    rental={rental}
                    onClose={() => setModal(null)}
                    onSubmit={(body) => action(`/api/admin/field-rentals/${id}/reschedule`, body)}
                    onDone={() => setModal(null)}
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

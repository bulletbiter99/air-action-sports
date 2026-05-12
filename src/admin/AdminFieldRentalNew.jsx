// M5.5 Batch 8 — Field Rental new-rental wizard (3-step single-page flow).
//
// Step 1 — Customer (typeahead from /api/admin/customers?q=)
// Step 2 — Schedule (site + fields + datetimes + engagement + lead source)
// Step 3 — Terms (pricing + deposit + COI required + notes + headcount)
//
// On submit, POST /api/admin/field-rentals. On 409 conflict, render conflicts
// list + "Submit anyway" button gated by field_rentals.create.bypass_conflict
// capability (loaded via /api/admin/auth/me).

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ENGAGEMENT_TYPES } from './AdminFieldRentals.jsx';
import { mergeConflictsForBanner } from './AdminFieldRentalDetail.jsx';

const LEAD_SOURCES = ['inquiry_form', 'phone', 'email', 'referral', 'walkin', 'other'];

// ────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ────────────────────────────────────────────────────────────────────

/**
 * Step 1 validation: requires a selected customer (object with .id).
 */
export function validateNewRentalStep1(state) {
    if (!state || !state.customer || !state.customer.id) {
        return { ok: false, error: 'Pick or create a customer first' };
    }
    return { ok: true };
}

/**
 * Step 2 validation: requires site, ≥1 field, valid scheduled window, engagement type.
 */
export function validateNewRentalStep2(state) {
    if (!state) return { ok: false, error: 'Missing state' };
    if (!state.siteId) return { ok: false, error: 'Pick a site' };
    if (!Array.isArray(state.siteFieldIds) || state.siteFieldIds.length === 0) {
        return { ok: false, error: 'Pick at least one field' };
    }
    const starts = Number(state.scheduledStartsAt);
    const ends = Number(state.scheduledEndsAt);
    if (!Number.isFinite(starts) || !Number.isFinite(ends)) {
        return { ok: false, error: 'Both start and end datetimes are required' };
    }
    if (ends <= starts) return { ok: false, error: 'End must be after start' };
    if (!state.engagementType) return { ok: false, error: 'Pick an engagement type' };
    return { ok: true };
}

/**
 * Step 3 validation: pricing inputs are non-negative integers.
 */
export function validateNewRentalStep3(state) {
    if (!state) return { ok: false, error: 'Missing state' };
    const fields = ['siteFeeCents', 'discountCents', 'taxCents'];
    for (const f of fields) {
        const n = Number(state[f] || 0);
        if (!Number.isInteger(n) || n < 0) {
            return { ok: false, error: `${f} must be a non-negative integer` };
        }
    }
    if (Array.isArray(state.addonFees)) {
        for (const a of state.addonFees) {
            const c = Number(a?.cents);
            if (!Number.isInteger(c) || c < 0) {
                return { ok: false, error: 'addon entries must have non-negative integer cents' };
            }
            if (!a?.label || !String(a.label).trim()) {
                return { ok: false, error: 'addon entries must have a label' };
            }
        }
    }
    return { ok: true };
}

/**
 * Computes the running total from current step-3 state. Used by the wizard's
 * preview pane.
 */
export function previewTotalCents(state) {
    const site = Number(state?.siteFeeCents || 0);
    const discount = Number(state?.discountCents || 0);
    const tax = Number(state?.taxCents || 0);
    const addons = Array.isArray(state?.addonFees)
        ? state.addonFees.reduce((sum, a) => sum + (Number(a?.cents) || 0), 0)
        : 0;
    return Math.max(0, site + addons - discount + tax);
}

// ────────────────────────────────────────────────────────────────────
// Inline styles
// ────────────────────────────────────────────────────────────────────

const containerStyle = { padding: 'var(--space-24)', maxWidth: 960 };
const headerStyle = { marginBottom: 'var(--space-16)' };
const titleStyle = { fontSize: 24, fontWeight: 700, margin: '4px 0 0' };
const backLinkStyle = { color: 'var(--text-secondary, #666)', textDecoration: 'none', fontSize: 13 };
const stepperStyle = { display: 'flex', gap: 8, marginBottom: 'var(--space-16)' };
const stepPillStyle = (active, done) => ({
    flex: 1, padding: '8px 12px', borderRadius: 4, fontSize: 13, fontWeight: 600,
    background: active ? 'var(--orange-strong, #d4541a)' : done ? '#dcfce7' : 'var(--surface-elevated, #f5f5f5)',
    color: active ? 'white' : done ? '#065f46' : 'var(--text-secondary, #666)',
    textAlign: 'center',
});
const cardStyle = {
    background: 'var(--surface-card, white)', border: '1px solid var(--border-soft, #e0e0e0)',
    borderRadius: 4, padding: 'var(--space-24)', marginBottom: 'var(--space-16)',
};
const fieldRow = { marginBottom: 'var(--space-12)' };
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary, #666)' };
const inputStyle = { width: '100%', padding: '8px 12px', border: '1px solid var(--border-soft, #d0d0d0)', borderRadius: 4, fontSize: 14 };
const primaryBtn = {
    background: 'var(--orange-strong, #d4541a)', color: 'white', border: 'none',
    padding: '10px 20px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: 14,
};
const ghostBtn = {
    background: 'white', color: 'var(--text-primary, #333)', border: '1px solid var(--border-soft, #d0d0d0)',
    padding: '10px 20px', borderRadius: 4, cursor: 'pointer', fontSize: 14,
};
const errorStyle = { background: '#fef0f0', border: '1px solid #d4541a', padding: 'var(--space-12)', borderRadius: 4, marginBottom: 'var(--space-12)' };
const conflictBannerStyle = { background: '#fef3c7', border: '1px solid #f59e0b', padding: 'var(--space-12)', borderRadius: 4, marginBottom: 'var(--space-12)' };
const dropdownStyle = {
    position: 'absolute', top: '100%', left: 0, right: 0, background: 'white',
    border: '1px solid var(--border-soft, #d0d0d0)', borderRadius: 4,
    maxHeight: 240, overflowY: 'auto', zIndex: 100, marginTop: 2,
};
const dropdownItemStyle = { padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-soft, #f0f0f0)', fontSize: 13 };

function nowPlusHoursDtLocal(hoursAhead) {
    const t = new Date(Date.now() + hoursAhead * 3600 * 1000);
    // Format as YYYY-MM-DDTHH:mm (compatible with input[type=datetime-local])
    const pad = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

// ────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────

export default function AdminFieldRentalNew() {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [state, setState] = useState({
        // Step 1
        customer: null,
        // Step 2
        siteId: '', siteFieldIds: [],
        scheduledStartsAt: new Date(nowPlusHoursDtLocal(24)).getTime(),
        scheduledEndsAt: new Date(nowPlusHoursDtLocal(32)).getTime(),
        engagementType: '', leadSource: '',
        // Step 3
        siteFeeCents: 0, addonFees: [], discountCents: 0, taxCents: 0,
        depositRequiredCents: '', headcountEstimate: '', notes: '',
        coiStatus: 'pending',
    });
    const [sites, setSites] = useState([]);
    const [siteFields, setSiteFields] = useState([]);
    const [err, setErr] = useState('');
    const [conflicts, setConflicts] = useState(null);
    const [caps, setCaps] = useState([]);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        fetch('/api/admin/sites', { credentials: 'include' })
            .then((r) => r.ok ? r.json() : { sites: [] })
            .then((d) => setSites(d.sites || []))
            .catch(() => setSites([]));
        fetch('/api/admin/auth/me', { credentials: 'include' })
            .then((r) => r.ok ? r.json() : { capabilities: [] })
            .then((d) => setCaps(d.capabilities || []))
            .catch(() => setCaps([]));
    }, []);

    useEffect(() => {
        if (!state.siteId) { setSiteFields([]); return; }
        fetch(`/api/admin/sites/${state.siteId}`, { credentials: 'include' })
            .then((r) => r.ok ? r.json() : { fields: [] })
            .then((d) => setSiteFields(d.fields || []))
            .catch(() => setSiteFields([]));
    }, [state.siteId]);

    const update = (patch) => setState((s) => ({ ...s, ...patch }));

    const handleNext = () => {
        const validator = step === 1 ? validateNewRentalStep1
            : step === 2 ? validateNewRentalStep2
            : validateNewRentalStep3;
        const r = validator(state);
        if (!r.ok) { setErr(r.error); return; }
        setErr('');
        setStep(step + 1);
    };

    const submit = async (acknowledgeConflicts = false) => {
        const all = [validateNewRentalStep1(state), validateNewRentalStep2(state), validateNewRentalStep3(state)];
        for (const r of all) if (!r.ok) { setErr(r.error); return; }
        setSubmitting(true); setErr(''); setConflicts(null);
        try {
            const body = {
                customer_id: state.customer.id,
                site_id: state.siteId,
                site_field_ids: state.siteFieldIds,
                engagement_type: state.engagementType,
                lead_source: state.leadSource || null,
                scheduled_starts_at: Number(state.scheduledStartsAt),
                scheduled_ends_at: Number(state.scheduledEndsAt),
                site_fee_cents: Number(state.siteFeeCents) || 0,
                addon_fees: state.addonFees,
                discount_cents: Number(state.discountCents) || 0,
                tax_cents: Number(state.taxCents) || 0,
                deposit_required_cents: state.depositRequiredCents === '' ? null : Number(state.depositRequiredCents),
                headcount_estimate: state.headcountEstimate === '' ? null : Number(state.headcountEstimate),
                notes: state.notes || null,
                coi_status: state.coiStatus,
                acknowledgeConflicts,
            };
            const res = await fetch('/api/admin/field-rentals', {
                method: 'POST', credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 409 && data.conflicts) {
                setConflicts(data.conflicts);
                setSubmitting(false);
                return;
            }
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            navigate(`/admin/field-rentals/${data.rental.id}`);
        } catch (e) {
            setErr(e.message);
        } finally {
            setSubmitting(false);
        }
    };

    const canBypassConflict = caps.includes('field_rentals.create.bypass_conflict');

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <Link to="/admin/field-rentals" style={backLinkStyle}>← All field rentals</Link>
                <h1 style={titleStyle}>New field rental</h1>
            </div>

            <div style={stepperStyle}>
                <div style={stepPillStyle(step === 1, step > 1)}>1. Customer</div>
                <div style={stepPillStyle(step === 2, step > 2)}>2. Schedule</div>
                <div style={stepPillStyle(step === 3, false)}>3. Terms & pricing</div>
            </div>

            {err && <div style={errorStyle}>{err}</div>}

            {conflicts && (
                <div style={conflictBannerStyle}>
                    <strong>Schedule conflict detected</strong>
                    <ul style={{ margin: '8px 0 0 20px', padding: 0, fontSize: 13 }}>
                        {mergeConflictsForBanner(conflicts).map((c) => (
                            <li key={`${c.kind}-${c.id}`}>
                                <strong>{c.kind}:</strong> {c.label}
                                {c.dateIso ? ` (${c.dateIso})` : c.startsAt ? ` (${new Date(c.startsAt).toLocaleString()} → ${new Date(c.endsAt).toLocaleString()})` : ''}
                            </li>
                        ))}
                    </ul>
                    {canBypassConflict ? (
                        <button
                            type="button"
                            style={{ ...primaryBtn, marginTop: 8, background: '#d4541a' }}
                            onClick={() => submit(true)}
                            disabled={submitting}
                        >
                            {submitting ? 'Submitting…' : 'Submit anyway'}
                        </button>
                    ) : (
                        <p style={{ marginTop: 8, fontSize: 13 }}>
                            You don't have the <code>field_rentals.create.bypass_conflict</code> capability.
                            Ask an Owner to override, or pick a different time.
                        </p>
                    )}
                </div>
            )}

            <div style={cardStyle}>
                {step === 1 && <Step1Customer state={state} update={update} />}
                {step === 2 && <Step2Schedule state={state} update={update} sites={sites} siteFields={siteFields} />}
                {step === 3 && <Step3Terms state={state} update={update} />}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button type="button" style={ghostBtn} onClick={() => step > 1 ? setStep(step - 1) : navigate('/admin/field-rentals')}>
                    ← {step > 1 ? 'Back' : 'Cancel'}
                </button>
                {step < 3 ? (
                    <button type="button" style={primaryBtn} onClick={handleNext}>Next →</button>
                ) : (
                    <button type="button" style={primaryBtn} onClick={() => submit(false)} disabled={submitting}>
                        {submitting ? 'Creating…' : 'Create rental'}
                    </button>
                )}
            </div>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────
// Step 1: Customer typeahead
// ────────────────────────────────────────────────────────────────────

function Step1Customer({ state, update }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);

    useEffect(() => {
        if (query.length < 2) { setResults([]); return; }
        const t = setTimeout(async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/admin/customers?q=${encodeURIComponent(query)}&limit=10`, { credentials: 'include' });
                const data = await res.json().catch(() => ({ customers: [] }));
                setResults(data.customers || []);
            } catch {
                setResults([]);
            } finally {
                setLoading(false);
            }
        }, 250);
        return () => clearTimeout(t);
    }, [query]);

    return (
        <div>
            <h2 style={{ marginTop: 0 }}>Step 1: Customer</h2>
            <p style={{ color: 'var(--text-secondary, #666)', fontSize: 13 }}>
                Search existing customers by name or email. New business customer?{' '}
                <Link to="/admin/customers" target="_blank">Create one in the customers page</Link> first, then come back.
            </p>

            {state.customer ? (
                <div style={{ padding: 12, background: '#dcfce7', borderRadius: 4 }}>
                    <strong>{state.customer.name || '(no name)'}</strong>
                    {state.customer.email && <span style={{ color: '#065f46' }}> · {state.customer.email}</span>}
                    {' '}
                    <button
                        type="button"
                        style={{ background: 'none', border: 'none', color: '#065f46', cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}
                        onClick={() => update({ customer: null })}
                    >
                        Change
                    </button>
                </div>
            ) : (
                <div style={{ position: 'relative' }}>
                    <input
                        style={inputStyle}
                        type="search"
                        placeholder="Search customer name or email…"
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
                        onFocus={() => setShowDropdown(true)}
                        autoFocus
                    />
                    {showDropdown && (loading || results.length > 0) && (
                        <div style={dropdownStyle}>
                            {loading && <div style={dropdownItemStyle}>Searching…</div>}
                            {!loading && results.length === 0 && <div style={dropdownItemStyle}>No matches</div>}
                            {results.map((c) => (
                                <div
                                    key={c.id}
                                    style={dropdownItemStyle}
                                    onClick={() => { update({ customer: c }); setShowDropdown(false); setQuery(''); }}
                                >
                                    <strong>{c.name || c.id}</strong>
                                    {c.email && <span style={{ color: 'var(--text-secondary, #666)' }}> · {c.email}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────
// Step 2: Schedule
// ────────────────────────────────────────────────────────────────────

function Step2Schedule({ state, update, sites, siteFields }) {
    const startsDt = new Date(state.scheduledStartsAt).toISOString().slice(0, 16);
    const endsDt = new Date(state.scheduledEndsAt).toISOString().slice(0, 16);

    const toggleField = (id) => {
        const next = state.siteFieldIds.includes(id)
            ? state.siteFieldIds.filter((x) => x !== id)
            : [...state.siteFieldIds, id];
        update({ siteFieldIds: next });
    };

    return (
        <div>
            <h2 style={{ marginTop: 0 }}>Step 2: Schedule</h2>
            <div style={fieldRow}>
                <label style={labelStyle}>Site</label>
                <select style={inputStyle} value={state.siteId} onChange={(e) => update({ siteId: e.target.value, siteFieldIds: [] })}>
                    <option value="">Pick a site…</option>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
            </div>

            {state.siteId && (
                <div style={fieldRow}>
                    <label style={labelStyle}>Fields (multi-select)</label>
                    {siteFields.length === 0 ? (
                        <p style={{ margin: 0, color: 'var(--text-secondary, #666)', fontSize: 13 }}>This site has no fields yet.</p>
                    ) : (
                        siteFields.map((f) => (
                            <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 14 }}>
                                <input
                                    type="checkbox"
                                    checked={state.siteFieldIds.includes(f.id)}
                                    onChange={() => toggleField(f.id)}
                                />
                                {f.name}
                            </label>
                        ))
                    )}
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={fieldRow}>
                    <label style={labelStyle}>Starts</label>
                    <input
                        type="datetime-local"
                        style={inputStyle}
                        value={startsDt}
                        onChange={(e) => update({ scheduledStartsAt: new Date(e.target.value).getTime() })}
                    />
                </div>
                <div style={fieldRow}>
                    <label style={labelStyle}>Ends</label>
                    <input
                        type="datetime-local"
                        style={inputStyle}
                        value={endsDt}
                        onChange={(e) => update({ scheduledEndsAt: new Date(e.target.value).getTime() })}
                    />
                </div>
            </div>

            <div style={fieldRow}>
                <label style={labelStyle}>Engagement type</label>
                <select style={inputStyle} value={state.engagementType} onChange={(e) => update({ engagementType: e.target.value })}>
                    <option value="">Pick…</option>
                    {ENGAGEMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
            </div>

            <div style={fieldRow}>
                <label style={labelStyle}>Lead source (optional)</label>
                <select style={inputStyle} value={state.leadSource} onChange={(e) => update({ leadSource: e.target.value })}>
                    <option value="">—</option>
                    {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
            </div>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────
// Step 3: Terms + pricing
// ────────────────────────────────────────────────────────────────────

function Step3Terms({ state, update }) {
    const addAddon = () => update({ addonFees: [...(state.addonFees || []), { label: '', cents: 0 }] });
    const editAddon = (i, patch) => {
        const next = [...(state.addonFees || [])];
        next[i] = { ...next[i], ...patch };
        update({ addonFees: next });
    };
    const removeAddon = (i) => {
        const next = [...(state.addonFees || [])];
        next.splice(i, 1);
        update({ addonFees: next });
    };

    const total = previewTotalCents(state);

    return (
        <div>
            <h2 style={{ marginTop: 0 }}>Step 3: Terms & pricing</h2>

            <div style={fieldRow}>
                <label style={labelStyle}>Site fee (cents)</label>
                <input type="number" min="0" style={inputStyle} value={state.siteFeeCents} onChange={(e) => update({ siteFeeCents: Number(e.target.value) || 0 })} />
            </div>

            <div style={fieldRow}>
                <label style={labelStyle}>Addons</label>
                {(state.addonFees || []).map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                        <input
                            style={{ ...inputStyle, flex: 2 }}
                            placeholder="Label"
                            value={a.label}
                            onChange={(e) => editAddon(i, { label: e.target.value })}
                        />
                        <input
                            style={{ ...inputStyle, flex: 1 }}
                            type="number" min="0"
                            placeholder="Cents"
                            value={a.cents}
                            onChange={(e) => editAddon(i, { cents: Number(e.target.value) || 0 })}
                        />
                        <button type="button" onClick={() => removeAddon(i)} style={{ ...inputStyle, background: '#fee2e2', cursor: 'pointer', flex: '0 0 auto' }}>×</button>
                    </div>
                ))}
                <button type="button" onClick={addAddon} style={{ ...inputStyle, background: '#f5f5f5', cursor: 'pointer', textAlign: 'left' }}>+ Add addon</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={fieldRow}>
                    <label style={labelStyle}>Discount (cents)</label>
                    <input type="number" min="0" style={inputStyle} value={state.discountCents} onChange={(e) => update({ discountCents: Number(e.target.value) || 0 })} />
                </div>
                <div style={fieldRow}>
                    <label style={labelStyle}>Tax (cents)</label>
                    <input type="number" min="0" style={inputStyle} value={state.taxCents} onChange={(e) => update({ taxCents: Number(e.target.value) || 0 })} />
                </div>
            </div>

            <div style={fieldRow}>
                <label style={labelStyle}>Deposit required (cents, optional)</label>
                <input type="number" min="0" style={inputStyle} value={state.depositRequiredCents} onChange={(e) => update({ depositRequiredCents: e.target.value })} placeholder="leave empty for none" />
            </div>

            <div style={fieldRow}>
                <label style={labelStyle}>COI status</label>
                <select style={inputStyle} value={state.coiStatus} onChange={(e) => update({ coiStatus: e.target.value })}>
                    <option value="not_required">Not required</option>
                    <option value="pending">Pending</option>
                    <option value="received">Received</option>
                </select>
            </div>

            <div style={fieldRow}>
                <label style={labelStyle}>Headcount estimate (optional)</label>
                <input type="number" min="0" style={inputStyle} value={state.headcountEstimate} onChange={(e) => update({ headcountEstimate: e.target.value })} />
            </div>

            <div style={fieldRow}>
                <label style={labelStyle}>Notes (optional, PII-tier — gated on read by field_rentals.read.pii)</label>
                <textarea style={{ ...inputStyle, minHeight: 80 }} value={state.notes} onChange={(e) => update({ notes: e.target.value })} />
            </div>

            <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, fontSize: 14 }}>
                <strong>Total: ${(total / 100).toFixed(2)}</strong>
                <span style={{ color: 'var(--text-secondary, #666)', marginLeft: 8 }}>
                    (site + addons − discount + tax; server recomputes on save)
                </span>
            </div>
        </div>
    );
}

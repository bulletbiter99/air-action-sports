// M3 Batch 8b — admin customer detail page.
//
// Backed by:
//   GET  /api/admin/customers/:id   (B8a) — customer + bookings + tags
//   POST /api/admin/customers/merge (B8a, manager+) — merge into target
//
// Merge UX: from the current customer's detail page, the admin clicks
// "Merge this customer into…", picks a target (the primary that will be
// kept), and submits. The current customer becomes a duplicate; the
// backend re-points its bookings + attendees onto the target, archives
// it with merged_into=target, and recomputes the target's aggregates.
// On success we redirect to the target's detail page.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import { formatMoney } from '../utils/money.js';
import { classifyStatus as classifyFieldRentalStatus, classifyCoiStatus } from './AdminFieldRentals.jsx';
import './AdminCustomers.css';

// Post-M6 D-1a — helpers for the business-fields display surface.
// "canSee" reflects whether the viewer has customers.read.business_fields
// (server sends viewerCanSeeBusinessFields). "hasEncrypted" distinguishes
// "no value set" from "value present but you can't see it".
function renderEinField(canSee, hasEncrypted, decrypted) {
    if (!canSee && hasEncrypted) {
        return <em className="admin-customers__muted">●●●●●● (requires customers.read.business_fields)</em>;
    }
    if (!hasEncrypted) return <em className="admin-customers__muted">(not set)</em>;
    if (decrypted) return <code>{decrypted}</code>;
    return <em className="admin-customers__muted">(could not decrypt — contact admin)</em>;
}

function renderBillingAddressField(canSee, hasEncrypted, decrypted) {
    if (!canSee && hasEncrypted) {
        return <em className="admin-customers__muted">●●●●●● (requires customers.read.business_fields)</em>;
    }
    if (!hasEncrypted) return <em className="admin-customers__muted">(not set)</em>;
    if (!decrypted || typeof decrypted !== 'object') {
        return <em className="admin-customers__muted">(could not decrypt — contact admin)</em>;
    }
    const lines = [
        decrypted.line1,
        decrypted.line2,
        [decrypted.city, decrypted.state, decrypted.postal].filter(Boolean).join(' ').trim(),
        decrypted.country,
    ].filter(Boolean);
    if (lines.length === 0) return <em className="admin-customers__muted">(empty)</em>;
    return (
        <address style={{ fontStyle: 'normal' }}>
            {lines.map((l, i) => <div key={i}>{l}</div>)}
        </address>
    );
}

export default function AdminCustomerDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { hasRole } = useAdmin();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState(null);
    const [mergeOpen, setMergeOpen] = useState(false);
    const [gdprOpen, setGdprOpen] = useState(false);
    const [businessEditOpen, setBusinessEditOpen] = useState(false);

    const reload = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        setErr(null);
        try {
            const res = await fetch(`/api/admin/customers/${encodeURIComponent(id)}`, {
                credentials: 'include',
                cache: 'no-store',
            });
            if (res.status === 404) {
                setErr('not-found');
                setData(null);
                return;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            setData(json);
        } catch (e) {
            setErr(String(e.message || e));
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { reload(); }, [reload]);

    if (loading) {
        return <div className="admin-customers"><p className="admin-customers__loading">Loading customer…</p></div>;
    }
    if (err === 'not-found') {
        return (
            <div className="admin-customers">
                <p className="admin-customers__empty">Customer not found.</p>
                <Link to="/admin/customers">← Back to customers</Link>
            </div>
        );
    }
    if (err) {
        return (
            <div className="admin-customers">
                <p className="admin-customers__error">Error: {err}</p>
                <Link to="/admin/customers">← Back to customers</Link>
            </div>
        );
    }
    if (!data) return null;

    const { customer, bookings, tags, fieldRentals = [] } = data;
    const archived = !!customer.archivedAt;
    const isBusiness = customer.clientType === 'business';
    const nowMs = Date.now();

    return (
        <div className="admin-customers admin-customers__detail">
            <header className="admin-customers__detail-header">
                <Link to="/admin/customers" className="admin-customers__back-link">← All customers</Link>
                <h1>{customer.name || <em>(no name)</em>}</h1>
                {archived ? (
                    <span className="admin-customers__pill admin-customers__pill--archived">
                        archived ({customer.archivedReason || 'manual'})
                    </span>
                ) : (
                    <span className="admin-customers__pill admin-customers__pill--active">active</span>
                )}
            </header>

            <section className="admin-customers__card">
                <h2>Contact</h2>
                <dl className="admin-customers__dl">
                    <dt>Email</dt>
                    <dd>{customer.email || <em>—</em>}{customer.emailNormalized && customer.emailNormalized !== customer.email && (
                        <span className="admin-customers__muted"> (canonical: {customer.emailNormalized})</span>
                    )}</dd>
                    <dt>Phone</dt>
                    <dd>{customer.phone || <em>—</em>}</dd>
                    <dt>Client type</dt>
                    <dd>
                        <span
                            className="admin-customers__pill"
                            style={{
                                background: isBusiness ? '#cffafe' : '#e5e7eb',
                                color: isBusiness ? '#0e7490' : '#475569',
                            }}
                        >
                            {isBusiness ? 'Business' : 'Individual'}
                        </span>
                    </dd>
                </dl>
            </section>

            {isBusiness && (
                <section className="admin-customers__card">
                    <header className="admin-customers__card-header">
                        <h2>Business profile</h2>
                        {customer.viewerCanWriteBusinessFields && !archived && (
                            <button
                                type="button"
                                className="admin-customers__btn"
                                onClick={() => setBusinessEditOpen(true)}
                            >
                                Edit
                            </button>
                        )}
                    </header>
                    <dl className="admin-customers__dl">
                        <dt>Business name</dt>
                        <dd>{customer.businessName || <em className="admin-customers__muted">(not set)</em>}</dd>
                        <dt>Website</dt>
                        <dd>
                            {customer.businessWebsite ? (
                                <a
                                    href={customer.businessWebsite}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {customer.businessWebsite}
                                </a>
                            ) : <em className="admin-customers__muted">(not set)</em>}
                        </dd>
                        <dt>EIN / Tax ID</dt>
                        <dd>{renderEinField(customer.viewerCanSeeBusinessFields, customer.hasEncryptedTaxId, customer.businessTaxId)}</dd>
                        <dt>Billing address</dt>
                        <dd>{renderBillingAddressField(customer.viewerCanSeeBusinessFields, customer.hasEncryptedBillingAddress, customer.businessBillingAddress)}</dd>
                    </dl>
                </section>
            )}

            <section className="admin-customers__card">
                <h2>Aggregates</h2>
                <div className="admin-customers__stats">
                    <Stat label="Bookings" value={customer.totalBookings} />
                    <Stat label="Attendees" value={customer.totalAttendees} />
                    <Stat label="LTV" value={formatMoney(customer.lifetimeValueCents)} />
                    <Stat label="Refunds" value={customer.refundCount} />
                    <Stat label="First booking" value={formatDate(customer.firstBookingAt)} />
                    <Stat label="Last booking" value={formatDate(customer.lastBookingAt)} />
                </div>
            </section>

            <section className="admin-customers__card">
                <h2>Comm preferences</h2>
                <ul className="admin-customers__pref-list">
                    <li><strong>Email transactional:</strong> {customer.emailTransactional ? 'on' : 'off'}</li>
                    <li><strong>Email marketing:</strong> {customer.emailMarketing ? 'on' : 'off'}</li>
                    <li><strong>SMS transactional:</strong> {customer.smsTransactional ? 'on' : 'off'}</li>
                    <li><strong>SMS marketing:</strong> {customer.smsMarketing ? 'on' : 'off'}</li>
                </ul>
            </section>

            {customer.notes && (
                <section className="admin-customers__card">
                    <h2>Notes</h2>
                    <p className="admin-customers__notes">{customer.notes}</p>
                </section>
            )}

            {tags && tags.length > 0 && (
                <section className="admin-customers__card">
                    <h2>Tags</h2>
                    <div className="admin-customers__tags">
                        {tags.map((t) => (
                            <span
                                key={`${t.tagType}:${t.tag}`}
                                className={`admin-customers__tag admin-customers__tag--${t.tagType}`}
                                title={t.tagType === 'system' ? 'System-computed' : 'Manual'}
                            >
                                {t.tag}
                            </span>
                        ))}
                    </div>
                </section>
            )}

            <section className="admin-customers__card">
                <header className="admin-customers__card-header">
                    <h2>Bookings ({bookings.length})</h2>
                </header>
                {bookings.length === 0 ? (
                    <p className="admin-customers__empty">No bookings linked to this customer.</p>
                ) : (
                    <table className="admin-customers__table">
                        <thead>
                            <tr>
                                <th>Booking</th>
                                <th>Event</th>
                                <th>Status</th>
                                <th>Method</th>
                                <th className="admin-customers__num">Total</th>
                                <th>Created</th>
                            </tr>
                        </thead>
                        <tbody>
                            {bookings.map((b) => (
                                <tr key={b.id}>
                                    <td><code>{b.id}</code></td>
                                    <td>{b.eventTitle || b.eventId}</td>
                                    <td><StatusPill status={b.status} /></td>
                                    <td>{b.paymentMethod || '—'}</td>
                                    <td className="admin-customers__num">{formatMoney(b.totalCents)}</td>
                                    <td>{formatDate(b.createdAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>

            {fieldRentals.length > 0 && (
                <section className="admin-customers__card">
                    <header className="admin-customers__card-header">
                        <h2>Field rentals ({fieldRentals.length})</h2>
                        <Link
                            to={`/admin/field-rentals?customer_id=${encodeURIComponent(customer.id)}`}
                            className="admin-customers__back-link"
                        >
                            View in field rentals →
                        </Link>
                    </header>
                    <table className="admin-customers__table">
                        <thead>
                            <tr>
                                <th>Rental</th>
                                <th>Schedule</th>
                                <th>Status</th>
                                <th>COI</th>
                                <th>Engagement</th>
                                <th className="admin-customers__num">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {fieldRentals.map((fr) => {
                                const s = classifyFieldRentalStatus(fr.status);
                                const c = classifyCoiStatus(fr.coiStatus, fr.coiExpiresAt, nowMs);
                                const pillStyle = (cls) => ({
                                    display: 'inline-block', padding: '2px 8px', borderRadius: 12,
                                    background: cls.bg, color: cls.color, fontSize: 12, fontWeight: 600,
                                });
                                return (
                                    <tr key={fr.id} style={fr.archivedAt ? { opacity: 0.55 } : null}>
                                        <td>
                                            <Link to={`/admin/field-rentals/${encodeURIComponent(fr.id)}`}>
                                                <code>{fr.id}</code>
                                            </Link>
                                        </td>
                                        <td>{formatDate(fr.scheduledStartsAt)} → {formatDate(fr.scheduledEndsAt)}</td>
                                        <td><span style={pillStyle(s)}>{s.label}</span></td>
                                        <td><span style={pillStyle(c)}>{c.label}</span></td>
                                        <td>{(fr.engagementType || '').replace(/_/g, ' ') || '—'}</td>
                                        <td className="admin-customers__num">{formatMoney(fr.totalCents)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </section>
            )}

            {!archived && (
                <section className="admin-customers__card">
                    <h2>Danger zone</h2>
                    <p>
                        Found a duplicate of this customer? Merge them into another canonical
                        record. The other customer's bookings + attendees will re-point onto
                        the target, this row will be archived with a <code>merged_into</code>
                        {' '}pointer, and the target's aggregates will recompute.
                    </p>
                    <button
                        type="button"
                        className="admin-customers__btn admin-customers__btn--danger"
                        onClick={() => setMergeOpen(true)}
                    >
                        Merge this customer into…
                    </button>
                    {hasRole?.('owner') && (
                        <>
                            <p style={{ marginTop: '1rem' }}>
                                Or, if the customer has invoked their right to erasure (GDPR / CCPA),
                                redact their personal fields and write the deletion to the
                                <code> gdpr_deletions </code>audit table. Bookings + attendees stay linked
                                (anonymized) so accounting + history remain intact, but email, name,
                                phone, and notes are nulled out. <strong>Owner only — irreversible.</strong>
                            </p>
                            <button
                                type="button"
                                className="admin-customers__btn admin-customers__btn--danger"
                                onClick={() => setGdprOpen(true)}
                            >
                                GDPR / CCPA delete…
                            </button>
                        </>
                    )}
                </section>
            )}

            {archived && customer.mergedInto && (
                <section className="admin-customers__card admin-customers__card--muted">
                    <h2>Merged record</h2>
                    <p>
                        This customer was merged into{' '}
                        <Link to={`/admin/customers/${encodeURIComponent(customer.mergedInto)}`}>
                            {customer.mergedInto}
                        </Link>{' '}
                        on {formatDate(customer.archivedAt)}.
                    </p>
                </section>
            )}

            {mergeOpen && (
                <MergeModal
                    duplicate={customer}
                    onClose={() => setMergeOpen(false)}
                    onMerged={(primaryId) => {
                        setMergeOpen(false);
                        navigate(`/admin/customers/${encodeURIComponent(primaryId)}`);
                    }}
                />
            )}

            {gdprOpen && (
                <GdprDeleteModal
                    customer={customer}
                    onClose={() => setGdprOpen(false)}
                    onDeleted={() => {
                        setGdprOpen(false);
                        reload(); // page refresh — customer is now archived/redacted
                    }}
                />
            )}

            {businessEditOpen && (
                <BusinessFieldsEditModal
                    customer={customer}
                    onClose={() => setBusinessEditOpen(false)}
                    onSaved={() => {
                        setBusinessEditOpen(false);
                        reload();
                    }}
                />
            )}
        </div>
    );
}

// Post-M6 D-1a — edits client_type + business_* fields via PUT /:id/business.
// EIN client-side validated against XX-XXXXXXX before submit; address fields
// are independently optional. Backend re-encrypts both EIN + billing address
// before writing to D1.
function BusinessFieldsEditModal({ customer, onClose, onSaved }) {
    const initialAddress = customer.businessBillingAddress || {};
    const [clientType, setClientType] = useState(customer.clientType || 'individual');
    const [businessName, setBusinessName] = useState(customer.businessName || '');
    const [businessWebsite, setBusinessWebsite] = useState(customer.businessWebsite || '');
    const [businessTaxId, setBusinessTaxId] = useState(customer.businessTaxId || '');
    const [line1, setLine1] = useState(initialAddress.line1 || '');
    const [line2, setLine2] = useState(initialAddress.line2 || '');
    const [city, setCity] = useState(initialAddress.city || '');
    const [state, setState] = useState(initialAddress.state || '');
    const [postal, setPostal] = useState(initialAddress.postal || '');
    const [country, setCountry] = useState(initialAddress.country || '');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState(null);

    const einError = (() => {
        const v = (businessTaxId || '').trim();
        if (!v) return null;
        if (!/^\d{2}-\d{7}$/.test(v)) return 'EIN must be XX-XXXXXXX';
        return null;
    })();

    async function submit(e) {
        e.preventDefault();
        if (einError) { setErr(einError); return; }
        setSubmitting(true);
        setErr(null);

        const billing = {};
        if (line1.trim()) billing.line1 = line1.trim();
        if (line2.trim()) billing.line2 = line2.trim();
        if (city.trim()) billing.city = city.trim();
        if (state.trim()) billing.state = state.trim();
        if (postal.trim()) billing.postal = postal.trim();
        if (country.trim()) billing.country = country.trim();

        try {
            const res = await fetch(
                `/api/admin/customers/${encodeURIComponent(customer.id)}/business`,
                {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        clientType,
                        businessName: businessName.trim() || null,
                        businessWebsite: businessWebsite.trim() || null,
                        businessTaxId: businessTaxId.trim() || null,
                        businessBillingAddress: Object.keys(billing).length ? billing : null,
                    }),
                },
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(json.error || `HTTP ${res.status}`);
                return;
            }
            onSaved?.();
        } catch (e2) {
            setErr(String(e2.message || e2));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="admin-customers__modal-backdrop" onClick={onClose}>
            <div className="admin-customers__modal" onClick={(e) => e.stopPropagation()}>
                <header className="admin-customers__modal-header">
                    <h2>Edit business profile</h2>
                    <button type="button" className="admin-customers__modal-close" onClick={onClose} aria-label="Close">×</button>
                </header>

                <form onSubmit={submit}>
                    <div className="admin-customers__modal-body">
                        <label style={{ display: 'block', marginBottom: '0.85rem' }}>
                            <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>Client type</span>
                            <select
                                value={clientType}
                                onChange={(e) => setClientType(e.target.value)}
                                className="admin-customers__merge-search"
                            >
                                <option value="individual">Individual</option>
                                <option value="business">Business</option>
                            </select>
                        </label>

                        <label style={{ display: 'block', marginBottom: '0.85rem' }}>
                            <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>Business name</span>
                            <input
                                type="text"
                                value={businessName}
                                onChange={(e) => setBusinessName(e.target.value)}
                                className="admin-customers__merge-search"
                                placeholder="Acme Corp"
                            />
                        </label>

                        <label style={{ display: 'block', marginBottom: '0.85rem' }}>
                            <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>Website</span>
                            <input
                                type="url"
                                value={businessWebsite}
                                onChange={(e) => setBusinessWebsite(e.target.value)}
                                className="admin-customers__merge-search"
                                placeholder="https://acme.example"
                            />
                        </label>

                        <label style={{ display: 'block', marginBottom: '0.85rem' }}>
                            <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>
                                EIN / Tax ID <small style={{ color: 'var(--color-text-muted)', fontWeight: 'normal' }}>(encrypted at rest)</small>
                            </span>
                            <input
                                type="text"
                                value={businessTaxId}
                                onChange={(e) => setBusinessTaxId(e.target.value)}
                                className="admin-customers__merge-search"
                                placeholder="XX-XXXXXXX"
                            />
                            {einError && <small style={{ color: '#dc2626', display: 'block', marginTop: '0.25rem' }}>{einError}</small>}
                        </label>

                        <h3 style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
                            Billing address <small style={{ color: 'var(--color-text-muted)', fontWeight: 'normal' }}>(encrypted at rest)</small>
                        </h3>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                            <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>Line 1</span>
                            <input type="text" value={line1} onChange={(e) => setLine1(e.target.value)} className="admin-customers__merge-search" />
                        </label>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                            <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>Line 2</span>
                            <input type="text" value={line2} onChange={(e) => setLine2(e.target.value)} className="admin-customers__merge-search" />
                        </label>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <label>
                                <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>City</span>
                                <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className="admin-customers__merge-search" />
                            </label>
                            <label>
                                <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>State</span>
                                <input type="text" value={state} onChange={(e) => setState(e.target.value)} className="admin-customers__merge-search" />
                            </label>
                            <label>
                                <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>Postal</span>
                                <input type="text" value={postal} onChange={(e) => setPostal(e.target.value)} className="admin-customers__merge-search" />
                            </label>
                        </div>
                        <label style={{ display: 'block', marginBottom: '0.85rem' }}>
                            <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>Country</span>
                            <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} className="admin-customers__merge-search" />
                        </label>

                        {err && <p className="admin-customers__error">Error: {err}</p>}
                    </div>

                    <footer className="admin-customers__modal-footer">
                        <button type="button" className="admin-customers__btn" onClick={onClose} disabled={submitting}>Cancel</button>
                        <button type="submit" className="admin-customers__btn admin-customers__btn--primary" disabled={submitting || !!einError}>
                            {submitting ? 'Saving…' : 'Save changes'}
                        </button>
                    </footer>
                </form>
            </div>
        </div>
    );
}

function GdprDeleteModal({ customer, onClose, onDeleted }) {
    const [requestedVia, setRequestedVia] = useState('GDPR');
    const [reason, setReason] = useState('');
    const [confirmTyped, setConfirmTyped] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState(null);

    const expectedConfirmation = customer.email || customer.id;
    const canSubmit = confirmTyped === expectedConfirmation && !submitting;

    async function submit() {
        if (!canSubmit) return;
        setSubmitting(true);
        setErr(null);
        try {
            const res = await fetch(
                `/api/admin/customers/${encodeURIComponent(customer.id)}/gdpr-delete`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        requestedVia,
                        reason: reason.trim() || null,
                    }),
                },
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(json.error || `HTTP ${res.status}`);
                return;
            }
            onDeleted();
        } catch (e) {
            setErr(String(e.message || e));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="admin-customers__modal-backdrop" onClick={onClose}>
            <div className="admin-customers__modal" onClick={(e) => e.stopPropagation()}>
                <header className="admin-customers__modal-header">
                    <h2>GDPR / CCPA delete</h2>
                    <button type="button" className="admin-customers__modal-close" onClick={onClose} aria-label="Close">×</button>
                </header>

                <div className="admin-customers__modal-body">
                    <p>
                        This will <strong>permanently redact</strong> personal fields on{' '}
                        <strong>{customer.name || customer.email || customer.id}</strong>:
                        email, name, phone, and notes will be nulled out; tags will be deleted;
                        the row will be archived with <code>archived_reason='gdpr_delete'</code>.
                        Bookings + attendees keep <code>customer_id</code> set so accounting +
                        history stay valid, but the personal data is gone.
                    </p>
                    <p>This action is logged to the <code>gdpr_deletions</code> table and the audit_log.</p>

                    <label className="admin-customers__merge-search-label">Requested via</label>
                    <select
                        value={requestedVia}
                        onChange={(e) => setRequestedVia(e.target.value)}
                        className="admin-customers__merge-search"
                        style={{ marginTop: '0.25rem' }}
                    >
                        <option value="GDPR">GDPR</option>
                        <option value="CCPA">CCPA</option>
                        <option value="manual">Manual / other</option>
                    </select>

                    <label style={{ display: 'block', marginTop: '0.85rem' }}>Reason (optional)</label>
                    <textarea
                        rows={2}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="admin-customers__merge-search"
                        placeholder="e.g. ticket #1234 — user emailed actionairsport@gmail.com requesting deletion"
                        style={{ marginTop: '0.25rem' }}
                    />

                    <label style={{ display: 'block', marginTop: '0.85rem' }}>
                        To confirm, type <code>{expectedConfirmation}</code>:
                    </label>
                    <input
                        type="text"
                        autoFocus
                        value={confirmTyped}
                        onChange={(e) => setConfirmTyped(e.target.value)}
                        className="admin-customers__merge-search"
                        placeholder={expectedConfirmation}
                        style={{ marginTop: '0.25rem' }}
                    />

                    {err && <p className="admin-customers__error">Error: {err}</p>}
                </div>

                <footer className="admin-customers__modal-footer">
                    <button type="button" className="admin-customers__btn" onClick={onClose}>Cancel</button>
                    <button
                        type="button"
                        className="admin-customers__btn admin-customers__btn--danger"
                        disabled={!canSubmit}
                        onClick={submit}
                    >
                        {submitting ? 'Deleting…' : 'Permanently redact this customer'}
                    </button>
                </footer>
            </div>
        </div>
    );
}

function MergeModal({ duplicate, onClose, onMerged }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState(null);

    // Debounced search against /api/admin/customers?q=...
    useEffect(() => {
        if (!query.trim()) { setResults([]); return; }
        let cancelled = false;
        setSearching(true);
        const t = setTimeout(async () => {
            try {
                const params = new URLSearchParams();
                params.set('q', query.trim());
                params.set('archived', 'false');
                params.set('limit', '20');
                const res = await fetch(`/api/admin/customers?${params.toString()}`, {
                    credentials: 'include',
                    cache: 'no-store',
                });
                if (cancelled) return;
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                // Exclude the current customer (can't merge into self)
                setResults((json.customers || []).filter((c) => c.id !== duplicate.id));
            } catch (e) {
                if (!cancelled) setErr(String(e.message || e));
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 250);
        return () => { cancelled = true; clearTimeout(t); };
    }, [query, duplicate.id]);

    async function submit() {
        if (!selected) return;
        setSubmitting(true);
        setErr(null);
        try {
            const res = await fetch('/api/admin/customers/merge', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    primaryId: selected.id,
                    duplicateIds: [duplicate.id],
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(json.error || `HTTP ${res.status}`);
                return;
            }
            onMerged(selected.id);
        } catch (e) {
            setErr(String(e.message || e));
        } finally {
            setSubmitting(false);
        }
    }

    const summary = useMemo(() => {
        if (!selected) return null;
        return (
            <div className="admin-customers__merge-summary">
                <p><strong>This customer (will be archived):</strong></p>
                <p>{duplicate.name || '(no name)'} — {duplicate.email}</p>
                <p>↓ merge into ↓</p>
                <p><strong>Primary (will be kept):</strong></p>
                <p>{selected.name || '(no name)'} — {selected.email}</p>
            </div>
        );
    }, [selected, duplicate]);

    return (
        <div className="admin-customers__modal-backdrop" onClick={onClose}>
            <div className="admin-customers__modal" onClick={(e) => e.stopPropagation()}>
                <header className="admin-customers__modal-header">
                    <h2>Merge customer into…</h2>
                    <button type="button" className="admin-customers__modal-close" onClick={onClose} aria-label="Close">×</button>
                </header>

                <div className="admin-customers__modal-body">
                    <p>Search for the canonical customer to merge <strong>{duplicate.name || duplicate.email}</strong> into.</p>
                    <input
                        type="search"
                        autoFocus
                        className="admin-customers__merge-search"
                        placeholder="Search by email or name…"
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
                    />
                    {searching && <p className="admin-customers__loading">Searching…</p>}
                    {!searching && query.trim() && results.length === 0 && (
                        <p className="admin-customers__empty">No active customers match.</p>
                    )}
                    {!searching && results.length > 0 && (
                        <ul className="admin-customers__merge-results">
                            {results.map((c) => (
                                <li key={c.id}>
                                    <button
                                        type="button"
                                        className={selected?.id === c.id ? 'admin-customers__merge-pick admin-customers__merge-pick--active' : 'admin-customers__merge-pick'}
                                        onClick={() => setSelected(c)}
                                    >
                                        <strong>{c.name || '(no name)'}</strong>
                                        <span className="admin-customers__muted"> — {c.email} · {c.totalBookings} bookings · {formatMoney(c.lifetimeValueCents)} LTV</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {summary}
                    {err && <p className="admin-customers__error">Error: {err}</p>}
                </div>

                <footer className="admin-customers__modal-footer">
                    <button type="button" className="admin-customers__btn" onClick={onClose}>Cancel</button>
                    <button
                        type="button"
                        className="admin-customers__btn admin-customers__btn--danger"
                        disabled={!selected || submitting}
                        onClick={submit}
                    >
                        {submitting ? 'Merging…' : 'Merge'}
                    </button>
                </footer>
            </div>
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div className="admin-customers__stat">
            <div className="admin-customers__stat-label">{label}</div>
            <div className="admin-customers__stat-value">{value ?? '—'}</div>
        </div>
    );
}

function StatusPill({ status }) {
    const cls = `admin-customers__status-pill admin-customers__status-pill--${status || 'unknown'}`;
    return <span className={cls}>{status || '—'}</span>;
}

function formatDate(ms) {
    if (!ms) return '—';
    try {
        return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return '—';
    }
}

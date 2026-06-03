// Post-M6 Track D-1b — admin-side customer create modal.
//
// Backs POST /api/admin/customers (added in same batch). Phone-intake
// operator workflow: operator picks up the phone, creates a customer
// without waiting for them to book. clientType=individual is the
// default; switching to business reveals the B2B subform. EIN +
// billing address are encrypted server-side via the D-1a path.

import { useState } from 'react';

export default function CustomerCreateModal({ onClose, onCreated }) {
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [clientType, setClientType] = useState('individual');
    const [businessName, setBusinessName] = useState('');
    const [businessWebsite, setBusinessWebsite] = useState('');
    const [businessTaxId, setBusinessTaxId] = useState('');
    const [line1, setLine1] = useState('');
    const [line2, setLine2] = useState('');
    const [city, setCity] = useState('');
    const [state, setState] = useState('');
    const [postal, setPostal] = useState('');
    const [country, setCountry] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState(null);
    const [duplicateOf, setDuplicateOf] = useState(null);

    const emailError = (() => {
        const v = email.trim();
        if (!v) return null; // empty handled on submit (required)
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Email format looks invalid';
        return null;
    })();

    const einError = (() => {
        const v = businessTaxId.trim();
        if (!v) return null;
        if (!/^\d{2}-\d{7}$/.test(v)) return 'EIN must be XX-XXXXXXX';
        return null;
    })();

    async function submit(e) {
        e.preventDefault();
        setErr(null);
        setDuplicateOf(null);

        if (!email.trim()) { setErr('Email is required'); return; }
        if (emailError) { setErr(emailError); return; }
        if (einError) { setErr(einError); return; }

        setSubmitting(true);

        const billing = {};
        if (line1.trim()) billing.line1 = line1.trim();
        if (line2.trim()) billing.line2 = line2.trim();
        if (city.trim()) billing.city = city.trim();
        if (state.trim()) billing.state = state.trim();
        if (postal.trim()) billing.postal = postal.trim();
        if (country.trim()) billing.country = country.trim();

        const payload = {
            email: email.trim(),
            name: name.trim() || null,
            phone: phone.trim() || null,
            clientType,
            notes: notes.trim() || null,
        };
        if (clientType === 'business') {
            payload.businessName = businessName.trim() || null;
            payload.businessWebsite = businessWebsite.trim() || null;
            payload.businessTaxId = businessTaxId.trim() || null;
            payload.businessBillingAddress = Object.keys(billing).length ? billing : null;
        }

        try {
            const res = await fetch('/api/admin/customers', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const json = await res.json().catch(() => ({}));
            if (res.status === 409 && json.existingCustomerId) {
                setDuplicateOf(json.existingCustomerId);
                return;
            }
            if (!res.ok) {
                setErr(json.error || `HTTP ${res.status}`);
                return;
            }
            onCreated?.(json.customerId);
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
                    <h2>New customer</h2>
                    <button type="button" className="admin-customers__modal-close" onClick={onClose} aria-label="Close">×</button>
                </header>

                <form onSubmit={submit}>
                    <div className="admin-customers__modal-body">
                        <label style={{ display: 'block', marginBottom: '0.85rem' }}>
                            <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>
                                Email <span style={{ color: '#dc2626' }}>*</span>
                            </span>
                            <input
                                type="email"
                                autoFocus
                                value={email}
                                onChange={(e) => { setEmail(e.target.value); setDuplicateOf(null); }}
                                className="admin-customers__merge-search"
                                required
                                placeholder="customer@example.com"
                            />
                            {emailError && <small style={{ color: '#dc2626', display: 'block', marginTop: '0.25rem' }}>{emailError}</small>}
                            {duplicateOf && (
                                <small style={{ color: '#dc2626', display: 'block', marginTop: '0.25rem' }}>
                                    A customer with this email already exists.{' '}
                                    <a href={`/admin/customers/${encodeURIComponent(duplicateOf)}`}>
                                        Open existing customer →
                                    </a>
                                </small>
                            )}
                        </label>

                        <label style={{ display: 'block', marginBottom: '0.85rem' }}>
                            <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>Name</span>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="admin-customers__merge-search"
                                placeholder="Full name"
                            />
                        </label>

                        <label style={{ display: 'block', marginBottom: '0.85rem' }}>
                            <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>Phone</span>
                            <input
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                className="admin-customers__merge-search"
                                placeholder="555-555-1234"
                            />
                        </label>

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

                        {clientType === 'business' && (
                            <>
                                <h3 style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>Business details</h3>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                                    <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>Business name</span>
                                    <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="admin-customers__merge-search" />
                                </label>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                                    <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>Website</span>
                                    <input type="url" value={businessWebsite} onChange={(e) => setBusinessWebsite(e.target.value)} className="admin-customers__merge-search" placeholder="https://" />
                                </label>
                                <label style={{ display: 'block', marginBottom: '0.85rem' }}>
                                    <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>
                                        EIN / Tax ID <small style={{ color: 'var(--color-text-muted)', fontWeight: 'normal' }}>(encrypted at rest)</small>
                                    </span>
                                    <input type="text" value={businessTaxId} onChange={(e) => setBusinessTaxId(e.target.value)} className="admin-customers__merge-search" placeholder="XX-XXXXXXX" />
                                    {einError && <small style={{ color: '#dc2626', display: 'block', marginTop: '0.25rem' }}>{einError}</small>}
                                </label>

                                <h3 style={{ marginTop: '0.85rem', marginBottom: '0.5rem' }}>
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
                            </>
                        )}

                        <label style={{ display: 'block', marginBottom: '0.85rem' }}>
                            <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>Notes</span>
                            <textarea
                                rows={2}
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                className="admin-customers__merge-search"
                                placeholder="Internal notes (visible to all admins)"
                            />
                        </label>

                        {err && <p className="admin-customers__error">Error: {err}</p>}
                    </div>

                    <footer className="admin-customers__modal-footer">
                        <button type="button" className="admin-customers__btn" onClick={onClose} disabled={submitting}>Cancel</button>
                        <button
                            type="submit"
                            className="admin-customers__btn admin-customers__btn--primary"
                            disabled={submitting || !email.trim() || !!emailError || !!einError}
                        >
                            {submitting ? 'Creating…' : 'Create customer'}
                        </button>
                    </footer>
                </form>
            </div>
        </div>
    );
}

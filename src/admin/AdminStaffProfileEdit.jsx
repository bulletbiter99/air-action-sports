// Post-M5.5 P1 — Profile edit modal for /admin/staff/:id Profile tab.
//
// PUT /api/admin/staff/:id accepts an allow-list of 8 columns
// (full_name, preferred_name, pronouns, email, phone, status,
//  hired_at, separated_at). Mailing address + compensation + notes
// have their own dedicated flows and are not edited here.

import { useState } from 'react';

const STATUS_OPTIONS = [
    { value: 'active',      label: 'Active' },
    { value: 'onboarding',  label: 'Onboarding' },
    { value: 'on_leave',    label: 'On leave' },
    { value: 'offboarding', label: 'Offboarding' },
    { value: 'inactive',    label: 'Inactive' },
];

function toDateInput(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function fromDateInput(s) {
    if (!s) return null;
    const ms = new Date(`${s}T00:00:00Z`).getTime();
    return Number.isNaN(ms) ? null : ms;
}

export default function AdminStaffProfileEdit({ person, onClose, onSaved }) {
    const [form, setForm] = useState({
        fullName: person.fullName || '',
        preferredName: person.preferredName || '',
        pronouns: person.pronouns || '',
        email: person.email || '',
        phone: person.phone || '',
        status: person.status || 'active',
        hiredAt: toDateInput(person.hiredAt),
        separatedAt: toDateInput(person.separatedAt),
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    function update(key, value) {
        setForm((prev) => ({ ...prev, [key]: value }));
    }

    async function submit(e) {
        e?.preventDefault?.();
        setError(null);

        const fullName = form.fullName.trim();
        if (!fullName) {
            setError('Full name is required.');
            return;
        }

        setSubmitting(true);
        try {
            const body = {
                full_name: fullName,
                preferred_name: form.preferredName.trim() || null,
                pronouns: form.pronouns.trim() || null,
                email: form.email.trim() || null,
                phone: form.phone.trim() || null,
                status: form.status,
                hired_at: fromDateInput(form.hiredAt),
                separated_at: fromDateInput(form.separatedAt),
            };
            const res = await fetch(`/api/admin/staff/${person.id}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data?.error || `Request failed (${res.status})`);
                return;
            }
            onSaved?.();
        } catch (err) {
            setError(err?.message || 'Network error');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div style={modalBack} onClick={onClose}>
            <div style={modalCard} onClick={(e) => e.stopPropagation()}>
                <h3 style={h3}>Edit profile</h3>

                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {error && <div style={errorBox}>{error}</div>}

                    <label style={lblBlock}>
                        Full name <span style={req}>*</span>
                        <input type="text" value={form.fullName} onChange={(e) => update('fullName', e.target.value)} style={input} autoFocus required maxLength={200} />
                    </label>

                    <div style={twoCol}>
                        <label style={lblBlock}>
                            Preferred name
                            <input type="text" value={form.preferredName} onChange={(e) => update('preferredName', e.target.value)} style={input} maxLength={120} />
                        </label>

                        <label style={lblBlock}>
                            Pronouns
                            <input type="text" value={form.pronouns} onChange={(e) => update('pronouns', e.target.value)} style={input} maxLength={40} placeholder="e.g. she/her" />
                        </label>
                    </div>

                    <div style={twoCol}>
                        <label style={lblBlock}>
                            Email
                            <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} style={input} maxLength={254} />
                        </label>

                        <label style={lblBlock}>
                            Phone
                            <input type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} style={input} maxLength={40} />
                        </label>
                    </div>

                    <label style={lblBlock}>
                        Status
                        <select value={form.status} onChange={(e) => update('status', e.target.value)} style={input}>
                            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </label>

                    <div style={twoCol}>
                        <label style={lblBlock}>
                            Hired at
                            <input type="date" value={form.hiredAt} onChange={(e) => update('hiredAt', e.target.value)} style={input} />
                        </label>

                        <label style={lblBlock}>
                            Separated at
                            <input type="date" value={form.separatedAt} onChange={(e) => update('separatedAt', e.target.value)} style={input} />
                        </label>
                    </div>

                    <div style={actions}>
                        <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
                        <button type="submit" disabled={submitting || !form.fullName.trim()} style={primaryBtn}>
                            {submitting ? 'Saving…' : 'Save changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

const modalBack = { position: 'fixed', inset: 0, background: 'var(--color-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modalCard = { background: 'var(--mid)', border: '1px solid var(--color-border-strong)', padding: '2rem', maxWidth: 640, width: '100%', maxHeight: '90vh', overflowY: 'auto' };
const h3 = { fontSize: 18, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--cream)', margin: '0 0 16px' };
const lblBlock = { display: 'block', fontSize: 12, color: 'var(--tan-light)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 };
const twoCol = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 };
const input = { width: '100%', padding: '10px 14px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 13, marginTop: 6, fontFamily: 'inherit', boxSizing: 'border-box' };
const primaryBtn = { padding: '10px 20px', background: 'var(--orange)', color: 'white', border: 0, fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const cancelBtn = { padding: '10px 20px', background: 'transparent', color: 'var(--tan)', border: '1px solid var(--color-border-strong)', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const actions = { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 };
const errorBox = { padding: 10, background: 'var(--color-danger-soft)', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', fontSize: 13 };
const req = { color: 'var(--color-danger)' };

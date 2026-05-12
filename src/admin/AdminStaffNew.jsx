// Post-M5.5 wiring fix — new-person create form.
//
// /admin/staff → "+ New Person" → /admin/staff/new lands here. Posts to
// POST /api/admin/staff (added in the same patch) and redirects to the
// freshly-created person's detail page on success.

import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';

const STATUS_OPTIONS = [
    { value: 'onboarding',  label: 'Onboarding (default)' },
    { value: 'active',      label: 'Active' },
    { value: 'on_leave',    label: 'On leave' },
    { value: 'offboarding', label: 'Offboarding' },
    { value: 'inactive',    label: 'Inactive' },
];

export default function AdminStaffNew() {
    const { isAuthenticated, hasRole } = useAdmin();
    const navigate = useNavigate();

    const [form, setForm] = useState({
        fullName: '',
        preferredName: '',
        email: '',
        phone: '',
        status: 'onboarding',
        primaryRoleId: '',
        notes: '',
    });
    const [roles, setRoles] = useState([]);
    const [rolesLoading, setRolesLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!isAuthenticated) return;
        setRolesLoading(true);
        (async () => {
            try {
                const res = await fetch('/api/admin/staff/roles-catalog', { credentials: 'include' });
                if (res.ok) {
                    const data = await res.json();
                    setRoles(data.roles || []);
                }
            } finally {
                setRolesLoading(false);
            }
        })();
    }, [isAuthenticated]);

    if (!isAuthenticated) return null;

    const canCreate = hasRole?.('manager');

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
            const payload = {
                fullName,
                preferredName: form.preferredName.trim() || null,
                email: form.email.trim() || null,
                phone: form.phone.trim() || null,
                status: form.status,
                primaryRoleId: form.primaryRoleId || null,
                notes: form.notes.trim() || null,
            };
            const res = await fetch('/api/admin/staff', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data?.error || `Request failed (${res.status})`);
                return;
            }
            navigate(`/admin/staff/${data.person.id}`);
        } catch (err) {
            setError(err?.message || 'Network error');
        } finally {
            setSubmitting(false);
        }
    }

    if (!canCreate) {
        return (
            <div style={page}>
                <Link to="/admin/staff" style={breadcrumb}>← Staff</Link>
                <h1 style={h1}>New Person</h1>
                <p style={errorBox}>You don&apos;t have permission to create staff records. Ask an owner or manager.</p>
            </div>
        );
    }

    return (
        <div style={page}>
            <Link to="/admin/staff" style={breadcrumb}>← Staff</Link>
            <h1 style={h1}>New Person</h1>

            <form onSubmit={submit} style={section}>
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
                        Status
                        <select value={form.status} onChange={(e) => update('status', e.target.value)} style={input}>
                            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
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
                    Primary role {rolesLoading && <span style={hint}>(loading…)</span>}
                    <select value={form.primaryRoleId} onChange={(e) => update('primaryRoleId', e.target.value)} style={input} disabled={rolesLoading}>
                        <option value="">— none yet (assign later) —</option>
                        {roles.map((r) => (
                            <option key={r.id} value={r.id}>{r.name} (Tier {r.tier})</option>
                        ))}
                    </select>
                </label>

                <label style={lblBlock}>
                    Notes
                    <textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} rows={4} style={input} />
                </label>

                <div style={actions}>
                    <Link to="/admin/staff" style={cancelBtn}>Cancel</Link>
                    <button type="submit" disabled={submitting || !form.fullName.trim()} style={primaryBtn}>
                        {submitting ? 'Creating…' : 'Create person'}
                    </button>
                </div>
            </form>
        </div>
    );
}

const page = { maxWidth: 720, margin: '0 auto', padding: '2rem' };
const breadcrumb = { color: 'var(--orange)', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'none' };
const h1 = { fontSize: 32, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: '8px 0 24px' };
const section = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: 16 };
const lblBlock = { display: 'block', fontSize: 12, color: 'var(--tan-light)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 };
const twoCol = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 };
const input = { width: '100%', padding: '10px 14px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 13, marginTop: 6, fontFamily: 'inherit', boxSizing: 'border-box' };
const primaryBtn = { padding: '10px 20px', background: 'var(--orange)', color: 'white', border: 0, fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const cancelBtn = { padding: '10px 20px', background: 'transparent', color: 'var(--tan)', border: '1px solid var(--color-border-strong)', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' };
const actions = { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 };
const errorBox = { padding: 12, background: 'var(--color-danger-soft)', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', fontSize: 13 };
const req = { color: 'var(--color-danger)' };
const hint = { color: 'var(--olive-light)', fontWeight: 400, fontSize: 10, fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 };

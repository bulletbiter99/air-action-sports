// M5 R8 — staff certification editor (extracted from inline CertificationsTab in AdminStaffDetail).
//
// Renders an inline add/edit form for a single certification. Caller owns
// the open/close state and reload callback; this component just owns the
// form-field state and the POST submission.
//
// Props:
//   - personId: string (required) — passed to the API as personId
//   - mode: 'add' | 'edit' | 'renew' (default 'add')
//   - initialCert: optional — for 'edit' mode, prefills fields from a cert row
//   - onSaved: () => void — called after a successful POST/PUT
//   - onCancel: () => void — called when the user clicks Cancel

import { useState } from 'react';

const EMPTY_FORM = {
    kind: '',
    displayName: '',
    certificateNumber: '',
    issuingAuthority: '',
    issuedAt: '',
    expiresAt: '',
    notes: '',
};

function toDateInputValue(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function AdminStaffCertEditor({
    personId,
    mode = 'add',
    initialCert = null,
    onSaved,
    onCancel,
}) {
    const [form, setForm] = useState(() => {
        if (!initialCert) return EMPTY_FORM;
        return {
            kind: initialCert.kind || '',
            displayName: initialCert.displayName || '',
            certificateNumber: initialCert.certificateNumber || '',
            issuingAuthority: initialCert.issuingAuthority || '',
            issuedAt: toDateInputValue(initialCert.issuedAt),
            expiresAt: toDateInputValue(initialCert.expiresAt),
            notes: initialCert.notes || '',
        };
    });
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState('');

    const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    async function submit() {
        setSubmitting(true);
        setErr('');
        try {
            const body = {
                personId,
                kind: form.kind,
                displayName: form.displayName,
                certificateNumber: form.certificateNumber || null,
                issuingAuthority: form.issuingAuthority || null,
                issuedAt: form.issuedAt ? new Date(form.issuedAt).getTime() : null,
                expiresAt: form.expiresAt ? new Date(form.expiresAt).getTime() : null,
                notes: form.notes || null,
            };

            let url;
            let method;
            if (mode === 'edit') {
                url = `/api/admin/certifications/${initialCert.id}`;
                method = 'PUT';
                // PUT body excludes personId/kind (immutable post-creation)
                delete body.personId;
                delete body.kind;
            } else if (mode === 'renew') {
                url = `/api/admin/certifications/${initialCert.id}/renew`;
                method = 'POST';
                // Renew body uses just the new dates + cert# / notes
                delete body.personId;
                delete body.kind;
                delete body.displayName;
                delete body.issuingAuthority;
            } else {
                url = '/api/admin/certifications';
                method = 'POST';
            }

            const res = await fetch(url, {
                method,
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setErr(data.error || `${method} failed`);
                return;
            }
            setForm(EMPTY_FORM);
            if (onSaved) onSaved();
        } finally {
            setSubmitting(false);
        }
    }

    const canSubmit = (() => {
        if (mode === 'add') return form.kind && form.displayName && !submitting;
        if (mode === 'edit') return form.displayName && !submitting;
        if (mode === 'renew') return !submitting; // dates optional — backend uses defaults
        return false;
    })();

    return (
        <div style={editorWrap}>
            {mode === 'add' && (
                <>
                    <label style={lbl}>
                        Kind
                        <input
                            type="text"
                            value={form.kind}
                            onChange={(e) => update('kind', e.target.value)}
                            placeholder="cpr / first_aid / emt_basic / aas_marshal"
                            style={input}
                        />
                    </label>
                    <label style={lbl}>
                        Display name
                        <input
                            type="text"
                            value={form.displayName}
                            onChange={(e) => update('displayName', e.target.value)}
                            placeholder="CPR/AED — American Heart Association"
                            style={input}
                        />
                    </label>
                </>
            )}
            {mode === 'edit' && (
                <label style={lbl}>
                    Display name
                    <input
                        type="text"
                        value={form.displayName}
                        onChange={(e) => update('displayName', e.target.value)}
                        style={input}
                    />
                </label>
            )}
            <label style={lbl}>
                Certificate number
                <input
                    type="text"
                    value={form.certificateNumber}
                    onChange={(e) => update('certificateNumber', e.target.value)}
                    style={input}
                />
            </label>
            {mode !== 'renew' && (
                <label style={lbl}>
                    Issuing authority
                    <input
                        type="text"
                        value={form.issuingAuthority}
                        onChange={(e) => update('issuingAuthority', e.target.value)}
                        style={input}
                    />
                </label>
            )}
            <label style={lbl}>
                Issued at
                <input
                    type="date"
                    value={form.issuedAt}
                    onChange={(e) => update('issuedAt', e.target.value)}
                    style={input}
                />
            </label>
            <label style={lbl}>
                Expires at
                <input
                    type="date"
                    value={form.expiresAt}
                    onChange={(e) => update('expiresAt', e.target.value)}
                    style={input}
                />
            </label>
            <label style={lbl}>
                Notes
                <textarea
                    value={form.notes}
                    onChange={(e) => update('notes', e.target.value)}
                    rows={2}
                    style={input}
                />
            </label>
            {err && <div style={errorText}>{err}</div>}
            <div style={actions}>
                <button type="button" onClick={submit} disabled={!canSubmit} style={primaryBtn}>
                    {submitting
                        ? 'Saving…'
                        : mode === 'renew'
                            ? 'Renew certification'
                            : mode === 'edit'
                                ? 'Save changes'
                                : 'Save'}
                </button>
                {onCancel && (
                    <button type="button" onClick={onCancel} disabled={submitting} style={cancelBtn}>
                        Cancel
                    </button>
                )}
            </div>
        </div>
    );
}

const editorWrap = {
    marginTop: 'var(--space-16)',
    padding: 'var(--space-16)',
    background: 'var(--color-bg-sunken)',
    border: '1px solid var(--color-border)',
};
const lbl = {
    display: 'block',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-muted)',
    fontWeight: 'var(--font-weight-bold)',
    marginBottom: 'var(--space-12)',
    textTransform: 'uppercase',
    letterSpacing: 'var(--letter-spacing-wide)',
};
const input = {
    width: '100%',
    padding: 'var(--space-8) var(--space-12)',
    background: 'var(--color-bg-page)',
    border: '1px solid var(--color-border-strong)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-base)',
    marginTop: 'var(--space-4)',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
};
const actions = { display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-8)' };
const primaryBtn = {
    padding: 'var(--space-8) var(--space-16)',
    background: 'var(--color-accent)',
    color: 'var(--color-accent-on-accent)',
    border: 0,
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-extrabold)',
    letterSpacing: 'var(--letter-spacing-wider)',
    textTransform: 'uppercase',
    cursor: 'pointer',
};
const cancelBtn = {
    padding: 'var(--space-8) var(--space-16)',
    background: 'transparent',
    color: 'var(--color-text-muted)',
    border: '1px solid var(--color-border-strong)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-extrabold)',
    letterSpacing: 'var(--letter-spacing-wider)',
    textTransform: 'uppercase',
    cursor: 'pointer',
};
const errorText = {
    color: 'var(--color-danger)',
    fontSize: 'var(--font-size-sm)',
    margin: 'var(--space-8) 0',
};

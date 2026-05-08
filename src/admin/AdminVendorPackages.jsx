import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAdmin } from './AdminContext';

// Per-event vendor package composer. Two modes in one file:
//  - List:    /admin/vendor-packages            (filterable by event)
//  - Detail:  /admin/vendor-packages/:id        (compose, attach docs, send, revoke)

export default function AdminVendorPackages() {
    const { id } = useParams();
    return id ? <Composer eventVendorId={id} /> : <ListView />;
}

// ───── List view ─────

function ListView() {
    const { isAuthenticated, loading, hasRole } = useAdmin();
    const navigate = useNavigate();
    const [events, setEvents] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [rows, setRows] = useState([]);
    const [filterEvent, setFilterEvent] = useState('');
    const [filterVendor, setFilterVendor] = useState('');
    const [loadingList, setLoadingList] = useState(false);
    const [attaching, setAttaching] = useState(false);

    useEffect(() => {
        if (loading) return;
        if (!isAuthenticated) navigate('/admin/login');
    }, [loading, isAuthenticated, navigate]);

    const load = useCallback(async () => {
        setLoadingList(true);
        const params = new URLSearchParams();
        if (filterEvent) params.set('event_id', filterEvent);
        if (filterVendor) params.set('vendor_id', filterVendor);
        const res = await fetch(`/api/admin/event-vendors?${params}`, { credentials: 'include', cache: 'no-store' });
        if (res.ok) setRows((await res.json()).eventVendors || []);
        setLoadingList(false);
    }, [filterEvent, filterVendor]);

    useEffect(() => {
        if (!isAuthenticated) return;
        (async () => {
            const [e, v] = await Promise.all([
                fetch('/api/admin/events', { credentials: 'include', cache: 'no-store' }).then((r) => r.json()).catch(() => ({ events: [] })),
                fetch('/api/admin/vendors', { credentials: 'include', cache: 'no-store' }).then((r) => r.json()).catch(() => ({ vendors: [] })),
            ]);
            setEvents(e.events || []);
            setVendors(v.vendors || []);
        })();
    }, [isAuthenticated]);

    useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

    if (loading || !isAuthenticated) return null;

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <h1 style={h1}>Vendor Packages</h1>
                <div style={{ display: 'flex', gap: 8 }}>
                    <Link to="/admin/vendors" style={subtleBtn}>← Vendors</Link>
                    {hasRole('manager') && <button onClick={() => setAttaching(true)} style={primaryBtn}>+ Attach Vendor</button>}
                </div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                <select value={filterEvent} onChange={(e) => setFilterEvent(e.target.value)} style={input}>
                    <option value="">All events</option>
                    {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                </select>
                <select value={filterVendor} onChange={(e) => setFilterVendor(e.target.value)} style={input}>
                    <option value="">All vendors</option>
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.companyName}</option>)}
                </select>
            </div>

            <div style={tableBox}>
                {loadingList && <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>Loading…</p>}
                {!loadingList && rows.length === 0 && <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>No packages yet. Click "Attach Vendor" to link a vendor to an event.</p>}
                {rows.length > 0 && (
                    <table style={table}>
                        <thead>
                            <tr>
                                <th style={th}>Event</th>
                                <th style={th}>Vendor</th>
                                <th style={th}>Primary contact</th>
                                <th style={th}>Status</th>
                                <th style={th}>Last viewed</th>
                                <th style={th}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} style={tr}>
                                    <td style={td}><strong>{r.event.title}</strong><br /><span style={{ color: 'var(--olive-light)', fontSize: 11 }}>{r.event.displayDate}</span></td>
                                    <td style={td}>{r.vendor.companyName}</td>
                                    <td style={td}>{r.primaryContact ? `${r.primaryContact.name} <${r.primaryContact.email}>` : <span style={{ color: '#e74c3c', fontSize: 11 }}>none — assign before send</span>}</td>
                                    <td style={td}><StatusChip status={r.status} /></td>
                                    <td style={td}>{r.lastViewedAt ? new Date(r.lastViewedAt).toLocaleString() : <span style={{ color: 'var(--olive-light)', fontSize: 11 }}>—</span>}</td>
                                    <td style={{ ...td, textAlign: 'right' }}><Link to={`/admin/vendor-packages/${r.id}`} style={subtleBtn}>Open →</Link></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {attaching && (
                <AttachModal
                    events={events}
                    vendors={vendors}
                    onClose={() => setAttaching(false)}
                    onAttached={(id) => { setAttaching(false); window.location.href = `/admin/vendor-packages/${id}`; }}
                />
            )}
        </div>
    );
}

function AttachModal({ events, vendors, onClose, onAttached }) {
    const [eventId, setEventId] = useState('');
    const [vendorId, setVendorId] = useState('');
    const [notes, setNotes] = useState('');
    const [err, setErr] = useState(''); const [saving, setSaving] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setErr(''); setSaving(true);
        const res = await fetch('/api/admin/event-vendors', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId, vendorId, notes }),
        });
        setSaving(false);
        const d = await res.json();
        if (!res.ok) { setErr(d.error || 'Failed'); return; }
        onAttached(d.eventVendor.id);
    };

    return (
        <div style={modalBg} onClick={onClose}>
            <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={modal}>
                <h2 style={{ ...h1, fontSize: 20, marginBottom: 14 }}>Attach Vendor to Event</h2>
                <Field label="Event *">
                    <select value={eventId} onChange={(e) => setEventId(e.target.value)} required style={input}>
                        <option value="">Select event…</option>
                        {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                    </select>
                </Field>
                <Field label="Vendor *">
                    <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required style={input}>
                        <option value="">Select vendor…</option>
                        {vendors.map((v) => <option key={v.id} value={v.id}>{v.companyName}</option>)}
                    </select>
                </Field>
                <Field label="Internal notes">
                    <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...input, minHeight: 70, resize: 'vertical' }} />
                </Field>
                {err && <div style={{ color: '#e74c3c', fontSize: 12, margin: '8px 0' }}>{err}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button type="submit" disabled={saving} style={primaryBtn}>{saving ? 'Attaching…' : 'Attach →'}</button>
                    <button type="button" onClick={onClose} style={subtleBtn}>Cancel</button>
                </div>
            </form>
        </div>
    );
}

// ───── Composer ─────

function Composer({ eventVendorId }) {
    const { isAuthenticated, loading, hasRole } = useAdmin();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);

    useEffect(() => {
        if (loading) return;
        if (!isAuthenticated) navigate('/admin/login');
    }, [loading, isAuthenticated, navigate]);

    const reload = useCallback(async () => {
        const res = await fetch(`/api/admin/event-vendors/${eventVendorId}`, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) { setErr((await res.json()).error || 'Failed to load'); return; }
        setData(await res.json());
    }, [eventVendorId]);

    useEffect(() => { if (isAuthenticated) reload(); }, [isAuthenticated, reload]);

    if (loading || !isAuthenticated) return null;
    if (err) return <div style={{ padding: '2rem', color: '#e74c3c' }}>{err} — <Link to="/admin/vendor-packages">Back</Link></div>;
    if (!data) return <div style={{ padding: '2rem', color: 'var(--olive-light)' }}>Loading…</div>;

    const { eventVendor: ev, sections, documents, accessLog } = data;

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem' }}>
            <div style={{ marginBottom: 8 }}>
                <Link to="/admin/vendor-packages" style={{ color: 'var(--tan-light)', fontSize: 12, textDecoration: 'none' }}>← Back to packages</Link>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
                <div>
                    <h1 style={{ ...h1, marginBottom: 4 }}>{ev.vendor.companyName}</h1>
                    <p style={{ color: 'var(--tan-light)', fontSize: 13, margin: 0 }}>
                        {ev.event.title} — {ev.event.displayDate}
                    </p>
                    <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <StatusChip status={ev.status} />
                        {ev.sentAt && <span style={{ color: 'var(--olive-light)', fontSize: 11 }}>Sent {new Date(ev.sentAt).toLocaleString()}</span>}
                        {ev.lastViewedAt && <span style={{ color: 'var(--olive-light)', fontSize: 11 }}>· Last viewed {new Date(ev.lastViewedAt).toLocaleString()}</span>}
                        {ev.tokenExpiresAt && <span style={{ color: 'var(--olive-light)', fontSize: 11 }}>· Token expires {new Date(ev.tokenExpiresAt).toLocaleDateString()}</span>}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {hasRole('manager') && ev.status !== 'revoked' && <SendButton eventVendorId={ev.id} hasPrimary={!!ev.primaryContact} onSent={reload} />}
                    {hasRole('manager') && ev.status !== 'revoked' && <RevokeButton eventVendorId={ev.id} onRevoked={reload} />}
                </div>
            </div>

            <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 20 }}>
                <div>
                    <PrimaryContactPicker eventVendor={ev} onUpdated={reload} hasRole={hasRole} />
                    <ContractPanel eventVendor={ev} hasRole={hasRole} onChanged={reload} />
                    <SectionsPanel eventVendorId={ev.id} sections={sections} hasRole={hasRole} onChanged={reload} />
                </div>
                <div>
                    <DocumentsPanel eventVendorId={ev.id} vendorId={ev.vendor.id || ev.vendorId} documents={documents} hasRole={hasRole} onChanged={reload} />
                    <AccessLogPanel log={accessLog} />
                </div>
            </div>
        </div>
    );
}

function ContractPanel({ eventVendor, hasRole, onChanged }) {
    const [saving, setSaving] = useState(false);
    const [sig, setSig] = useState(null);
    const [loadingSig, setLoadingSig] = useState(true);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/admin/event-vendors/${eventVendor.id}/signature`, { credentials: 'include', cache: 'no-store' })
            .then((r) => r.json())
            .then((d) => { if (!cancelled) { setSig(d.signature); setLoadingSig(false); } });
        return () => { cancelled = true; };
    }, [eventVendor.id, eventVendor.contractSignedAt, eventVendor.contractCountersignedAt]);

    const toggle = async (required) => {
        setSaving(true);
        const res = await fetch(`/api/admin/event-vendors/${eventVendor.id}/contract`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ required }),
        });
        setSaving(false);
        if (!res.ok) { alert((await res.json()).error || 'Failed'); return; }
        onChanged();
    };

    const countersign = async () => {
        if (!window.confirm('Countersign this vendor agreement on behalf of Air Action Sports? The vendor will be emailed a fully-executed copy.')) return;
        const res = await fetch(`/api/admin/event-vendors/${eventVendor.id}/countersign`, { method: 'POST', credentials: 'include' });
        if (!res.ok) { alert((await res.json()).error || 'Failed'); return; }
        onChanged();
    };

    const req = !!eventVendor.contract_required || !!eventVendor.contractRequired;

    return (
        <div style={{ ...panel, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={panelTitle}>Contract</h3>
                {hasRole('manager') && (
                    <label style={{ color: 'var(--tan-light)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={req} disabled={saving} onChange={(e) => toggle(e.target.checked)} />
                        Require signature
                    </label>
                )}
            </div>
            {!req && <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>No contract required for this package.</p>}
            {req && loadingSig && <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>Loading signature status…</p>}
            {req && !loadingSig && !sig && (
                <p style={{ color: '#d9822b', fontSize: 13 }}>
                    ⚠ Awaiting vendor signature. They'll see the live contract document on their package page.
                </p>
            )}
            {req && sig && (
                <div>
                    <p style={{ color: '#78c493', fontSize: 13, margin: '0 0 8px' }}>
                        ✓ Signed by <strong>{sig.typedName}</strong> ({sig.contactEmail}) on{' '}
                        {new Date(sig.signedAt).toLocaleString()}. v{sig.contractDocumentVersion}.
                    </p>
                    <p style={{ color: 'var(--olive-light)', fontSize: 11, fontFamily: 'monospace', margin: '0 0 10px' }}>
                        SHA-256: {sig.bodySha256.slice(0, 16)}…
                    </p>
                    {sig.countersignedAt ? (
                        <p style={{ color: '#78c493', fontSize: 13, margin: '0 0 8px' }}>
                            ✓ Countersigned on {new Date(sig.countersignedAt).toLocaleString()}
                        </p>
                    ) : (
                        hasRole('owner') && (
                            <button onClick={countersign} style={primaryBtn}>Countersign & email vendor</button>
                        )
                    )}
                </div>
            )}
        </div>
    );
}

function PrimaryContactPicker({ eventVendor, onUpdated, hasRole }) {
    const [contacts, setContacts] = useState([]);
    const [selected, setSelected] = useState(eventVendor.primaryContact?.id || '');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const vendorId = eventVendor.vendor.id || eventVendor.vendorId;
        fetch(`/api/admin/vendors/${vendorId}`, { credentials: 'include', cache: 'no-store' })
            .then((r) => r.json()).then((d) => setContacts(d.vendor?.contacts || []));
    }, [eventVendor.vendor.id, eventVendor.vendorId]);

    const save = async (newId) => {
        setSelected(newId); setSaving(true);
        await fetch(`/api/admin/event-vendors/${eventVendor.id}`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ primaryContactId: newId || null }),
        });
        setSaving(false);
        onUpdated();
    };

    return (
        <div style={{ ...panel, marginBottom: 16 }}>
            <h3 style={panelTitle}>Primary contact</h3>
            <select value={selected} onChange={(e) => save(e.target.value)} disabled={!hasRole('manager') || saving} style={input}>
                <option value="">— none —</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} &lt;{c.email}&gt;</option>)}
            </select>
            {contacts.length === 0 && <p style={{ color: '#e74c3c', fontSize: 12, margin: '8px 0 0' }}>No contacts on this vendor. Add one from the Vendors page first.</p>}
        </div>
    );
}

function SectionsPanel({ eventVendorId, sections, hasRole, onChanged }) {
    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState(null);

    const del = async (s) => {
        if (!window.confirm(`Delete section "${s.title}"?`)) return;
        await fetch(`/api/admin/event-vendors/${eventVendorId}/sections/${s.id}`, { method: 'DELETE', credentials: 'include' });
        onChanged();
    };

    return (
        <div style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={panelTitle}>Package sections</h3>
                {hasRole('manager') && <button onClick={() => setCreating(true)} style={subtleBtn}>+ Section</button>}
            </div>
            {sections.length === 0 && <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>No sections yet. Add overview, schedule, site map, etc.</p>}
            {sections.map((s) => (
                <div key={s.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                        <div>
                            <span style={{ color: 'var(--orange)', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase' }}>{s.kind} · #{s.sortOrder}</span>
                            <div style={{ color: 'var(--cream)', fontWeight: 700, fontSize: 14 }}>{s.title}</div>
                        </div>
                        {hasRole('manager') && (
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => setEditing(s)} style={subtleBtn}>Edit</button>
                                <button onClick={() => del(s)} style={subtleBtn}>Delete</button>
                            </div>
                        )}
                    </div>
                </div>
            ))}
            {(creating || editing) && (
                <SectionModal
                    eventVendorId={eventVendorId}
                    section={editing}
                    onClose={() => { setCreating(false); setEditing(null); }}
                    onSaved={() => { setCreating(false); setEditing(null); onChanged(); }}
                />
            )}
        </div>
    );
}

function SectionModal({ eventVendorId, section, onClose, onSaved }) {
    const isNew = !section;
    const [form, setForm] = useState({
        kind: section?.kind || 'overview',
        title: section?.title || '',
        bodyHtml: section?.bodyHtml || '',
        sortOrder: section?.sortOrder ?? 0,
    });
    const [err, setErr] = useState(''); const [saving, setSaving] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setErr(''); setSaving(true);
        const url = isNew
            ? `/api/admin/event-vendors/${eventVendorId}/sections`
            : `/api/admin/event-vendors/${eventVendorId}/sections/${section.id}`;
        const res = await fetch(url, {
            method: isNew ? 'POST' : 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
        });
        setSaving(false);
        if (!res.ok) { setErr((await res.json()).error || 'Failed'); return; }
        onSaved();
    };

    return (
        <div style={modalBg} onClick={onClose}>
            <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ ...modal, maxWidth: 720 }}>
                <h2 style={{ ...h1, fontSize: 20, marginBottom: 14 }}>{isNew ? 'New Section' : 'Edit Section'}</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 10 }}>
                    <Field label="Kind *">
                        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} style={input}>
                            {['overview', 'schedule', 'map', 'contact', 'custom'].map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                    </Field>
                    <Field label="Title *">
                        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required style={input} />
                    </Field>
                    <Field label="Order">
                        <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value, 10) || 0 })} style={input} />
                    </Field>
                </div>
                <Field label="Body (HTML supported)">
                    <textarea rows={12} value={form.bodyHtml} onChange={(e) => setForm({ ...form, bodyHtml: e.target.value })} style={{ ...input, minHeight: 220, fontFamily: 'monospace', resize: 'vertical' }} />
                </Field>
                {err && <div style={{ color: '#e74c3c', fontSize: 12, margin: '8px 0' }}>{err}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button type="submit" disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : (isNew ? 'Create' : 'Save')}</button>
                    <button type="button" onClick={onClose} style={subtleBtn}>Cancel</button>
                </div>
            </form>
        </div>
    );
}

function DocumentsPanel({ eventVendorId, vendorId, documents, hasRole, onChanged }) {
    const [uploading, setUploading] = useState(false);
    const [kind, setKind] = useState('admin_asset');

    const upload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        const fd = new FormData();
        fd.append('file', file);
        fd.append('event_vendor_id', eventVendorId);
        fd.append('kind', kind);
        const res = await fetch('/api/admin/uploads/vendor-doc', { method: 'POST', credentials: 'include', body: fd });
        setUploading(false);
        e.target.value = '';
        if (!res.ok) { alert((await res.json()).error || 'Upload failed'); return; }
        onChanged();
    };

    const del = async (d) => {
        if (!window.confirm(`Delete "${d.filename}"?`)) return;
        await fetch(`/api/admin/uploads/vendor-doc/${d.id}`, { method: 'DELETE', credentials: 'include' });
        onChanged();
    };

    return (
        <div style={{ ...panel, marginBottom: 16 }}>
            <h3 style={panelTitle}>Documents</h3>
            {documents.length === 0 && <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>No documents attached.</p>}
            {documents.map((d) => (
                <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(200,184,154,0.05)' }}>
                    <div>
                        <span style={{ color: 'var(--orange)', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase' }}>{d.kind}</span>
                        <div style={{ color: 'var(--cream)', fontSize: 13 }}>{d.filename}</div>
                        <div style={{ color: 'var(--olive-light)', fontSize: 11 }}>{Math.round(d.byteSize / 1024)} KB · {d.contentType}</div>
                    </div>
                    {hasRole('manager') && <button onClick={() => del(d)} style={subtleBtn}>Delete</button>}
                </div>
            ))}
            {hasRole('manager') && (
                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...input, maxWidth: 160 }}>
                        <option value="admin_asset">admin_asset</option>
                        <option value="coi">coi (informational)</option>
                        <option value="w9">w9 (informational)</option>
                    </select>
                    <label style={{ ...subtleBtn, cursor: uploading ? 'wait' : 'pointer' }}>
                        {uploading ? 'Uploading…' : 'Upload file'}
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,application/pdf,image/*" onChange={upload} disabled={uploading} style={{ display: 'none' }} />
                    </label>
                </div>
            )}
        </div>
    );
}

function AccessLogPanel({ log }) {
    return (
        <div style={panel}>
            <h3 style={panelTitle}>Access log (last 100)</h3>
            {log.length === 0 && <p style={{ color: 'var(--olive-light)', fontSize: 12 }}>No access yet.</p>}
            {log.map((l) => (
                <div key={l.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(200,184,154,0.05)', fontSize: 11, color: 'var(--tan-light)' }}>
                    <span style={{ color: 'var(--orange)', fontWeight: 700 }}>{l.action}</span>
                    {l.target && <span> · {l.target}</span>}
                    <div style={{ color: 'var(--olive-light)', fontSize: 10 }}>
                        {new Date(l.createdAt).toLocaleString()} · {l.ip || '(no ip)'} · tv{l.tokenVersion}
                    </div>
                </div>
            ))}
        </div>
    );
}

function SendButton({ eventVendorId, hasPrimary, onSent }) {
    const [sending, setSending] = useState(false);
    const send = async () => {
        if (!hasPrimary) { alert('Set a primary contact before sending.'); return; }
        if (!window.confirm('Send the package email to the primary contact now?')) return;
        setSending(true);
        const res = await fetch(`/api/admin/event-vendors/${eventVendorId}/send`, { method: 'POST', credentials: 'include' });
        setSending(false);
        if (!res.ok) { alert((await res.json()).error || 'Send failed'); return; }
        onSent();
    };
    return <button onClick={send} disabled={sending} style={primaryBtn}>{sending ? 'Sending…' : 'Send package'}</button>;
}

function RevokeButton({ eventVendorId, onRevoked }) {
    const revoke = async () => {
        if (!window.confirm('Revoke this package? All outstanding magic links will stop working immediately.')) return;
        const res = await fetch(`/api/admin/event-vendors/${eventVendorId}/revoke`, { method: 'POST', credentials: 'include' });
        if (!res.ok) { alert((await res.json()).error || 'Revoke failed'); return; }
        onRevoked();
    };
    return <button onClick={revoke} style={{ ...subtleBtn, color: '#e74c3c', borderColor: 'rgba(231,76,60,0.4)' }}>Revoke</button>;
}

function StatusChip({ status }) {
    const palette = {
        draft: { bg: '#4a4238', fg: '#c8b89a' },
        sent: { bg: '#2e5d7a', fg: '#fff' },
        viewed: { bg: '#2e7d4a', fg: '#fff' },
        revoked: { bg: '#6b1f1f', fg: '#fff' },
        complete: { bg: '#c65a2a', fg: '#fff' },
    };
    const p = palette[status] || palette.draft;
    return <span style={{ display: 'inline-block', padding: '3px 8px', fontSize: 10, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', background: p.bg, color: p.fg, borderRadius: 2 }}>{status}</span>;
}

function Field({ label, children }) {
    return (
        <label style={{ display: 'block', marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
            {children}
        </label>
    );
}

const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const input = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const tableBox = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', color: 'var(--cream)', verticalAlign: 'top' };
const primaryBtn = { padding: '10px 18px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const subtleBtn = { padding: '6px 12px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' };
const panel = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.25rem' };
const panelTitle = { fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 800, margin: '0 0 12px' };
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal = { background: 'var(--mid)', border: '1px solid var(--color-border-strong)', padding: '1.5rem', width: '100%', maxWidth: 560, borderRadius: 4, maxHeight: '92vh', overflowY: 'auto' };

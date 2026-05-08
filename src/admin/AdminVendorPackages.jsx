import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';
import FilterBar from '../components/admin/FilterBar.jsx';

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
    const [filters, setFilters] = useState({ event_id: '', vendor_id: '' });
    const [loadingList, setLoadingList] = useState(false);
    const [attaching, setAttaching] = useState(false);

    useEffect(() => {
        if (loading) return;
        if (!isAuthenticated) navigate('/admin/login');
    }, [loading, isAuthenticated, navigate]);

    const load = useCallback(async () => {
        setLoadingList(true);
        const params = new URLSearchParams();
        if (filters.event_id) params.set('event_id', filters.event_id);
        if (filters.vendor_id) params.set('vendor_id', filters.vendor_id);
        const res = await fetch(`/api/admin/event-vendors?${params}`, { credentials: 'include', cache: 'no-store' });
        if (res.ok) setRows((await res.json()).eventVendors || []);
        setLoadingList(false);
    }, [filters.event_id, filters.vendor_id]);

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

    const filterSchema = useMemo(() => [
        {
            key: 'event_id',
            label: 'Event',
            type: 'enum',
            options: events.map((e) => ({ value: e.id, label: e.title })),
        },
        {
            key: 'vendor_id',
            label: 'Vendor',
            type: 'enum',
            options: vendors.map((v) => ({ value: v.id, label: v.companyName })),
        },
    ], [events, vendors]);

    if (loading || !isAuthenticated) return null;

    const isFiltered = Boolean(filters.event_id || filters.vendor_id);

    return (
        <div style={pageWrap}>
            <AdminPageHeader
                title="Vendor Packages"
                description="Per-event vendor briefing packages. Compose with sections + documents, send via magic link, track views."
                breadcrumb={[{ label: 'Vendors', to: '/admin/vendors' }, { label: 'Packages' }]}
                secondaryActions={<Link to="/admin/vendors" style={subtleBtn}>← Vendors</Link>}
                primaryAction={hasRole('manager') && (
                    <button onClick={() => setAttaching(true)} style={primaryBtn}>+ Attach Vendor</button>
                )}
            />

            <FilterBar
                schema={filterSchema}
                value={filters}
                onChange={setFilters}
                resultCount={rows.length}
                savedViewsKey="adminVendorPackages"
            />

            <div style={tableBox}>
                {loadingList && <EmptyState variant="loading" title="Loading packages…" compact />}
                {!loadingList && rows.length === 0 && (
                    <EmptyState
                        isFiltered={isFiltered}
                        title={isFiltered ? 'No packages match these filters' : 'No packages yet'}
                        description={isFiltered
                            ? 'Try clearing a filter.'
                            : "Click 'Attach Vendor' to link a vendor to an event."}
                        action={hasRole('manager') && !isFiltered && (
                            <button onClick={() => setAttaching(true)} style={primaryBtn}>+ Attach Vendor</button>
                        )}
                    />
                )}
                {!loadingList && rows.length > 0 && (
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
                                    <td style={td}>
                                        <strong>{r.event.title}</strong>
                                        <div style={subRow}>{r.event.displayDate}</div>
                                    </td>
                                    <td style={td}>{r.vendor.companyName}</td>
                                    <td style={td}>
                                        {r.primaryContact
                                            ? `${r.primaryContact.name} <${r.primaryContact.email}>`
                                            : <span style={dangerInline}>none — assign before send</span>}
                                    </td>
                                    <td style={td}><StatusChip status={r.status} /></td>
                                    <td style={td}>
                                        {r.lastViewedAt
                                            ? new Date(r.lastViewedAt).toLocaleString()
                                            : <span style={mutedInline}>—</span>}
                                    </td>
                                    <td style={tdActions}>
                                        <Link to={`/admin/vendor-packages/${r.id}`} style={subtleBtn}>Open →</Link>
                                    </td>
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
                <h2 style={modalTitle}>Attach Vendor to Event</h2>
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
                {err && <div style={errorText}>{err}</div>}
                <div style={modalActions}>
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
    if (err) return <div style={composerError}>{err} — <Link to="/admin/vendor-packages" style={{ color: 'var(--color-accent)' }}>Back</Link></div>;
    if (!data) {
        return (
            <div style={pageWrap}>
                <EmptyState variant="loading" title="Loading package…" />
            </div>
        );
    }

    const { eventVendor: ev, sections, documents, accessLog } = data;

    return (
        <div style={pageWrap}>
            <AdminPageHeader
                title={ev.vendor.companyName}
                description={`${ev.event.title} — ${ev.event.displayDate}`}
                breadcrumb={[
                    { label: 'Vendors', to: '/admin/vendors' },
                    { label: 'Packages', to: '/admin/vendor-packages' },
                    { label: ev.vendor.companyName },
                ]}
                primaryAction={hasRole('manager') && ev.status !== 'revoked' && (
                    <SendButton eventVendorId={ev.id} hasPrimary={!!ev.primaryContact} onSent={reload} />
                )}
                secondaryActions={hasRole('manager') && ev.status !== 'revoked' && (
                    <RevokeButton eventVendorId={ev.id} onRevoked={reload} />
                )}
            />

            <div style={statusRow}>
                <StatusChip status={ev.status} />
                {ev.sentAt && <span style={mutedInline}>Sent {new Date(ev.sentAt).toLocaleString()}</span>}
                {ev.lastViewedAt && <span style={mutedInline}>· Last viewed {new Date(ev.lastViewedAt).toLocaleString()}</span>}
                {ev.tokenExpiresAt && <span style={mutedInline}>· Token expires {new Date(ev.tokenExpiresAt).toLocaleDateString()}</span>}
            </div>

            <div style={composerGrid}>
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
        <div style={{ ...panel, marginBottom: 'var(--space-16)' }}>
            <div style={panelHeader}>
                <h3 style={panelTitle}>Contract</h3>
                {hasRole('manager') && (
                    <label style={inlineCheckLabel}>
                        <input type="checkbox" checked={req} disabled={saving} onChange={(e) => toggle(e.target.checked)} />
                        Require signature
                    </label>
                )}
            </div>
            {!req && <p style={mutedText}>No contract required for this package.</p>}
            {req && loadingSig && <p style={mutedText}>Loading signature status…</p>}
            {req && !loadingSig && !sig && (
                <p style={warnText}>
                    ⚠ Awaiting vendor signature. They'll see the live contract document on their package page.
                </p>
            )}
            {req && sig && (
                <div>
                    <p style={successText}>
                        ✓ Signed by <strong>{sig.typedName}</strong> ({sig.contactEmail}) on{' '}
                        {new Date(sig.signedAt).toLocaleString()}. v{sig.contractDocumentVersion}.
                    </p>
                    <p style={shaText}>
                        SHA-256: {sig.bodySha256.slice(0, 16)}…
                    </p>
                    {sig.countersignedAt ? (
                        <p style={successText}>
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
        <div style={{ ...panel, marginBottom: 'var(--space-16)' }}>
            <h3 style={panelTitle}>Primary contact</h3>
            <select value={selected} onChange={(e) => save(e.target.value)} disabled={!hasRole('manager') || saving} style={input}>
                <option value="">— none —</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} &lt;{c.email}&gt;</option>)}
            </select>
            {contacts.length === 0 && <p style={dangerText}>No contacts on this vendor. Add one from the Vendors page first.</p>}
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
            <div style={panelHeader}>
                <h3 style={panelTitle}>Package sections</h3>
                {hasRole('manager') && <button onClick={() => setCreating(true)} style={subtleBtn}>+ Section</button>}
            </div>
            {sections.length === 0 && <p style={mutedText}>No sections yet. Add overview, schedule, site map, etc.</p>}
            {sections.map((s) => (
                <div key={s.id} style={sectionRow}>
                    <div style={panelRowSplit}>
                        <div>
                            <span style={sectionMeta}>{s.kind} · #{s.sortOrder}</span>
                            <div style={sectionTitle}>{s.title}</div>
                        </div>
                        {hasRole('manager') && (
                            <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
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
                <h2 style={modalTitle}>{isNew ? 'New Section' : 'Edit Section'}</h2>
                <div style={threeCol}>
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
                {err && <div style={errorText}>{err}</div>}
                <div style={modalActions}>
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
        <div style={{ ...panel, marginBottom: 'var(--space-16)' }}>
            <h3 style={panelTitle}>Documents</h3>
            {documents.length === 0 && <p style={mutedText}>No documents attached.</p>}
            {documents.map((d) => (
                <div key={d.id} style={docRow}>
                    <div>
                        <span style={sectionMeta}>{d.kind}</span>
                        <div style={{ color: 'var(--color-text)', fontSize: 'var(--font-size-base)' }}>{d.filename}</div>
                        <div style={mutedSmall}>{Math.round(d.byteSize / 1024)} KB · {d.contentType}</div>
                    </div>
                    {hasRole('manager') && <button onClick={() => del(d)} style={subtleBtn}>Delete</button>}
                </div>
            ))}
            {hasRole('manager') && (
                <div style={uploadRow}>
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
            {log.length === 0 && <p style={mutedText}>No access yet.</p>}
            {log.map((l) => (
                <div key={l.id} style={accessLogRow}>
                    <span style={accessLogAction}>{l.action}</span>
                    {l.target && <span> · {l.target}</span>}
                    <div style={mutedSmaller}>
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
    return <button onClick={revoke} style={{ ...subtleBtn, color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>Revoke</button>;
}

// Domain-specific status chip colors stay raw — the per-status color
// (draft/sent/viewed/revoked/complete) is intentional info density.
function StatusChip({ status }) {
    const palette = {
        draft: { bg: 'var(--color-bg-sunken)', fg: 'var(--color-text-muted)' },
        sent: { bg: 'rgba(74,144,194,0.2)', fg: 'var(--color-info)' },
        viewed: { bg: 'rgba(45,165,90,0.2)', fg: 'var(--color-success)' },
        revoked: { bg: 'rgba(231,76,60,0.2)', fg: 'var(--color-danger)' },
        complete: { bg: 'rgba(215,108,33,0.2)', fg: 'var(--color-accent)' },
    };
    const p = palette[status] || palette.draft;
    return (
        <span style={{
            display: 'inline-block',
            padding: 'var(--space-4) var(--space-8)',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 'var(--font-weight-extrabold)',
            letterSpacing: 'var(--letter-spacing-wide)',
            textTransform: 'uppercase',
            background: p.bg,
            color: p.fg,
            borderRadius: 'var(--radius-sm)',
        }}>{status}</span>
    );
}

function Field({ label, children }) {
    return (
        <label style={fieldLabel}>
            <div style={fieldLabelText}>{label}</div>
            {children}
        </label>
    );
}

const pageWrap = { maxWidth: 1200, margin: '0 auto', padding: 'var(--space-32)' };
const composerError = {
    padding: 'var(--space-32)',
    color: 'var(--color-danger)',
};
const statusRow = {
    marginTop: 'var(--space-8)',
    marginBottom: 'var(--space-16)',
    display: 'flex',
    gap: 'var(--space-12)',
    alignItems: 'center',
    flexWrap: 'wrap',
};
const composerGrid = {
    marginTop: 'var(--space-24)',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
    gap: 'var(--space-24)',
};
const input = {
    padding: 'var(--space-8) var(--space-12)',
    background: 'var(--color-bg-page)',
    border: '1px solid var(--color-border-strong)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-base)',
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
};
const tableBox = {
    background: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-border)',
    padding: 'var(--space-24)',
    marginTop: 'var(--space-16)',
};
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-base)' };
const th = {
    textAlign: 'left',
    padding: 'var(--space-8) var(--space-12)',
    borderBottom: '1px solid var(--color-border-strong)',
    color: 'var(--color-accent)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-extrabold)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
};
const tr = { borderBottom: '1px solid var(--color-border-subtle)' };
const td = { padding: 'var(--space-8) var(--space-12)', color: 'var(--color-text)', verticalAlign: 'top' };
const tdActions = { ...td, textAlign: 'right' };
const subRow = { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' };
const dangerInline = { color: 'var(--color-danger)', fontSize: 'var(--font-size-xs)' };
const mutedInline = { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' };
const primaryBtn = {
    padding: 'var(--space-8) var(--space-16)',
    background: 'var(--color-accent)',
    color: 'var(--color-accent-on-accent)',
    border: 'none',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-extrabold)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
    cursor: 'pointer',
};
const subtleBtn = {
    padding: 'var(--space-4) var(--space-12)',
    background: 'transparent',
    border: '1px solid var(--color-border-strong)',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--font-size-sm)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-block',
};
const panel = {
    background: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-border)',
    padding: 'var(--space-16)',
};
const panelTitle = {
    fontSize: 'var(--font-size-sm)',
    letterSpacing: 'var(--letter-spacing-wider)',
    textTransform: 'uppercase',
    color: 'var(--color-accent)',
    fontWeight: 'var(--font-weight-extrabold)',
    margin: '0 0 var(--space-12)',
};
const panelHeader = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--space-8)',
};
const panelRowSplit = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--space-8)',
};
const sectionRow = {
    padding: 'var(--space-8) 0',
    borderBottom: '1px solid var(--color-border)',
};
const sectionMeta = {
    color: 'var(--color-accent)',
    fontSize: 'var(--font-size-xs)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
};
const sectionTitle = {
    color: 'var(--color-text)',
    fontWeight: 'var(--font-weight-bold)',
    fontSize: 'var(--font-size-md)',
};
const docRow = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 'var(--space-4) 0',
    borderBottom: '1px solid var(--color-border-subtle)',
};
const uploadRow = {
    marginTop: 'var(--space-8)',
    display: 'flex',
    gap: 'var(--space-8)',
    alignItems: 'center',
    flexWrap: 'wrap',
};
const accessLogRow = {
    padding: 'var(--space-4) 0',
    borderBottom: '1px solid var(--color-border-subtle)',
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-muted)',
};
const accessLogAction = {
    color: 'var(--color-accent)',
    fontWeight: 'var(--font-weight-bold)',
};
const mutedText = { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' };
const mutedSmall = { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' };
const mutedSmaller = { color: 'var(--color-text-subtle)', fontSize: 'var(--font-size-xs)' };
const dangerText = { color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)', margin: 'var(--space-8) 0 0' };
const warnText = { color: 'var(--color-warning)', fontSize: 'var(--font-size-base)' };
const successText = { color: 'var(--color-success)', fontSize: 'var(--font-size-base)', margin: '0 0 var(--space-8)' };
const shaText = { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', fontFamily: 'monospace', margin: '0 0 var(--space-8)' };
const inlineCheckLabel = {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--font-size-sm)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-4)',
};
const modalBg = {
    position: 'fixed',
    inset: 0,
    background: 'var(--color-overlay-strong)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 'var(--space-16)',
};
const modal = {
    background: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-border-strong)',
    padding: 'var(--space-24)',
    width: '100%',
    maxWidth: 560,
    borderRadius: 'var(--radius-md)',
    maxHeight: '92vh',
    overflowY: 'auto',
};
const modalTitle = {
    fontSize: 'var(--font-size-xl)',
    fontWeight: 'var(--font-weight-extrabold)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
    color: 'var(--color-text)',
    margin: '0 0 var(--space-12)',
};
const modalActions = { display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-16)' };
const fieldLabel = { display: 'block', marginBottom: 'var(--space-8)' };
const fieldLabelText = {
    fontSize: 'var(--font-size-sm)',
    letterSpacing: 'var(--letter-spacing-wide)',
    textTransform: 'uppercase',
    color: 'var(--color-accent)',
    fontWeight: 'var(--font-weight-bold)',
    marginBottom: 'var(--space-4)',
};
const errorText = {
    color: 'var(--color-danger)',
    fontSize: 'var(--font-size-sm)',
    margin: 'var(--space-8) 0',
};
const threeCol = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 120px',
    gap: 'var(--space-8)',
};

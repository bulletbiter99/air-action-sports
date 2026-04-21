import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';

export default function AdminEvents() {
  const { isAuthenticated, loading, hasRole } = useAdmin();
  const navigate = useNavigate();

  const [events, setEvents] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [editingId, setEditingId] = useState(null); // null | 'new' | eventId
  const [duplicating, setDuplicating] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const load = useCallback(async () => {
    setLoadingList(true);
    const res = await fetch('/api/admin/events', { credentials: 'include', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setEvents(data.events || []);
    }
    setLoadingList(false);
  }, []);

  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  const duplicate = async (srcId) => {
    const title = window.prompt('Title for duplicated event?', '(copy)');
    if (title === null) return;
    setDuplicating(srcId);
    const res = await fetch(`/api/admin/events/${srcId}/duplicate`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    setDuplicating(null);
    if (res.ok) {
      const { event } = await res.json();
      load();
      setEditingId(event.id);
    } else alert('Duplicate failed');
  };

  const del = async (id) => {
    if (!window.confirm('Delete this event? If it has bookings, it will be archived instead.')) return;
    const res = await fetch(`/api/admin/events/${id}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (res.ok) {
      const data = await res.json();
      if (data.archived) alert('Event has bookings — archived instead of deleted.');
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Delete failed');
    }
  };

  if (loading || !isAuthenticated) return null;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={h1}>Events</h1>
        {hasRole('manager') && (
          <button onClick={() => setEditingId('new')} style={primaryBtn}>+ New Event</button>
        )}
      </div>

      <section style={tableBox}>
        {loadingList && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}
        {!loadingList && events.length === 0 && (
          <p style={{ color: 'var(--olive-light)' }}>No events yet. Create one to get started.</p>
        )}
        {events.length > 0 && (
          <div className="admin-table-wrap"><table style={table}>
            <thead>
              <tr>
                <th style={th}>Title</th>
                <th style={th}>Date</th>
                <th style={th}>Location</th>
                <th style={th}>Tickets</th>
                <th style={th}>Sold</th>
                <th style={th}>Gross</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} style={tr}>
                  <td style={td}>
                    <strong>{e.title}</strong>
                    <div style={{ fontSize: 10, color: 'var(--olive-light)', fontFamily: 'monospace' }}>{e.id}</div>
                  </td>
                  <td style={td}>{e.displayDate || e.dateIso?.slice(0, 10)}</td>
                  <td style={{ ...td, fontSize: 12 }}>{e.location || '—'}</td>
                  <td style={td}>{(e.ticketTypes || []).length}</td>
                  <td style={td}>{e.attendeesCount || 0}</td>
                  <td style={td}>${((e.grossCents || 0) / 100).toFixed(2)}</td>
                  <td style={td}>
                    {e.past ? <span style={{ color: 'var(--olive-light)', fontSize: 12 }}>Past</span>
                      : e.published ? <span style={{ color: '#2ecc71', fontSize: 12 }}>Published</span>
                      : <span style={{ color: '#f39c12', fontSize: 12 }}>Draft</span>}
                  </td>
                  <td style={td}>
                    <button onClick={() => setEditingId(e.id)} style={subtleBtn}>Edit</button>
                    {hasRole('manager') && (
                      <button onClick={() => duplicate(e.id)} disabled={duplicating === e.id} style={{ ...subtleBtn, marginLeft: 6 }}>
                        {duplicating === e.id ? '…' : 'Duplicate'}
                      </button>
                    )}
                    {hasRole('owner') && (
                      <button onClick={() => del(e.id)} style={{ ...subtleBtn, marginLeft: 6 }}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      {editingId && (
        <EventEditor
          eventId={editingId === 'new' ? null : editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}

function EventEditor({ eventId, onClose, onSaved }) {
  const isNew = !eventId;
  const { hasRole } = useAdmin();
  const [loading, setLoading] = useState(!isNew);
  const [form, setForm] = useState({
    title: '', slug: '', dateIso: '',
    displayDate: '', displayDay: '', displayMonth: '',
    location: '', site: '', type: 'airsoft',
    timeRange: '', checkIn: '', firstGame: '', endTime: '',
    basePriceCents: 8000, totalSlots: 100,
    taxRateBps: 0, passFeesToCustomer: false,
    coverImageUrl: '', shortDescription: '',
    published: false, past: false,
    addons: [], gameModes: [], customQuestions: [],
  });
  const [ticketTypes, setTicketTypes] = useState([]);
  const [savingEvent, setSavingEvent] = useState(false);
  const [err, setErr] = useState('');
  const [currentEventId, setCurrentEventId] = useState(eventId);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const res = await fetch(`/api/admin/events/${eventId}/detail`, { credentials: 'include', cache: 'no-store' });
      if (res.ok) {
        const { event, ticketTypes } = await res.json();
        setForm({
          title: event.title || '', slug: event.slug || '',
          dateIso: event.dateIso || '',
          displayDate: event.displayDate || '', displayDay: event.displayDay || '', displayMonth: event.displayMonth || '',
          location: event.location || '', site: event.site || '', type: event.type || 'airsoft',
          timeRange: event.timeRange || '', checkIn: event.checkIn || '', firstGame: event.firstGame || '', endTime: event.endTime || '',
          basePriceCents: event.basePriceCents || 0, totalSlots: event.totalSlots || 0,
          taxRateBps: event.taxRateBps || 0, passFeesToCustomer: !!event.passFeesToCustomer,
          coverImageUrl: event.coverImageUrl || '', shortDescription: event.shortDescription || '',
          published: !!event.published, past: !!event.past,
          addons: event.addons || [], gameModes: event.gameModes || [],
          customQuestions: event.customQuestions || [],
        });
        setTicketTypes(ticketTypes || []);
      }
      setLoading(false);
    })();
  }, [eventId, isNew]);

  const updateField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const saveEvent = async (e) => {
    e?.preventDefault();
    setSavingEvent(true); setErr('');
    const url = isNew ? '/api/admin/events' : `/api/admin/events/${currentEventId}`;
    const method = isNew ? 'POST' : 'PUT';
    const res = await fetch(url, {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSavingEvent(false);
    if (res.ok) {
      const data = await res.json();
      if (isNew) setCurrentEventId(data.event.id); // allow adding ticket types afterward
      onSaved();
      if (isNew) { /* stay in editor so they can add ticket types */ }
    } else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || 'Save failed');
    }
  };

  if (loading) {
    return (
      <div style={modalBg} onClick={onClose}>
        <div style={modal} onClick={(e) => e.stopPropagation()}>
          <p style={{ color: 'var(--olive-light)' }}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: 'var(--cream)', fontSize: 14, letterSpacing: 1.5, textTransform: 'uppercase' }}>
            {isNew ? 'New event' : `Edit: ${form.title}`}
          </h3>
          <button type="button" onClick={onClose} style={subtleBtn}>Close</button>
        </div>

        <form onSubmit={saveEvent}>
          <div style={sectionLabel}>Basics</div>
          <Field label="Title *">
            <input required value={form.title} onChange={(e) => updateField('title', e.target.value)} style={input} />
          </Field>
          <Field label={isNew ? 'Slug (leave blank to auto-generate)' : 'Slug'}>
            <input value={form.slug} onChange={(e) => updateField('slug', e.target.value)} style={input} placeholder="operation-nightfall" />
          </Field>
          <Field label="Short description">
            <textarea rows={2} value={form.shortDescription} onChange={(e) => updateField('shortDescription', e.target.value)} style={{ ...input, resize: 'vertical' }} />
          </Field>
          <Field label="Cover image">
            <CoverImagePicker
              value={form.coverImageUrl}
              onChange={(v) => updateField('coverImageUrl', v)}
            />
          </Field>

          <div style={sectionLabel}>Date & time</div>
          <div style={twoCol}>
            <Field label="Date/time ISO *">
              <input required value={form.dateIso} onChange={(e) => updateField('dateIso', e.target.value)} style={input} placeholder="2026-05-09T08:30:00" />
            </Field>
            <Field label="Display date (e.g. '9 May 2026')">
              <input value={form.displayDate} onChange={(e) => updateField('displayDate', e.target.value)} style={input} />
            </Field>
          </div>
          <div style={twoCol}>
            <Field label="Display day"><input value={form.displayDay} onChange={(e) => updateField('displayDay', e.target.value)} style={input} /></Field>
            <Field label="Display month"><input value={form.displayMonth} onChange={(e) => updateField('displayMonth', e.target.value)} style={input} /></Field>
          </div>
          <div style={twoCol}>
            <Field label="Time range"><input value={form.timeRange} onChange={(e) => updateField('timeRange', e.target.value)} style={input} placeholder="6:30 AM – 8:00 PM" /></Field>
            <Field label="Check-in"><input value={form.checkIn} onChange={(e) => updateField('checkIn', e.target.value)} style={input} /></Field>
          </div>
          <div style={twoCol}>
            <Field label="First game"><input value={form.firstGame} onChange={(e) => updateField('firstGame', e.target.value)} style={input} /></Field>
            <Field label="End time"><input value={form.endTime} onChange={(e) => updateField('endTime', e.target.value)} style={input} /></Field>
          </div>

          <div style={sectionLabel}>Location & type</div>
          <div style={twoCol}>
            <Field label="Location"><input value={form.location} onChange={(e) => updateField('location', e.target.value)} style={input} /></Field>
            <Field label="Site"><input value={form.site} onChange={(e) => updateField('site', e.target.value)} style={input} placeholder="delta / alpha / …" /></Field>
          </div>
          <Field label="Type">
            <input value={form.type} onChange={(e) => updateField('type', e.target.value)} style={input} placeholder="airsoft" />
          </Field>

          <div style={sectionLabel}>Pricing & capacity</div>
          <div style={twoCol}>
            <Field label="Base price (cents) *">
              <input required type="number" value={form.basePriceCents} onChange={(e) => updateField('basePriceCents', Number(e.target.value))} style={input} />
            </Field>
            <Field label="Total slots *">
              <input required type="number" value={form.totalSlots} onChange={(e) => updateField('totalSlots', Number(e.target.value))} style={input} />
            </Field>
          </div>
          <div style={twoCol}>
            <Field label="Tax rate (bps, e.g. 825 = 8.25%)">
              <input type="number" value={form.taxRateBps} onChange={(e) => updateField('taxRateBps', Number(e.target.value))} style={input} />
            </Field>
            <Field label="">
              <label style={{ color: 'var(--tan-light)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, paddingTop: 22 }}>
                <input type="checkbox" checked={form.passFeesToCustomer} onChange={(e) => updateField('passFeesToCustomer', e.target.checked)} />
                Pass fees to customer
              </label>
            </Field>
          </div>

          <div style={sectionLabel}>Game modes (one per line)</div>
          <textarea
            rows={3}
            value={(form.gameModes || []).join('\n')}
            onChange={(e) => updateField('gameModes', e.target.value.split('\n').map((l) => l.trim()).filter(Boolean))}
            style={{ ...input, resize: 'vertical' }}
            placeholder="Team Deathmatch&#10;Capture the Flag"
          />

          <div style={sectionLabel}>Add-ons</div>
          <AddonEditor addons={form.addons} onChange={(v) => updateField('addons', v)} />

          <div style={sectionLabel}>Custom questions (asked per attendee at booking)</div>
          <CustomQuestionsEditor
            questions={form.customQuestions}
            onChange={(v) => updateField('customQuestions', v)}
          />

          <div style={sectionLabel}>Publishing</div>
          <div style={{ display: 'flex', gap: 16, color: 'var(--tan-light)', fontSize: 13 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={form.published} onChange={(e) => updateField('published', e.target.checked)} />
              Published (visible to customers)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={form.past} onChange={(e) => updateField('past', e.target.checked)} />
              Past
            </label>
          </div>

          {err && <div style={{ color: '#e74c3c', fontSize: 12, margin: '12px 0' }}>{err}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 20, position: 'sticky', bottom: 0, padding: '12px 0', background: 'var(--mid)' }}>
            <button type="submit" disabled={savingEvent} style={primaryBtn}>
              {savingEvent ? 'Saving…' : (isNew ? 'Create event' : 'Save changes')}
            </button>
            <button type="button" onClick={onClose} style={subtleBtn}>Close</button>
          </div>
        </form>

        {currentEventId && (
          <>
            <div style={{ ...sectionLabel, marginTop: 32 }}>Ticket types</div>
            <TicketTypesEditor eventId={currentEventId} ticketTypes={ticketTypes} onReload={async () => {
              const r = await fetch(`/api/admin/events/${currentEventId}/detail`, { credentials: 'include', cache: 'no-store' });
              if (r.ok) { const d = await r.json(); setTicketTypes(d.ticketTypes || []); onSaved(); }
            }} canEdit={hasRole('manager')} />
          </>
        )}
      </div>
    </div>
  );
}

function AddonEditor({ addons, onChange }) {
  const update = (i, k, v) => {
    const n = [...addons]; n[i] = { ...n[i], [k]: v }; onChange(n);
  };
  const add = () => onChange([...addons, { sku: '', name: '', price_cents: 0, type: 'rental', description: '' }]);
  const remove = (i) => onChange(addons.filter((_, idx) => idx !== i));
  return (
    <div>
      {addons.length === 0 && <p style={{ color: 'var(--olive-light)', fontSize: 12, margin: '6px 0' }}>No add-ons.</p>}
      {addons.map((a, i) => (
        <div key={i} className="admin-row-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
          <input placeholder="sku" value={a.sku || ''} onChange={(e) => update(i, 'sku', e.target.value)} style={input} />
          <input placeholder="name" value={a.name || ''} onChange={(e) => update(i, 'name', e.target.value)} style={input} />
          <input type="number" placeholder="cents" value={a.price_cents ?? 0} onChange={(e) => update(i, 'price_cents', Number(e.target.value))} style={input} />
          <select value={a.type || 'rental'} onChange={(e) => update(i, 'type', e.target.value)} style={input}>
            <option value="rental">rental</option>
            <option value="consumable">consumable</option>
          </select>
          <button type="button" onClick={() => remove(i)} style={subtleBtn}>×</button>
        </div>
      ))}
      <button type="button" onClick={add} style={subtleBtn}>+ Add row</button>
    </div>
  );
}

function CoverImagePicker({ value, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState(null);

  const upload = async (file) => {
    if (!file) return;
    setUploading(true); setErr(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/admin/uploads/image', {
      method: 'POST', credentials: 'include', body: fd,
    });
    setUploading(false);
    if (res.ok) {
      const d = await res.json();
      onChange(d.url);
    } else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || 'Upload failed');
    }
  };

  return (
    <div>
      <input
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste a URL or upload an image →"
        style={{ ...input, marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ ...qSubtle, display: 'inline-block', cursor: uploading ? 'wait' : 'pointer' }}>
          {uploading ? 'Uploading…' : '↑ Upload image'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={uploading}
            onChange={(e) => upload(e.target.files?.[0])}
            style={{ display: 'none' }}
          />
        </label>
        {value && (
          <button type="button" onClick={() => onChange('')} style={qSubtle}>Clear</button>
        )}
        <span style={{ fontSize: 11, color: 'var(--olive-light)' }}>Max 5 MB · JPEG / PNG / WebP / GIF</span>
      </div>
      {err && <div style={{ color: '#e74c3c', fontSize: 12, marginTop: 6 }}>{err}</div>}
      {value && (
        <div style={{ marginTop: 10 }}>
          <img src={value} alt="" style={{ maxWidth: 300, maxHeight: 180, border: '1px solid rgba(200,184,154,0.2)' }} />
        </div>
      )}
    </div>
  );
}

function CustomQuestionsEditor({ questions, onChange }) {
  const update = (i, patch) => {
    onChange(questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  };
  const add = () => {
    const n = questions.length + 1;
    onChange([...questions, { key: `question_${n}`, label: '', type: 'text', required: false, options: [], sortOrder: n }]);
  };
  const remove = (i) => onChange(questions.filter((_, idx) => idx !== i));

  return (
    <div>
      {questions.length === 0 && (
        <p style={{ color: 'var(--olive-light)', fontSize: 12, margin: '6px 0' }}>
          No custom questions. Add one below to collect per-attendee info (team name, shirt size, dietary notes, etc.).
        </p>
      )}
      {questions.map((q, i) => (
        <div key={i} style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(200,184,154,0.08)', padding: '10px 12px', marginBottom: 8 }}>
          <div className="admin-row-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr auto auto', gap: 6, alignItems: 'center' }}>
            <input
              placeholder="key (snake_case)"
              value={q.key || ''}
              onChange={(e) => update(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_') })}
              style={{ ...qInput, fontFamily: 'monospace', fontSize: 11 }}
            />
            <input
              placeholder="Label shown to player"
              value={q.label || ''}
              onChange={(e) => update(i, { label: e.target.value })}
              style={qInput}
            />
            <select
              value={q.type || 'text'}
              onChange={(e) => update(i, { type: e.target.value })}
              style={qInput}
            >
              <option value="text">Text</option>
              <option value="textarea">Textarea</option>
              <option value="select">Select</option>
              <option value="checkbox">Checkbox</option>
            </select>
            <label style={{ color: 'var(--tan-light)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={!!q.required} onChange={(e) => update(i, { required: e.target.checked })} />
              req
            </label>
            <button type="button" onClick={() => remove(i)} style={qSubtle}>×</button>
          </div>
          {q.type === 'select' && (
            <div style={{ marginTop: 6 }}>
              <input
                placeholder="Options, comma-separated (e.g. Small, Medium, Large)"
                value={(q.options || []).join(', ')}
                onChange={(e) => update(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                style={{ ...qInput, width: '100%', fontSize: 12 }}
              />
            </div>
          )}
        </div>
      ))}
      <button type="button" onClick={add} style={qSubtle}>+ Add question</button>
    </div>
  );
}

const qInput = { padding: '8px 10px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 12, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const qSubtle = { padding: '6px 12px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };

function TicketTypesEditor({ eventId, ticketTypes, onReload, canEdit }) {
  const [editingTt, setEditingTt] = useState(null); // null | 'new' | ticketType

  const del = async (id) => {
    if (!window.confirm('Delete this ticket type? If it has sales, it will be deactivated instead.')) return;
    const res = await fetch(`/api/admin/ticket-types/${id}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (res.ok) {
      const d = await res.json();
      if (d.deactivated) alert('Has sales — deactivated instead of deleted.');
      onReload();
    }
  };

  return (
    <div>
      {ticketTypes.length === 0 && <p style={{ color: 'var(--olive-light)', fontSize: 13 }}>No ticket types yet. Add one below.</p>}
      {ticketTypes.map((t) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(200,184,154,0.08)' }}>
          <div>
            <div style={{ color: 'var(--cream)' }}>
              <strong>{t.name}</strong>
              {!t.active && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--olive-light)' }}>(inactive)</span>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--olive-light)' }}>
              ${(t.priceCents / 100).toFixed(2)} · {t.sold || 0}/{t.capacity ?? '∞'} sold
              {t.maxPerOrder ? ` · max ${t.maxPerOrder}/order` : ''}
            </div>
          </div>
          {canEdit && (
            <div>
              <button type="button" onClick={() => setEditingTt(t)} style={subtleBtn}>Edit</button>
              <button type="button" onClick={() => del(t.id)} style={{ ...subtleBtn, marginLeft: 6 }}>Delete</button>
            </div>
          )}
        </div>
      ))}
      {canEdit && (
        <button type="button" onClick={() => setEditingTt('new')} style={{ ...subtleBtn, marginTop: 10 }}>+ Add ticket type</button>
      )}
      {editingTt && (
        <TicketTypeForm
          eventId={eventId}
          ticketType={editingTt === 'new' ? null : editingTt}
          onClose={() => setEditingTt(null)}
          onSaved={() => { setEditingTt(null); onReload(); }}
        />
      )}
    </div>
  );
}

function TicketTypeForm({ eventId, ticketType, onClose, onSaved }) {
  const isNew = !ticketType;
  const [form, setForm] = useState({
    name: ticketType?.name || '',
    description: ticketType?.description || '',
    priceCents: ticketType?.priceCents ?? 8000,
    capacity: ticketType?.capacity ?? '',
    minPerOrder: ticketType?.minPerOrder ?? 1,
    maxPerOrder: ticketType?.maxPerOrder ?? '',
    sortOrder: ticketType?.sortOrder ?? 0,
    active: ticketType ? !!ticketType.active : true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setErr('');
    const url = isNew ? `/api/admin/events/${eventId}/ticket-types` : `/api/admin/ticket-types/${ticketType.id}`;
    const method = isNew ? 'POST' : 'PUT';
    const res = await fetch(url, {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || 'Save failed');
    }
  };

  return (
    <div style={modalBg} onClick={onClose}>
      <form style={nestedModal} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h4 style={{ margin: 0, color: 'var(--cream)', fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase' }}>
            {isNew ? 'New ticket type' : 'Edit ticket type'}
          </h4>
          <button type="button" onClick={onClose} style={subtleBtn}>Close</button>
        </div>
        <Field label="Name *"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} /></Field>
        <Field label="Description"><textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ ...input, resize: 'vertical' }} /></Field>
        <div style={twoCol}>
          <Field label="Price (cents) *">
            <input required type="number" value={form.priceCents} onChange={(e) => setForm({ ...form, priceCents: Number(e.target.value) })} style={input} />
          </Field>
          <Field label="Capacity (blank = ∞)">
            <input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} style={input} />
          </Field>
        </div>
        <div style={twoCol}>
          <Field label="Min per order"><input type="number" value={form.minPerOrder} onChange={(e) => setForm({ ...form, minPerOrder: Number(e.target.value) })} style={input} /></Field>
          <Field label="Max per order"><input type="number" value={form.maxPerOrder} onChange={(e) => setForm({ ...form, maxPerOrder: e.target.value })} style={input} /></Field>
        </div>
        <div style={twoCol}>
          <Field label="Sort order"><input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} style={input} /></Field>
          <Field label="">
            <label style={{ color: 'var(--tan-light)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, paddingTop: 22 }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>
          </Field>
        </div>
        {err && <div style={{ color: '#e74c3c', fontSize: 12, margin: '8px 0' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="submit" disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : (isNew ? 'Create' : 'Save')}</button>
          <button type="button" onClick={onClose} style={subtleBtn}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 700, marginBottom: 4 }}>{label || '\u00A0'}</div>
      {children}
    </label>
  );
}

const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const input = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const tableBox = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1.5rem' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', color: 'var(--cream)', verticalAlign: 'top' };
const primaryBtn = { padding: '10px 18px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const subtleBtn = { padding: '6px 12px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.2)', padding: '1.5rem', width: '100%', maxWidth: 720, borderRadius: 4, maxHeight: '92vh', overflowY: 'auto' };
const nestedModal = { ...modal, maxWidth: 520 };
const sectionLabel = { fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 800, margin: '20px 0 10px', borderTop: '1px solid rgba(200,184,154,0.12)', paddingTop: 16 };
const twoCol = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };

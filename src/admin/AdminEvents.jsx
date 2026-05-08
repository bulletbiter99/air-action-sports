import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import { formatMoney } from '../utils/money.js';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';
import FilterBar from '../components/admin/FilterBar.jsx';

// "6:30 AM" | "18:30" → "HH:MM" (24h) for <input type="time">. Returns '' if unparseable.
function to24h(s) {
  if (!s) return '';
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return '';
  let h = Number(m[1]);
  const mm = m[2];
  const ap = m[3]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  if (h < 0 || h > 23) return '';
  return `${String(h).padStart(2, '0')}:${mm}`;
}
// "HH:MM" (24h) → "h:mm AM/PM"
function to12h(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  let h = Number(m[1]);
  const mm = m[2];
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${mm} ${ap}`;
}
// Split "6:30 AM – 8:00 PM" (or "-") into [start, end] raw strings.
function splitRange(s) {
  if (!s) return ['', ''];
  const parts = String(s).split(/\s*[–-]\s*/);
  return [parts[0] || '', parts[1] || ''];
}
const centsToDollars = (c) => formatMoney(c, { currency: '', emptyFor: '' });
const dollarsToCents = (s) => {
  if (s === '' || s == null) return 0;
  const n = Number(String(s).replace(/[^0-9.-]/g, ''));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
};

const STATUS_OPTIONS = [
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'past', label: 'Past' },
];

const FILTER_SCHEMA = [
  { key: 'status', label: 'Status', type: 'enum', options: STATUS_OPTIONS },
];

export default function AdminEvents() {
  const { isAuthenticated, loading, hasRole } = useAdmin();
  const navigate = useNavigate();

  const [events, setEvents] = useState([]);
  const [filters, setFilters] = useState({ status: '', q: '' });
  const [loadingList, setLoadingList] = useState(false);
  const [editingId, setEditingId] = useState(null);
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

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return events.filter((e) => {
      if (filters.status === 'published' && !e.published) return false;
      if (filters.status === 'draft' && (e.published || e.past)) return false;
      if (filters.status === 'past' && !e.past) return false;
      if (q) {
        const hay = `${e.title} ${e.location || ''} ${e.slug || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, filters.status, filters.q]);

  if (loading || !isAuthenticated) return null;

  const isFiltered = Boolean(filters.status || filters.q);

  return (
    <div style={pageWrap}>
      <AdminPageHeader
        title="Events"
        description="Public-facing airsoft / paintball events. Edit details, manage ticket types, set images, publish or unpublish."
        breadcrumb={[{ label: 'Events' }]}
        primaryAction={hasRole('manager') && (
          <button onClick={() => setEditingId('new')} style={primaryBtn}>+ New Event</button>
        )}
      />

      <FilterBar
        schema={FILTER_SCHEMA}
        value={filters}
        onChange={setFilters}
        searchValue={filters.q}
        onSearchChange={(q) => setFilters((f) => ({ ...f, q }))}
        searchPlaceholder="Search title, location, slug…"
        resultCount={filtered.length}
        savedViewsKey="adminEvents"
      />

      <section style={tableBox}>
        {loadingList && <EmptyState variant="loading" title="Loading events…" compact />}
        {!loadingList && filtered.length === 0 && (
          <EmptyState
            isFiltered={isFiltered}
            title={isFiltered ? 'No events match these filters' : 'No events yet'}
            description={isFiltered
              ? 'Try clearing a filter or expanding the search.'
              : 'Create your first event to get started.'}
            action={hasRole('manager') && !isFiltered && (
              <button onClick={() => setEditingId('new')} style={primaryBtn}>+ New Event</button>
            )}
          />
        )}
        {!loadingList && filtered.length > 0 && (
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
              {filtered.map((e) => (
                <tr key={e.id} style={tr}>
                  <td style={td}>
                    <strong>{e.title}</strong>
                    <div style={subRowMono}>{e.id}</div>
                  </td>
                  <td style={td}>{e.displayDate || e.dateIso?.slice(0, 10)}</td>
                  <td style={tdSmall}>{e.location || '—'}</td>
                  <td style={td}>{(e.ticketTypes || []).length}</td>
                  <td style={td}>{e.attendeesCount || 0}</td>
                  <td style={td}>{formatMoney(e.grossCents)}</td>
                  <td style={td}>
                    {e.past ? <span style={statusPast}>Past</span>
                      : e.published ? <span style={statusPublished}>Published</span>
                      : <span style={statusDraft}>Draft</span>}
                  </td>
                  <td style={td}>
                    <button onClick={() => setEditingId(e.id)} style={subtleBtn}>Edit</button>
                    {hasRole('manager') && (
                      <button onClick={() => duplicate(e.id)} disabled={duplicating === e.id} style={{ ...subtleBtn, marginLeft: 'var(--space-4)' }}>
                        {duplicating === e.id ? '…' : 'Duplicate'}
                      </button>
                    )}
                    {hasRole('owner') && (
                      <button onClick={() => del(e.id)} style={{ ...subtleBtn, marginLeft: 'var(--space-4)' }}>Delete</button>
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
    coverImageUrl: '', cardImageUrl: '', heroImageUrl: '', bannerImageUrl: '', ogImageUrl: '',
    shortDescription: '',
    published: false, past: false, featured: false,
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
          coverImageUrl: event.coverImageUrl || '',
          cardImageUrl: event.cardImageUrl || '',
          heroImageUrl: event.heroImageUrl || '',
          bannerImageUrl: event.bannerImageUrl || '',
          ogImageUrl: event.ogImageUrl || '',
          shortDescription: event.shortDescription || '',
          published: !!event.published, past: !!event.past, featured: !!event.featured,
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
    if (savingEvent) return;
    setSavingEvent(true); setErr('');
    try {
      const url = isNew ? '/api/admin/events' : `/api/admin/events/${currentEventId}`;
      const method = isNew ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const data = await res.json();
        if (isNew) setCurrentEventId(data.event.id);
        onSaved();
      } else {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || 'Save failed');
      }
    } finally {
      setSavingEvent(false);
    }
  };

  if (loading) {
    return (
      <div style={modalBg} onClick={onClose}>
        <div style={modal} onClick={(e) => e.stopPropagation()}>
          <EmptyState variant="loading" title="Loading event…" compact />
        </div>
      </div>
    );
  }

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>
            {isNew ? 'New event' : `Edit: ${form.title}`}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" style={closeX}>×</button>
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
          <div style={sectionLabel}>Event images</div>
          <p style={imageHint}>
            Each surface uses a different aspect ratio. Upload a ratio-correct image per surface for the best look.
            Anything left blank falls back to <strong>Cover (universal fallback)</strong>, so you can ship with one image and refine later.
          </p>
          <EventImagePicker
            label="Cover (universal fallback)"
            ratioHint="Any ratio · used wherever a specific size isn't set"
            recommended="1200×630 works on every surface"
            ratio={1200 / 630}
            value={form.coverImageUrl}
            onChange={(v) => updateField('coverImageUrl', v)}
          />
          <EventImagePicker
            label="Card hero"
            ratioHint="2:1 · shown on the /events grid card"
            recommended="1200×600"
            ratio={2 / 1}
            value={form.cardImageUrl}
            onChange={(v) => updateField('cardImageUrl', v)}
            fallback={form.coverImageUrl}
          />
          <EventImagePicker
            label="Event hero"
            ratioHint="3.2:1 · shown at the top of the event detail page"
            recommended="1920×600"
            ratio={3.2 / 1}
            value={form.heroImageUrl}
            onChange={(v) => updateField('heroImageUrl', v)}
            fallback={form.coverImageUrl}
          />
          <EventImagePicker
            label="Booking banner"
            ratioHint="4:1 · shown when a customer books this event"
            recommended="1920×500"
            ratio={4 / 1}
            value={form.bannerImageUrl}
            onChange={(v) => updateField('bannerImageUrl', v)}
            fallback={form.coverImageUrl}
          />
          <EventImagePicker
            label="Social / OG"
            ratioHint="1.91:1 · shown when the event URL is shared (FB / iMessage / Slack)"
            recommended="1200×630"
            ratio={1200 / 630}
            value={form.ogImageUrl}
            onChange={(v) => updateField('ogImageUrl', v)}
            fallback={form.coverImageUrl}
          />

          <div style={sectionLabel}>Date & time</div>
          <div style={twoCol}>
            <Field label="Date & time *">
              <input
                required
                type="datetime-local"
                value={(form.dateIso || '').slice(0, 16)}
                onChange={(e) => updateField('dateIso', e.target.value ? `${e.target.value}:00` : '')}
                style={input}
              />
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
            <Field label="Time range (start — end)">
              <TimeRangeInput value={form.timeRange} onChange={(v) => updateField('timeRange', v)} />
            </Field>
            <Field label="Check-in (start — end)">
              <TimeRangeInput value={form.checkIn} onChange={(v) => updateField('checkIn', v)} />
            </Field>
          </div>
          <div style={twoCol}>
            <Field label="First game">
              <input
                type="time"
                value={to24h(form.firstGame)}
                onChange={(e) => updateField('firstGame', to12h(e.target.value))}
                style={input}
              />
            </Field>
            <Field label="End time">
              <input
                type="time"
                value={to24h(form.endTime)}
                onChange={(e) => updateField('endTime', to12h(e.target.value))}
                style={input}
              />
            </Field>
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
            <Field label="Base price (USD) *">
              <MoneyInput required value={form.basePriceCents} onChange={(v) => updateField('basePriceCents', v)} />
            </Field>
            <Field label="Total slots *">
              <input required type="number" value={form.totalSlots} onChange={(e) => updateField('totalSlots', Number(e.target.value))} style={input} />
            </Field>
          </div>
          <div style={smallHint}>
            Taxes &amp; fees are managed globally in <strong>Settings → Taxes &amp; Fees</strong> and applied to every event automatically.
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
          <div style={publishRow}>
            <label style={inlineCheckLabel}>
              <input type="checkbox" checked={form.published} onChange={(e) => updateField('published', e.target.checked)} />
              Published (visible to customers)
            </label>
            <label style={inlineCheckLabel}>
              <input type="checkbox" checked={form.featured} onChange={(e) => updateField('featured', e.target.checked)} />
              Featured (homepage countdown / TickerBar headliner)
            </label>
            <label style={inlineCheckLabel}>
              <input type="checkbox" checked={form.past} onChange={(e) => updateField('past', e.target.checked)} />
              Past
            </label>
          </div>

          {err && <div style={errorText}>{err}</div>}

          <div style={stickyFooter}>
            <button type="submit" disabled={savingEvent} style={primaryBtn}>
              {savingEvent ? 'Saving…' : (isNew ? 'Create event' : 'Save changes')}
            </button>
          </div>
        </form>

        {currentEventId && (
          <>
            <div style={{ ...sectionLabel, marginTop: 'var(--space-32)' }}>Ticket types</div>
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

function MoneyInput({ value, onChange, required, placeholder }) {
  const [text, setText] = useState(centsToDollars(value));
  useEffect(() => {
    const incoming = centsToDollars(value);
    if (dollarsToCents(text) !== Number(value || 0)) setText(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div style={{ position: 'relative' }}>
      <span style={moneySign}>$</span>
      <input
        required={required}
        type="number"
        step="0.01"
        min="0"
        inputMode="decimal"
        placeholder={placeholder || '0.00'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(dollarsToCents(e.target.value));
        }}
        onBlur={() => setText(centsToDollars(value))}
        style={{ ...input, paddingLeft: 22 }}
      />
    </div>
  );
}

function TimeRangeInput({ value, onChange }) {
  const [startRaw, endRaw] = splitRange(value);
  const start = to24h(startRaw);
  const end = to24h(endRaw);
  const commit = (s24, e24) => {
    const s = s24 ? to12h(s24) : '';
    const e = e24 ? to12h(e24) : '';
    if (!s && !e) onChange('');
    else if (s && e) onChange(`${s} – ${e}`);
    else onChange(s || e);
  };
  return (
    <div style={timeRangeWrap}>
      <input type="time" value={start} onChange={(e) => commit(e.target.value, end)} style={input} aria-label="Start" />
      <span style={timeRangeSep}>—</span>
      <input type="time" value={end} onChange={(e) => commit(start, e.target.value)} style={input} aria-label="End" />
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
      {addons.length === 0 && <p style={emptyHint}>No add-ons.</p>}
      {addons.map((a, i) => (
        <div key={i} className="admin-row-grid" style={addonRow}>
          <input placeholder="sku" value={a.sku || ''} onChange={(e) => update(i, 'sku', e.target.value)} style={input} />
          <input placeholder="name" value={a.name || ''} onChange={(e) => update(i, 'name', e.target.value)} style={input} />
          <MoneyInput placeholder="$0.00" value={a.price_cents ?? 0} onChange={(v) => update(i, 'price_cents', v)} />
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

function EventImagePicker({ label, ratioHint, recommended, ratio, value, onChange, fallback }) {
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

  const previewSrc = value || fallback || '';
  const usingFallback = !value && !!fallback;
  const PREVIEW_WIDTH = 320;
  const previewHeight = Math.round(PREVIEW_WIDTH / ratio);

  return (
    <div style={imagePicker}>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <div style={imagePickerLabel}>{label}</div>
        <div style={imagePickerHint}>
          {ratioHint} · <span style={{ color: 'var(--color-text-muted)' }}>{recommended}</span>
        </div>
      </div>
      <input
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste a URL or upload an image →"
        style={{ ...input, marginBottom: 'var(--space-8)' }}
      />
      <div style={imagePickerActions}>
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
        <span style={imagePickerHint}>Max 5 MB · JPEG / PNG / WebP / GIF</span>
      </div>
      {err && <div style={errorText}>{err}</div>}
      {previewSrc && (
        <div style={{ marginTop: 'var(--space-8)' }}>
          <div
            style={{
              width: PREVIEW_WIDTH,
              maxWidth: '100%',
              height: previewHeight,
              backgroundImage: `url("${previewSrc}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              border: '1px solid var(--color-border-strong)',
              opacity: usingFallback ? 0.55 : 1,
              filter: usingFallback ? 'grayscale(20%)' : 'none',
            }}
            aria-label={`${label} preview cropped to ${ratioHint.split('·')[0].trim()}`}
          />
          <div style={previewCaption}>
            {usingFallback
              ? 'Showing fallback (Cover) cropped to this surface — upload a dedicated image to fix any awkward crops.'
              : `Cropped preview at ${ratioHint.split('·')[0].trim()}`}
          </div>
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
        <p style={emptyHint}>
          No custom questions. Add one below to collect per-attendee info (team name, shirt size, dietary notes, etc.).
        </p>
      )}
      {questions.map((q, i) => (
        <div key={i} style={qBox}>
          <div className="admin-row-grid" style={qGrid}>
            <input
              placeholder="key (snake_case)"
              value={q.key || ''}
              onChange={(e) => update(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_') })}
              style={{ ...qInput, fontFamily: 'monospace', fontSize: 'var(--font-size-xs)' }}
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
            <label style={qReqLabel}>
              <input type="checkbox" checked={!!q.required} onChange={(e) => update(i, { required: e.target.checked })} />
              req
            </label>
            <button type="button" onClick={() => remove(i)} style={qSubtle}>×</button>
          </div>
          {q.type === 'select' && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <input
                placeholder="Options, comma-separated (e.g. Small, Medium, Large)"
                value={(q.options || []).join(', ')}
                onChange={(e) => update(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                style={{ ...qInput, width: '100%', fontSize: 'var(--font-size-sm)' }}
              />
            </div>
          )}
        </div>
      ))}
      <button type="button" onClick={add} style={qSubtle}>+ Add question</button>
    </div>
  );
}

function TicketTypesEditor({ eventId, ticketTypes, onReload, canEdit }) {
  const [editingTt, setEditingTt] = useState(null);

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
      {ticketTypes.length === 0 && <p style={emptyHint}>No ticket types yet. Add one below.</p>}
      {ticketTypes.map((t) => (
        <div key={t.id} style={ttRow}>
          <div>
            <div style={{ color: 'var(--color-text)' }}>
              <strong>{t.name}</strong>
              {!t.active && <span style={ttInactive}>(inactive)</span>}
            </div>
            <div style={ttMeta}>
              {formatMoney(t.priceCents)} · {t.sold || 0}/{t.capacity ?? '∞'} sold
              {t.maxPerOrder ? ` · max ${t.maxPerOrder}/order` : ''}
            </div>
          </div>
          {canEdit && (
            <div>
              <button type="button" onClick={() => setEditingTt(t)} style={subtleBtn}>Edit</button>
              <button type="button" onClick={() => del(t.id)} style={{ ...subtleBtn, marginLeft: 'var(--space-4)' }}>Delete</button>
            </div>
          )}
        </div>
      ))}
      {canEdit && (
        <button type="button" onClick={() => setEditingTt('new')} style={{ ...subtleBtn, marginTop: 'var(--space-8)' }}>+ Add ticket type</button>
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
        <div style={modalHeader}>
          <h4 style={modalTitleSmall}>
            {isNew ? 'New ticket type' : 'Edit ticket type'}
          </h4>
          <button type="button" onClick={onClose} style={subtleBtn}>Close</button>
        </div>
        <Field label="Name *"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} /></Field>
        <Field label="Description"><textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ ...input, resize: 'vertical' }} /></Field>
        <div style={twoCol}>
          <Field label="Price (USD) *">
            <MoneyInput required value={form.priceCents} onChange={(v) => setForm({ ...form, priceCents: v })} />
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
            <label style={ttActiveLabel}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>
          </Field>
        </div>
        {err && <div style={errorText}>{err}</div>}
        <div style={modalActions}>
          <button type="submit" disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : (isNew ? 'Create' : 'Save')}</button>
          <button type="button" onClick={onClose} style={subtleBtn}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={fieldLabel}>
      <div style={fieldLabelText}>{label || ' '}</div>
      {children}
    </label>
  );
}

const pageWrap = { maxWidth: 1200, margin: '0 auto', padding: 'var(--space-32)' };
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
const moneySign = {
  position: 'absolute',
  left: 'var(--space-8)',
  top: '50%',
  transform: 'translateY(-50%)',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-base)',
  pointerEvents: 'none',
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
const tdSmall = { ...td, fontSize: 'var(--font-size-sm)' };
const subRowMono = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-muted)',
  fontFamily: 'monospace',
};
const statusPast = { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' };
const statusPublished = { color: 'var(--color-success)', fontSize: 'var(--font-size-sm)' };
const statusDraft = { color: 'var(--color-warning)', fontSize: 'var(--font-size-sm)' };
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
  maxWidth: 720,
  borderRadius: 'var(--radius-md)',
  maxHeight: '92vh',
  overflowY: 'auto',
};
const nestedModal = { ...modal, maxWidth: 520 };
const modalHeader = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 'var(--space-16)',
};
const modalTitle = {
  margin: 0,
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-md)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
};
const modalTitleSmall = {
  margin: 0,
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-base)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
};
const modalActions = { display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-12)' };
const closeX = {
  width: 32,
  height: 32,
  border: '1px solid var(--color-border-strong)',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-xl)',
  lineHeight: 1,
  cursor: 'pointer',
  borderRadius: 'var(--radius-md)',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const sectionLabel = {
  fontSize: 'var(--font-size-sm)',
  letterSpacing: 'var(--letter-spacing-wider)',
  textTransform: 'uppercase',
  color: 'var(--color-accent)',
  fontWeight: 'var(--font-weight-extrabold)',
  margin: 'var(--space-24) 0 var(--space-8)',
  borderTop: '1px solid var(--color-border)',
  paddingTop: 'var(--space-16)',
};
const twoCol = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-8)' };
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
const imageHint = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-muted)',
  margin: '0 0 var(--space-12)',
  lineHeight: 'var(--line-height-normal)',
};
const imagePicker = {
  background: 'var(--color-bg-sunken)',
  border: '1px solid var(--color-border-subtle)',
  padding: 'var(--space-12) var(--space-16)',
  marginBottom: 'var(--space-12)',
};
const imagePickerLabel = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text)',
  fontWeight: 'var(--font-weight-bold)',
};
const imagePickerHint = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-muted)',
  marginTop: 'var(--space-4)',
};
const imagePickerActions = {
  display: 'flex',
  gap: 'var(--space-8)',
  alignItems: 'center',
  flexWrap: 'wrap',
};
const previewCaption = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-muted)',
  marginTop: 'var(--space-4)',
};
const smallHint = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-muted)',
  marginBottom: 'var(--space-8)',
};
const publishRow = {
  display: 'flex',
  gap: 'var(--space-16)',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-base)',
  flexWrap: 'wrap',
};
const inlineCheckLabel = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-4)',
};
const stickyFooter = {
  display: 'flex',
  gap: 'var(--space-8)',
  marginTop: 'var(--space-16)',
  position: 'sticky',
  bottom: 0,
  padding: 'var(--space-8) 0',
  background: 'var(--color-bg-elevated)',
};
const timeRangeWrap = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  gap: 'var(--space-4)',
  alignItems: 'center',
};
const timeRangeSep = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
};
const emptyHint = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
  margin: 'var(--space-4) 0',
};
const addonRow = {
  display: 'grid',
  gridTemplateColumns: '1fr 2fr 1fr 1fr auto',
  gap: 'var(--space-4)',
  marginBottom: 'var(--space-4)',
};
const qInput = {
  padding: 'var(--space-4) var(--space-8)',
  background: 'var(--color-bg-page)',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};
const qSubtle = {
  padding: 'var(--space-4) var(--space-12)',
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const qBox = {
  background: 'var(--color-bg-sunken)',
  border: '1px solid var(--color-border-subtle)',
  padding: 'var(--space-8) var(--space-12)',
  marginBottom: 'var(--space-8)',
};
const qGrid = {
  display: 'grid',
  gridTemplateColumns: '1fr 2fr 1fr auto auto',
  gap: 'var(--space-4)',
  alignItems: 'center',
};
const qReqLabel = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-xs)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-4)',
};
const ttRow = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 'var(--space-8) 0',
  borderBottom: '1px solid var(--color-border-subtle)',
};
const ttInactive = {
  marginLeft: 'var(--space-4)',
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-muted)',
};
const ttMeta = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-muted)',
};
const ttActiveLabel = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-4)',
  paddingTop: 22,
};

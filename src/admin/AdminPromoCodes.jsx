import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import { formatMoney } from '../utils/money.js';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';
import FilterBar from '../components/admin/FilterBar.jsx';

const ACTIVE_OPTIONS = [
  { value: '1', label: 'Active' },
  { value: '0', label: 'Inactive' },
];

const centsToDollars = (c) => formatMoney(c, { currency: '', emptyFor: '' });
const dollarsToCents = (s) => {
  if (s === '' || s == null) return 0;
  const n = Number(String(s).replace(/[^0-9.-]/g, ''));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
};

function MoneyInput({ value, onChange, required, placeholder, style: extraStyle }) {
  const [text, setText] = useState(centsToDollars(value));
  useEffect(() => {
    const incoming = centsToDollars(value);
    if (dollarsToCents(text) !== Number(value || 0)) setText(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 'var(--space-8)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-base)', pointerEvents: 'none' }}>$</span>
      <input
        required={required}
        type="number"
        step="0.01"
        min="0"
        inputMode="decimal"
        placeholder={placeholder || '0.00'}
        value={text}
        onChange={(e) => { setText(e.target.value); onChange(dollarsToCents(e.target.value)); }}
        onBlur={() => setText(centsToDollars(value))}
        style={{ ...(extraStyle || input), paddingLeft: 22 }}
      />
    </div>
  );
}

export default function AdminPromoCodes() {
  const { isAuthenticated, loading, hasRole } = useAdmin();
  const navigate = useNavigate();

  const [events, setEvents] = useState([]);
  const [promoCodes, setPromoCodes] = useState([]);
  const [filters, setFilters] = useState({ active: '', event_id: '', q: '' });
  const [loadingList, setLoadingList] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const loadEvents = useCallback(async () => {
    const res = await fetch('/api/admin/events', { credentials: 'include', cache: 'no-store' });
    if (res.ok) setEvents((await res.json()).events || []);
  }, []);

  const load = useCallback(async () => {
    setLoadingList(true);
    const params = new URLSearchParams();
    if (filters.active) params.set('active', filters.active);
    if (filters.event_id) params.set('event_id', filters.event_id);
    if (filters.q.trim()) params.set('q', filters.q.trim());
    const res = await fetch(`/api/admin/promo-codes?${params}`, { credentials: 'include', cache: 'no-store' });
    if (res.ok) setPromoCodes((await res.json()).promoCodes || []);
    setLoadingList(false);
  }, [filters.active, filters.event_id, filters.q]);

  useEffect(() => { if (isAuthenticated) loadEvents(); }, [isAuthenticated, loadEvents]);
  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  const del = async (id) => {
    if (!hasRole('owner')) { alert('Only owners can delete promo codes'); return; }
    if (!window.confirm('Delete this promo code? If it has been used, it will be deactivated instead.')) return;
    const res = await fetch(`/api/admin/promo-codes/${id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) {
      const d = await res.json();
      if (d.deactivated) alert('Code has uses — deactivated instead of deleted.');
      load();
    }
  };

  const toggleActive = async (promo) => {
    const res = await fetch(`/api/admin/promo-codes/${promo.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !promo.active }),
    });
    if (res.ok) load();
  };

  const filterSchema = useMemo(() => [
    {
      key: 'active',
      label: 'Status',
      type: 'enum',
      options: ACTIVE_OPTIONS,
    },
    {
      key: 'event_id',
      label: 'Event',
      type: 'enum',
      options: events.map((e) => ({ value: e.id, label: e.title })),
    },
  ], [events]);

  if (loading || !isAuthenticated) return null;

  const eventTitle = (id) => id ? events.find((e) => e.id === id)?.title || id : 'All events';
  const isFiltered = Boolean(filters.active || filters.event_id || filters.q);

  return (
    <div style={pageWrap}>
      <AdminPageHeader
        title="Promo Codes"
        description="Discount codes for events. Codes can be percent or fixed-amount, scoped to a single event or global, with optional usage caps and date windows."
        primaryAction={hasRole('manager') && (
          <button onClick={() => setEditing('new')} style={primaryBtn}>+ New Code</button>
        )}
      />

      <FilterBar
        schema={filterSchema}
        value={filters}
        onChange={setFilters}
        searchValue={filters.q}
        onSearchChange={(q) => setFilters((f) => ({ ...f, q }))}
        searchPlaceholder="Search code…"
        resultCount={promoCodes.length}
        savedViewsKey="adminPromoCodes"
      />

      <section style={tableBox}>
        {loadingList && <EmptyState variant="loading" title="Loading promo codes…" compact />}
        {!loadingList && promoCodes.length === 0 && (
          <EmptyState
            isFiltered={isFiltered}
            title={isFiltered ? 'No codes match these filters' : 'No promo codes yet'}
            description={isFiltered
              ? 'Try clearing a filter or expanding the search.'
              : 'Create your first promo code to give customers a discount.'}
            action={hasRole('manager') && !isFiltered && (
              <button onClick={() => setEditing('new')} style={primaryBtn}>+ New Code</button>
            )}
          />
        )}
        {!loadingList && promoCodes.length > 0 && (
          <div className="admin-table-wrap"><table style={table}>
            <thead>
              <tr>
                <th style={th}>Code</th>
                <th style={th}>Discount</th>
                <th style={th}>Scope</th>
                <th style={th}>Uses</th>
                <th style={th}>Window</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {promoCodes.map((p) => (
                <tr key={p.id} style={tr}>
                  <td style={tdCode}>{p.code}</td>
                  <td style={td}>
                    {p.discountType === 'percent'
                      ? `${p.discountValue}% off`
                      : `${formatMoney(p.discountValue)} off`}
                    {p.minOrderCents ? <div style={subRow}>min {formatMoney(p.minOrderCents)}</div> : null}
                  </td>
                  <td style={tdSmall}>{eventTitle(p.eventId)}</td>
                  <td style={td}>
                    {p.usesCount}{p.maxUses != null ? ` / ${p.maxUses}` : ''}
                  </td>
                  <td style={tdSmaller}>
                    {p.startsAt ? <div>from {new Date(p.startsAt).toLocaleDateString()}</div> : null}
                    {p.expiresAt ? <div>to {new Date(p.expiresAt).toLocaleDateString()}</div> : null}
                    {!p.startsAt && !p.expiresAt && <span style={mutedText}>—</span>}
                  </td>
                  <td style={td}>
                    {p.active
                      ? <span style={statusActive}>Active</span>
                      : <span style={statusInactive}>Inactive</span>}
                  </td>
                  <td style={td}>
                    {hasRole('manager') && (
                      <>
                        <button onClick={() => setEditing(p)} style={subtleBtn}>Edit</button>
                        <button onClick={() => toggleActive(p)} style={{ ...subtleBtn, marginLeft: 'var(--space-4)' }}>
                          {p.active ? 'Disable' : 'Enable'}
                        </button>
                      </>
                    )}
                    {hasRole('owner') && (
                      <button onClick={() => del(p.id)} style={{ ...subtleBtn, marginLeft: 'var(--space-4)' }}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      {editing && (
        <PromoForm
          promo={editing === 'new' ? null : editing}
          events={events}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function PromoForm({ promo, events, onClose, onSaved }) {
  const isNew = !promo;
  const [form, setForm] = useState({
    code: promo?.code || '',
    eventId: promo?.eventId || '',
    discountType: promo?.discountType || 'percent',
    discountValue: promo?.discountValue ?? 10,
    maxUses: promo?.maxUses ?? '',
    minOrderCents: promo?.minOrderCents ?? '',
    startsAt: promo?.startsAt ? toLocalInput(promo.startsAt) : '',
    expiresAt: promo?.expiresAt ? toLocalInput(promo.expiresAt) : '',
    active: promo ? !!promo.active : true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setErr('');
    const body = {
      ...form,
      eventId: form.eventId || null,
      maxUses: form.maxUses === '' ? null : Number(form.maxUses),
      minOrderCents: form.minOrderCents === '' ? null : Number(form.minOrderCents),
      startsAt: form.startsAt ? new Date(form.startsAt).getTime() : null,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).getTime() : null,
      discountValue: Number(form.discountValue),
    };
    const url = isNew ? '/api/admin/promo-codes' : `/api/admin/promo-codes/${promo.id}`;
    const method = isNew ? 'POST' : 'PUT';
    const res = await fetch(url, {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
      <form style={modal} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>
            {isNew ? 'New promo code' : `Edit: ${promo.code}`}
          </h3>
          <button type="button" onClick={onClose} style={subtleBtn}>Close</button>
        </div>

        <Field label="Code *">
          <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} style={input} placeholder="EARLYBIRD" />
        </Field>
        <Field label="Event (blank = all events)">
          <select value={form.eventId} onChange={(e) => setForm({ ...form, eventId: e.target.value })} style={input}>
            <option value="">All events</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
        </Field>
        <div style={fieldRow}>
          <Field label="Discount type *">
            <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })} style={input}>
              <option value="percent">Percent (%)</option>
              <option value="fixed">Fixed amount (USD)</option>
            </select>
          </Field>
          <Field label={form.discountType === 'percent' ? 'Percent (1–100) *' : 'Amount off (USD) *'}>
            {form.discountType === 'percent'
              ? <input required type="number" min="1" max="100" value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} style={input} />
              : <MoneyInput required value={form.discountValue} onChange={(v) => setForm({ ...form, discountValue: v })} />
            }
          </Field>
        </div>
        <div style={fieldRow}>
          <Field label="Max uses (blank = unlimited)">
            <input type="number" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} style={input} />
          </Field>
          <Field label="Min order (USD)">
            <MoneyInput value={form.minOrderCents} onChange={(v) => setForm({ ...form, minOrderCents: v })} />
          </Field>
        </div>
        <div style={fieldRow}>
          <Field label="Starts at">
            <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} style={input} />
          </Field>
          <Field label="Expires at">
            <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} style={input} />
          </Field>
        </div>
        <label style={activeCheckbox}>
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Active
        </label>

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
      <div style={fieldLabelText}>{label}</div>
      {children}
    </label>
  );
}

function toLocalInput(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
const tdSmaller = { ...td, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' };
const tdCode = {
  ...td,
  fontFamily: 'monospace',
  fontWeight: 'var(--font-weight-bold)',
};
const subRow = { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' };
const mutedText = { color: 'var(--color-text-muted)' };
const statusActive = { color: 'var(--color-success)', fontSize: 'var(--font-size-sm)' };
const statusInactive = { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' };
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
  maxWidth: 560,
  borderRadius: 'var(--radius-md)',
  maxHeight: '92vh',
  overflowY: 'auto',
};
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
const modalActions = { display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-16)' };
const fieldRow = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-12)' };
const errorText = {
  color: 'var(--color-danger)',
  fontSize: 'var(--font-size-sm)',
  margin: 'var(--space-8) 0',
};
const activeCheckbox = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-base)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-4)',
  margin: 'var(--space-8) 0',
};
const fieldLabel = { display: 'block', marginBottom: 'var(--space-12)' };
const fieldLabelText = {
  fontSize: 'var(--font-size-sm)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  color: 'var(--color-accent)',
  fontWeight: 'var(--font-weight-bold)',
  marginBottom: 'var(--space-4)',
};

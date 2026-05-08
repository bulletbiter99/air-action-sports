import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import { formatMoney } from '../utils/money.js';

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
      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--olive-light)', fontSize: 13, pointerEvents: 'none' }}>$</span>
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
  const [filterActive, setFilterActive] = useState(''); // '' | '1' | '0'
  const [filterEvent, setFilterEvent] = useState('');
  const [search, setSearch] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [editing, setEditing] = useState(null); // null | 'new' | promo

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
    if (filterActive) params.set('active', filterActive);
    if (filterEvent) params.set('event_id', filterEvent);
    if (search.trim()) params.set('q', search.trim());
    const res = await fetch(`/api/admin/promo-codes?${params}`, { credentials: 'include', cache: 'no-store' });
    if (res.ok) setPromoCodes((await res.json()).promoCodes || []);
    setLoadingList(false);
  }, [filterActive, filterEvent, search]);

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

  if (loading || !isAuthenticated) return null;

  const eventTitle = (id) => id ? events.find((e) => e.id === id)?.title || id : 'All events';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={h1}>Promo Codes</h1>
        {hasRole('manager') && <button onClick={() => setEditing('new')} style={primaryBtn}>+ New Code</button>}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input type="search" placeholder="Search code…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...input, flex: 1, minWidth: 200 }} />
        <select value={filterActive} onChange={(e) => setFilterActive(e.target.value)} style={input}>
          <option value="">All status</option>
          <option value="1">Active</option>
          <option value="0">Inactive</option>
        </select>
        <select value={filterEvent} onChange={(e) => setFilterEvent(e.target.value)} style={input}>
          <option value="">All events</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
      </div>

      <section style={tableBox}>
        {loadingList && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}
        {!loadingList && promoCodes.length === 0 && (
          <p style={{ color: 'var(--olive-light)' }}>No promo codes. Create one above.</p>
        )}
        {promoCodes.length > 0 && (
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
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700 }}>{p.code}</td>
                  <td style={td}>
                    {p.discountType === 'percent'
                      ? `${p.discountValue}% off`
                      : `${formatMoney(p.discountValue)} off`}
                    {p.minOrderCents ? <div style={{ fontSize: 10, color: 'var(--olive-light)' }}>min {formatMoney(p.minOrderCents)}</div> : null}
                  </td>
                  <td style={{ ...td, fontSize: 12 }}>{eventTitle(p.eventId)}</td>
                  <td style={td}>
                    {p.usesCount}{p.maxUses != null ? ` / ${p.maxUses}` : ''}
                  </td>
                  <td style={{ ...td, fontSize: 11 }}>
                    {p.startsAt ? <div>from {new Date(p.startsAt).toLocaleDateString()}</div> : null}
                    {p.expiresAt ? <div>to {new Date(p.expiresAt).toLocaleDateString()}</div> : null}
                    {!p.startsAt && !p.expiresAt && <span style={{ color: 'var(--olive-light)' }}>—</span>}
                  </td>
                  <td style={td}>
                    {p.active
                      ? <span style={{ color: '#2ecc71', fontSize: 12 }}>Active</span>
                      : <span style={{ color: 'var(--olive-light)', fontSize: 12 }}>Inactive</span>}
                  </td>
                  <td style={td}>
                    {hasRole('manager') && (
                      <>
                        <button onClick={() => setEditing(p)} style={subtleBtn}>Edit</button>
                        <button onClick={() => toggleActive(p)} style={{ ...subtleBtn, marginLeft: 6 }}>
                          {p.active ? 'Disable' : 'Enable'}
                        </button>
                      </>
                    )}
                    {hasRole('owner') && (
                      <button onClick={() => del(p.id)} style={{ ...subtleBtn, marginLeft: 6 }}>Delete</button>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: 'var(--cream)', fontSize: 14, letterSpacing: 1.5, textTransform: 'uppercase' }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Max uses (blank = unlimited)">
            <input type="number" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} style={input} />
          </Field>
          <Field label="Min order (USD)">
            <MoneyInput value={form.minOrderCents} onChange={(v) => setForm({ ...form, minOrderCents: v })} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Starts at">
            <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} style={input} />
          </Field>
          <Field label="Expires at">
            <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} style={input} />
          </Field>
        </div>
        <label style={{ color: 'var(--tan-light)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, margin: '10px 0' }}>
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Active
        </label>

        {err && <div style={{ color: '#e74c3c', fontSize: 12, margin: '8px 0' }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
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
      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

function toLocalInput(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const input = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const tableBox = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', color: 'var(--cream)', verticalAlign: 'top' };
const primaryBtn = { padding: '10px 18px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const subtleBtn = { padding: '6px 12px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal = { background: 'var(--mid)', border: '1px solid var(--color-border-strong)', padding: '1.5rem', width: '100%', maxWidth: 560, borderRadius: 4, maxHeight: '92vh', overflowY: 'auto' };

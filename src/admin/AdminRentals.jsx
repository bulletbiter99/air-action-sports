import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { useAdmin } from './AdminContext';
import { formatMoney } from '../utils/money.js';

const CATEGORIES = ['rifle', 'mask', 'vest', 'magazine', 'battery', 'other'];
const CONDITIONS = ['new', 'good', 'fair', 'damaged', 'retired'];

const centsToDollars = (c) => formatMoney(c, { currency: '', emptyFor: '' });
const dollarsToCents = (s) => {
  if (s === '' || s == null) return 0;
  const n = Number(String(s).replace(/[^0-9.-]/g, ''));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
};

function MoneyInput({ value, onChange, required, placeholder }) {
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
        style={{ ...input, paddingLeft: 22 }}
      />
    </div>
  );
}

export default function AdminRentals() {
  const { isAuthenticated, loading, hasRole } = useAdmin();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all'); // all | available | assigned | retired
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [includeRetired, setIncludeRetired] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null); // item or 'new'

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const load = useCallback(async () => {
    setLoadingItems(true);
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (search.trim()) params.set('q', search.trim());
    if (includeRetired) params.set('includeRetired', '1');
    const res = await fetch(`/api/admin/rentals/items?${params}`, { credentials: 'include', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setItems(data.items || []);
    }
    setLoadingItems(false);
  }, [category, search, includeRetired]);

  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => i.status === filter);
  }, [items, filter]);

  const stats = useMemo(() => ({
    total: items.length,
    available: items.filter((i) => i.status === 'available').length,
    assigned: items.filter((i) => i.status === 'assigned').length,
    retired: items.filter((i) => i.status === 'retired').length,
  }), [items]);

  const toggleSel = (id) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectAllFiltered = () => {
    const allIds = filtered.map((i) => i.id);
    const every = allIds.every((id) => selected.has(id));
    setSelected((s) => {
      const n = new Set(s);
      if (every) allIds.forEach((id) => n.delete(id));
      else allIds.forEach((id) => n.add(id));
      return n;
    });
  };

  const printSheet = () => {
    if (selected.size === 0) { alert('Select items to print'); return; }
    const ids = [...selected].join(',');
    window.open(`/admin/rentals/qr-sheet?ids=${ids}`, '_blank');
  };

  const retire = async (id) => {
    if (!hasRole('owner')) { alert('Only owners can retire items'); return; }
    if (!window.confirm('Retire this item? It will be hidden from the active list.')) return;
    const res = await fetch(`/api/admin/rentals/items/${id}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (res.ok) load();
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Failed to retire');
    }
  };

  if (loading || !isAuthenticated) return null;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={h1}>Rental Equipment</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/admin/rentals/assignments" style={navLinkBtn}>Assignments →</Link>
          {hasRole('manager') && (
            <button onClick={() => setEditing('new')} style={primaryBtn}>+ New Item</button>
          )}
        </div>
      </div>

      <div style={statsGrid}>
        <Stat label="Total" value={stats.total} />
        <Stat label="Available" value={stats.available} color="#2ecc71" />
        <Stat label="Assigned" value={stats.assigned} color="#e67e22" />
        <Stat label="Retired" value={stats.retired} color="var(--olive-light)" />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="search" placeholder="Search name, SKU, serial…"
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ ...input, flex: 1, minWidth: 200 }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={input}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={input}>
          <option value="all">All status</option>
          <option value="available">Available</option>
          <option value="assigned">Assigned</option>
          <option value="retired">Retired</option>
        </select>
        <label style={{ color: 'var(--tan-light)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={includeRetired} onChange={(e) => setIncludeRetired(e.target.checked)} />
          include retired
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <button onClick={selectAllFiltered} style={subtleBtn}>
          {filtered.every((i) => selected.has(i.id)) && filtered.length > 0 ? 'Deselect all' : 'Select all'}
        </button>
        <button onClick={printSheet} style={secondaryBtn} disabled={selected.size === 0}>
          Print QR sheet ({selected.size})
        </button>
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} style={subtleBtn}>Clear</button>
        )}
      </div>

      <section style={tableBox}>
        {loadingItems && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}
        {!loadingItems && filtered.length === 0 && (
          <p style={{ color: 'var(--olive-light)' }}>No items match.</p>
        )}
        {filtered.length > 0 && (
          <div className="admin-table-wrap"><table style={table}>
            <thead>
              <tr>
                <th style={th}></th>
                <th style={th}>Name</th>
                <th style={th}>SKU</th>
                <th style={th}>Category</th>
                <th style={th}>Condition</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} style={tr}>
                  <td style={td}>
                    <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggleSel(i.id)} />
                  </td>
                  <td style={td}>
                    <strong>{i.name}</strong>
                    {i.serialNumber && <div style={{ fontSize: 10, color: 'var(--olive-light)' }}>SN: {i.serialNumber}</div>}
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{i.sku}</td>
                  <td style={td}>{i.category}</td>
                  <td style={td}><ConditionPill c={i.condition} /></td>
                  <td style={td}><StatusPill i={i} /></td>
                  <td style={td}>
                    {hasRole('manager') && (
                      <button onClick={() => setEditing(i)} style={subtleBtn}>Edit</button>
                    )}
                    {hasRole('owner') && i.active && (
                      <button onClick={() => retire(i.id)} style={{ ...subtleBtn, marginLeft: 6 }}>Retire</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      {editing && (
        <ItemForm
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ConditionPill({ c }) {
  const colors = {
    new: '#2ecc71', good: '#2ecc71', fair: '#f39c12', damaged: '#e74c3c', retired: 'var(--olive-light)',
  };
  return <span style={{ color: colors[c] || 'var(--cream)', fontSize: 12 }}>{c}</span>;
}

function StatusPill({ i }) {
  if (i.status === 'assigned') {
    return (
      <span style={{ color: '#e67e22', fontSize: 12 }}>
        → {i.currentAssignment?.attendeeName || 'assigned'}
      </span>
    );
  }
  if (i.status === 'available') return <span style={{ color: '#2ecc71', fontSize: 12 }}>Available</span>;
  return <span style={{ color: 'var(--olive-light)', fontSize: 12 }}>Retired</span>;
}

function Stat({ label, value, color }) {
  return (
    <div style={statCard}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: 'var(--orange)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: color || 'var(--cream)', margin: '6px 0 2px' }}>{value}</div>
    </div>
  );
}

function ItemForm({ item, onClose, onSaved }) {
  const isNew = !item;
  const [form, setForm] = useState({
    sku: item?.sku || '',
    serialNumber: item?.serialNumber || '',
    name: item?.name || '',
    category: item?.category || 'rifle',
    condition: item?.condition || 'good',
    purchaseDate: item?.purchaseDate || '',
    purchaseCostCents: item?.purchaseCostCents || '',
    notes: item?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setErr('');
    const body = {
      ...form,
      purchaseCostCents: form.purchaseCostCents === '' ? null : Number(form.purchaseCostCents),
    };
    const url = isNew ? '/api/admin/rentals/items' : `/api/admin/rentals/items/${item.id}`;
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
            {isNew ? 'New rental item' : 'Edit item'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" style={closeX}>×</button>
        </div>

        <Field label="Name *">
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} />
        </Field>
        <Field label="SKU *">
          <input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} style={input} />
        </Field>
        <Field label="Serial number">
          <input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} style={input} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Category *">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={input}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Condition">
            <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} style={input}>
              {CONDITIONS.filter((c) => c !== 'retired').map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Purchase date">
            <input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} style={input} />
          </Field>
          <Field label="Cost (USD)">
            <MoneyInput value={form.purchaseCostCents} onChange={(v) => setForm({ ...form, purchaseCostCents: v })} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ ...input, resize: 'vertical' }} />
        </Field>

        {err && <div style={{ color: '#e74c3c', fontSize: 12, margin: '8px 0' }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="submit" disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : (isNew ? 'Create' : 'Save')}</button>
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

// ─── QR sheet page (separate route) ───
export function AdminRentalQrSheet() {
  const params = new URLSearchParams(window.location.search);
  const ids = (params.get('ids') || '').split(',').filter(Boolean);
  const [items, setItems] = useState([]);
  const [qrDataUrls, setQrDataUrls] = useState({});
  const printedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const fetched = [];
      for (const id of ids) {
        const res = await fetch(`/api/admin/rentals/items/${id}`, { credentials: 'include', cache: 'no-store' });
        if (res.ok) fetched.push((await res.json()).item);
      }
      setItems(fetched);
      const dataUrls = {};
      for (const i of fetched) {
        dataUrls[i.id] = await QRCode.toDataURL(i.id, { width: 256, margin: 1 });
      }
      setQrDataUrls(dataUrls);
    })();
  }, []);

  useEffect(() => {
    if (items.length > 0 && Object.keys(qrDataUrls).length === items.length && !printedRef.current) {
      printedRef.current = true;
      setTimeout(() => window.print(), 300);
    }
  }, [items, qrDataUrls]);

  return (
    <div style={{ background: '#fff', color: '#000', padding: '1cm', minHeight: '100vh' }}>
      <style>{`
        @media print {
          @page { size: letter; margin: 1cm; }
          body { background: #fff; }
          .no-print { display: none !important; }
        }
        .qr-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1cm; }
        .qr-cell { border: 1px dashed #999; padding: 0.5cm; text-align: center; page-break-inside: avoid; }
        .qr-cell img { width: 100%; max-width: 5cm; height: auto; }
        .qr-name { font-weight: 700; font-size: 12pt; margin-top: 6pt; }
        .qr-sku { font-family: monospace; font-size: 9pt; color: #555; }
        .qr-cat { font-size: 9pt; color: #555; text-transform: uppercase; letter-spacing: 1px; }
      `}</style>
      <div className="no-print" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>QR Sheet — {items.length} items</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => window.print()} style={{ padding: '8px 16px' }}>Print</button>
          <button onClick={() => window.close()} style={{ padding: '8px 16px' }}>Close</button>
        </div>
      </div>
      <div className="qr-grid">
        {items.map((i) => (
          <div key={i.id} className="qr-cell">
            {qrDataUrls[i.id] ? <img src={qrDataUrls[i.id]} alt={i.sku} /> : <div style={{ padding: 40 }}>…</div>}
            <div className="qr-name">{i.name}</div>
            <div className="qr-sku">{i.sku}</div>
            <div className="qr-cat">{i.category}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const input = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const statsGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 };
const statCard = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.25rem' };
const tableBox = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', color: 'var(--cream)' };
const primaryBtn = { padding: '10px 18px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const secondaryBtn = { padding: '10px 18px', background: 'var(--olive)', color: 'var(--cream)', border: '1px solid var(--olive-light)', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const subtleBtn = { padding: '6px 12px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };
const navLinkBtn = { padding: '10px 18px', background: 'transparent', border: '1px solid var(--olive-light)', color: 'var(--tan-light)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' };
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal = { background: 'var(--mid)', border: '1px solid var(--color-border-strong)', padding: '1.5rem', width: '100%', maxWidth: 560, borderRadius: 4, maxHeight: '90vh', overflowY: 'auto' };
const closeX = { width: 32, height: 32, border: '1px solid rgba(200,184,154,0.25)', background: 'transparent', color: 'var(--tan-light)', fontSize: 22, lineHeight: 1, cursor: 'pointer', borderRadius: 4, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };

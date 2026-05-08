import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { useAdmin } from './AdminContext';
import { formatMoney } from '../utils/money.js';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';
import FilterBar from '../components/admin/FilterBar.jsx';

const CATEGORIES = ['rifle', 'mask', 'vest', 'magazine', 'battery', 'other'];
const CONDITIONS = ['new', 'good', 'fair', 'damaged', 'retired'];

const STATUS_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'retired', label: 'Retired' },
];
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: c }));
const INCLUDE_RETIRED_OPTIONS = [{ value: '1', label: 'Yes' }];

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
      <span style={moneySign}>$</span>
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

const FILTER_SCHEMA = [
  { key: 'category', label: 'Category', type: 'enum', options: CATEGORY_OPTIONS },
  { key: 'status', label: 'Status', type: 'enum', options: STATUS_OPTIONS },
  { key: 'includeRetired', label: 'Include retired', type: 'enum', options: INCLUDE_RETIRED_OPTIONS },
];

export default function AdminRentals() {
  const { isAuthenticated, loading, hasRole } = useAdmin();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({ category: '', status: '', includeRetired: '', q: '' });
  const [loadingItems, setLoadingItems] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const load = useCallback(async () => {
    setLoadingItems(true);
    const params = new URLSearchParams();
    if (filters.category) params.set('category', filters.category);
    if (filters.q.trim()) params.set('q', filters.q.trim());
    if (filters.includeRetired) params.set('includeRetired', '1');
    const res = await fetch(`/api/admin/rentals/items?${params}`, { credentials: 'include', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setItems(data.items || []);
    }
    setLoadingItems(false);
  }, [filters.category, filters.q, filters.includeRetired]);

  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  const filtered = useMemo(() => {
    if (!filters.status) return items;
    return items.filter((i) => i.status === filters.status);
  }, [items, filters.status]);

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

  const isFiltered = Boolean(filters.category || filters.status || filters.includeRetired || filters.q);

  return (
    <div style={pageWrap}>
      <AdminPageHeader
        title="Rental Equipment"
        description="Inventory of rifles, masks, vests, and accessories. Print QR sheets for tagging items, manage condition, retire damaged equipment."
        secondaryActions={<Link to="/admin/rentals/assignments" style={navLinkBtn}>Assignments →</Link>}
        primaryAction={hasRole('manager') && (
          <button onClick={() => setEditing('new')} style={primaryBtn}>+ New Item</button>
        )}
      />

      <div style={statsGrid}>
        <Stat label="Total" value={stats.total} />
        <Stat label="Available" value={stats.available} color="var(--color-success)" />
        <Stat label="Assigned" value={stats.assigned} color="var(--color-warning)" />
        <Stat label="Retired" value={stats.retired} color="var(--color-text-muted)" />
      </div>

      <FilterBar
        schema={FILTER_SCHEMA}
        value={filters}
        onChange={setFilters}
        searchValue={filters.q}
        onSearchChange={(q) => setFilters((f) => ({ ...f, q }))}
        searchPlaceholder="Search name, SKU, serial…"
        resultCount={filtered.length}
        savedViewsKey="adminRentals"
      />

      <div style={bulkActionsRow}>
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
        {loadingItems && <EmptyState variant="loading" title="Loading inventory…" compact />}
        {!loadingItems && filtered.length === 0 && (
          <EmptyState
            isFiltered={isFiltered}
            title={isFiltered ? 'No items match these filters' : 'No items yet'}
            description={isFiltered
              ? 'Try clearing a filter or expanding the search.'
              : 'Click "+ New Item" to add the first piece of rental equipment.'}
            action={hasRole('manager') && !isFiltered && (
              <button onClick={() => setEditing('new')} style={primaryBtn}>+ New Item</button>
            )}
          />
        )}
        {!loadingItems && filtered.length > 0 && (
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
                    {i.serialNumber && <div style={subRowMuted}>SN: {i.serialNumber}</div>}
                  </td>
                  <td style={tdMonospace}>{i.sku}</td>
                  <td style={td}>{i.category}</td>
                  <td style={td}><ConditionPill c={i.condition} /></td>
                  <td style={td}><StatusPill i={i} /></td>
                  <td style={td}>
                    {hasRole('manager') && (
                      <button onClick={() => setEditing(i)} style={subtleBtn}>Edit</button>
                    )}
                    {hasRole('owner') && i.active && (
                      <button onClick={() => retire(i.id)} style={{ ...subtleBtn, marginLeft: 'var(--space-4)' }}>Retire</button>
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

// Domain-specific condition colors stay raw — the new/good/fair/damaged/retired
// gradient is intentional information density (green→orange→red).
function ConditionPill({ c }) {
  const colors = {
    new: 'var(--color-success)',
    good: 'var(--color-success)',
    fair: 'var(--color-warning)',
    damaged: 'var(--color-danger)',
    retired: 'var(--color-text-muted)',
  };
  return <span style={{ color: colors[c] || 'var(--color-text)', fontSize: 'var(--font-size-sm)' }}>{c}</span>;
}

function StatusPill({ i }) {
  if (i.status === 'assigned') {
    return (
      <span style={{ color: 'var(--color-warning)', fontSize: 'var(--font-size-sm)' }}>
        → {i.currentAssignment?.attendeeName || 'assigned'}
      </span>
    );
  }
  if (i.status === 'available') return <span style={{ color: 'var(--color-success)', fontSize: 'var(--font-size-sm)' }}>Available</span>;
  return <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Retired</span>;
}

function Stat({ label, value, color }) {
  return (
    <div style={statCard}>
      <div style={statLabel}>{label}</div>
      <div style={{ ...statValue, color: color || 'var(--color-text)' }}>{value}</div>
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
        <div style={modalHeader}>
          <h3 style={modalTitle}>
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
        <div style={twoCol}>
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
        <div style={twoCol}>
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

        {err && <div style={errorText}>{err}</div>}

        <div style={modalActions}>
          <button type="submit" disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : (isNew ? 'Create' : 'Save')}</button>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className="no-print" style={{ marginBottom: 'var(--space-16)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>QR Sheet — {items.length} items</strong>
        <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
          <button onClick={() => window.print()} style={{ padding: 'var(--space-8) var(--space-16)' }}>Print</button>
          <button onClick={() => window.close()} style={{ padding: 'var(--space-8) var(--space-16)' }}>Close</button>
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
const statsGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 'var(--space-16)',
  marginTop: 'var(--space-16)',
  marginBottom: 'var(--space-24)',
};
const statCard = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-16)',
};
const statLabel = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wider)',
  color: 'var(--color-accent)',
  textTransform: 'uppercase',
};
const statValue = {
  fontSize: 'var(--font-size-2xl)',
  fontWeight: 'var(--font-weight-extrabold)',
  margin: 'var(--space-4) 0 var(--space-4)',
};
const bulkActionsRow = {
  display: 'flex',
  gap: 'var(--space-8)',
  marginTop: 'var(--space-12)',
  marginBottom: 'var(--space-12)',
  alignItems: 'center',
};
const tableBox = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-24)',
  marginTop: 'var(--space-8)',
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
const td = { padding: 'var(--space-8) var(--space-12)', color: 'var(--color-text)' };
const tdMonospace = { ...td, fontFamily: 'monospace', fontSize: 'var(--font-size-sm)' };
const subRowMuted = { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' };
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
const secondaryBtn = {
  padding: 'var(--space-8) var(--space-16)',
  background: 'var(--color-bg-sunken)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-strong)',
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
const navLinkBtn = {
  padding: 'var(--space-8) var(--space-16)',
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
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
  maxHeight: '90vh',
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

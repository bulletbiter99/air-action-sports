import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';

const EMPTY = {
  name: '', shortLabel: '', category: 'tax',
  percentBps: 0, fixedCents: 0,
  perUnit: 'booking', appliesTo: 'all',
  active: true, sortOrder: 0, description: '',
};

export default function AdminTaxesFees() {
  const { isAuthenticated, loading, hasRole } = useAdmin();
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [editing, setEditing] = useState(null); // existing row or EMPTY
  const [error, setError] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
    else if (!hasRole('manager')) navigate('/admin');
  }, [loading, isAuthenticated, hasRole, navigate]);

  const load = useCallback(async () => {
    setLoadingList(true);
    const res = await fetch('/api/admin/taxes-fees', { credentials: 'include', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setRows(data.taxesFees || []);
    }
    setLoadingList(false);
  }, []);

  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  const save = async (payload) => {
    setError(null);
    const url = payload.id ? `/api/admin/taxes-fees/${payload.id}` : '/api/admin/taxes-fees';
    const method = payload.id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Save failed'); return; }
    setEditing(null);
    load();
  };

  const toggleActive = async (row) => {
    await fetch(`/api/admin/taxes-fees/${row.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !row.active }),
    });
    load();
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete "${row.name}"? This can't be undone.`)) return;
    await fetch(`/api/admin/taxes-fees/${row.id}`, {
      method: 'DELETE', credentials: 'include',
    });
    load();
  };

  if (loading || !isAuthenticated) return null;

  const taxes = rows.filter((r) => r.category === 'tax');
  const fees = rows.filter((r) => r.category === 'fee');

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={h1}>Taxes &amp; Fees</h1>
          <p style={{ color: 'var(--olive-light)', fontSize: 13, marginTop: 4 }}>
            Global taxes and fees. Active entries are applied to every checkout.
            Customer sees a single <strong>Taxes &amp; Fees</strong> line — this breakdown is admin-only.
          </p>
        </div>
        <button style={newBtn} onClick={() => setEditing(EMPTY)}>▶ Add New</button>
      </div>

      {error && <div style={errBanner}>{error}</div>}

      {loadingList && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}

      <Group title="Taxes" rows={taxes} onEdit={setEditing} onToggle={toggleActive} onDelete={remove} hasRole={hasRole} />
      <Group title="Fees" rows={fees} onEdit={setEditing} onToggle={toggleActive} onDelete={remove} hasRole={hasRole} />

      {editing && <EditModal row={editing} onClose={() => { setEditing(null); setError(null); }} onSave={save} />}
    </div>
  );
}

function Group({ title, rows, onEdit, onToggle, onDelete, hasRole }) {
  return (
    <section style={section}>
      <h2 style={h2}>{title}</h2>
      {rows.length === 0 && <p style={{ color: 'var(--olive-light)', fontSize: 13 }}>None configured.</p>}
      {rows.length > 0 && (
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Active</th>
              <th style={th}>Name</th>
              <th style={th}>%</th>
              <th style={th}>Fixed</th>
              <th style={th}>Per</th>
              <th style={th}>Applies to</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={tr}>
                <td style={td}>
                  <button onClick={() => onToggle(r)} style={{ ...pill, ...(r.active ? pillOn : pillOff) }}>
                    {r.active ? 'ON' : 'OFF'}
                  </button>
                </td>
                <td style={td}>
                  <strong>{r.name}</strong>
                  {r.shortLabel && <div style={{ fontSize: 11, color: 'var(--olive-light)' }}>{r.shortLabel}</div>}
                  {r.description && <div style={{ fontSize: 11, color: 'var(--olive-light)', marginTop: 4 }}>{r.description}</div>}
                </td>
                <td style={td}>{r.percentDisplay || '—'}</td>
                <td style={td}>{r.fixedDisplay || '—'}</td>
                <td style={td}>{r.perUnit}</td>
                <td style={td}>{r.appliesTo}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button style={editBtn} onClick={() => onEdit(r)}>Edit</button>
                  {hasRole('owner') && (
                    <button style={{ ...editBtn, marginLeft: 6, color: '#ff8a7e', borderColor: 'rgba(231,76,60,0.3)' }} onClick={() => onDelete(r)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function EditModal({ row, onClose, onSave }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    ...row,
    percentInput: row.percentBps ? (row.percentBps / 100).toFixed(2) : '',
    fixedInput: row.fixedCents ? (row.fixedCents / 100).toFixed(2) : '',
  });

  const submit = (e) => {
    e.preventDefault();
    const payload = {
      ...(row.id ? { id: row.id } : {}),
      name: form.name,
      shortLabel: form.shortLabel || null,
      category: form.category,
      percentBps: Math.round(parseFloat(form.percentInput || 0) * 100),
      fixedCents: Math.round(parseFloat(form.fixedInput || 0) * 100),
      perUnit: form.perUnit,
      appliesTo: form.appliesTo,
      active: !!form.active,
      sortOrder: Number(form.sortOrder) || 0,
      description: form.description || null,
    };
    onSave(payload);
  };

  return (
    <div style={modalBack} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 20, fontWeight: 900, color: 'var(--cream)', margin: '0 0 1rem', textTransform: 'uppercase', letterSpacing: '-0.5px' }}>
          {isNew ? 'Add Tax or Fee' : `Edit — ${row.name}`}
        </h3>
        <form onSubmit={submit}>
          <Field label="Name">
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} required />
          </Field>
          <Field label="Short label (admin-only, optional)">
            <input type="text" value={form.shortLabel || ''} onChange={(e) => setForm({ ...form, shortLabel: e.target.value })} style={input} />
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Category">
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={input}>
                <option value="tax">Tax</option>
                <option value="fee">Fee</option>
              </select>
            </Field>
            <Field label="Per">
              <select value={form.perUnit} onChange={(e) => setForm({ ...form, perUnit: e.target.value })} style={input}>
                <option value="booking">Per booking</option>
                <option value="ticket">Per ticket</option>
                <option value="attendee">Per attendee</option>
              </select>
            </Field>
          </div>
          <Field label="Applies to">
            <select value={form.appliesTo} onChange={(e) => setForm({ ...form, appliesTo: e.target.value })} style={input}>
              <option value="all">All (tickets + add-ons)</option>
              <option value="tickets">Tickets only</option>
              <option value="addons">Add-ons only</option>
            </select>
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Percent rate">
              <div style={{ position: 'relative' }}>
                <input type="number" step="0.01" min="0" value={form.percentInput} onChange={(e) => setForm({ ...form, percentInput: e.target.value })} style={{ ...input, paddingRight: 28 }} />
                <span style={{ position: 'absolute', right: 10, top: 10, color: 'var(--olive-light)' }}>%</span>
              </div>
            </Field>
            <Field label="Fixed amount ($)">
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: 10, color: 'var(--olive-light)' }}>$</span>
                <input type="number" step="0.01" min="0" value={form.fixedInput} onChange={(e) => setForm({ ...form, fixedInput: e.target.value })} style={{ ...input, paddingLeft: 22 }} />
              </div>
            </Field>
            <Field label="Sort order">
              <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} style={input} />
            </Field>
          </div>
          <Field label="Description (admin notes)">
            <textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} style={{ ...input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', color: 'var(--cream)', fontSize: 13 }}>
            <input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} style={{ accentColor: 'var(--orange)' }} />
            Active — charge to customers now
          </label>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={saveBtn}>{isNew ? 'Create' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ flex: 1, marginBottom: 12 }}>
      <label style={lbl}>{label}</label>
      {children}
    </div>
  );
}

// styles
const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const h2 = { fontSize: 14, fontWeight: 800, letterSpacing: 2, color: 'var(--orange)', textTransform: 'uppercase', margin: '0 0 16px' };
const newBtn = { padding: '10px 22px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const section = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1.5rem', marginBottom: 24 };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '12px', color: 'var(--cream)', verticalAlign: 'top' };
const pill = { padding: '3px 10px', fontSize: 10, fontWeight: 800, letterSpacing: 1, border: '1px solid', cursor: 'pointer', fontFamily: 'inherit' };
const pillOn = { background: 'rgba(39,174,96,0.15)', color: '#2ecc71', borderColor: 'rgba(39,174,96,0.5)' };
const pillOff = { background: 'rgba(149,165,166,0.15)', color: '#95a5a6', borderColor: 'rgba(149,165,166,0.5)' };
const editBtn = { padding: '4px 10px', background: 'transparent', border: '1px solid rgba(200,184,154,0.3)', color: 'var(--tan)', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' };
const modalBack = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 500, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' };
const modalCard = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.2)', padding: '2rem', maxWidth: 560, width: '100%' };
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--tan)', marginBottom: 6 };
const input = { width: '100%', padding: '10px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const cancelBtn = { padding: '10px 20px', background: 'transparent', color: 'var(--tan)', border: '1px solid rgba(200,184,154,0.3)', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const saveBtn = { padding: '10px 20px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' };
const errBanner = { background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', color: '#ff8a7e', padding: 12, marginBottom: 16, fontSize: 13 };

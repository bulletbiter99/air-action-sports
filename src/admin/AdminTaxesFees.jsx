import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';

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
  const [editing, setEditing] = useState(null);
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
    <div style={pageWrap}>
      <AdminPageHeader
        title="Taxes & Fees"
        description="Global taxes and fees. Active entries are applied to every checkout. Customer sees a single Taxes & Fees line — this breakdown is admin-only."
        breadcrumb={[{ label: 'Settings', to: '/admin/settings' }, { label: 'Taxes & Fees' }]}
        primaryAction={<button style={primaryBtn} onClick={() => setEditing(EMPTY)}>+ Add New</button>}
      />

      {error && <div style={errBanner}>{error}</div>}

      {loadingList && <EmptyState variant="loading" title="Loading taxes & fees…" compact />}

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
      {rows.length === 0 && (
        <EmptyState
          title={`No ${title.toLowerCase()} configured`}
          description={`Click "+ Add New" to create a ${title.slice(0, -1).toLowerCase()}.`}
          compact
        />
      )}
      {rows.length > 0 && (
        <div className="admin-table-wrap"><table style={table}>
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
                  {r.shortLabel && <div style={subRow}>{r.shortLabel}</div>}
                  {r.description && <div style={{ ...subRow, marginTop: 'var(--space-4)' }}>{r.description}</div>}
                </td>
                <td style={td}>{r.percentDisplay || '—'}</td>
                <td style={td}>{r.fixedDisplay || '—'}</td>
                <td style={td}>{r.perUnit}</td>
                <td style={td}>{r.appliesTo}</td>
                <td style={tdActions}>
                  <button style={editBtn} onClick={() => onEdit(r)}>Edit</button>
                  {hasRole('owner') && (
                    <button style={deleteBtn} onClick={() => onDelete(r)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
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
        <h3 style={modalTitle}>
          {isNew ? 'Add Tax or Fee' : `Edit — ${row.name}`}
        </h3>
        <form onSubmit={submit}>
          <Field label="Name">
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} required />
          </Field>
          <Field label="Short label (admin-only, optional)">
            <input type="text" value={form.shortLabel || ''} onChange={(e) => setForm({ ...form, shortLabel: e.target.value })} style={input} />
          </Field>
          <div style={fieldRow}>
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
          <div style={fieldRow}>
            <Field label="Percent rate">
              <div style={{ position: 'relative' }}>
                <input type="number" step="0.01" min="0" value={form.percentInput} onChange={(e) => setForm({ ...form, percentInput: e.target.value })} style={{ ...input, paddingRight: 28 }} />
                <span style={inputSuffixR}>%</span>
              </div>
            </Field>
            <Field label="Fixed amount ($)">
              <div style={{ position: 'relative' }}>
                <span style={inputSuffixL}>$</span>
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
          <label style={activeCheckbox}>
            <input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} style={{ accentColor: 'var(--color-accent)' }} />
            Active — charge to customers now
          </label>
          <div style={modalActions}>
            <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
            <button type="submit" style={primaryBtn}>{isNew ? 'Create' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ flex: 1, marginBottom: 'var(--space-12)' }}>
      <label style={lbl}>{label}</label>
      {children}
    </div>
  );
}

const pageWrap = { maxWidth: 1100, margin: '0 auto', padding: 'var(--space-32)' };
const h2 = {
  fontSize: 'var(--font-size-md)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wider)',
  color: 'var(--color-accent)',
  textTransform: 'uppercase',
  margin: '0 0 var(--space-16)',
};
const section = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-24)',
  marginBottom: 'var(--space-24)',
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
const td = { padding: 'var(--space-12)', color: 'var(--color-text)', verticalAlign: 'top' };
const tdActions = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
const subRow = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' };
// Domain-specific status pill colors stay raw (success-green / muted-grey).
const pill = {
  padding: 'var(--space-4) var(--space-8)',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  border: '1px solid',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const pillOn = { background: 'var(--color-success-soft)', color: 'var(--color-success)', borderColor: 'var(--color-success)' };
const pillOff = { background: 'rgba(149,165,166,0.15)', color: 'var(--color-text-muted)', borderColor: 'var(--color-border-strong)' };
const editBtn = {
  padding: 'var(--space-4) var(--space-12)',
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-bold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const deleteBtn = {
  ...editBtn,
  marginLeft: 'var(--space-4)',
  color: 'var(--color-danger)',
  borderColor: 'var(--color-danger)',
};
const modalBack = {
  position: 'fixed',
  inset: 0,
  background: 'var(--color-overlay-strong)',
  zIndex: 500,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: 'var(--space-32) var(--space-16)',
  overflowY: 'auto',
};
const modalCard = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border-strong)',
  padding: 'var(--space-32)',
  maxWidth: 560,
  width: '100%',
  borderRadius: 'var(--radius-md)',
};
const modalTitle = {
  fontSize: 'var(--font-size-xl)',
  fontWeight: 'var(--font-weight-extrabold)',
  color: 'var(--color-text)',
  margin: '0 0 var(--space-16)',
  textTransform: 'uppercase',
  letterSpacing: '-0.5px',
};
const modalActions = {
  display: 'flex',
  gap: 'var(--space-8)',
  justifyContent: 'flex-end',
  marginTop: 'var(--space-16)',
};
const fieldRow = { display: 'flex', gap: 'var(--space-12)' };
const lbl = {
  display: 'block',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-bold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  color: 'var(--color-accent)',
  marginBottom: 'var(--space-4)',
};
const input = {
  width: '100%',
  padding: 'var(--space-8) var(--space-12)',
  background: 'var(--color-bg-page)',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-base)',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};
const inputSuffixR = {
  position: 'absolute',
  right: 'var(--space-8)',
  top: 'var(--space-8)',
  color: 'var(--color-text-muted)',
};
const inputSuffixL = {
  position: 'absolute',
  left: 'var(--space-8)',
  top: 'var(--space-8)',
  color: 'var(--color-text-muted)',
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
const primaryBtn = {
  padding: 'var(--space-8) var(--space-16)',
  background: 'var(--color-accent)',
  color: 'var(--color-accent-on-accent)',
  border: 'none',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wider)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const errBanner = {
  background: 'var(--color-danger-soft)',
  border: '1px solid var(--color-danger)',
  color: 'var(--color-danger)',
  padding: 'var(--space-12)',
  marginBottom: 'var(--space-16)',
  fontSize: 'var(--font-size-base)',
};
const activeCheckbox = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-8)',
  padding: 'var(--space-8) 0',
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-base)',
};

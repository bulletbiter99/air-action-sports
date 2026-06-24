import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';
import { formatMoney } from '../utils/money.js';
import { EXPENSE_CATEGORIES, categoryLabel } from '../utils/expenseCategories.js';

function currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthBounds(ym) {
    if (!ym) return null;
    const [y, m] = ym.split('-').map(Number);
    if (!y || !m) return null;
    return { start: Date.UTC(y, m - 1, 1), end: Date.UTC(y, m, 1) - 1 };
}
function todayInput() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dateInputToMs(s) {
    if (!s) return Date.now();
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
}
function msToDateInput(ms) {
    const d = new Date(Number(ms));
    if (isNaN(d.getTime())) return todayInput();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const EMPTY = { category: 'other', description: '', amountInput: '', dateInput: '', vendor: '', eventId: '' };

export default function AdminExpenses() {
    const { isAuthenticated, loading, hasCapability } = useAdmin();
    const navigate = useNavigate();
    const canWrite = hasCapability('finances.write');

    const [rows, setRows] = useState([]);
    const [totalCents, setTotalCents] = useState(0);
    const [events, setEvents] = useState([]);
    const [month, setMonth] = useState(currentMonth());
    const [category, setCategory] = useState('');
    const [loadingList, setLoadingList] = useState(true);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (loading) return;
        if (!isAuthenticated) navigate('/admin/login');
        else if (!hasCapability('finances.read')) navigate('/admin');
    }, [loading, isAuthenticated, hasCapability, navigate]);

    const load = useCallback(async () => {
        setLoadingList(true);
        const params = new URLSearchParams();
        const b = monthBounds(month);
        if (b) { params.set('start', String(b.start)); params.set('end', String(b.end)); }
        if (category) params.set('category', category);
        const res = await fetch(`/api/admin/expenses?${params}`, { credentials: 'include', cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            setRows(data.expenses || []);
            setTotalCents(data.totalCents || 0);
        }
        setLoadingList(false);
    }, [month, category]);

    useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

    // Events for the optional per-expense tag + table display. Non-blocking.
    useEffect(() => {
        if (!isAuthenticated) return;
        fetch('/api/admin/events', { credentials: 'include', cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : { events: [] }))
            .then((d) => setEvents(d.events || []))
            .catch(() => setEvents([]));
    }, [isAuthenticated]);

    const eventTitle = useMemo(() => {
        const map = {};
        for (const e of events) map[e.id] = e.title;
        return map;
    }, [events]);

    const save = async (payload, id) => {
        setError(null);
        const url = id ? `/api/admin/expenses/${id}` : '/api/admin/expenses';
        const res = await fetch(url, {
            method: id ? 'PUT' : 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data.error || 'Save failed'); return; }
        setEditing(null);
        load();
    };

    const remove = async (row) => {
        if (!window.confirm("Delete this expense? This can't be undone.")) return;
        await fetch(`/api/admin/expenses/${row.id}`, { method: 'DELETE', credentials: 'include' });
        load();
    };

    if (loading || !isAuthenticated) return null;

    const isFiltered = Boolean(category) || month !== currentMonth();

    return (
        <div style={pageWrap}>
            <AdminPageHeader
                title="Expenses"
                description="Record operating expenses (field/rent, payroll, consumables, equipment, …). Tag an expense to an event to power per-event P&L."
                primaryAction={canWrite && <button style={primaryBtn} onClick={() => setEditing({ ...EMPTY, dateInput: todayInput() })}>+ New Expense</button>}
            />

            {error && <div style={errBanner}>{error}</div>}

            <div style={filterRow}>
                <label style={filterField}>
                    <span style={filterLbl}>Month</span>
                    <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={input} />
                </label>
                <label style={filterField}>
                    <span style={filterLbl}>Category</span>
                    <select value={category} onChange={(e) => setCategory(e.target.value)} style={input}>
                        <option value="">All categories</option>
                        {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                </label>
                <div style={totalBox}>
                    <span style={filterLbl}>Total shown</span>
                    <strong style={totalAmt}>{formatMoney(totalCents)}</strong>
                </div>
            </div>

            <section style={section}>
                {loadingList && <EmptyState variant="loading" title="Loading expenses…" compact />}
                {!loadingList && rows.length === 0 && (
                    <EmptyState
                        isFiltered={isFiltered}
                        title={isFiltered ? 'No expenses match these filters' : 'No expenses this month'}
                        description={isFiltered ? 'Try a different month or category.' : (canWrite ? 'Record your first operating expense with "+ New Expense".' : 'Nothing recorded yet.')}
                        compact
                    />
                )}
                {!loadingList && rows.length > 0 && (
                    <div className="admin-table-wrap"><table style={table}>
                        <thead><tr>
                            <th style={th}>Date</th>
                            <th style={th}>Description</th>
                            <th style={th}>Category</th>
                            <th style={th}>Event</th>
                            <th style={thR}>Amount</th>
                            <th style={th}></th>
                        </tr></thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} style={tr}>
                                    <td style={td}>{msToDateInput(r.incurredAt)}</td>
                                    <td style={td}><strong>{r.description || '—'}</strong>{r.vendor && <div style={subRow}>{r.vendor}</div>}</td>
                                    <td style={td}>{categoryLabel(r.category)}</td>
                                    <td style={td}>{r.eventId ? (eventTitle[r.eventId] || r.eventId) : '—'}</td>
                                    <td style={tdR}>{formatMoney(r.amountCents)}</td>
                                    <td style={tdActions}>
                                        {canWrite && <>
                                            <button style={editBtn} onClick={() => setEditing({
                                                id: r.id, category: r.category, description: r.description || '',
                                                amountInput: (r.amountCents / 100).toFixed(2), dateInput: msToDateInput(r.incurredAt),
                                                vendor: r.vendor || '', eventId: r.eventId || '',
                                            })}>Edit</button>
                                            <button style={deleteBtn} onClick={() => remove(r)}>Delete</button>
                                        </>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table></div>
                )}
            </section>

            {editing && <ExpenseModal row={editing} events={events} onClose={() => { setEditing(null); setError(null); }} onSave={save} />}
        </div>
    );
}

function ExpenseModal({ row, events, onClose, onSave }) {
    const isNew = !row.id;
    const [form, setForm] = useState(row);
    const submit = (e) => {
        e.preventDefault();
        const amountCents = Math.round(parseFloat(form.amountInput || '0') * 100);
        onSave({
            category: form.category,
            description: form.description || null,
            amountCents,
            incurredAt: dateInputToMs(form.dateInput),
            vendor: form.vendor || null,
            eventId: form.eventId || null,
        }, row.id);
    };
    return (
        <div style={modalBack} onClick={onClose}>
            <div style={modalCard} onClick={(e) => e.stopPropagation()}>
                <h3 style={modalTitle}>{isNew ? 'New Expense' : 'Edit Expense'}</h3>
                <form onSubmit={submit}>
                    <Field label="Description">
                        <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={input} placeholder="e.g. July field lease" />
                    </Field>
                    <div style={fieldRow}>
                        <Field label="Category">
                            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={input}>
                                {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                            </select>
                        </Field>
                        <Field label="Amount ($)">
                            <input type="number" step="0.01" min="0.01" value={form.amountInput} onChange={(e) => setForm({ ...form, amountInput: e.target.value })} style={input} required />
                        </Field>
                    </div>
                    <div style={fieldRow}>
                        <Field label="Date"><input type="date" value={form.dateInput} onChange={(e) => setForm({ ...form, dateInput: e.target.value })} style={input} required /></Field>
                        <Field label="Vendor (optional)"><input type="text" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} style={input} /></Field>
                    </div>
                    <Field label="Tag to event (optional)">
                        <select value={form.eventId} onChange={(e) => setForm({ ...form, eventId: e.target.value })} style={input}>
                            <option value="">— none (general overhead) —</option>
                            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                        </select>
                    </Field>
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
    return <div style={{ flex: 1, marginBottom: 'var(--space-12)' }}><label style={lbl}>{label}</label>{children}</div>;
}

const pageWrap = { maxWidth: 1100, margin: '0 auto', padding: 'var(--space-32)' };
const filterRow = { display: 'flex', gap: 'var(--space-16)', alignItems: 'flex-end', marginBottom: 'var(--space-16)', flexWrap: 'wrap' };
const filterField = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' };
const filterLbl = { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)', letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase', color: 'var(--color-accent)' };
const totalBox = { marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', textAlign: 'right' };
const totalAmt = { fontSize: 'var(--font-size-xl)', color: 'var(--color-text)' };
const section = { background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', padding: 'var(--space-24)' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-base)' };
const th = { textAlign: 'left', padding: 'var(--space-8) var(--space-12)', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--color-accent)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-extrabold)', letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase' };
const thR = { ...th, textAlign: 'right' };
const tr = { borderBottom: '1px solid var(--color-border-subtle)' };
const td = { padding: 'var(--space-12)', color: 'var(--color-text)', verticalAlign: 'top' };
const tdR = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const tdActions = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
const subRow = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' };
const editBtn = { padding: 'var(--space-4) var(--space-12)', background: 'transparent', border: '1px solid var(--color-border-strong)', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)', letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' };
const deleteBtn = { ...editBtn, marginLeft: 'var(--space-4)', color: 'var(--color-danger)', borderColor: 'var(--color-danger)' };
const modalBack = { position: 'fixed', inset: 0, background: 'var(--color-overlay-strong)', zIndex: 500, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 'var(--space-32) var(--space-16)', overflowY: 'auto' };
const modalCard = { background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-strong)', padding: 'var(--space-32)', maxWidth: 560, width: '100%', borderRadius: 'var(--radius-md)' };
const modalTitle = { fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-extrabold)', color: 'var(--color-text)', margin: '0 0 var(--space-16)', textTransform: 'uppercase', letterSpacing: '-0.5px' };
const modalActions = { display: 'flex', gap: 'var(--space-8)', justifyContent: 'flex-end', marginTop: 'var(--space-16)' };
const fieldRow = { display: 'flex', gap: 'var(--space-12)' };
const lbl = { display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)', letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 'var(--space-4)' };
const input = { width: '100%', padding: 'var(--space-8) var(--space-12)', background: 'var(--color-bg-page)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text)', fontSize: 'var(--font-size-base)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const cancelBtn = { padding: 'var(--space-8) var(--space-16)', background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-strong)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-extrabold)', letterSpacing: 'var(--letter-spacing-wider)', textTransform: 'uppercase', cursor: 'pointer' };
const primaryBtn = { padding: 'var(--space-8) var(--space-16)', background: 'var(--color-accent)', color: 'var(--color-accent-on-accent)', border: 'none', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-extrabold)', letterSpacing: 'var(--letter-spacing-wider)', textTransform: 'uppercase', cursor: 'pointer' };
const errBanner = { background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger)', color: 'var(--color-danger)', padding: 'var(--space-12)', marginBottom: 'var(--space-16)', fontSize: 'var(--font-size-base)' };

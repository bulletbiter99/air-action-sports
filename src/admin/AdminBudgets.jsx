import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import { formatMoney } from '../utils/money.js';
import { EXPENSE_CATEGORIES } from '../utils/expenseCategories.js';

function currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function toCents(raw) {
    const n = Math.round(parseFloat(raw || '0') * 100);
    return Number.isFinite(n) ? n : 0;
}

export default function AdminBudgets() {
    const { isAuthenticated, loading, hasCapability } = useAdmin();
    const navigate = useNavigate();
    const canWrite = hasCapability('finances.write');

    const [month, setMonth] = useState(currentMonth());
    const [amounts, setAmounts] = useState({});       // category → dollar string (input)
    const [savedCents, setSavedCents] = useState({}); // category → last-saved cents
    const [loadingList, setLoadingList] = useState(true);
    const [savingCat, setSavingCat] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (loading) return;
        if (!isAuthenticated) navigate('/admin/login');
        else if (!hasCapability('finances.read')) navigate('/admin');
    }, [loading, isAuthenticated, hasCapability, navigate]);

    const load = useCallback(async () => {
        setLoadingList(true);
        const res = await fetch(`/api/admin/budgets?period=${month}`, { credentials: 'include', cache: 'no-store' });
        const next = {};
        const saved = {};
        if (res.ok) {
            const data = await res.json();
            for (const b of (data.budgets || [])) {
                next[b.category] = (b.budgetedCents / 100).toFixed(2);
                saved[b.category] = b.budgetedCents;
            }
        }
        setAmounts(next);
        setSavedCents(saved);
        setLoadingList(false);
    }, [month]);

    useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

    const saveCat = async (cat) => {
        if (!canWrite) return;
        const cents = toCents(amounts[cat]);
        if (cents < 0) return;
        if (cents === (savedCents[cat] || 0)) return; // unchanged
        setSavingCat(cat);
        setError(null);
        const res = await fetch('/api/admin/budgets', {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ period: month, category: cat, budgetedCents: cents }),
        });
        if (res.ok) {
            setSavedCents((s) => ({ ...s, [cat]: cents }));
        } else {
            const d = await res.json().catch(() => ({}));
            setError(d.error || 'Save failed');
        }
        setSavingCat(null);
    };

    if (loading || !isAuthenticated) return null;

    const totalCents = EXPENSE_CATEGORIES.reduce((s, c) => s + (savedCents[c.key] || 0), 0);

    return (
        <div style={pageWrap}>
            <AdminPageHeader
                title="Budgets"
                description="Set a monthly spending target per category. The P&L vs Budget report compares these against your actual recorded expenses."
            />

            {error && <div style={errBanner}>{error}</div>}

            <div style={filterRow}>
                <label style={filterField}>
                    <span style={filterLbl}>Month</span>
                    <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={input} />
                </label>
                <div style={totalBox}>
                    <span style={filterLbl}>Total budgeted</span>
                    <strong style={totalAmt}>{formatMoney(totalCents)}</strong>
                </div>
            </div>

            <section style={section}>
                {loadingList ? (
                    <p style={muted}>Loading…</p>
                ) : (
                    <table style={table}>
                        <thead><tr>
                            <th style={th}>Category</th>
                            <th style={thR}>Monthly budget ($)</th>
                            <th style={th}></th>
                        </tr></thead>
                        <tbody>
                            {EXPENSE_CATEGORIES.map((c) => {
                                const dirty = toCents(amounts[c.key]) !== (savedCents[c.key] || 0);
                                return (
                                    <tr key={c.key} style={tr}>
                                        <td style={td}><strong>{c.label}</strong></td>
                                        <td style={tdR}>
                                            <input
                                                type="number" step="0.01" min="0" disabled={!canWrite}
                                                value={amounts[c.key] ?? ''} placeholder="0.00"
                                                onChange={(e) => setAmounts((a) => ({ ...a, [c.key]: e.target.value }))}
                                                onBlur={() => saveCat(c.key)}
                                                style={budgetInput}
                                            />
                                        </td>
                                        <td style={statusTd}>
                                            {savingCat === c.key ? <span style={muted}>Saving…</span>
                                                : dirty ? <span style={muted}>Unsaved — tab out to save</span>
                                                    : (savedCents[c.key] ? <span style={savedTag}>Saved</span> : null)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </section>

            {!canWrite && <p style={muted}>You have read-only access to budgets.</p>}
        </div>
    );
}

const pageWrap = { maxWidth: 900, margin: '0 auto', padding: 'var(--space-32)' };
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
const td = { padding: 'var(--space-12)', color: 'var(--color-text)', verticalAlign: 'middle' };
const tdR = { ...td, textAlign: 'right' };
const statusTd = { ...td, width: 200 };
const budgetInput = { width: 140, padding: 'var(--space-8) var(--space-12)', background: 'var(--color-bg-page)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text)', fontSize: 'var(--font-size-base)', textAlign: 'right', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const input = { padding: 'var(--space-8) var(--space-12)', background: 'var(--color-bg-page)', border: '1px solid var(--color-border-strong)', color: 'var(--color-text)', fontSize: 'var(--font-size-base)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const muted = { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', margin: 0 };
const savedTag = { color: 'var(--color-success)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)' };
const errBanner = { background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger)', color: 'var(--color-danger)', padding: 'var(--space-12)', marginBottom: 'var(--space-16)', fontSize: 'var(--font-size-base)' };

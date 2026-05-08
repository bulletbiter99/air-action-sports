// M5 R16 — Admin booking-charges review queue (Surface 5 addendum).
//
// Routed at /admin/booking-charges. Lists charges with status tabs;
// per-row Approve / Waive / Mark Paid actions gated by status.

import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader';
import EmptyState from '../components/admin/EmptyState';

const STATUS_TABS = [
    { value: 'pending', label: 'Pending approval' },
    { value: 'sent', label: 'Sent · awaiting payment' },
    { value: 'paid', label: 'Paid' },
    { value: 'waived', label: 'Waived' },
];

const BREADCRUMB = [
    { label: 'Settings', to: '/admin/settings' },
    { label: 'Booking charges' },
];

function formatUsd(cents) {
    return (Number(cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDate(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
}

export default function AdminBookingChargeQueue() {
    const { isAuthenticated, hasRole } = useAdmin();
    const [activeTab, setActiveTab] = useState('pending');
    const [charges, setCharges] = useState([]);
    const [loading, setLoading] = useState(false);
    const [errorText, setErrorText] = useState('');
    const [busyId, setBusyId] = useState(null);

    // Modal state
    const [waiveOpen, setWaiveOpen] = useState(null);   // { chargeId } | null
    const [waiveReason, setWaiveReason] = useState('');
    const [paidOpen, setPaidOpen] = useState(null);     // { chargeId } | null
    const [paymentMethod, setPaymentMethod] = useState('venmo');
    const [paymentReference, setPaymentReference] = useState('');

    const canManage = typeof hasRole === 'function' && hasRole('manager');

    const load = useCallback(async (statusFilter = activeTab) => {
        setLoading(true);
        setErrorText('');
        try {
            const res = await fetch(
                `/api/admin/booking-charges?status=${encodeURIComponent(statusFilter)}`,
                { credentials: 'include', cache: 'no-store' },
            );
            if (!res.ok) {
                if (res.status === 403) setErrorText('You do not have permission to view booking charges.');
                else setErrorText(`Failed to load (${res.status})`);
                setCharges([]);
                return;
            }
            const data = await res.json();
            setCharges(data.charges || []);
        } catch (err) {
            setErrorText(err?.message || 'Network error');
            setCharges([]);
        } finally {
            setLoading(false);
        }
    }, [activeTab]);

    useEffect(() => { if (isAuthenticated) load(activeTab); }, [isAuthenticated, activeTab, load]);

    if (!isAuthenticated) return null;

    async function approve(chargeId) {
        setBusyId(chargeId);
        try {
            const res = await fetch(`/api/admin/booking-charges/${encodeURIComponent(chargeId)}/approve`, {
                method: 'POST',
                credentials: 'include',
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setErrorText(body.error || `Approve failed (${res.status})`);
                return;
            }
            await load(activeTab);
        } finally {
            setBusyId(null);
        }
    }

    async function submitWaive() {
        if (!waiveOpen || !waiveReason.trim()) return;
        setBusyId(waiveOpen.chargeId);
        try {
            const res = await fetch(`/api/admin/booking-charges/${encodeURIComponent(waiveOpen.chargeId)}/waive`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: waiveReason.trim() }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setErrorText(body.error || `Waive failed (${res.status})`);
                return;
            }
            setWaiveOpen(null);
            setWaiveReason('');
            await load(activeTab);
        } finally {
            setBusyId(null);
        }
    }

    async function submitMarkPaid() {
        if (!paidOpen || !paymentMethod.trim()) return;
        setBusyId(paidOpen.chargeId);
        try {
            const res = await fetch(`/api/admin/booking-charges/${encodeURIComponent(paidOpen.chargeId)}/mark-paid`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paymentMethod: paymentMethod.trim(),
                    paymentReference: paymentReference.trim() || undefined,
                }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setErrorText(body.error || `Mark-paid failed (${res.status})`);
                return;
            }
            setPaidOpen(null);
            setPaymentMethod('venmo');
            setPaymentReference('');
            await load(activeTab);
        } finally {
            setBusyId(null);
        }
    }

    return (
        <div style={page}>
            <AdminPageHeader
                title="Booking charges"
                description="Review damage / lost-equipment charges queued from event-day mode. Approve sends the customer a payment link; waive cancels with a reason."
                breadcrumb={BREADCRUMB}
            />

            <nav style={tabs} role="tablist" aria-label="Charge status">
                {STATUS_TABS.map((tab) => (
                    <button
                        key={tab.value}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === tab.value}
                        onClick={() => setActiveTab(tab.value)}
                        style={activeTab === tab.value ? tabActive : tab}
                    >
                        {tab.label}
                    </button>
                ))}
            </nav>

            {errorText && <div style={errorBanner}>{errorText}</div>}

            {loading && charges.length === 0 && <p style={muted}>Loading…</p>}

            {!loading && charges.length === 0 && (
                <EmptyState
                    title={`No ${STATUS_TABS.find((t) => t.value === activeTab)?.label.toLowerCase() || ''} charges`}
                    description="Charges show up here when a Lead Marshal records damage or lost equipment in event-day mode."
                />
            )}

            {charges.length > 0 && (
                <div style={tableBox}>
                    <table style={table}>
                        <thead>
                            <tr>
                                <th style={th}>Customer</th>
                                <th style={th}>Item</th>
                                <th style={th}>Reason</th>
                                <th style={thRight}>Amount</th>
                                <th style={th}>Status</th>
                                <th style={th}>Created</th>
                                <th style={th}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {charges.map((c) => (
                                <tr key={c.id} style={tr}>
                                    <td style={td}>
                                        <div>{c.booking?.fullName || '—'}</div>
                                        <div style={mutedSmall}>{c.booking?.email || ''}</div>
                                    </td>
                                    <td style={td}>{c.item?.name || '—'}{c.item?.sku ? ` (${c.item.sku})` : ''}</td>
                                    <td style={td}>{c.reasonKind}</td>
                                    <td style={tdRight}>{formatUsd(c.amountCents)}</td>
                                    <td style={td}>
                                        <span style={statusPill(c.status)}>{c.status}</span>
                                        {c.approvalRequired && c.status === 'pending' && (
                                            <span style={pillNeed}> needs review</span>
                                        )}
                                    </td>
                                    <td style={td}>{formatDate(c.createdAt)}</td>
                                    <td style={td}>
                                        {canManage && c.status === 'pending' && (
                                            <button
                                                type="button"
                                                onClick={() => approve(c.id)}
                                                disabled={busyId === c.id}
                                                style={btnPrimary}
                                            >
                                                Approve
                                            </button>
                                        )}
                                        {canManage && (c.status === 'pending' || c.status === 'sent') && (
                                            <button
                                                type="button"
                                                onClick={() => setWaiveOpen({ chargeId: c.id })}
                                                disabled={busyId === c.id}
                                                style={btnSecondary}
                                            >
                                                Waive
                                            </button>
                                        )}
                                        {canManage && c.status === 'sent' && (
                                            <button
                                                type="button"
                                                onClick={() => setPaidOpen({ chargeId: c.id })}
                                                disabled={busyId === c.id}
                                                style={btnSecondary}
                                            >
                                                Mark paid
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {waiveOpen && (
                <div style={modalBackdrop} onClick={() => !busyId && setWaiveOpen(null)}>
                    <div style={modal} onClick={(e) => e.stopPropagation()}>
                        <h2 style={modalTitle}>Waive charge</h2>
                        <p style={modalCopy}>
                            Send the customer the additional_charge_waived email. They will not be charged.
                        </p>
                        <label style={modalLabel}>
                            Reason
                            <textarea
                                value={waiveReason}
                                onChange={(e) => setWaiveReason(e.target.value)}
                                rows={3}
                                style={textarea}
                                placeholder="e.g. Equipment showed prior wear; charge was issued in error."
                            />
                        </label>
                        <div style={modalActions}>
                            <button
                                type="button"
                                onClick={() => setWaiveOpen(null)}
                                disabled={!!busyId}
                                style={btnSecondary}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={submitWaive}
                                disabled={!!busyId || !waiveReason.trim()}
                                style={btnPrimary}
                            >
                                Waive charge
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {paidOpen && (
                <div style={modalBackdrop} onClick={() => !busyId && setPaidOpen(null)}>
                    <div style={modal} onClick={(e) => e.stopPropagation()}>
                        <h2 style={modalTitle}>Record manual payment</h2>
                        <p style={modalCopy}>
                            Records that the customer paid out-of-band (Venmo / cash / etc.) and sends the receipt email.
                        </p>
                        <label style={modalLabel}>
                            Payment method
                            <select
                                value={paymentMethod}
                                onChange={(e) => setPaymentMethod(e.target.value)}
                                style={input}
                            >
                                <option value="venmo">Venmo</option>
                                <option value="paypal">PayPal</option>
                                <option value="cash">Cash</option>
                                <option value="check">Check</option>
                                <option value="other">Other</option>
                            </select>
                        </label>
                        <label style={modalLabel}>
                            Reference (optional)
                            <input
                                type="text"
                                value={paymentReference}
                                onChange={(e) => setPaymentReference(e.target.value)}
                                style={input}
                                placeholder="@user123 / check #4501 / etc."
                            />
                        </label>
                        <div style={modalActions}>
                            <button
                                type="button"
                                onClick={() => setPaidOpen(null)}
                                disabled={!!busyId}
                                style={btnSecondary}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={submitMarkPaid}
                                disabled={!!busyId || !paymentMethod}
                                style={btnPrimary}
                            >
                                Record payment
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const page = { maxWidth: 1200, margin: '0 auto', padding: '2rem' };
const tabs = { display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--color-border)' };
const tab = { padding: '10px 16px', background: 'transparent', color: 'var(--cream)', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' };
const tabActive = { ...tab, color: 'var(--orange)', borderBottom: '2px solid var(--orange)' };
const errorBanner = { padding: '10px 14px', background: 'var(--color-error-soft, rgba(220, 38, 38, 0.12))', border: '1px solid var(--color-error, #dc2626)', color: 'var(--cream)', fontSize: 13, borderRadius: 4, marginBottom: 16 };
const muted = { color: 'var(--olive-light, #888)', textAlign: 'center', padding: 20 };
const mutedSmall = { color: 'var(--olive-light, #888)', fontSize: 11 };
const tableBox = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem', overflowX: 'auto' };
const table = { width: '100%', borderCollapse: 'collapse' };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const thRight = { ...th, textAlign: 'right' };
const tr = { borderBottom: '1px solid var(--color-border-subtle)' };
const td = { padding: '10px 12px', fontSize: 13, color: 'var(--cream)', verticalAlign: 'middle' };
const tdRight = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const btnPrimary = { padding: '6px 12px', background: 'var(--orange)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', borderRadius: 3, marginRight: 6 };
const btnSecondary = { padding: '6px 12px', background: 'transparent', color: 'var(--cream)', border: '1px solid var(--color-border-strong)', cursor: 'pointer', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', borderRadius: 3, marginRight: 6 };
const pillNeed = { fontSize: 10, color: 'var(--color-warning, #d97706)', marginLeft: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 };
const modalBackdrop = { position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal = { background: 'var(--mid)', border: '1px solid var(--color-border-strong)', padding: '1.75rem', borderRadius: 6, maxWidth: 480, width: '100%' };
const modalTitle = { margin: 0, color: 'var(--cream)', fontSize: 18, fontWeight: 800, marginBottom: 12 };
const modalCopy = { color: 'var(--tan-light, #ccc)', fontSize: 13, lineHeight: 1.55, marginBottom: 16 };
const modalLabel = { display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--tan-light, #ccc)', fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 };
const textarea = { padding: '10px 12px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' };
const input = { padding: '10px 12px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 13 };
const modalActions = { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 };

function statusPill(status) {
    const base = { padding: '2px 8px', fontSize: 10, fontWeight: 800, letterSpacing: 1, borderRadius: 3, textTransform: 'uppercase' };
    if (status === 'pending') return { ...base, background: 'rgba(217, 119, 6, 0.16)', color: '#d97706' };
    if (status === 'sent') return { ...base, background: 'rgba(255, 136, 0, 0.16)', color: 'var(--orange)' };
    if (status === 'paid') return { ...base, background: 'rgba(95, 186, 95, 0.16)', color: '#5fba5f' };
    if (status === 'waived') return { ...base, background: 'rgba(136, 136, 136, 0.16)', color: '#888' };
    return base;
}

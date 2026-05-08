// M5 R11 — 1099 thresholds rollup view (Surface 4b).
//
// Bookkeeper-facing page that shows per-recipient 1099 totals for a tax
// year, IRS threshold status, and lock controls. Year selector spans
// the current calendar year + 3 prior. Locked years show a banner and
// suppress the "Lock Year" button; export remains available.
//
// All state-changing endpoints are capability-gated server-side
// (staff.thresholds_1099.{read,export,lock_year}). The UI optimistically
// shows manager+ controls; server returns 403 to anyone lacking the
// specific cap.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader';
import EmptyState from '../components/admin/EmptyState';

// Build the year-selector options once at module load. Current year
// plus the previous three. Cron auto-locks the previous year on
// March 1; older years are typically already locked.
function buildYearOptions(now = new Date()) {
    const current = now.getUTCFullYear();
    return [current, current - 1, current - 2, current - 3];
}

function formatUsd(cents) {
    const n = Number(cents || 0) / 100;
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatLockedAt(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
    });
}

function lockReasonLabel(reason) {
    if (reason === 'manual_close') return 'Manual close';
    if (reason === 'auto_march_1') return 'Auto-locked March 1';
    return reason || 'Locked';
}

const BREADCRUMB = [
    { label: 'Settings', to: '/admin/settings' },
    { label: 'Staff', to: '/admin/staff' },
    { label: '1099 Thresholds' },
];

export default function AdminStaff1099Thresholds() {
    const { isAuthenticated, hasRole } = useAdmin();
    const yearOptions = useMemo(() => buildYearOptions(), []);
    const [taxYear, setTaxYear] = useState(yearOptions[0]);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [lockOpen, setLockOpen] = useState(false);
    const [lockNotes, setLockNotes] = useState('');
    const [lockSubmitting, setLockSubmitting] = useState(false);

    const canManage = typeof hasRole === 'function' && hasRole('manager');

    const load = useCallback(async () => {
        setLoading(true);
        setErr('');
        try {
            const res = await fetch(`/api/admin/1099-thresholds?tax_year=${taxYear}`, {
                credentials: 'include',
                cache: 'no-store',
            });
            if (!res.ok) {
                if (res.status === 403) {
                    setErr('You do not have permission to view 1099 thresholds.');
                } else {
                    setErr(`Failed to load (${res.status})`);
                }
                setData(null);
                return;
            }
            setData(await res.json());
        } catch (e) {
            setErr(e?.message || 'Failed to load');
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [taxYear]);

    useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

    if (!isAuthenticated) return null;

    const isLocked = Boolean(data?.locked);
    const recipients = data?.recipients || [];
    const requiringCount = recipients.filter((r) => r.requires1099).length;

    async function submitLock() {
        setLockSubmitting(true);
        try {
            const res = await fetch('/api/admin/1099-thresholds/lock-year', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taxYear, notes: lockNotes || null }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setErr(body.error || `Lock failed (${res.status})`);
                return;
            }
            setLockOpen(false);
            setLockNotes('');
            await load();
        } finally {
            setLockSubmitting(false);
        }
    }

    function exportCsv() {
        // Direct navigation triggers Content-Disposition download. No fetch
        // needed — the route is auth-cookie + capability gated like the
        // rollup endpoint.
        window.location.href = `/api/admin/1099-thresholds/export?tax_year=${taxYear}`;
    }

    const primaryAction = canManage && !isLocked
        ? <button onClick={() => setLockOpen(true)} style={lockBtn}>Lock Year</button>
        : null;
    const secondaryActions = canManage
        ? <button onClick={exportCsv} style={exportBtn}>Export CSV</button>
        : null;

    return (
        <div style={page}>
            <AdminPageHeader
                title="1099 Thresholds"
                description="Per-recipient 1099 totals against the IRS $600 1099-NEC reporting threshold."
                breadcrumb={BREADCRUMB}
                primaryAction={primaryAction}
                secondaryActions={secondaryActions}
            />

            <div style={controls}>
                <label style={ctrlLabel}>
                    Tax year
                    <select
                        value={taxYear}
                        onChange={(e) => setTaxYear(Number(e.target.value))}
                        style={select}
                    >
                        {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                </label>
                <div style={summary}>
                    <span style={summaryItem}>
                        <strong>{recipients.length}</strong> recipients
                    </span>
                    <span style={summaryItem}>
                        <strong style={{ color: 'var(--orange)' }}>{requiringCount}</strong> require 1099-NEC
                    </span>
                </div>
            </div>

            {isLocked && (
                <div style={lockedBanner}>
                    <strong>Year {taxYear} is locked.</strong>
                    {' '}
                    {lockReasonLabel(data?.locked_reason)}
                    {data?.locked_at ? ` on ${formatLockedAt(data.locked_at)}.` : '.'}
                    {' No further labor entries can be created or modified for this year.'}
                </div>
            )}

            {err && <div style={errorBanner}>{err}</div>}

            <div style={tableBox}>
                <table style={table}>
                    <thead>
                        <tr>
                            <th style={th}>Recipient</th>
                            <th style={th}>Legal Name</th>
                            <th style={th}>EIN</th>
                            <th style={th}>Email</th>
                            <th style={thRight}>1099 Total</th>
                            <th style={thRight}>W-2 Total</th>
                            <th style={thRight}>Entries</th>
                            <th style={th}>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={8} style={loadingCell}>Loading…</td></tr>
                        )}
                        {!loading && recipients.length === 0 && (
                            <tr><td colSpan={8} style={emptyCell}>
                                <EmptyState
                                    title={`No labor entries for ${taxYear}`}
                                    description="Once labor entries are recorded for this tax year they will roll up here."
                                />
                            </td></tr>
                        )}
                        {!loading && recipients.map((r) => (
                            <tr key={r.personId} style={tr}>
                                <td style={td}>{r.fullName}</td>
                                <td style={td}>{r.legalName || <span style={muted}>—</span>}</td>
                                <td style={td}>{r.ein ? <code style={mono}>{r.ein}</code> : <span style={muted}>—</span>}</td>
                                <td style={td}>{r.email || <span style={muted}>—</span>}</td>
                                <td style={tdRight}>{formatUsd(r.total1099Cents)}</td>
                                <td style={tdRight}>{formatUsd(r.totalW2Cents)}</td>
                                <td style={tdRight}>{r.entryCount}</td>
                                <td style={td}>
                                    {r.requires1099
                                        ? <span style={pillReq}>Requires 1099-NEC</span>
                                        : <span style={pillBelow}>Below threshold</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {lockOpen && (
                <div style={modalBackdrop} onClick={() => !lockSubmitting && setLockOpen(false)}>
                    <div style={modal} onClick={(e) => e.stopPropagation()}>
                        <h2 style={modalTitle}>Lock tax year {taxYear}</h2>
                        <p style={modalCopy}>
                            Locking this year prevents further labor entries from being created or
                            modified. Snapshot totals are captured at lock time. You can attach an
                            internal note explaining why the year is being closed.
                        </p>
                        <label style={modalLabel}>
                            Notes (optional)
                            <textarea
                                value={lockNotes}
                                onChange={(e) => setLockNotes(e.target.value)}
                                rows={3}
                                style={textarea}
                                placeholder="e.g. Annual close after CPA review."
                            />
                        </label>
                        <div style={modalActions}>
                            <button
                                onClick={() => setLockOpen(false)}
                                disabled={lockSubmitting}
                                style={cancelBtn}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={submitLock}
                                disabled={lockSubmitting}
                                style={confirmBtn}
                            >
                                {lockSubmitting ? 'Locking…' : `Lock ${taxYear}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const page = { maxWidth: 1200, margin: '0 auto', padding: '2rem' };
const controls = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginTop: 16, marginBottom: 16, flexWrap: 'wrap' };
const ctrlLabel = { display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--tan-light)', fontSize: 'var(--font-size-xs)', fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase' };
const select = { padding: '8px 14px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 'var(--font-size-sm)', minWidth: 140 };
const summary = { display: 'flex', gap: 18, alignItems: 'center' };
const summaryItem = { color: 'var(--cream)', fontSize: 'var(--font-size-sm)' };
const lockBtn = { padding: '10px 20px', background: 'var(--orange)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-xs)', fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', borderRadius: 4 };
const exportBtn = { padding: '10px 20px', background: 'transparent', color: 'var(--cream)', border: '1px solid var(--color-border-strong)', cursor: 'pointer', fontSize: 'var(--font-size-xs)', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', borderRadius: 4 };
const lockedBanner = { padding: '12px 16px', background: 'var(--color-warning-soft, rgba(255, 165, 0, 0.12))', border: '1px solid var(--color-warning, #d97706)', color: 'var(--cream)', fontSize: 'var(--font-size-sm)', borderRadius: 4, marginBottom: 16 };
const errorBanner = { padding: '10px 14px', background: 'var(--color-error-soft, rgba(220, 38, 38, 0.12))', border: '1px solid var(--color-error, #dc2626)', color: 'var(--cream)', fontSize: 'var(--font-size-sm)', borderRadius: 4, marginBottom: 16 };
const tableBox = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem', overflowX: 'auto' };
const table = { width: '100%', borderCollapse: 'collapse' };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--color-border-strong)', color: 'var(--orange)', fontSize: 'var(--font-size-xs)', fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const thRight = { ...th, textAlign: 'right' };
const tr = { borderBottom: '1px solid var(--color-border-subtle)' };
const td = { padding: '10px 12px', fontSize: 'var(--font-size-sm)', color: 'var(--cream)', verticalAlign: 'middle' };
const tdRight = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const muted = { color: 'var(--olive-light)' };
const mono = { fontFamily: 'ui-monospace, monospace', fontSize: 'var(--font-size-xs)', color: 'var(--tan-light)' };
const loadingCell = { padding: 20, textAlign: 'center', color: 'var(--olive-light)', fontStyle: 'italic' };
const emptyCell = { padding: 20, textAlign: 'center' };
const pillReq = { padding: '2px 8px', background: 'var(--color-accent-soft, rgba(255, 100, 0, 0.16))', color: 'var(--orange)', fontSize: 'var(--font-size-xs)', fontWeight: 800, letterSpacing: 1, borderRadius: 3, textTransform: 'uppercase' };
const pillBelow = { padding: '2px 8px', background: 'var(--color-bg-sunken, rgba(255,255,255,0.04))', color: 'var(--color-text-subtle, var(--olive-light))', fontSize: 'var(--font-size-xs)', fontWeight: 700, borderRadius: 3 };
const modalBackdrop = { position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal = { background: 'var(--mid)', border: '1px solid var(--color-border-strong)', padding: '1.75rem', borderRadius: 6, maxWidth: 480, width: '100%' };
const modalTitle = { margin: 0, color: 'var(--cream)', fontSize: 'var(--font-size-lg)', fontWeight: 800, marginBottom: 12 };
const modalCopy = { color: 'var(--tan-light)', fontSize: 'var(--font-size-sm)', lineHeight: 1.55, marginBottom: 16 };
const modalLabel = { display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--tan-light)', fontSize: 'var(--font-size-xs)', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' };
const textarea = { padding: '10px 12px', background: 'var(--dark)', border: '1px solid var(--color-border-strong)', color: 'var(--cream)', fontSize: 'var(--font-size-sm)', resize: 'vertical', fontFamily: 'inherit' };
const modalActions = { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 };
const cancelBtn = { padding: '10px 18px', background: 'transparent', color: 'var(--cream)', border: '1px solid var(--color-border-strong)', cursor: 'pointer', fontSize: 'var(--font-size-xs)', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', borderRadius: 4 };
const confirmBtn = { padding: '10px 18px', background: 'var(--orange)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-xs)', fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', borderRadius: 4 };

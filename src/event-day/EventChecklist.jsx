// M5 Batch 15 — Event-day checklist (Surface 5).
// R15: rewired from local React state ("fake demo") to actual D1
// persistence via /api/event-day/checklists. Each toggle hits the
// backend; the parent checklist's completed_at is recomputed
// server-side.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEventDay } from './EventDayLayout.jsx';

export default function EventChecklist() {
    const { activeEvent } = useEventDay();
    const [checklists, setChecklists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorText, setErrorText] = useState('');
    const [busyItemIds, setBusyItemIds] = useState(new Set());

    const load = useCallback(async () => {
        setLoading(true);
        setErrorText('');
        try {
            const res = await fetch('/api/event-day/checklists', {
                credentials: 'include',
                cache: 'no-store',
            });
            if (!res.ok) {
                setErrorText(`Failed to load (${res.status})`);
                setChecklists([]);
                return;
            }
            const data = await res.json();
            setChecklists(data.checklists || []);
        } catch (err) {
            setErrorText(err?.message || 'Network error');
            setChecklists([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (activeEvent?.id) load();
        else setLoading(false);
    }, [activeEvent, load]);

    async function toggle(checklistId, item) {
        const itemId = item.id;
        const newDone = !item.doneAt;

        setBusyItemIds((prev) => {
            const next = new Set(prev);
            next.add(itemId);
            return next;
        });

        // Optimistic update for snappier UX.
        setChecklists((prev) => prev.map((cl) => {
            if (cl.id !== checklistId) return cl;
            return {
                ...cl,
                items: cl.items.map((i) => i.id === itemId
                    ? { ...i, doneAt: newDone ? Date.now() : null }
                    : i),
            };
        }));

        try {
            const res = await fetch(
                `/api/event-day/checklists/${encodeURIComponent(checklistId)}/items/${encodeURIComponent(itemId)}/toggle`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ done: newDone }),
                },
            );
            if (!res.ok) {
                // Roll back the optimistic update.
                await load();
                const data = await res.json().catch(() => ({}));
                setErrorText(data.error || `Toggle failed (${res.status})`);
                return;
            }
            const data = await res.json();
            // Patch the parent checklist's completedAt with the server's authoritative value.
            setChecklists((prev) => prev.map((cl) => {
                if (cl.id !== checklistId) return cl;
                return {
                    ...cl,
                    completedAt: data.checklistCompletedAt,
                    items: cl.items.map((i) => i.id === itemId
                        ? { ...i, doneAt: data.item?.doneAt ?? (newDone ? Date.now() : null) }
                        : i),
                };
            }));
        } catch (err) {
            await load();
            setErrorText(err?.message || 'Network error');
        } finally {
            setBusyItemIds((prev) => {
                const next = new Set(prev);
                next.delete(itemId);
                return next;
            });
        }
    }

    if (!activeEvent) {
        return (
            <div>
                <Link to="/event" style={back}>← Back</Link>
                <h1 style={h1}>Event Checklist</h1>
                <p style={muted}>No active event today.</p>
            </div>
        );
    }

    return (
        <div>
            <Link to="/event" style={back}>← Back</Link>
            <h1 style={h1}>Event Checklist</h1>

            {loading && <p style={muted}>Loading…</p>}
            {!loading && errorText && (
                <p style={errText}>{errorText} <button type="button" onClick={load} style={inlineBtn}>Retry</button></p>
            )}

            {!loading && checklists.length === 0 && (
                <p style={muted}>No checklists for this event yet.</p>
            )}

            {checklists.map((cl) => {
                const total = cl.items.length;
                const done = cl.items.filter((i) => i.doneAt).length;
                return (
                    <section key={cl.id} style={cl.completedAt ? clCardDone : clCard}>
                        <header style={clHeader}>
                            <h2 style={clTitle}>{cl.title}</h2>
                            <span style={clProgress}>
                                {done} / {total}
                                {cl.completedAt && ' ✓'}
                            </span>
                        </header>
                        {cl.roleKey && (
                            <p style={clRole}>Owner role: <code style={{ fontFamily: 'monospace' }}>{cl.roleKey}</code></p>
                        )}
                        {cl.items.map((item) => {
                            const isBusy = busyItemIds.has(item.id);
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => toggle(cl.id, item)}
                                    disabled={isBusy}
                                    style={item.doneAt ? itemRowDone : itemRow}
                                    aria-pressed={!!item.doneAt}
                                >
                                    <span style={{ fontSize: 24, marginRight: 12 }}>{item.doneAt ? '☑' : '☐'}</span>
                                    <span style={{ fontSize: 15, flex: 1, textAlign: 'left' }}>
                                        {item.label}
                                        {!item.required && <span style={optionalTag}> (optional)</span>}
                                    </span>
                                    {item.doneAt && (
                                        <span style={{ fontSize: 11, color: '#888' }}>
                                            {new Date(item.doneAt).toLocaleTimeString()}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </section>
                );
            })}
        </div>
    );
}

const back = { color: '#ff8800', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'none' };
const h1 = { fontSize: 28, fontWeight: 900, margin: '12px 0 24px' };
const muted = { color: '#888', fontSize: 13, marginTop: 16 };
const errText = { color: '#ff5050', fontSize: 13, marginBottom: 12 };
const inlineBtn = { background: 'transparent', border: '1px solid #ff5050', color: '#ff5050', padding: '4px 10px', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', marginLeft: 8 };
const clCard = { background: '#1a1a1a', border: '1px solid #333', padding: 16, marginBottom: 16, borderRadius: 4 };
const clCardDone = { ...clCard, border: '1px solid #5fba5f', background: '#0a2a0a' };
const clHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 };
const clTitle = { fontSize: 18, fontWeight: 800, margin: 0 };
const clProgress = { fontSize: 13, fontWeight: 700, color: '#ff8800', letterSpacing: 1 };
const clRole = { fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: 1, marginTop: 0, marginBottom: 12 };
const itemRow = { width: '100%', background: '#0a0a0a', border: '1px solid #444', padding: '14px 12px', marginBottom: 6, borderRadius: 3, color: '#fff', display: 'flex', alignItems: 'center', cursor: 'pointer', minHeight: 56, fontSize: 15 };
const itemRowDone = { ...itemRow, background: '#062a06', border: '1px solid #5fba5f', color: '#bef0be' };
const optionalTag = { color: '#888', fontSize: 12, marginLeft: 8 };

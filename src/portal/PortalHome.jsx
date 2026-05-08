// M5 Batch 6b — Portal home (Surface 4a part 4).
// Three sections per Surface 4a: Upcoming events / Documents to acknowledge /
// Your account. M5 ships the Documents + Account sections; events tile is a
// link-only stub (full event-day mode lands in Batches 12-15).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePortal } from './PortalLayout.jsx';

export default function PortalHome() {
    const { person } = usePortal();
    const [docCount, setDocCount] = useState({ total: 0, unacknowledged: 0 });

    useEffect(() => {
        (async () => {
            const res = await fetch('/api/portal/documents', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                const ackedDocIds = new Set((data.acknowledged || []).map((a) => a.documentId));
                const unacked = (data.documents || []).filter((d) => !ackedDocIds.has(d.id));
                setDocCount({ total: (data.documents || []).length, unacknowledged: unacked.length });
            }
        })();
    }, []);

    if (!person) {
        return (
            <div>
                <h1 style={h1}>Welcome</h1>
                <p>You're not signed in. Use the magic link sent to your email to access the portal.</p>
            </div>
        );
    }

    return (
        <div>
            <h1 style={h1}>Hi, {person.full_name?.split(' ')[0] || 'there'}!</h1>
            <p style={subtitle}>Your hub for events, documents, and account info.</p>

            <div style={tileGrid}>
                <Link to="/portal/documents" style={tile}>
                    <div style={tileTitle}>Documents</div>
                    <div style={tileBody}>
                        {docCount.total === 0 && <span>No documents assigned.</span>}
                        {docCount.total > 0 && (
                            <>
                                <strong>{docCount.total}</strong> assigned to your role
                                {docCount.unacknowledged > 0 && (
                                    <>, <span style={alertText}>{docCount.unacknowledged} waiting on your acknowledgment</span></>
                                )}
                            </>
                        )}
                    </div>
                </Link>

                <Link to="/portal/account" style={tile}>
                    <div style={tileTitle}>Your account</div>
                    <div style={tileBody}>Update your contact info, view profile.</div>
                </Link>

                <div style={{ ...tile, opacity: 0.6, cursor: 'default' }}>
                    <div style={tileTitle}>Upcoming events</div>
                    <div style={tileBody}>Coming with event-day mode (M5 Batch 12+).</div>
                </div>
            </div>
        </div>
    );
}

const h1 = { fontSize: 32, fontWeight: 900, letterSpacing: '-1px', color: 'var(--cream)', margin: '0 0 8px' };
const subtitle = { color: 'var(--tan-light)', fontSize: 14, marginBottom: 24 };
const tileGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 24 };
const tile = {
    background: 'var(--mid)',
    border: '1px solid var(--color-border)',
    padding: '1.5rem',
    textDecoration: 'none',
    color: 'var(--cream)',
    display: 'block',
};
const tileTitle = { fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--cream)', marginBottom: 8 };
const tileBody = { fontSize: 13, color: 'var(--tan-light)', lineHeight: 1.5 };
const alertText = { color: 'var(--color-warning)', fontWeight: 700 };

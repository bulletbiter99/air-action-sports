// M5 Batch 6b — Portal documents (list + detail with policy ack flow).
//
// Two modes:
//   /portal/documents      — list of docs assigned to my primary role
//   /portal/documents/:id  — single doc body + ack button (if not acked)

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';

export default function PortalDocument() {
    const { id } = useParams();
    return id ? <DocumentDetail id={id} /> : <DocumentList />;
}

function DocumentList() {
    const [data, setData] = useState({ documents: [], acknowledged: [] });
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/portal/documents', { credentials: 'include', cache: 'no-store' });
            if (res.ok) setData(await res.json());
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const acked = new Set(data.acknowledged.map((a) => a.documentId));

    return (
        <div>
            <h1 style={h1}>Documents</h1>
            <p style={subtitle}>Tagged to your role. Required policies must be acknowledged before working an event.</p>

            {loading && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}
            {!loading && data.documents.length === 0 && (
                <p style={{ color: 'var(--olive-light)', fontStyle: 'italic' }}>No documents tagged for your role yet.</p>
            )}
            {!loading && data.documents.map((d) => {
                const isAcked = acked.has(d.id);
                return (
                    <Link key={d.id} to={`/portal/documents/${d.id}`} style={card}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                            <div>
                                <div style={cardTitle}>
                                    <span style={kindPill}>{d.kind.toUpperCase()}</span>
                                    {' '}
                                    {d.title}
                                </div>
                                <div style={cardMeta}>{d.version}</div>
                            </div>
                            <div>
                                {d.required && !isAcked && <span style={requiredPill}>Action needed</span>}
                                {isAcked && <span style={ackedPill}>Acknowledged</span>}
                            </div>
                        </div>
                        {d.description && <div style={cardDesc}>{d.description}</div>}
                    </Link>
                );
            })}
        </div>
    );
}

function DocumentDetail({ id }) {
    const navigate = useNavigate();
    const [doc, setDoc] = useState(null);
    const [acked, setAcked] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        const docRes = await fetch(`/api/portal/documents/${id}`, { credentials: 'include' });
        if (docRes.ok) setDoc(await docRes.json());
        else { navigate('/portal/documents'); return; }

        // Determine ack status by re-fetching the list
        const listRes = await fetch('/api/portal/documents', { credentials: 'include' });
        if (listRes.ok) {
            const list = await listRes.json();
            const found = list.acknowledged.find((a) => a.documentId === id);
            setAcked(found || null);
        }
    }, [id, navigate]);

    useEffect(() => { load(); }, [load]);

    async function ack() {
        setError(null);
        setSubmitting(true);
        try {
            const res = await fetch(`/api/portal/documents/${id}/ack`, { method: 'POST', credentials: 'include' });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                await load();
            } else {
                setError(data.error || 'Acknowledgment failed');
            }
        } finally { setSubmitting(false); }
    }

    if (!doc) return <div><p style={{ color: 'var(--olive-light)' }}>Loading…</p></div>;

    return (
        <div>
            <Link to="/portal/documents" style={breadcrumb}>← All documents</Link>
            <h1 style={h1}>
                <span style={kindPill}>{doc.kind.toUpperCase()}</span> {doc.title}
            </h1>
            <p style={subtitle}>Version {doc.version}</p>

            <article style={article}>
                <pre style={preBody}>{doc.bodyHtml}</pre>
            </article>

            <div style={ackBox}>
                {acked ? (
                    <p style={{ color: 'var(--color-success)' }}>
                        <strong>✓ Acknowledged</strong> on {new Date(acked.acknowledgedAt).toLocaleString()}
                        — version {acked.version}
                    </p>
                ) : (
                    <>
                        <p style={{ color: 'var(--cream)' }}>
                            By acknowledging, you confirm you have read and will comply with this document.
                        </p>
                        <button type="button" onClick={ack} disabled={submitting} style={ackBtn}>
                            {submitting ? 'Submitting…' : 'I acknowledge this document'}
                        </button>
                        {error && <p style={errText}>{error}</p>}
                    </>
                )}
            </div>
        </div>
    );
}

const h1 = { fontSize: 28, fontWeight: 900, letterSpacing: '-1px', color: 'var(--cream)', margin: '0 0 8px' };
const subtitle = { color: 'var(--tan-light)', fontSize: 13, marginBottom: 24 };
const breadcrumb = { color: 'var(--orange)', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'none' };
const card = {
    display: 'block', background: 'var(--mid)', border: '1px solid var(--color-border)',
    padding: '1rem 1.25rem', marginBottom: 12, textDecoration: 'none', color: 'var(--cream)',
};
const cardTitle = { fontSize: 14, fontWeight: 700, color: 'var(--cream)', marginBottom: 4 };
const cardMeta = { fontSize: 11, color: 'var(--olive-light)' };
const cardDesc = { fontSize: 12, color: 'var(--tan-light)', marginTop: 8 };
const kindPill = { padding: '2px 8px', background: 'var(--color-accent-soft)', color: 'var(--orange)', fontSize: 9, fontWeight: 800, letterSpacing: 1, borderRadius: 3 };
const requiredPill = { padding: '4px 10px', background: 'var(--color-warning-soft)', color: 'var(--color-warning)', fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', borderRadius: 3 };
const ackedPill = { padding: '4px 10px', background: 'var(--color-success-soft)', color: 'var(--color-success)', fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', borderRadius: 3 };
const article = { background: 'var(--mid)', border: '1px solid var(--color-border)', padding: '1.5rem', marginBottom: 24 };
const preBody = { whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--cream)', fontSize: 14, fontFamily: 'inherit', lineHeight: 1.6 };
const ackBox = { background: 'var(--mid)', border: '1px solid var(--color-border-strong)', padding: '1.5rem', textAlign: 'center' };
const ackBtn = { padding: '12px 32px', background: 'var(--orange)', color: 'white', border: 0, fontSize: 13, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', marginTop: 12 };
const errText = { color: 'var(--color-danger)', fontSize: 13, marginTop: 8 };

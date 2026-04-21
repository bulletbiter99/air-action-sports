import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function VendorDashboard() {
    const navigate = useNavigate();
    const [contact, setContact] = useState(null);
    const [packages, setPackages] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const meRes = await fetch('/api/vendor/auth/me', { credentials: 'include', cache: 'no-store' });
            const me = await meRes.json();
            if (!meRes.ok || !me.contact) { if (!cancelled) navigate('/vendor/login'); return; }
            const pkgRes = await fetch('/api/vendor/auth/my-packages', { credentials: 'include', cache: 'no-store' });
            const pkg = await pkgRes.json();
            if (cancelled) return;
            setContact(me.contact);
            setPackages(pkg.packages || []);
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [navigate]);

    const logout = async () => {
        await fetch('/api/vendor/auth/logout', { method: 'POST', credentials: 'include' });
        navigate('/vendor/login');
    };

    if (loading) return <div style={shell}><p style={{ color: '#888', padding: 40 }}>Loading…</p></div>;

    return (
        <div style={shell}>
            <header style={header}>
                <div style={brand}>▶ AIR ACTION SPORTS · VENDOR</div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ color: '#c8b89a', fontSize: 13 }}>{contact?.name} · {contact?.email}</span>
                    <button onClick={logout} style={{ padding: '6px 14px', background: 'transparent', color: '#c8b89a', border: '1px solid #444', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' }}>
                        Log out
                    </button>
                </div>
            </header>
            <main style={main}>
                <h1 style={{ color: '#fff', fontWeight: 900, textTransform: 'uppercase', fontSize: 28, margin: '0 0 24px' }}>Your Packages</h1>
                {packages.length === 0 && (
                    <p style={{ color: '#888' }}>No active packages. Air Action Sports will email you a link when you're attached to an event.</p>
                )}
                {packages.map((p) => (
                    <a key={p.eventVendorId} href={p.packageUrl} style={pkgCard}>
                        <div style={{ color: '#c65a2a', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 800 }}>
                            {p.vendorCompanyName}
                        </div>
                        <div style={{ color: '#fff', fontSize: 20, fontWeight: 800, margin: '4px 0' }}>{p.event.title}</div>
                        <div style={{ color: '#c8b89a', fontSize: 13 }}>{p.event.displayDate}</div>
                        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <StatusChip status={p.status} />
                            {p.contractRequired && (
                                p.contractCountersignedAt
                                    ? <Chip bg="#2e7d4a">Countersigned</Chip>
                                    : p.contractSignedAt
                                        ? <Chip bg="#2e5d7a">Signed — awaiting countersign</Chip>
                                        : <Chip bg="#a04030">Signature needed</Chip>
                            )}
                        </div>
                    </a>
                ))}
                <p style={{ color: '#888', fontSize: 12, marginTop: 32 }}>
                    <Link to="/" style={{ color: '#c65a2a', textDecoration: 'none' }}>← Main site</Link>
                </p>
            </main>
        </div>
    );
}

function StatusChip({ status }) {
    const palette = {
        draft: '#4a4238', sent: '#2e5d7a', viewed: '#2e7d4a',
        revoked: '#6b1f1f', complete: '#c65a2a',
    };
    return <Chip bg={palette[status] || '#4a4238'}>{status}</Chip>;
}
function Chip({ bg, children }) {
    return <span style={{ display: 'inline-block', padding: '3px 8px', fontSize: 10, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', background: bg, color: '#fff', borderRadius: 2 }}>{children}</span>;
}

const shell = { minHeight: '100vh', background: '#1a1a1a', color: '#fff', fontFamily: 'system-ui, sans-serif' };
const header = { padding: '20px 24px', borderBottom: '1px solid rgba(200,184,154,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 };
const brand = { color: '#c65a2a', fontWeight: 900, letterSpacing: 2, fontSize: 14 };
const main = { maxWidth: 780, margin: '0 auto', padding: '32px 24px 60px' };
const pkgCard = { display: 'block', padding: '20px 24px', background: '#252525', border: '1px solid rgba(200,184,154,0.15)', marginBottom: 12, textDecoration: 'none' };

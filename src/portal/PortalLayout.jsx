// M5 Batch 6b — Portal shell (Surface 4a part 4 frontend).
//
// Separate route tree from /admin/*; uses the aas_portal_session cookie.
// Layout is intentionally minimal: top header with person name + sign-out;
// router outlet for the three sections (Home / Documents / Account).

import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom';

const PortalContext = createContext({ person: null, loading: true, refresh: async () => {} });

export function usePortal() {
    return useContext(PortalContext);
}

export default function PortalLayout() {
    const [person, setPerson] = useState(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/portal/auth/me', { credentials: 'include', cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                setPerson(data.person || null);
            } else {
                setPerson(null);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    async function logout() {
        await fetch('/api/portal/auth/logout', { method: 'POST', credentials: 'include' });
        setPerson(null);
        navigate('/portal/auth/signed-out');
    }

    if (loading) {
        return <div style={shell}><p style={{ color: 'var(--olive-light)' }}>Loading…</p></div>;
    }

    return (
        <PortalContext.Provider value={{ person, loading, refresh }}>
            <div style={shell}>
                <header style={header}>
                    <Link to="/portal" style={brand}>
                        <span style={brandText}>AAS Portal</span>
                    </Link>
                    {person ? (
                        <>
                            <nav style={nav}>
                                <NavLink to="/portal" end style={({ isActive }) => navItem(isActive)}>Home</NavLink>
                                <NavLink to="/portal/documents" style={({ isActive }) => navItem(isActive)}>Documents</NavLink>
                                <NavLink to="/portal/account" style={({ isActive }) => navItem(isActive)}>Account</NavLink>
                            </nav>
                            <div style={profile}>
                                <span style={nameText}>{person.full_name || person.email}</span>
                                <button type="button" onClick={logout} style={logoutBtn}>Sign out</button>
                            </div>
                        </>
                    ) : (
                        <Link to="/portal/auth/signed-out" style={navItem(false)}>Sign in</Link>
                    )}
                </header>
                <main style={main}>
                    <Outlet />
                </main>
            </div>
        </PortalContext.Provider>
    );
}

const shell = { minHeight: '100vh', background: 'var(--dark)', color: 'var(--cream)' };
const header = {
    display: 'flex', alignItems: 'center', gap: 24, padding: '12px 24px',
    borderBottom: '1px solid var(--color-border)', background: 'var(--mid)',
};
const brand = { display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' };
const brandText = { fontSize: 16, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--cream)' };
const nav = { display: 'flex', gap: 16, marginLeft: 'auto' };
function navItem(isActive) {
    return {
        padding: '8px 12px',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        textDecoration: 'none',
        color: isActive ? 'var(--orange)' : 'var(--tan-light)',
        borderBottom: isActive ? '2px solid var(--orange)' : '2px solid transparent',
    };
}
const profile = { display: 'flex', alignItems: 'center', gap: 12 };
const nameText = { fontSize: 12, color: 'var(--tan-light)' };
const logoutBtn = {
    background: 'transparent', color: 'var(--tan)', border: '1px solid var(--color-border-strong)',
    padding: '6px 12px', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer',
};
const main = { padding: '24px', maxWidth: 1000, margin: '0 auto' };

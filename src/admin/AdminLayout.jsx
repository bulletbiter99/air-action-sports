import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AdminProvider, useAdmin } from './AdminContext';
import FeedbackModal from '../components/FeedbackModal';
import { useFeatureFlag } from './useFeatureFlag';
import '../styles/admin.css';

// Sidebar grouped by operational rhythm: setup → event-day → review → admin.
// "New Booking" intentionally absent — it's an action verb, exposed as a primary
// CTA on the Dashboard header instead. Team + Audit live under Settings.
const NAV_SECTIONS = [
  {
    items: [
      { to: '/admin', label: 'Dashboard', end: true },
    ],
  },
  {
    label: 'Event Setup',
    items: [
      { to: '/admin/events', label: 'Events' },
      { to: '/admin/promo-codes', label: 'Promos' },
      { to: '/admin/vendors', label: 'Vendors' },
    ],
  },
  {
    label: 'Event Day',
    items: [
      { to: '/admin/roster', label: 'Roster' },
      { to: '/admin/scan', label: 'Scan' },
      { to: '/admin/rentals', label: 'Rentals' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/admin/analytics', label: 'Analytics' },
      { to: '/admin/feedback', label: 'Feedback', badgeKey: 'newFeedback' },
    ],
  },
  {
    items: [
      { to: '/admin/settings', label: 'Settings' },
    ],
  },
];

export default function AdminLayout() {
  return (
    <AdminProvider>
      <AdminShell />
    </AdminProvider>
  );
}

function AdminShell() {
  const { isAuthenticated, user } = useAdmin();
  const loc = useLocation();
  const onAuthPage = loc.pathname.endsWith('/login') || loc.pathname.endsWith('/setup');
  const showChrome = isAuthenticated && !onAuthPage;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const { enabled: compactDensity } = useFeatureFlag('density_compact');

  useEffect(() => { setDrawerOpen(false); }, [loc.pathname]);

  if (!showChrome) {
    return (
      <div className="admin-shell admin-shell--bare" style={{ minHeight: '100vh', background: 'var(--dark)', color: 'var(--cream)' }}>
        <main className="admin-main admin-main--bare"><Outlet /></main>
      </div>
    );
  }

  return (
    <div
      className="admin-shell admin-shell--with-sidebar"
      data-density={compactDensity ? 'compact' : 'normal'}
      style={{ minHeight: '100vh', background: 'var(--dark)', color: 'var(--cream)' }}
    >
      <MobileTopbar onOpen={() => setDrawerOpen(true)} />
      {drawerOpen && <div className="admin-drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
      <Sidebar drawerOpen={drawerOpen} onClose={() => setDrawerOpen(false)} onOpenFeedback={() => setFeedbackOpen(true)} />
      <main className="admin-main"><Outlet /></main>
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} defaultEmail={user?.email || ''} />
    </div>
  );
}

function MobileTopbar({ onOpen }) {
  return (
    <header className="admin-mobile-topbar">
      <button type="button" aria-label="Open menu" onClick={onOpen} style={hamburgerBtn}>
        <span style={hamburgerLine} />
        <span style={hamburgerLine} />
        <span style={hamburgerLine} />
      </button>
      <span style={mobileWordmark}>Air Action Sports</span>
    </header>
  );
}

function Sidebar({ drawerOpen, onClose, onOpenFeedback }) {
  const { isAuthenticated } = useAdmin();
  const [badges, setBadges] = useState({ newFeedback: 0 });
  const loc = useLocation();
  const { enabled: customersEnabled } = useFeatureFlag('customers_entity');

  // Derive the actual nav sections by injecting the Customers entry under
  // Insights when the customers_entity flag is on. The flag ships off
  // (M3 B8a migration 0024); the owner flips it via /admin/settings when
  // ready to expose the customers UI.
  const sections = useMemo(() => {
    if (!customersEnabled) return NAV_SECTIONS;
    return NAV_SECTIONS.map((section) => {
      if (section.label !== 'Insights') return section;
      return {
        ...section,
        items: [{ to: '/admin/customers', label: 'Customers' }, ...section.items],
      };
    });
  }, [customersEnabled]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const fetchBadges = async () => {
      try {
        const r = await fetch('/api/admin/feedback/summary', { credentials: 'include', cache: 'no-store' });
        if (r.ok && !cancelled) {
          const { newCount } = await r.json();
          setBadges((b) => ({ ...b, newFeedback: newCount || 0 }));
        }
      } catch {}
    };
    fetchBadges();
    const t = setInterval(fetchBadges, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [isAuthenticated, loc.pathname]);

  return (
    <aside className={`admin-sidebar${drawerOpen ? ' admin-sidebar--open' : ''}`}>
      <div style={sidebarHeader}>
        <span style={logoText}>Air Action<br />Sports</span>
        <span style={logoSub}>Admin</span>
      </div>
      <nav className="admin-sidebar-nav" aria-label="Admin navigation">
        {sections.map((section, sIdx) => (
          <div key={sIdx} className="admin-sidebar-section">
            {section.label && (
              <div className="admin-sidebar-section-label">{section.label}</div>
            )}
            {section.items.map((item) => {
              const count = item.badgeKey ? badges[item.badgeKey] : 0;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onClose}
                  style={({ isActive }) => ({
                    ...navLink,
                    color: isActive ? 'var(--orange)' : 'var(--tan-light)',
                    background: isActive ? 'rgba(215,108,33,0.08)' : 'transparent',
                    borderLeft: isActive ? '3px solid var(--orange)' : '3px solid transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  })}
                >
                  <span>{item.label}</span>
                  {count > 0 && <span style={navBadge}>{count}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
      <ProfileMenu onOpenFeedback={onOpenFeedback} />
    </aside>
  );
}

function ProfileMenu({ onOpenFeedback }) {
  const { user, logout } = useAdmin();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!user) return null;
  const initials = (user.displayName || user.email || '?')
    .split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <div ref={ref} style={profileWrap}>
      {open && (
        <div style={profileMenu} role="menu">
          <Link to="/" style={profileMenuItem} onClick={() => setOpen(false)}>← Back to site</Link>
          <button
            type="button"
            style={{ ...profileMenuItem, width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer' }}
            onClick={() => { setOpen(false); onOpenFeedback?.(); }}
          >
            Share feedback
          </button>
          <button
            type="button"
            style={{ ...profileMenuItem, color: '#e74c3c', width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer' }}
            onClick={() => { setOpen(false); logout(); }}
          >
            Sign out
          </button>
        </div>
      )}
      <button type="button" style={profileBtn} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span style={avatarCircle}>{initials}</span>
        <span style={profileTextWrap}>
          <span style={profileName}>{user.displayName || user.email}</span>
          <span style={profileRole}>{user.role}</span>
        </span>
        <span style={profileCaret}>▾</span>
      </button>
    </div>
  );
}

const sidebarHeader = {
  padding: '20px 18px 16px',
  borderBottom: '1px solid rgba(200,184,154,0.1)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
const logoText = { fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--cream)', lineHeight: 1.15 };
const logoSub = { fontSize: 10, color: 'var(--orange)', letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 };

const navLink = {
  display: 'block',
  padding: '12px 18px',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 1.3,
  textAlign: 'left',
  textTransform: 'uppercase',
  textDecoration: 'none',
  transition: 'background 0.12s, color 0.12s',
};
const navBadge = {
  background: 'var(--orange)', color: '#fff',
  fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
  minWidth: 20, height: 20, padding: '0 6px',
  borderRadius: 10, display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center',
  lineHeight: 1,
};

const profileWrap = {
  borderTop: '1px solid rgba(200,184,154,0.1)',
  padding: 10,
  position: 'relative',
  marginTop: 'auto',
};
const profileBtn = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
  background: 'transparent', border: 0, color: 'var(--cream)',
  padding: 8, borderRadius: 6, cursor: 'pointer',
  textAlign: 'left',
};
const avatarCircle = {
  width: 32, height: 32, borderRadius: '50%',
  background: 'var(--orange)', color: 'var(--dark)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 12, fontWeight: 800, letterSpacing: 0.5,
  flexShrink: 0,
};
const profileTextWrap = { display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minWidth: 0 };
const profileName = { fontSize: 12, fontWeight: 700, color: 'var(--cream)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const profileRole = { fontSize: 10, color: 'var(--olive-light)', textTransform: 'uppercase', letterSpacing: 1 };
const profileCaret = { color: 'var(--olive-light)', fontSize: 10, flexShrink: 0 };

const profileMenu = {
  position: 'absolute',
  bottom: 'calc(100% + 4px)',
  left: 10, right: 10,
  background: 'var(--mid)',
  border: '1px solid rgba(200,184,154,0.15)',
  borderRadius: 6,
  overflow: 'hidden',
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  zIndex: 100,
};
const profileMenuItem = {
  display: 'block',
  padding: '10px 14px',
  fontSize: 12,
  color: 'var(--tan-light)',
  textDecoration: 'none',
  textTransform: 'uppercase',
  letterSpacing: 1,
  fontWeight: 700,
};

const hamburgerBtn = {
  width: 40, height: 40, border: 0, background: 'transparent',
  display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', padding: 0,
};
const hamburgerLine = { width: 20, height: 2, background: 'var(--cream)', borderRadius: 2 };
const mobileWordmark = { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--cream)' };

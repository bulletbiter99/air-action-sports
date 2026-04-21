import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AdminProvider, useAdmin } from './AdminContext';
import '../styles/admin.css';

export default function AdminLayout() {
  return (
    <AdminProvider>
      <div className="admin-shell" style={{ minHeight: '100vh', background: 'var(--dark)', color: 'var(--cream)' }}>
        <AdminHeader />
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </AdminProvider>
  );
}

function AdminHeader() {
  const { isAuthenticated } = useAdmin();
  const loc = useLocation();
  const onAuthPage = loc.pathname.endsWith('/login') || loc.pathname.endsWith('/setup');

  return (
    <header className="admin-header" style={headerBar}>
      <span style={logoText}>Air Action Sports — Admin</span>
      {isAuthenticated && !onAuthPage && (
        <nav className="admin-nav" style={navBar}>
          <TabLink to="/admin" end>Dashboard</TabLink>
          <TabLink to="/admin/analytics">Analytics</TabLink>
          <TabLink to="/admin/events">Events</TabLink>
          <TabLink to="/admin/roster">Roster</TabLink>
          <TabLink to="/admin/scan">Scan</TabLink>
          <TabLink to="/admin/rentals">Rentals</TabLink>
          <TabLink to="/admin/promo-codes">Promos</TabLink>
          <TabLink to="/admin/new-booking">New Booking</TabLink>
          <TabLink to="/admin/users">Team</TabLink>
          <TabLink to="/admin/audit-log">Audit</TabLink>
          <TabLink to="/admin/settings">Settings</TabLink>
        </nav>
      )}
      <Link to="/" style={backLink}>← Back to Site</Link>
    </header>
  );
}

function TabLink({ to, end, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      style={({ isActive }) => ({
        ...navTab,
        color: isActive ? 'var(--orange)' : 'var(--tan-light)',
        borderBottom: isActive ? '2px solid var(--orange)' : '2px solid transparent',
      })}
    >
      {children}
    </NavLink>
  );
}

const headerBar = {
  background: 'var(--mid)',
  borderBottom: '1px solid rgba(200,184,154,0.1)',
  padding: '0 2rem',
  height: 60,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '2rem',
};
const logoText = { fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--cream)', flexShrink: 0 };
const navBar = { display: 'flex', gap: 8, flex: 1, alignItems: 'center' };
const navTab = {
  padding: '20px 16px',
  fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase',
  textDecoration: 'none', height: 60, display: 'flex', alignItems: 'center',
};
const backLink = { fontSize: 12, color: 'var(--orange)', textDecoration: 'none', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700, flexShrink: 0 };

import { Link, Outlet } from 'react-router-dom';
import { AdminProvider } from './AdminContext';

export default function AdminLayout() {
  return (
    <AdminProvider>
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--dark, #1a1a1a)',
          color: 'var(--cream, #f5f0e8)',
        }}
      >
        {/* Admin Header */}
        <header
          style={{
            background: 'var(--mid, #2a2a2a)',
            borderBottom: '1px solid rgba(200,184,154,0.1)',
            padding: '0 2rem',
            height: '60px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontSize: '14px',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '2px',
              color: 'var(--cream, #f5f0e8)',
            }}
          >
            Air Action Sports &mdash; Admin
          </span>
          <Link
            to="/"
            style={{
              fontSize: '12px',
              color: 'var(--orange, #d4541a)',
              textDecoration: 'none',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
          >
            &larr; Back to Site
          </Link>
        </header>

        {/* Admin Content */}
        <Outlet />
      </div>
    </AdminProvider>
  );
}

import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';

const CARDS = [
  {
    to: '/admin/settings/taxes-fees',
    title: 'Taxes & Fees',
    desc: 'City/state tax rates, processing fees, and what the customer sees at checkout.',
    role: 'staff',
  },
  {
    to: '/admin/settings/email-templates',
    title: 'Email Templates',
    desc: 'Edit booking confirmation, waiver request, 24hr/1hr reminder, and password/invite copy. Owner only.',
    role: 'owner',
  },
  {
    to: '/admin/waivers',
    title: 'Waiver Document',
    desc: 'Edit the player liability waiver. New version retires the previous; past signers stay pinned to whatever they signed. Owner only.',
    role: 'owner',
  },
  {
    to: '/admin/users',
    title: 'Team',
    desc: 'Invite admins, manage roles (staff / manager / owner), revoke access. Owner only.',
    role: 'manager',
  },
  {
    to: '/admin/audit-log',
    title: 'Audit Log',
    desc: 'Who did what, when. Filter by action, user, or target. Manager+ only.',
    role: 'manager',
  },
];

export default function AdminSettings() {
  const { isAuthenticated, loading, hasRole } = useAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  if (loading || !isAuthenticated) return null;

  const visible = CARDS.filter((c) => hasRole(c.role));

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '2rem' }}>
      <h1 style={h1}>Settings</h1>
      <p style={{ color: 'var(--olive-light)', fontSize: 13, marginBottom: 24 }}>
        Configuration for booking, pricing, and transactional messaging.
      </p>

      <div style={grid}>
        {visible.map((c) => (
          <Link to={c.to} key={c.to} style={card}>
            <div style={cardTitle}>{c.title}</div>
            <div style={cardDesc}>{c.desc}</div>
            <div style={cardCta}>Open →</div>
          </Link>
        ))}
      </div>

      {visible.length === 0 && (
        <p style={{ color: 'var(--olive-light)' }}>No settings available for your role.</p>
      )}
    </div>
  );
}

const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: '0 0 0.5rem' };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 };
const card = {
  background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1.5rem',
  textDecoration: 'none', color: 'var(--cream)', display: 'block', transition: 'border 0.2s',
};
const cardTitle = { fontSize: 16, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--cream)', marginBottom: 8 };
const cardDesc = { fontSize: 13, color: 'var(--tan-light)', lineHeight: 1.5, marginBottom: 12 };
const cardCta = { fontSize: 11, fontWeight: 800, letterSpacing: 2, color: 'var(--orange)', textTransform: 'uppercase' };

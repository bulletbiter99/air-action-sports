import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import { useFeatureFlag, setFeatureFlagOverride } from './useFeatureFlag';

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
  const {
    enabled: compactDensity,
    exists: densityExists,
    refresh: refreshDensity,
  } = useFeatureFlag('density_compact');
  const [densitySaving, setDensitySaving] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  if (loading || !isAuthenticated) return null;

  const visible = CARDS.filter((c) => hasRole(c.role));

  const handleDensity = async (compact) => {
    if (densitySaving || compact === compactDensity) return;
    setDensitySaving(true);
    try {
      await setFeatureFlagOverride('density_compact', compact);
      await refreshDensity();
    } finally {
      setDensitySaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '2rem' }}>
      <h1 style={h1}>Settings</h1>
      <p style={{ color: 'var(--olive-light)', fontSize: 13, marginBottom: 24 }}>
        Configuration for booking, pricing, and transactional messaging.
      </p>

      {densityExists && (
        <div style={densitySection}>
          <div style={densityHeader}>
            <div style={densityLabel}>Display Density</div>
            <div style={densityHint}>Tighten admin padding for more content above the fold.</div>
          </div>
          <div style={densityControl} role="radiogroup" aria-label="Display density">
            <button
              type="button"
              role="radio"
              aria-checked={!compactDensity}
              onClick={() => handleDensity(false)}
              disabled={densitySaving}
              style={{ ...densityButton, ...(compactDensity ? {} : densityButtonActive) }}
            >
              Normal
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={compactDensity}
              onClick={() => handleDensity(true)}
              disabled={densitySaving}
              style={{ ...densityButton, ...(compactDensity ? densityButtonActive : {}) }}
            >
              Compact
            </button>
          </div>
        </div>
      )}

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

const densitySection = {
  background: 'var(--mid)',
  border: '1px solid rgba(200,184,154,0.1)',
  padding: '1.25rem 1.5rem',
  marginBottom: 24,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 24,
  flexWrap: 'wrap',
};
const densityHeader = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 };
const densityLabel = { fontSize: 14, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--cream)' };
const densityHint = { fontSize: 12, color: 'var(--olive-light)' };
const densityControl = {
  display: 'inline-flex',
  border: '1px solid rgba(200,184,154,0.15)',
  borderRadius: 4,
  overflow: 'hidden',
};
const densityButton = {
  background: 'transparent',
  color: 'var(--tan-light)',
  border: 0,
  padding: '8px 16px',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: 'uppercase',
  cursor: 'pointer',
  transition: 'background 0.15s, color 0.15s',
};
const densityButtonActive = {
  background: 'var(--orange)',
  color: 'var(--dark)',
};

import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import { useFeatureFlag, setFeatureFlagOverride } from './useFeatureFlag';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';

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
    to: '/admin/staff',
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
    <div style={page}>
      <AdminPageHeader
        title="Settings"
        description="Configuration for booking, pricing, and transactional messaging."
      />

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
        <EmptyState
          title="No settings available"
          description="No settings are visible at your current role. Contact an Owner if you need access."
        />
      )}
    </div>
  );
}

const page = { maxWidth: 1000, margin: '0 auto', padding: 'var(--space-32)' };
const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
  gap: 'var(--space-16)',
};
const card = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-24)',
  textDecoration: 'none',
  color: 'var(--color-text)',
  display: 'block',
  transition: 'border var(--duration-base) var(--easing-standard)',
};
const cardTitle = {
  fontSize: 'var(--font-size-lg)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  color: 'var(--color-text)',
  marginBottom: 'var(--space-8)',
};
const cardDesc = {
  fontSize: 'var(--font-size-base)',
  color: 'var(--color-text-muted)',
  lineHeight: 'var(--line-height-relaxed)',
  marginBottom: 'var(--space-12)',
};
const cardCta = {
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-widest)',
  color: 'var(--color-accent)',
  textTransform: 'uppercase',
};

const densitySection = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-16) var(--space-24)',
  marginBottom: 'var(--space-24)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-24)',
  flexWrap: 'wrap',
};
const densityHeader = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 };
const densityLabel = {
  fontSize: 'var(--font-size-md)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  color: 'var(--color-text)',
};
const densityHint = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' };
const densityControl = {
  display: 'inline-flex',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
};
const densityButton = {
  background: 'transparent',
  color: 'var(--color-text-muted)',
  border: 0,
  padding: 'var(--space-8) var(--space-16)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-bold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
  transition: 'background var(--duration-fast) var(--easing-standard), color var(--duration-fast) var(--easing-standard)',
};
const densityButtonActive = {
  background: 'var(--color-accent)',
  color: 'var(--color-text-inverse)',
};

import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import { useFeatureFlag, setFeatureFlagOverride } from './useFeatureFlag';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';

// Open-reads model (2026-07): every card is visible to every authenticated
// admin — the destination pages are viewable by all; editing inside them
// stays role/capability-gated.
const CARDS = [
  {
    to: '/admin/settings/taxes-fees',
    title: 'Taxes & Fees',
    desc: 'City/state tax rates, processing fees, and what the customer sees at checkout.',
  },
  {
    to: '/admin/settings/email-templates',
    title: 'Email Templates',
    desc: 'Booking confirmation, waiver request, 24hr/1hr reminder, and password/invite copy. Editing is owner-only.',
  },
  {
    to: '/admin/waivers',
    title: 'Waiver Document',
    desc: 'The player liability waiver. New version retires the previous; past signers stay pinned to whatever they signed. Editing is owner-only.',
  },
  {
    to: '/admin/staff',
    title: 'Staff',
    desc: 'Team roster, roles, documents, certifications. Inviting + editing is manager+.',
  },
  {
    to: '/admin/audit-log',
    title: 'Audit Log',
    desc: 'Who did what, when. Filter by action, user, or target.',
  },
  {
    to: '/admin/booking-charges',
    title: 'Booking Charges',
    desc: 'Damage-charge queue: review, approve, collect, or waive post-event charges. Actions are manager+.',
  },
];

export default function AdminSettings() {
  const { isAuthenticated, loading } = useAdmin();
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

  const visible = CARDS;

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

      <LoginAccountsSection />

      {visible.length === 0 && (
        <EmptyState
          title="No settings available"
          description="No settings are visible at your current role. Contact an Owner if you need access."
        />
      )}
    </div>
  );
}

// Sprint 4 — login accounts + the persona dropdown (audit "persona-system
// decision", operator chose: keep the system AND give it a UI). This is also
// the first read surface for login accounts since AdminUsers was
// decommissioned in M5 R17 — role/active editing stays API-only; persona is
// the one write here because it's a LENS preference (dashboard layout only,
// per decision D08), not an access change. PUT /api/admin/users/:id is
// owner-gated, so the dropdown is disabled for everyone else.
const PERSONA_OPTIONS = [
  ['', 'Role default'],
  ['owner', 'Owner'],
  ['booking_coordinator', 'Booking Coordinator'],
  ['marketing', 'Marketing'],
  ['bookkeeper', 'Bookkeeper'],
  ['generic_manager', 'General Manager'],
  ['staff', 'Staff'],
];

function LoginAccountsSection() {
  const { hasRole } = useAdmin();
  const isOwner = hasRole?.('owner');
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState(null);
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/users', { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (alive) setUsers(j.users || []); })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, []);

  const setPersona = async (userId, persona) => {
    setSavingId(userId); setErr(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: persona || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, persona: persona || null } : u)));
    } catch (e) {
      setErr(e.message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div style={{ ...densitySection, marginTop: 'var(--space-24)', display: 'block' }}>
      <div style={densityLabel}>Login Accounts &amp; Dashboard Personas</div>
      <div style={{ ...densityHint, marginBottom: 'var(--space-12)' }}>
        The persona picks which dashboard layout an admin sees — it never changes what they can
        access (that&apos;s role + capabilities). &quot;Role default&quot; derives the layout from their role.
        {isOwner ? '' : ' Changing personas is owner-only.'}
      </div>
      {err && <div style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)', marginBottom: 8 }}>Error: {err}</div>}
      {!users && !err && <div style={densityHint}>Loading…</div>}
      {users && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
          <thead>
            <tr>
              {['Name', 'Email', 'Role', 'Status', 'Dashboard persona'].map((h) => (
                <th key={h} style={usersTh}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={usersTd}>{u.displayName || '—'}</td>
                <td style={usersTd}>{u.email}</td>
                <td style={usersTd}>{u.role}</td>
                <td style={usersTd}>{u.active ? 'active' : 'inactive'}</td>
                <td style={usersTd}>
                  <select
                    value={u.persona || ''}
                    disabled={!isOwner || savingId === u.id}
                    onChange={(e) => setPersona(u.id, e.target.value)}
                    aria-label={`Dashboard persona for ${u.email}`}
                    style={{
                      background: 'var(--color-bg-sunken)', color: 'var(--color-text)',
                      border: '1px solid var(--color-border-strong)', padding: '4px 8px',
                      fontSize: 'var(--font-size-sm)',
                    }}
                  >
                    {PERSONA_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const usersTh = {
  textAlign: 'left', padding: '6px 8px', fontSize: 'var(--font-size-xs)',
  textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)',
  color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border-strong)',
};
const usersTd = { padding: '8px', color: 'var(--color-text)' };

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

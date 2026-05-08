import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx';
import EmptyState from '../components/admin/EmptyState.jsx';

const ROLES = ['staff', 'manager', 'owner'];

export default function AdminUsers() {
  const { isAuthenticated, loading, hasRole, user: me } = useAdmin();
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) navigate('/admin/login');
  }, [loading, isAuthenticated, navigate]);

  const load = useCallback(async () => {
    setLoadingList(true);
    try {
      const [u, i] = await Promise.all([
        fetch('/api/admin/users', { credentials: 'include', cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/admin/users/invitations', { credentials: 'include', cache: 'no-store' }).then((r) => r.json()),
      ]);
      setUsers(u.users || []);
      setInvites(i.invitations || []);
    } catch (e) {
      console.error(e);
    }
    setLoadingList(false);
  }, []);

  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  const updateUser = async (id, patch, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) load();
    else { const d = await res.json().catch(() => ({})); alert(d.error || 'Update failed'); }
  };

  const revokeInvite = async (token) => {
    if (!window.confirm('Revoke this invite? It will no longer be usable.')) return;
    const res = await fetch(`/api/admin/users/invitations/${token}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (res.ok) load();
  };

  if (loading || !isAuthenticated) return null;

  const pending = invites.filter((i) => i.status === 'pending');
  const recent = invites.filter((i) => i.status !== 'pending').slice(0, 10);
  const activeUsers = users.filter((u) => u.active);

  return (
    <div style={pageWrap}>
      <AdminPageHeader
        title="Team"
        description="Admin user accounts and pending invitations. Owner role required to invite, change roles, or revoke access."
        breadcrumb={[{ label: 'Settings', to: '/admin/settings' }, { label: 'Team' }]}
        primaryAction={hasRole('owner') && (
          <button onClick={() => setShowInvite(true)} style={primaryBtn}>+ Invite User</button>
        )}
      />

      <section style={tableBox}>
        <h2 style={h2}>Active admins ({activeUsers.length})</h2>
        {loadingList && (
          <EmptyState variant="loading" title="Loading users…" compact />
        )}
        {!loadingList && users.length === 0 && (
          <EmptyState
            title="No admin accounts yet"
            description="Invite at least one Owner to get started."
            compact
          />
        )}
        {users.length > 0 && (
          <div className="admin-table-wrap"><table style={table}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Email</th>
                <th style={th}>Role</th>
                <th style={th}>Last login</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={tr}>
                  <td style={td}>
                    <strong>{u.displayName}</strong>
                    {me?.id === u.id && <span style={youBadge}>(you)</span>}
                  </td>
                  <td style={td}>{u.email}</td>
                  <td style={td}>
                    {hasRole('owner') && me?.id !== u.id ? (
                      <select
                        value={u.role}
                        onChange={(e) => updateUser(u.id, { role: e.target.value },
                          u.role === 'owner' && e.target.value !== 'owner'
                            ? 'Demote this owner?' : null)}
                        style={roleSelect}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <RolePill role={u.role} />
                    )}
                  </td>
                  <td style={tdSmall}>
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : <span style={mutedText}>never</span>}
                  </td>
                  <td style={td}>
                    {u.active
                      ? <span style={statusActive}>Active</span>
                      : <span style={statusInactive}>Disabled</span>}
                  </td>
                  <td style={td}>
                    {hasRole('owner') && me?.id !== u.id && (
                      <button
                        onClick={() => updateUser(u.id, { active: !u.active },
                          u.active ? `Deactivate ${u.displayName}? They won't be able to log in.` : null)}
                        style={subtleBtn}
                      >{u.active ? 'Disable' : 'Re-enable'}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      {pending.length > 0 && (
        <section style={tableBox}>
          <h2 style={h2}>Pending invites ({pending.length})</h2>
          <div className="admin-table-wrap"><table style={table}>
            <thead>
              <tr>
                <th style={th}>Email</th>
                <th style={th}>Role</th>
                <th style={th}>Invited by</th>
                <th style={th}>Expires</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((i) => (
                <tr key={i.token} style={tr}>
                  <td style={td}>{i.email}</td>
                  <td style={td}><RolePill role={i.role} /></td>
                  <td style={tdSmall}>{i.inviterName || '—'}</td>
                  <td style={tdSmaller}>{new Date(i.expiresAt).toLocaleDateString()}</td>
                  <td style={td}>
                    {hasRole('owner') && (
                      <>
                        <button
                          onClick={() => {
                            const link = `${window.location.origin}/admin/accept-invite?token=${i.token}`;
                            navigator.clipboard.writeText(link).then(() => alert('Invite link copied'));
                          }}
                          style={subtleBtn}
                        >Copy Link</button>
                        <button onClick={() => revokeInvite(i.token)} style={{ ...subtleBtn, marginLeft: 'var(--space-4)' }}>Revoke</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}

      {recent.length > 0 && (
        <section style={tableBox}>
          <h2 style={h2}>Recent invites</h2>
          <div className="admin-table-wrap"><table style={table}>
            <thead>
              <tr><th style={th}>Email</th><th style={th}>Role</th><th style={th}>Status</th><th style={th}>When</th></tr>
            </thead>
            <tbody>
              {recent.map((i) => (
                <tr key={i.token} style={tr}>
                  <td style={tdSmall}>{i.email}</td>
                  <td style={td}><RolePill role={i.role} /></td>
                  <td style={td}>
                    <InviteStatusPill status={i.status} />
                  </td>
                  <td style={tdSmaller}>
                    {new Date(i.consumedAt || i.revokedAt || i.expiresAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}

      {showInvite && (
        <InviteForm onClose={() => setShowInvite(false)} onSent={() => { setShowInvite(false); load(); }} />
      )}
    </div>
  );
}

function RolePill({ role }) {
  // Domain-specific role colors stay raw — owner is brand-orange,
  // manager is purple to differentiate, staff is muted.
  const palette = {
    owner: { bg: 'rgba(212,84,26,0.15)', fg: 'var(--color-accent)' },
    manager: { bg: 'rgba(155,89,182,0.15)', fg: '#c39bda' },
    staff: { bg: 'rgba(200,184,154,0.08)', fg: 'var(--color-text-muted)' },
  };
  const c = palette[role] || palette.staff;
  return (
    <span style={{
      display: 'inline-block',
      padding: 'var(--space-4) var(--space-8)',
      fontSize: 'var(--font-size-xs)',
      fontWeight: 'var(--font-weight-extrabold)',
      letterSpacing: 'var(--letter-spacing-wide)',
      textTransform: 'uppercase',
      background: c.bg,
      color: c.fg,
      border: `1px solid ${c.fg}40`,
    }}>{role}</span>
  );
}

function InviteStatusPill({ status }) {
  const color =
    status === 'accepted' ? 'var(--color-success)' :
    status === 'revoked' ? 'var(--color-danger)' :
    'var(--color-text-muted)';
  return (
    <span style={{ fontSize: 'var(--font-size-sm)', color }}>{status}</span>
  );
}

function InviteForm({ onClose, onSent }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('staff');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  const send = async (e) => {
    e.preventDefault();
    setSending(true); setErr('');
    const res = await fetch('/api/admin/users/invite', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    setSending(false);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setResult(data);
    } else {
      setErr(data.error || 'Invite failed');
    }
  };

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>Invite team member</h3>
          <button onClick={onClose} style={subtleBtn}>Close</button>
        </div>

        {!result ? (
          <form onSubmit={send}>
            <Field label="Email *">
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={input} placeholder="name@example.com" />
            </Field>
            <Field label="Role *">
              <select value={role} onChange={(e) => setRole(e.target.value)} style={input}>
                <option value="staff">Staff — check-in, scan, view rosters</option>
                <option value="manager">Manager — staff + refunds, manual bookings, events, promos</option>
                <option value="owner">Owner — full access including team + settings</option>
              </select>
            </Field>
            {err && <div style={errorText}>{err}</div>}
            <div style={modalActions}>
              <button type="submit" disabled={sending} style={primaryBtn}>{sending ? 'Sending…' : 'Send Invite'}</button>
              <button type="button" onClick={onClose} style={subtleBtn}>Cancel</button>
            </div>
          </form>
        ) : (
          <div>
            <p style={successText}>✓ Invite sent to <strong>{email}</strong>.</p>
            <p style={modalHint}>If email delivery fails, share this link directly:</p>
            <input
              type="text" readOnly value={result.acceptLink}
              onFocus={(e) => e.target.select()}
              style={{ ...input, fontFamily: 'monospace', fontSize: 'var(--font-size-sm)' }}
            />
            <div style={modalActions}>
              <button
                onClick={() => navigator.clipboard.writeText(result.acceptLink).then(() => alert('Copied'))}
                style={primaryBtn}
              >Copy link</button>
              <button onClick={onSent} style={subtleBtn}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={fieldLabel}>
      <div style={fieldLabelText}>{label}</div>
      {children}
    </label>
  );
}

const pageWrap = { maxWidth: 1200, margin: '0 auto', padding: 'var(--space-32)' };
const h2 = {
  fontSize: 'var(--font-size-base)',
  fontWeight: 'var(--font-weight-extrabold)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--letter-spacing-wider)',
  color: 'var(--color-accent)',
  margin: '0 0 var(--space-12)',
};
const input = {
  padding: 'var(--space-8) var(--space-12)',
  background: 'var(--color-bg-page)',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-base)',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};
const roleSelect = {
  ...input,
  width: 'auto',
  padding: 'var(--space-4) var(--space-8)',
  fontSize: 'var(--font-size-sm)',
};
const tableBox = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-24)',
  marginBottom: 'var(--space-24)',
};
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-base)' };
const th = {
  textAlign: 'left',
  padding: 'var(--space-8) var(--space-12)',
  borderBottom: '1px solid var(--color-border-strong)',
  color: 'var(--color-accent)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
};
const tr = { borderBottom: '1px solid var(--color-border-subtle)' };
const td = { padding: 'var(--space-8) var(--space-12)', color: 'var(--color-text)' };
const tdSmall = { ...td, fontSize: 'var(--font-size-sm)' };
const tdSmaller = { ...td, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' };
const youBadge = {
  marginLeft: 'var(--space-4)',
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-accent)',
};
const statusActive = { color: 'var(--color-success)', fontSize: 'var(--font-size-sm)' };
const statusInactive = { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' };
const mutedText = { color: 'var(--color-text-muted)' };
const primaryBtn = {
  padding: 'var(--space-8) var(--space-16)',
  background: 'var(--color-accent)',
  color: 'var(--color-accent-on-accent)',
  border: 'none',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-extrabold)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const subtleBtn = {
  padding: 'var(--space-4) var(--space-12)',
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const modalBg = {
  position: 'fixed',
  inset: 0,
  background: 'var(--color-overlay-strong)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 'var(--space-16)',
};
const modal = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border-strong)',
  padding: 'var(--space-24)',
  width: '100%',
  maxWidth: 520,
  borderRadius: 'var(--radius-md)',
};
const modalHeader = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 'var(--space-16)',
};
const modalTitle = {
  margin: 0,
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-md)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
};
const modalActions = {
  display: 'flex',
  gap: 'var(--space-8)',
  marginTop: 'var(--space-16)',
};
const modalHint = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-sm)',
  marginBottom: 'var(--space-12)',
};
const successText = {
  color: 'var(--color-success)',
  fontSize: 'var(--font-size-base)',
};
const errorText = {
  color: 'var(--color-danger)',
  fontSize: 'var(--font-size-sm)',
  margin: 'var(--space-8) 0',
};
const fieldLabel = { display: 'block', marginBottom: 'var(--space-12)' };
const fieldLabelText = {
  fontSize: 'var(--font-size-sm)',
  letterSpacing: 'var(--letter-spacing-wide)',
  textTransform: 'uppercase',
  color: 'var(--color-accent)',
  fontWeight: 'var(--font-weight-bold)',
  marginBottom: 'var(--space-4)',
};

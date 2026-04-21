import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from './AdminContext';

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

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={h1}>Team</h1>
        {hasRole('owner') && <button onClick={() => setShowInvite(true)} style={primaryBtn}>+ Invite User</button>}
      </div>

      <section style={tableBox}>
        <h2 style={h2}>Active admins ({users.filter((u) => u.active).length})</h2>
        {loadingList && <p style={{ color: 'var(--olive-light)' }}>Loading…</p>}
        {users.length > 0 && (
          <table style={table}>
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
                    {me?.id === u.id && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--orange)' }}>(you)</span>}
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
                  <td style={{ ...td, fontSize: 12 }}>
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : <span style={{ color: 'var(--olive-light)' }}>never</span>}
                  </td>
                  <td style={td}>
                    {u.active
                      ? <span style={{ color: '#2ecc71', fontSize: 12 }}>Active</span>
                      : <span style={{ color: 'var(--olive-light)', fontSize: 12 }}>Disabled</span>}
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
          </table>
        )}
      </section>

      {pending.length > 0 && (
        <section style={tableBox}>
          <h2 style={h2}>Pending invites ({pending.length})</h2>
          <table style={table}>
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
                  <td style={{ ...td, fontSize: 12 }}>{i.inviterName || '—'}</td>
                  <td style={{ ...td, fontSize: 11, color: 'var(--olive-light)' }}>
                    {new Date(i.expiresAt).toLocaleDateString()}
                  </td>
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
                        <button onClick={() => revokeInvite(i.token)} style={{ ...subtleBtn, marginLeft: 6 }}>Revoke</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {recent.length > 0 && (
        <section style={tableBox}>
          <h2 style={h2}>Recent invites</h2>
          <table style={table}>
            <thead>
              <tr><th style={th}>Email</th><th style={th}>Role</th><th style={th}>Status</th><th style={th}>When</th></tr>
            </thead>
            <tbody>
              {recent.map((i) => (
                <tr key={i.token} style={tr}>
                  <td style={{ ...td, fontSize: 12 }}>{i.email}</td>
                  <td style={td}><RolePill role={i.role} /></td>
                  <td style={td}>
                    <span style={{
                      fontSize: 11,
                      color: i.status === 'accepted' ? '#2ecc71'
                           : i.status === 'revoked' ? '#e74c3c'
                           : 'var(--olive-light)',
                    }}>{i.status}</span>
                  </td>
                  <td style={{ ...td, fontSize: 11, color: 'var(--olive-light)' }}>
                    {new Date(i.consumedAt || i.revokedAt || i.expiresAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {showInvite && (
        <InviteForm onClose={() => setShowInvite(false)} onSent={() => { setShowInvite(false); load(); }} />
      )}
    </div>
  );
}

function RolePill({ role }) {
  const palette = {
    owner: { bg: 'rgba(212,84,26,0.15)', fg: 'var(--orange)' },
    manager: { bg: 'rgba(155,89,182,0.15)', fg: '#c39bda' },
    staff: { bg: 'rgba(200,184,154,0.08)', fg: 'var(--tan-light)' },
  };
  const c = palette[role] || palette.staff;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', fontSize: 10, fontWeight: 800,
      letterSpacing: 1.5, textTransform: 'uppercase', background: c.bg, color: c.fg,
      border: `1px solid ${c.fg}40`,
    }}>{role}</span>
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
      // give the user a moment to copy the link if email fails
    } else {
      setErr(data.error || 'Invite failed');
    }
  };

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: 'var(--cream)', fontSize: 14, letterSpacing: 1.5, textTransform: 'uppercase' }}>Invite team member</h3>
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
            {err && <div style={{ color: '#e74c3c', fontSize: 12, margin: '8px 0' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="submit" disabled={sending} style={primaryBtn}>{sending ? 'Sending…' : 'Send Invite'}</button>
              <button type="button" onClick={onClose} style={subtleBtn}>Cancel</button>
            </div>
          </form>
        ) : (
          <div>
            <p style={{ color: '#2ecc71', fontSize: 13 }}>✓ Invite sent to <strong>{email}</strong>.</p>
            <p style={{ color: 'var(--olive-light)', fontSize: 12, marginBottom: 12 }}>
              If email delivery fails, share this link directly:
            </p>
            <input
              type="text" readOnly value={result.acceptLink}
              onFocus={(e) => e.target.select()}
              style={{ ...input, fontFamily: 'monospace', fontSize: 11 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
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
    <label style={{ display: 'block', marginBottom: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

const h1 = { fontSize: 28, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-1px', color: 'var(--cream)', margin: 0 };
const h2 = { fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--orange)', margin: '0 0 12px' };
const input = { padding: '10px 14px', background: 'var(--dark)', border: '1px solid rgba(200,184,154,0.2)', color: 'var(--cream)', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const roleSelect = { ...input, width: 'auto', padding: '4px 8px', fontSize: 12 };
const tableBox = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.1)', padding: '1.5rem', marginBottom: 20 };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(200,184,154,0.15)', color: 'var(--orange)', fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' };
const tr = { borderBottom: '1px solid rgba(200,184,154,0.05)' };
const td = { padding: '10px 12px', color: 'var(--cream)' };
const primaryBtn = { padding: '10px 18px', background: 'var(--orange)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' };
const subtleBtn = { padding: '6px 12px', background: 'transparent', border: '1px solid rgba(200,184,154,0.25)', color: 'var(--tan-light)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' };
const modalBg = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal = { background: 'var(--mid)', border: '1px solid rgba(200,184,154,0.2)', padding: '1.5rem', width: '100%', maxWidth: 520, borderRadius: 4 };

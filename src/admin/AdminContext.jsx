import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AdminContext = createContext(null);

export function AdminProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupNeeded, setSetupNeeded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [meRes, setupRes] = await Promise.all([
        fetch('/api/admin/auth/me', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/admin/auth/setup-needed', { cache: 'no-store' }),
      ]);
      const setupData = await setupRes.json().catch(() => ({ setupNeeded: false }));
      setSetupNeeded(!!setupData.setupNeeded);
      if (meRes.ok) {
        const { user } = await meRes.json();
        setUser(user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email, password) => {
    const res = await fetch('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || 'Login failed' };
    setUser(data.user);
    return { ok: true };
  }, []);

  const setup = useCallback(async (email, password, displayName) => {
    const res = await fetch('/api/admin/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, displayName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || 'Setup failed' };
    setUser(data.user);
    setSetupNeeded(false);
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/admin/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
    setUser(null);
  }, []);

  const hasRole = (role) => {
    if (!user) return false;
    const hierarchy = { staff: 1, manager: 2, owner: 3 };
    return (hierarchy[user.role] || 0) >= (hierarchy[role] || 99);
  };

  return (
    <AdminContext.Provider
      value={{
        user,
        loading,
        setupNeeded,
        isAuthenticated: !!user,
        login,
        logout,
        setup,
        refresh,
        hasRole,
      }}
    >
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used within AdminProvider');
  return ctx;
}

export default AdminContext;

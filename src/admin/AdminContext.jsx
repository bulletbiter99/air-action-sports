import { createContext, useContext, useState } from 'react';

// TODO: Replace with real API auth when backend is ready

const AdminContext = createContext(null);

export function AdminProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const login = (username, password) => {
    // TODO: Replace with real API auth when backend is ready
    if (username === 'admin' && password === 'admin123') {
      setIsAuthenticated(true);
      return true;
    }
    return false;
  };

  const logout = () => {
    setIsAuthenticated(false);
  };

  return (
    <AdminContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error('useAdmin must be used within an AdminProvider');
  }
  return context;
}

export default AdminContext;

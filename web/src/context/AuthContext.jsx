import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { auth, ApiError, onSessionExpired, isConnectionError } from '../api.js';

const AuthContext = createContext(null);

// Remembers (per browser) that someone signed in here, so the home route can skip the auth-check spinner
// for first-time and signed-out visitors and show the landing page straight away.
const HINT_KEY = 'dm:signed-in';
export function hasSignedInHint() {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}
function setSignedInHint(on) {
  try {
    if (on) localStorage.setItem(HINT_KEY, '1');
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // storage unavailable; the hint is only an optimisation
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // The backend is unreachable, which is different from the user simply being signed out.
  const [backendDown, setBackendDown] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await auth.me();
      setUser(data.user);
      setSignedInHint(true);
      setBackendDown(false);
    } catch (err) {
      setUser(null);
      if (!isConnectionError(err)) setSignedInHint(false);
      setBackendDown(isConnectionError(err));
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => onSessionExpired(() => {
      setUser(null);
      setSignedInHint(false);
    }), []);

  const login = useCallback(async (email, password) => {
    const data = await auth.login(email, password);
    setUser(data.user);
    setSignedInHint(true);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } catch {
      // ignore network errors on logout, still clear local state
    }
    setUser(null);
    setSignedInHint(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, backendDown, login, logout, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { ApiError };

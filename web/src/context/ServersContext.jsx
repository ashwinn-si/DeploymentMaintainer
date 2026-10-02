import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { serversApi } from '../api.js';

const ServersContext = createContext(null);

// Shared registry list for the Servers page and the sidebar switcher.
// `servers` stays null until the first load finishes.
export function ServersProvider({ children }) {
  const [servers, setServers] = useState(null);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await serversApi.list();
      if (!mountedRef.current) return data.servers;
      setServers(data.servers);
      setError(null);
      return data.servers;
    } catch (err) {
      if (mountedRef.current) setError(err);
      return null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const value = useMemo(() => ({ servers, error, refresh }), [servers, error, refresh]);
  return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>;
}

export function useServers() {
  const ctx = useContext(ServersContext);
  if (!ctx) throw new Error('useServers must be used within ServersProvider');
  return ctx;
}

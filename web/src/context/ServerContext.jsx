import { createContext, useCallback, useContext, useMemo } from 'react';
import { serverApi } from '../api.js';

const ServerContext = createContext(null);

export function ServerProvider({ server, children }) {
  const serverId = server.id;
  const api = useMemo(() => serverApi(serverId), [serverId]);
  // '/apps/1' -> '/s/<id>/apps/1'; '/' or '' -> '/s/<id>'
  const serverPath = useCallback((path = '/') => `/s/${serverId}${path === '/' ? '' : path}`, [serverId]);
  const value = useMemo(() => ({ server, api, serverPath }), [server, api, serverPath]);
  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServer() {
  const ctx = useContext(ServerContext);
  if (!ctx) throw new Error('useServer must be used within a server route');
  return ctx;
}

// Null outside /s/:serverId (Sidebar, Navbar and DiskBanner render in both places).
export function useOptionalServer() {
  return useContext(ServerContext);
}

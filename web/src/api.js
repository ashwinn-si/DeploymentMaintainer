const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

// Absolute (or same-origin, when VITE_API_URL is empty) URL for a control plane `/api` path.
export function apiUrl(path) {
  return `${API_URL}/api${path}`;
}

export class ApiError extends Error {
  constructor(status, message, issues) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
  }
}

const CONNECTION_MESSAGE = "Can't reach the server. Check that the backend is running and try again.";

// True for network failures and gateway errors, i.e. the backend is down rather than rejecting the request.
export function isConnectionError(err) {
  return err instanceof ApiError && (err.status === 0 || (err.status >= 500 && err.message === CONNECTION_MESSAGE));
}

const SESSION_EXPIRED_EVENT = 'session-expired';

function dispatchSessionExpired() {
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

export function onSessionExpired(handler) {
  window.addEventListener(SESSION_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
}

export function toQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function request(path, options = {}) {
  const { method = 'GET', body, headers, ...rest } = options;

  let res;
  try {
    res = await fetch(apiUrl(path), {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...rest,
    });
  } catch (err) {
    // Aborted requests are the caller's doing, not an outage.
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, CONNECTION_MESSAGE);
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const isAuthCheck = path === '/auth/login' || path === '/auth/me';
    if (res.status === 401 && !isAuthCheck) {
      dispatchSessionExpired();
    }
    // A dev proxy or gateway answers 5xx with an empty or HTML body when the backend is down.
    const gatewayDown = !data?.error && res.status >= 500;
    throw new ApiError(res.status, gatewayDown ? CONNECTION_MESSAGE : (data?.error ?? res.statusText), data?.issues);
  }

  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path, body) => request(path, { method: 'DELETE', body }),
};

export const auth = {
  // Bounded: a hung backend must not leave the app waiting forever to learn whether you are signed in.
  me: () => request('/auth/me', { signal: AbortSignal.timeout(8000) }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
};

export const serversApi = {
  list: () => api.get('/servers'),
  get: (id) => api.get(`/servers/${id}`),
  create: (body) => api.post('/servers', body),
  update: (id, body) => api.patch(`/servers/${id}`, body),
  rotateSecret: (id, secret) => api.post(`/servers/${id}/secret`, { secret }),
  remove: (id) => api.delete(`/servers/${id}`),
};

export const accountApi = {
  changePassword: (body) => api.post('/settings/password', body),
};

// `serverId` is the control plane's Server record id (not SERVER_ID); the control
// plane proxies everything under this prefix to that server's agent.
export function serverApi(serverId) {
  const base = `/servers/${serverId}/api`;
  const get = (path) => api.get(`${base}${path}`);
  const post = (path, body) => api.post(`${base}${path}`, body);
  const patch = (path, body) => api.patch(`${base}${path}`, body);
  const del = (path, body) => api.delete(`${base}${path}`, body);

  return {
    repos: {
      list: (q, refresh) => get(`/repos${toQuery({ q, refresh: refresh ? 1 : undefined })}`),
      branches: (owner, repo) => get(`/repos/${owner}/${repo}/branches`),
      nodeVersion: (owner, repo, ref) => get(`/repos/${owner}/${repo}/node-version${toQuery({ ref })}`),
      detectProject: (owner, repo, ref) => get(`/repos/${owner}/${repo}/detect-project${toQuery({ ref })}`),
    },
    apps: {
      list: () => get('/apps'),
      defaults: (name, kind, preset) => get(`/apps/defaults${toQuery({ name, kind, preset })}`),
      create: (body) => post('/apps', body),
      get: (id) => get(`/apps/${id}`),
      update: (id, body) => patch(`/apps/${id}`, body),
      remove: (id, confirmName) => del(`/apps/${id}`, { confirmName }),
      duplicate: (id, body) => post(`/apps/${id}/duplicate`, body),
      deploy: (id, body) => post(`/apps/${id}/deploy`, body),
      restart: (id) => post(`/apps/${id}/restart`),
      stop: (id) => post(`/apps/${id}/stop`),
      logs: (id, lines = 200) => get(`/apps/${id}/logs${toQuery({ lines })}`),
      deployments: (id, { limit, before } = {}) => get(`/apps/${id}/deployments${toQuery({ limit, before })}`),
    },
    deployments: {
      list: (params = {}) => get(`/deployments${toQuery(params)}`),
      active: () => get('/deployments/active'),
      get: (id) => get(`/deployments/${id}`),
      entries: (id, after = -1, limit = 2000) => get(`/deployments/${id}/entries${toQuery({ after, limit })}`),
      streamUrl: (id, after = -1) => apiUrl(`${base}/deployments/${id}/stream${toQuery({ after })}`),
      downloadUrl: (id) => apiUrl(`${base}/deployments/${id}/download`),
      cancel: (id) => post(`/deployments/${id}/cancel`),
      rollback: (id) => post(`/deployments/${id}/rollback`),
    },
    ports: {
      list: () => get('/ports'),
    },
    node: {
      versions: () => get('/node/versions'),
    },
    system: {
      get: () => get('/system'),
    },
    settings: {
      info: () => get('/settings/info'),
    },
    config: {
      // POST /config/export returns a file attachment, not JSON, so callers use
      // fetch() + blob() (see lib/download.js).
      exportUrl: apiUrl(`${base}/config/export`),
      importPreview: (body) => post('/config/import/preview', body),
      importApply: (body) => post('/config/import', body),
    },
  };
}

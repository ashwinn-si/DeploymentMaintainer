export class ApiError extends Error {
  constructor(status, message, issues) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
  }
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

  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...rest,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const isAuthCheck = path === '/auth/login' || path === '/auth/me';
    if (res.status === 401 && !isAuthCheck) {
      dispatchSessionExpired();
    }
    throw new ApiError(res.status, data?.error ?? res.statusText, data?.issues);
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
  me: () => request('/auth/me'),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
};

export const reposApi = {
  list: (q, refresh) => api.get(`/repos${toQuery({ q, refresh: refresh ? 1 : undefined })}`),
  branches: (owner, repo) => api.get(`/repos/${owner}/${repo}/branches`),
  nodeVersion: (owner, repo, ref) => api.get(`/repos/${owner}/${repo}/node-version${toQuery({ ref })}`),
};

export const appsApi = {
  list: () => api.get('/apps'),
  defaults: (name) => api.get(`/apps/defaults${toQuery({ name })}`),
  create: (body) => api.post('/apps', body),
  get: (id) => api.get(`/apps/${id}`),
  update: (id, body) => api.patch(`/apps/${id}`, body),
  remove: (id, confirmName) => api.delete(`/apps/${id}`, { confirmName }),
  duplicate: (id, body) => api.post(`/apps/${id}/duplicate`, body),
  deploy: (id, body) => api.post(`/apps/${id}/deploy`, body),
  restart: (id) => api.post(`/apps/${id}/restart`),
  stop: (id) => api.post(`/apps/${id}/stop`),
  logs: (id, lines = 200) => api.get(`/apps/${id}/logs${toQuery({ lines })}`),
  deployments: (id, { limit, before } = {}) => api.get(`/apps/${id}/deployments${toQuery({ limit, before })}`),
};

export const deploymentsApi = {
  list: (params = {}) => api.get(`/deployments${toQuery(params)}`),
  active: () => api.get('/deployments/active'),
  get: (id) => api.get(`/deployments/${id}`),
  entries: (id, after = -1, limit = 2000) => api.get(`/deployments/${id}/entries${toQuery({ after, limit })}`),
  streamUrl: (id, after = -1) => `/api/deployments/${id}/stream${toQuery({ after })}`,
  downloadUrl: (id) => `/api/deployments/${id}/download`,
  cancel: (id) => api.post(`/deployments/${id}/cancel`),
  rollback: (id) => api.post(`/deployments/${id}/rollback`),
};

export const portsApi = {
  list: () => api.get('/ports'),
};

export const nodeApi = {
  versions: () => api.get('/node/versions'),
};

export const systemApi = {
  get: () => api.get('/system'),
};

export const settingsApi = {
  info: () => api.get('/settings/info'),
  changePassword: (body) => api.post('/settings/password', body),
};

export const configApi = {
  // No exportConfig helper here on purpose: POST /config/export returns a file
  // attachment, not JSON, so callers use fetch() + blob() directly (see Settings.jsx).
  importPreview: (body) => api.post('/config/import/preview', body),
  importApply: (body) => api.post('/config/import', body),
};

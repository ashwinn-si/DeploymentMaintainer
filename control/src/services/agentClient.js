import { HttpError } from '../lib/httpError.js';

const TIMEOUT_MS = 5000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const SECRET_REJECTED =
  'The server rejected the secret — check SERVER_SECRET in its .env and reload it';

// `code` lets the status probe tell "unauthorized" apart from "offline" without parsing messages.
function fail(status, message, code) {
  const err = new HttpError(status, message);
  err.code = code;
  return err;
}

export function normalizeServerUrl(input, config) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new HttpError(400, 'Invalid server URL');
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  const okProtocol =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && (local || config.ALLOW_INSECURE_SERVER_URLS));
  if (!okProtocol) {
    throw new HttpError(400, 'Invalid server URL');
  }
  return url.origin;
}

async function agentFetch(url, pathname, { secret } = {}) {
  try {
    return await fetch(`${url}${pathname}`, {
      headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Never follow a redirect with a bearer attached.
      redirect: 'manual',
    });
  } catch {
    throw fail(502, `Could not reach the server at ${url}`, 'unreachable');
  }
}

export async function handshake(url) {
  const res = await agentFetch(url, '/deployment-manager');
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || body?.service !== 'deployment-maintainer') {
    throw fail(502, 'That URL is not a Deployment Maintainer server', 'not_dm');
  }
  return { serverId: body.serverId, version: body.version ?? null };
}

export async function checkAuth(url, secret) {
  const res = await agentFetch(url, '/api/auth/check', { secret });
  if (res.status === 401) {
    throw fail(400, SECRET_REJECTED, 'unauthorized');
  }
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || body?.ok !== true) {
    throw fail(502, `The server returned an unexpected response (${res.status})`, 'unexpected');
  }
  return { serverId: body.serverId, hostname: body.hostname ?? null };
}

export async function verifyServer({ url, serverId, secret }) {
  const info = await handshake(url);
  if (info.serverId !== serverId) {
    throw fail(
      400,
      `Server ID mismatch: the server reports "${info.serverId}" — check SERVER_ID in its .env`,
      'mismatch',
    );
  }
  const auth = await checkAuth(url, secret);
  return { version: info.version, hostname: auth.hostname };
}

export async function probeServer(target) {
  try {
    const { version, hostname } = await verifyServer(target);
    return { status: 'online', version, hostname };
  } catch (err) {
    if (err.code === 'unauthorized') return { status: 'unauthorized' };
    return { status: 'offline' };
  }
}

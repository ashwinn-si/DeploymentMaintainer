import { HttpError } from './httpError.js';

const OWNER_RE = /^[A-Za-z0-9-]{1,39}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
// Characters that are meaningless or dangerous in a git ref/branch name, plus
// anything that could be mistaken for a CLI flag by a downstream `git`/`fnm`
// invocation (guarded separately via the leading-"-" check below).
const REF_FORBIDDEN_CHARS_RE = /[\s~^:?*[\\`]/;

export function validateOwner(owner) {
  if (typeof owner !== 'string' || !OWNER_RE.test(owner)) {
    throw new HttpError(400, 'Invalid repository owner');
  }
  return owner;
}

export function validateRepo(repo) {
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) {
    throw new HttpError(400, 'Invalid repository name');
  }
  return repo;
}

/**
 * Validates a git ref/branch name: shared by the GitHub service (stage 2)
 * and app branch handling (stage 3). Rejects path traversal (".."), spaces,
 * git/glob metacharacters, a leading "-" (would look like a flag to git),
 * and anything over 255 chars.
 */
export function validateRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 255) {
    throw new HttpError(400, 'Invalid git ref');
  }
  if (ref.includes('..') || ref.startsWith('-') || REF_FORBIDDEN_CHARS_RE.test(ref)) {
    throw new HttpError(400, 'Invalid git ref');
  }
  return ref;
}

// Reserved names: paths this server's own Nginx site already claims.
export const RESERVED_APP_NAMES = new Set(['api', 'deployment-manager']);

const APP_NAME_RE = /^[a-z0-9-]{1,40}$/;

export function validateAppName(name) {
  if (typeof name !== 'string' || !APP_NAME_RE.test(name)) {
    throw new HttpError(400, 'App name must be 1-40 lowercase letters, digits or hyphens');
  }
  if (RESERVED_APP_NAMES.has(name)) {
    throw new HttpError(400, `"${name}" is a reserved name`);
  }
  return name;
}

export function validatePort(port) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) {
    throw new HttpError(400, 'Port must be an integer between 1024 and 65535');
  }
  return n;
}

const NODE_VERSION_RE = /^\d+(\.\d+){0,2}$/;

export function validateNodeVersion(version) {
  if (typeof version !== 'string' || (version !== 'lts' && !NODE_VERSION_RE.test(version))) {
    throw new HttpError(400, 'Invalid Node version');
  }
  return version;
}

const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

export function validateEnvKey(key) {
  if (typeof key !== 'string' || !ENV_KEY_RE.test(key)) {
    throw new HttpError(400, `Invalid env key: ${key}`);
  }
  return key;
}

export function validateEnvValue(value) {
  if (typeof value !== 'string' || /[\n\r\0]/.test(value)) {
    throw new HttpError(400, 'Env value must not contain newlines or null bytes');
  }
  return value;
}

const COMMIT_SHA_RE = /^[0-9a-f]{7,40}$/;

export function validateCommitSha(sha) {
  if (typeof sha !== 'string' || !COMMIT_SHA_RE.test(sha)) {
    throw new HttpError(400, 'Invalid commit sha');
  }
  return sha;
}

const NGINX_PATH_RE = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;

export function validateNginxPath(nginxPath) {
  if (typeof nginxPath !== 'string' || !NGINX_PATH_RE.test(nginxPath)) {
    throw new HttpError(400, 'Invalid nginx path');
  }
  return nginxPath;
}

const HEALTHCHECK_PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;

export function validateHealthCheckPath(healthPath) {
  if (typeof healthPath !== 'string' || healthPath.length > 200 || !HEALTHCHECK_PATH_RE.test(healthPath)) {
    throw new HttpError(400, 'Invalid health check path');
  }
  return healthPath;
}

const ENV_FILENAME_RE = /^\.?[A-Za-z0-9._-]{1,64}$/;

export function validateEnvFilename(filename) {
  const isDotOrDotDot = filename === '.' || filename === '..';
  if (typeof filename !== 'string' || isDotOrDotDot || !ENV_FILENAME_RE.test(filename)) {
    throw new HttpError(400, 'Invalid env filename');
  }
  return filename;
}

const STATIC_DIR_RE = /^\.($|\/)|^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;

export function validateStaticDir(staticDir) {
  if (
    typeof staticDir !== 'string' ||
    staticDir.length === 0 ||
    staticDir.length > 200 ||
    staticDir.includes('..') ||
    staticDir.startsWith('/') ||
    staticDir.startsWith('-') ||
    !STATIC_DIR_RE.test(staticDir)
  ) {
    throw new HttpError(400, 'Invalid static directory path');
  }
  return staticDir;
}

// Wraps a throwing validate* function for use in a zod .refine(); undefined
// passes through so it composes with .optional().
export function refinable(validator) {
  return (value) => {
    if (value === undefined) return true;
    try {
      validator(value);
      return true;
    } catch {
      return false;
    }
  };
}

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

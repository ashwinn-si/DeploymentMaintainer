import { lazy } from 'react';

const RELOAD_KEY = 'chunk-reload-at';
const RELOAD_WINDOW_MS = 10_000;

// After a new deploy the old hashed chunks are gone, so a tab opened before it fails to load
// the next page. Reload once to pick up the new build; the window stops an endless reload loop.
export function reloadOnceForNewBuild() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage unavailable: still reload once, the browser caches the new index
  }
  window.location.reload();
  return true;
}

export function lazyWithReload(factory) {
  return lazy(() =>
    factory().catch((err) => {
      if (reloadOnceForNewBuild()) return new Promise(() => {}); // page is reloading
      throw err;
    }),
  );
}

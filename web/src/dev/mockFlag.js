// Tiny, side-effect-free flag check kept separate from mockApi.js so it's cheap
// to import from hot paths (api layer, hooks) without pulling in the fixture data.
export function isMockEnabled() {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem('mockApi') === '1';
  } catch {
    return false;
  }
}

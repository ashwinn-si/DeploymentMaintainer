const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// CSRF defence for the cookie session. Sibling subdomains (e.g. deployed apps) are same-site, so
// the Lax cookie would be attached to their cross-origin writes; reject any state-changing request
// whose Origin is neither an allowed UI origin nor this server itself. No Origin (curl,
// server-to-server) is allowed: browsers always send Origin on cross-origin writes.
export function createOriginCheck(config) {
  const allowed = new Set(config.CORS_ORIGINS ?? []);
  return function originCheck(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (!origin) return next();
    if (allowed.has(origin) || origin === `${req.protocol}://${req.get('host')}`) return next();
    return res.status(403).json({ error: 'Origin not allowed' });
  };
}

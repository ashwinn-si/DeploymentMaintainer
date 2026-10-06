import App from '../models/App.js';
import { HttpError } from '../lib/httpError.js';

// The URL path an app is served at, or null when its nginx step is off (localhost only).
export function routePathFor(name, steps) {
  const nginxStep = (steps || []).find((s) => s.type === 'nginx');
  if (!nginxStep?.enabled) return null;
  return nginxStep.config?.path || `/${name}`;
}

// Two apps on one path make Nginx silently serve only one of them, so refuse it up front.
export async function assertRoutePathFree(name, steps, { excludeId = null, alsoTaken = new Set() } = {}) {
  const wanted = routePathFor(name, steps);
  if (!wanted) return;
  if (alsoTaken.has(wanted)) {
    throw new HttpError(409, `The path ${wanted} is already used by another app in this request`);
  }
  const query = excludeId ? { _id: { $ne: excludeId } } : {};
  const others = await App.find(query, 'name steps').lean();
  const clash = others.find((other) => routePathFor(other.name, other.steps) === wanted);
  if (clash) {
    throw new HttpError(409, `The path ${wanted} is already used by app "${clash.name}". Change this app's Nginx path.`);
  }
}

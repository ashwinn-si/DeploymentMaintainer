import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import App from '../models/App.js';
import RequestStat from '../models/RequestStat.js';
import { HttpError } from '../lib/httpError.js';
import { applyAppRoute, isAccessLogDirReady } from '../services/nginx.js';
import { getAnalyticsWarnings } from '../services/analytics.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// bucket = granularity of `series`; buckets = how many (current, partial one included).
// 1h is coarse on purpose: the data is hourly, so it shows the previous and the current hour bucket.
const RANGES = {
  '1h': { bucket: 'hour', buckets: 2 },
  '24h': { bucket: 'hour', buckets: 24 },
  '7d': { bucket: 'day', buckets: 7 },
  '30d': { bucket: 'day', buckets: 30 },
};

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

const querySchema = z.object({
  range: z.enum(['1h', '24h', '7d', '30d']).default('24h'),
  apps: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : []))
    .refine((ids) => ids.every((id) => OBJECT_ID_RE.test(id)), { message: 'apps must be a comma-separated list of app ids' }),
});

function emptyTotals() {
  return { total: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0, bytes: 0 };
}

function add(target, row) {
  target.total += row.total ?? 0;
  target.s2xx += row.s2xx ?? 0;
  target.s3xx += row.s3xx ?? 0;
  target.s4xx += row.s4xx ?? 0;
  target.s5xx += row.s5xx ?? 0;
  target.bytes += row.bytes ?? 0;
}

export function createAnalyticsRouter(config) {
  const router = Router();
  router.use(requireAuth(config));

  router.get('/', async (req, res) => {
    const { range, apps: requestedIds } = querySchema.parse(req.query);
    const { bucket, buckets } = RANGES[range];
    const now = Date.now();
    const bucketMs = bucket === 'hour' ? HOUR_MS : DAY_MS;
    const lastBucket = Math.floor(now / bucketMs) * bucketMs;
    const firstBucket = lastBucket - (buckets - 1) * bucketMs;

    const appFilter = requestedIds.length > 0 ? { _id: { $in: requestedIds } } : {};
    const apps = await App.find(appFilter).select('_id name').lean();
    const appIds = apps.map((a) => a._id);

    const rows = await RequestStat.find({ appId: { $in: appIds }, hour: { $gte: new Date(firstBucket) } }).lean();

    const perApp = new Map(apps.map((a) => [String(a._id), { id: String(a._id), name: a.name, ...emptyTotals() }]));
    const status = emptyTotals();
    const series = [];
    const seriesByTime = new Map();
    for (let t = firstBucket; t <= lastBucket; t += bucketMs) {
      const point = { t: new Date(t).toISOString(), total: 0, perApp: Object.fromEntries(apps.map((a) => [String(a._id), 0])) };
      series.push(point);
      seriesByTime.set(t, point);
    }
    const hoursOfDay = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0 }));

    for (const row of rows) {
      const id = String(row.appId);
      const appTotals = perApp.get(id);
      if (!appTotals) continue;
      const hourMs = new Date(row.hour).getTime();
      const point = seriesByTime.get(Math.floor(hourMs / bucketMs) * bucketMs);
      if (!point) continue;

      add(appTotals, row);
      add(status, row);
      point.total += row.total ?? 0;
      point.perApp[id] += row.total ?? 0;
      hoursOfDay[new Date(hourMs).getUTCHours()].total += row.total ?? 0;
    }

    res.json({
      enabled: Boolean(config.ANALYTICS_ENABLED),
      logDirReady: await isAccessLogDirReady(config),
      range,
      from: new Date(firstBucket).toISOString(),
      to: new Date(now).toISOString(),
      bucket,
      apps: [...perApp.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
      series,
      status: { s2xx: status.s2xx, s3xx: status.s3xx, s4xx: status.s4xx, s5xx: status.s5xx },
      busiestHours: hoursOfDay,
      warnings: getAnalyticsWarnings().filter((w) => apps.some((a) => a.name === w.app)),
    });
  });

  // Rewrites each app's Nginx route so it carries the access_log directive (and reloads Nginx when something changed).
  router.post('/setup', async (req, res) => {
    if (!config.ANALYTICS_ENABLED) {
      throw new HttpError(400, 'Analytics is disabled on this server (ANALYTICS_ENABLED=false)');
    }
    if (!(await isAccessLogDirReady(config))) {
      throw new HttpError(
        409,
        `The access log directory ${config.ACCESS_LOG_DIR} does not exist. Create it on the server first (see DEPLOYMENT.md 4.11), then try again.`,
      );
    }

    const apps = await App.find().sort({ name: 1 });
    let updated = 0;
    const skipped = [];
    const errors = [];

    for (const app of apps) {
      const step = app.steps.find((s) => s.type === 'nginx');
      if (!step || !step.enabled) {
        skipped.push({ app: app.name, reason: 'Nginx routing is turned off for this app' });
        continue;
      }
      if (!config.NGINX_ENABLED) {
        skipped.push({ app: app.name, reason: 'Nginx is disabled on this server (NGINX_ENABLED=false)' });
        continue;
      }
      try {
        const result = await applyAppRoute(app, { config, stepConfig: step.config ?? {} });
        if (result.applied) updated += 1;
      } catch (err) {
        errors.push({ app: app.name, message: err.message });
      }
    }

    res.json({ updated, skipped, errors });
  });

  return router;
}

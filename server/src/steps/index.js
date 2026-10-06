import { z } from 'zod';
import * as gitSync from './gitSync.js';
import * as nodeSetup from './nodeSetup.js';
import * as writeEnv from './writeEnv.js';
import * as install from './install.js';
import * as build from './build.js';
import * as custom from './custom.js';
import * as pm2 from './pm2.js';
import * as healthCheck from './healthCheck.js';
import * as nginx from './nginx.js';
import * as publish from './publish.js';
import { tokenizeCommand } from '../services/shell.js';
import { HttpError } from '../lib/httpError.js';
import {
  validateNginxPath,
  validateHealthCheckPath,
  validateEnvFilename,
  validateStaticDir,
  refinable,
} from '../lib/validate.js';

export const REGISTRY = { gitSync, nodeSetup, writeEnv, install, build, custom, pm2, healthCheck, nginx, publish };

// The 3b runner must call run() for these even when `enabled: false` so they
// can react to being turned off (nginx removes a now-stale route file).
export const ALWAYS_INVOKE = new Set(['nginx']);

// The admin can't disable these from the steps editor.
const ALWAYS_ENABLED = new Set(['gitSync', 'nodeSetup']);

const commandConfigSchema = z.object({ command: z.string().min(1).optional() }).passthrough();

const STEP_CONFIG_SCHEMAS = {
  gitSync: z.object({}).passthrough(),
  nodeSetup: z.object({}).passthrough(),
  writeEnv: z
    .object({ filename: z.string().min(1).optional().refine(refinable(validateEnvFilename), { message: 'Invalid env filename' }) })
    .passthrough(),
  install: commandConfigSchema,
  build: commandConfigSchema,
  custom: z.object({ command: z.string().min(1), label: z.string().min(1).optional() }).passthrough(),
  pm2: commandConfigSchema,
  publish: z
    .object({
      staticDir: z
        .string()
        .optional()
        .refine(refinable(validateStaticDir), { message: 'Invalid static directory' }),
    })
    .passthrough(),
  healthCheck: z
    .object({
      path: z
        .string()
        .min(1)
        .optional()
        .refine(refinable(validateHealthCheckPath), { message: 'Invalid health check path' }),
      timeoutSec: z.number().int().positive().optional(),
      intervalSec: z.number().int().positive().optional(),
      autoRollback: z.boolean().optional(),
    })
    .passthrough(),
  nginx: z
    .object({
      path: z.string().optional().refine(refinable(validateNginxPath), { message: 'Invalid nginx path' }),
      stripPrefix: z.boolean().optional(),
      serveStatic: z.boolean().optional(),
      staticDir: z.string().optional().refine(refinable(validateStaticDir), { message: 'Invalid static directory' }),
    })
    .passthrough(),
};

export function defaultSteps(name, kind = 'node') {
  if (kind === 'static') {
    return [
      { type: 'gitSync', enabled: true, config: {} },
      { type: 'nodeSetup', enabled: false, config: {} },
      { type: 'writeEnv', enabled: false, config: { filename: '.env' } },
      { type: 'install', enabled: false, config: {} },
      { type: 'build', enabled: false, config: { command: 'npm run build' } },
      { type: 'publish', enabled: true, config: { staticDir: '.' } },
      { type: 'nginx', enabled: true, config: { path: `/${name}`, stripPrefix: true, serveStatic: true, staticDir: '.' } },
      {
        type: 'healthCheck',
        enabled: true,
        config: { path: '/', timeoutSec: 30, intervalSec: 2, autoRollback: true },
      },
    ];
  }
  return [
    { type: 'gitSync', enabled: true, config: {} },
    { type: 'nodeSetup', enabled: true, config: {} },
    { type: 'writeEnv', enabled: true, config: { filename: '.env' } },
    { type: 'install', enabled: true, config: {} },
    { type: 'build', enabled: false, config: { command: 'npm run build' } },
    { type: 'pm2', enabled: true, config: { command: 'npm start' } },
    {
      type: 'healthCheck',
      enabled: true,
      config: { path: '/', timeoutSec: 60, intervalSec: 2, autoRollback: true },
    },
    { type: 'nginx', enabled: true, config: { path: `/${name}`, stripPrefix: true } },
  ];
}

function validateStepConfig(rawType, rawConfig, index) {
  const schema = STEP_CONFIG_SCHEMAS[rawType];
  const result = schema.safeParse(rawConfig ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new HttpError(400, `Step ${index} (${rawType}): ${issues}`);
  }
  if (result.data.command) {
    try {
      tokenizeCommand(result.data.command);
    } catch (err) {
      throw new HttpError(400, `Step ${index} (${rawType}): invalid command — ${err.message}`);
    }
  }
  return result.data;
}

export function normalizeSteps(rawSteps, { kind = 'node' } = {}) {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new HttpError(400, 'steps must be a non-empty array');
  }

  const normalized = rawSteps.map((raw, index) => {
    if (!raw || typeof raw.type !== 'string' || !REGISTRY[raw.type]) {
      throw new HttpError(400, `Unknown step type at index ${index}: ${raw?.type}`);
    }
    const config = validateStepConfig(raw.type, raw.config, index);
    // Static apps never run Node, so nodeSetup may be off for them.
    const locked = ALWAYS_ENABLED.has(raw.type) && !(kind === 'static' && raw.type === 'nodeSetup');
    const enabled = locked ? true : Boolean(raw.enabled);
    return { type: raw.type, enabled, config };
  });

  if (normalized[0].type !== 'gitSync') {
    throw new HttpError(400, 'gitSync must be the first step');
  }
  if (!normalized.some((s) => s.type === 'nodeSetup')) {
    throw new HttpError(400, 'nodeSetup step is required');
  }
  if (kind === 'static') {
    if (!normalized.some((s) => s.type === 'publish' && s.enabled)) {
      throw new HttpError(400, 'Static apps need the publish step enabled');
    }
    if (!normalized.some((s) => s.type === 'nginx' && s.enabled)) {
      throw new HttpError(400, 'Static apps need the nginx step enabled, or nothing serves them');
    }
    if (normalized.some((s) => s.type === 'pm2' && s.enabled)) {
      throw new HttpError(400, 'Static apps cannot use the pm2 step');
    }
  }

  return normalized;
}
